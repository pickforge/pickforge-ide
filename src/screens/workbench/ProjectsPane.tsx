// Projects pane: a tree where each project owns its chats as collapsible
// children (there is no separate Chats pane). Projects keep list/grid views,
// collapsible groups, three-dots + right-click menus, inline rename, and DnD
// into a group; chats keep rename / archive / delete / drag-reorder. A toolbar
// control collapses or expands every project's chats at once.
import {
  type JSX,
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  onCleanup,
  Show,
  Switch,
} from "solid-js";
import { FloatingMenu } from "../../components/FloatingMenu";
import { Dropdown, type DropdownOption } from "../../components/Dropdown";
import { Collapse } from "../../components/ui";
import {
  IconChevronDown,
  IconChevronRight,
  IconClaude,
  IconCollapseAll,
  IconFolderPlus,
  IconGrid,
  IconList,
  IconMore,
  IconOmp,
  IconOpenAI,
  IconPi,
  IconPlus,
  IconTerminal,
} from "../../components/icons";
import {
  assignProject,
  createGroup,
  grouping,
  groupOf,
  removeGroup,
  renameGroup,
  setViewMode,
  toggleGroup,
  type ProjectGroup,
} from "../../stores/projectGrouping";
import {
  anyChatsExpanded,
  chatsExpanded,
  setAllChats,
  toggleChats,
} from "../../stores/chatTree";
import { archiveChat, isChatArchived, unarchiveChat } from "../../stores/chatArchive";
import { isChatTmux, recoverChatSessions } from "../../stores/chatSessions";
import type { Chat, Project } from "../../lib/db";
import {
  addChat,
  addProject,
  archiveProject,
  chatsFor,
  deleteChat,
  deleteProject,
  ensureChatsLoaded,
  findChat,
  migrateChatBackend,
  renameChat,
  renameProject,
  reorderChat,
  reorderProject,
  selectChat,
  selectProject,
  workspace,
} from "../../stores/workspace";
import { agentBackendDescriptor, normalizeAgentProvider } from "../../lib/agentBackends";
import {
  defaultNativeAgentProvider,
  nativeAgentProfile,
  nativeAgentProfiles,
} from "../../lib/agentModels";
import {
  loadAskChatTitle,
  loadDefaultChatKind,
  loadLastAgentProvider,
  setLastAgentProvider,
} from "../../lib/chatDefaults";
import { isPrimaryChat } from "../../lib/chatLabels";
import {
  chatTitleOverride,
  chatTitleSourceForPolicy,
  DEFAULT_CHAT_TITLE,
  markChatTitleManual,
  resumeChatTitleAuto,
} from "../../lib/chatAutoName";
import { chatAttention, chatBusy, clearChatActivity } from "../../stores/chatActivity";
import {
  type CardVisualState,
  chatActivityMs,
  chatCardVisualState,
  shortRelTime,
  sortFlatChats,
  visibleFlatChats,
} from "../../stores/flatChatSort";
import {
  cardBranch,
  cardBrief,
  cardContextEdge,
  cardCost,
  cardLanes,
  cardPlanProgress,
  cardSwarmRun,
  laneTickTone,
} from "../../stores/flatWorkCard";
import { formatCardCost } from "../../components/chat/ContextMeter";
import { agentChat, latestPlanForChat } from "../../stores/agentChat";
import { ensureProjectBranch, projectBranchOf } from "../../stores/projectBranch";
import { swarmRuns } from "../../stores/swarm";
import { removeChatFromOrchestra } from "../../stores/orchestra";
import { isChatStaged } from "../../stores/orchestraStage";
import { beforeIdForDrop, dropEdgeForRect, dropEdgeForRectX, type DropEdge } from "../../lib/dndReorder";
import { pickProjectDir } from "../../lib/opener";
import { flagEnabled } from "../../stores/flags";
import { setProjectRemoteLocal } from "../../stores/workspace";
import { createRemoteAttach } from "../../lib/remoteAttach";
import type { ProbeState } from "../../lib/remoteHost";
import {
  harnessForChat,
  useTerminalHarnessPolling,
} from "../../stores/terminalHarnesses";
import {
  healthOf,
  healthStatus,
  healthSummary,
  probeText,
  recordHealth,
  refreshHost,
  relTime,
  useRemoteHealth,
} from "../../stores/remoteHealth";

const PROJECT_MIME = "application/x-pf-project";

// Brand mark per harness, replacing the old two-letter CC/CX/OM/PI badges
// (issue #300). Falls back to no icon (plain "AI" text) for an agent id the
// app doesn't recognize.
const AGENT_CHAT_ICON: Readonly<Partial<Record<string, () => JSX.Element>>> = Object.freeze({
  claudeCode: () => <IconClaude size={11} />,
  codex: () => <IconOpenAI size={11} />,
  omp: () => <IconOmp size={11} />,
  pi: () => <IconPi size={11} />,
});
const TERMINAL_AGENT_ID = "terminal";
export type ChatMarkKind = "terminal" | "agent";
const agentChatProvider = (agentId: string): string => normalizeAgentProvider(agentId) ?? agentId;
const agentChatLabel = (agentId: string): string =>
  agentBackendDescriptor(agentChatProvider(agentId))?.label ?? "Agent";
export const chatMarkKind = (chat: Chat): ChatMarkKind | null =>
  chat.kind === "terminal" ? "terminal" : chat.kind === "agent" ? "agent" : null;
const terminalHarnessFor = (chat: Chat) =>
  chatMarkKind(chat) === "terminal" ? harnessForChat(chat.chatId) : null;
const chatMarkLabel = (chat: Chat): string => {
  const harness = terminalHarnessFor(chat);
  return chatMarkKind(chat) === "terminal"
    ? harness ? `Terminal · ${agentChatLabel(harness)}` : "Terminal"
    : `Agent chat · ${agentChatLabel(chat.agentId)}`;
};
const ChatMarkIcon = (props: { chat: Chat }) => (
  <Show when={chatMarkKind(props.chat) === "terminal"} fallback={
    <Show when={AGENT_CHAT_ICON[agentChatProvider(props.chat.agentId)]} fallback="AI">
      {(icon) => icon()()}
    </Show>
  }>
    <IconTerminal size={11} />
    <Show when={terminalHarnessFor(props.chat)}>
      {(harness) => AGENT_CHAT_ICON[harness()]?.()}
    </Show>
  </Show>
);

function basename(path: string): string {
  return path.replace(/[/\\]+$/, "").split(/[/\\]/).pop() || path;
}
async function pickProject() {
  const dir = await pickProjectDir();
  if (dir) await addProject(dir, basename(dir));
}
function openProject(root: string): void {
  void selectProject(root);
}

type MenuKind = "project" | "group" | "chat" | "newchat" | "confirm" | "remote" | "flatNewChat";
interface MenuState { kind: MenuKind; id: string; x: number; y: number; align: "start" | "end" }

interface PendingConfirm {
  text: string;
  label: string;
  danger?: boolean;
  run: () => void;
}

interface ChatDragState {
  id: string;
  root: string;
  title: string;
  x: number;
  y: number;
  targetId: string | null;
  edge: DropEdge | null;
}

/** The floating-menu open/close/confirm-step state shared by every menu
 *  variant. A composable, called synchronously from
 *  `createProjectsPaneController`'s own setup so its `onCleanup` runs under
 *  the same reactive owner as if written inline. */
function createProjectsMenuState() {
  const [menu, setMenu] = createSignal<MenuState | null>(null);
  const [renaming, setRenaming] = createSignal<string | null>(null);
  // Destructive menu actions swap the open menu for a confirm step in place —
  // the action only runs on the explicit confirm click.
  const [pendingConfirm, setPendingConfirm] = createSignal<PendingConfirm | null>(null);

  const closeMenu = () => {
    setMenu(null);
    setPendingConfirm(null);
  };
  onCleanup(closeMenu);

  const askConfirm = (confirm: PendingConfirm) => {
    setPendingConfirm(confirm);
    setMenu((m) => (m ? { ...m, kind: "confirm" } : m));
  };

  const openFromButton = (kind: MenuKind, id: string, e: MouseEvent) => {
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu((m) => (m?.id === id && m.kind === kind ? null : { kind, id, x: r.right, y: r.bottom + 4, align: "end" }));
  };
  const openFromContext = (kind: MenuKind, id: string, e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ kind, id, x: e.clientX, y: e.clientY, align: "start" });
  };

  return { menu, setMenu, renaming, setRenaming, pendingConfirm, closeMenu, askConfirm, openFromButton, openFromContext };
}

/** Project drag-to-reorder and drag-into-group state. A composable, called
 *  synchronously from `createProjectsPaneController`'s own setup so its
 *  signals live under the same reactive owner as if written inline. */
function createProjectDragState() {
  const [dropGroup, setDropGroup] = createSignal<string | null>(null); // group id or "__ungrouped"
  // Reorder indicator: the row being hovered + which edge the drop lands on, for
  // both chat reorder and project reorder. A thin line renders on that edge.
  const [dropMark, setDropMark] = createSignal<{ kind: "chat" | "project"; id: string; edge: DropEdge } | null>(null);

  const markEdge = (kind: "chat" | "project", id: string, axis: "x" | "y" = "y") => (e: DragEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const edge = axis === "x" ? dropEdgeForRectX(e.clientX, rect) : dropEdgeForRect(e.clientY, rect);
    setDropMark({ kind, id, edge });
  };
  const clearMark = (kind: "chat" | "project", id: string) =>
    setDropMark((m) => (m && m.kind === kind && m.id === id ? null : m));
  const edgeFor = (kind: "chat" | "project", id: string): DropEdge | null => {
    const m = dropMark();
    return m && m.kind === kind && m.id === id ? m.edge : null;
  };

  // ---- project drag (reorder + assign to group) ----
  const projectDragStart = (root: string, e: DragEvent) => {
    e.dataTransfer?.setData(PROJECT_MIME, root);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
    // Ghost only the dragged row header, never the expanded chats subtree below
    // it — without this the browser can snapshot the whole tree node and produce
    // a huge, unwieldy drag image.
    const row = e.currentTarget as HTMLElement;
    e.dataTransfer?.setDragImage(row, 12, row.offsetHeight / 2);
  };
  const allowProjectDrop = (e: DragEvent) => {
    if (e.dataTransfer?.types.includes(PROJECT_MIME)) {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    }
  };
  const dropIntoGroup = (groupId: string | null, e: DragEvent) => {
    const root = e.dataTransfer?.getData(PROJECT_MIME);
    setDropGroup(null);
    if (!root) return;
    e.preventDefault();
    e.stopPropagation();
    assignProject(root, groupId);
  };

  // ---- project reorder (within the list) ----
  const dropProjectReorder = (targetRoot: string, e: DragEvent) => {
    const root = e.dataTransfer?.getData(PROJECT_MIME);
    const edge = edgeFor("project", targetRoot);
    setDropMark(null);
    if (!root || !edge) return;
    e.preventDefault();
    e.stopPropagation();
    // A row-level drop reorders globally; when the target lives in a different
    // group, also reassign the dragged project so the move sticks (this handler
    // stops propagation, so the group body's dropIntoGroup never fires).
    const targetGroup = groupOf(targetRoot);
    if (groupOf(root) !== targetGroup) assignProject(root, targetGroup);
    const order = workspace.projects.map((p) => p.projectRoot);
    void reorderProject(root, beforeIdForDrop(order, targetRoot, edge));
  };

  return {
    dropGroup,
    setDropGroup,
    setDropMark,
    markEdge,
    clearMark,
    edgeFor,
    projectDragStart,
    allowProjectDrop,
    dropIntoGroup,
    dropProjectReorder,
  };
}

// Pointer-based chat reorder drag (within a project), not HTML5 dnd: webkit's
// drag events were unreliable here (missed targets in row gaps, giant default
// drag images, delayed drops). A pressed row past a small threshold becomes a
// compact floating ghost; the slot it would land in renders an ember line,
// matching the lane drag accent. A composable, called synchronously from
// `createProjectsPaneController`'s own setup so its signal lives under the
// same reactive owner as if written inline.
function createChatDragState() {
  const chatRowEls = new Map<string, HTMLElement>();
  const [chatDrag, setChatDrag] = createSignal<ChatDragState | null>(null);
  let suppressChatClick = false;

  const chatDragEdge = (id: string): DropEdge | null => {
    const d = chatDrag();
    return d && d.targetId === id ? d.edge : null;
  };

  const startChatDrag = (e: PointerEvent, chat: Chat, root: string) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button, input")) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const orderIds = () =>
      chatsFor(root)
        .filter((c) => !isChatArchived(c.chatId) && isPrimaryChat(c))
        .map((c) => c.chatId);
    let active = false;

    const move = (ev: PointerEvent) => {
      if (!active) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 5) return;
        active = true;
      }
      const ids = orderIds();
      let targetId: string | null = null;
      let edge: DropEdge | null = null;
      for (const rowId of ids) {
        const rect = chatRowEls.get(rowId)?.getBoundingClientRect();
        if (!rect) continue;
        if (ev.clientY <= rect.bottom) {
          targetId = rowId;
          edge = dropEdgeForRect(ev.clientY, rect);
          break;
        }
      }
      if (!targetId && ids.length > 0) {
        targetId = ids[ids.length - 1];
        edge = "after";
      }
      setChatDrag({
        id: chat.chatId,
        root,
        title: chatTitleOverride(chat.chatId) ?? chat.title,
        x: ev.clientX,
        y: ev.clientY,
        targetId,
        edge,
      });
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
    };
    const cancel = () => {
      cleanup();
      setChatDrag(null);
    };
    const up = () => {
      cleanup();
      const drag = chatDrag();
      setChatDrag(null);
      if (!active) return;
      // The pointer went down on a row, so the browser fires a click on
      // pointerup even after a drag — swallow that one click.
      suppressChatClick = true;
      setTimeout(() => (suppressChatClick = false), 0);
      if (!drag?.targetId || !drag.edge) return;
      void reorderChat(drag.id, beforeIdForDrop(orderIds(), drag.targetId, drag.edge));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
    window.addEventListener("pointercancel", cancel, { once: true });
  };

  return { chatRowEls, chatDrag, chatDragEdge, startChatDrag, isChatClickSuppressed: () => suppressChatClick };
}

/** Flat list filter + sort state (#306 PR1, behind `flatChatList`) and its
 *  "new chat" project-picker flow. A composable, called synchronously from
 *  `createProjectsPaneController`'s own setup so its memos live under the
 *  same reactive owner as if written inline. Takes the tree's own
 *  newTerminalChat/newAgentChat rather than duplicating their default-kind
 *  chat-creation logic. */
function createFlatChatListState(
  menuState: ReturnType<typeof createProjectsMenuState>,
  newTerminalChat: (root: string, title?: string) => void,
  newAgentChat: (root: string, provider: string, title?: string) => void,
) {
  // Single-select project filter (null = All projects) for the pane bar chips.
  const [filterRoot, setFilterRoot] = createSignal<string | null>(null);
  // Needs-you chats stay globally visible regardless of the filter — see
  // visibleFlatChats. Only working/quiet chats are actually narrowed.
  const flatChats = createMemo(() => {
    const chatsByRoot = new Map<string, Chat[]>();
    for (const p of workspace.projects) {
      chatsByRoot.set(
        p.projectRoot,
        chatsFor(p.projectRoot).filter((c) => !isChatArchived(c.chatId) && isPrimaryChat(c)),
      );
    }
    return visibleFlatChats(chatsByRoot, filterRoot());
  });
  const flatSorted = createMemo(() => sortFlatChats(flatChats()));
  // Split once here so both the row component and the QUIET · N divider share
  // the same classification pass instead of each re-deriving it. Uses the
  // card-visual state (#306 PR2), not the raw lifecycle state — a chat that
  // just went quiet keeps its FlatWorkCard through the linger window, so it
  // stays in the live bucket (as "justFinished") until that collapses it.
  const flatLive = createMemo(() => flatSorted().filter((c) => chatCardVisualState(c.chatId) !== "quiet"));
  const flatQuiet = createMemo(() => flatSorted().filter((c) => chatCardVisualState(c.chatId) === "quiet"));

  // "New chat" project picker: the flat list has no single current project, so
  // the plus button lists every project first, then falls into the same
  // default-kind-or-ask branch `newChatFromButton` uses for a project row.
  const newChatFromProjectPicker = (root: string) => {
    const kind = loadDefaultChatKind();
    if (kind === "ask" || loadAskChatTitle()) {
      menuState.setMenu((m) => (m ? { ...m, kind: "newchat", id: root } : m));
      return;
    }
    if (kind === "terminal") newTerminalChat(root);
    else newAgentChat(root, defaultNativeAgentProvider(loadLastAgentProvider()));
    menuState.closeMenu();
  };

  // Eager cross-project load (see ProjectsPane's effect): tracked per-root so
  // one project's failed fetch surfaces its own retry instead of silently
  // rendering "no chats" or throwing an unhandled rejection. ensureChatsLoaded
  // never marks a failed root as loaded, so calling it again is a real retry.
  const [loadErrorRoots, setLoadErrorRoots] = createSignal<Set<string>>(new Set());
  const loadProjectChats = (root: string) => {
    ensureChatsLoaded(root)
      .then(() =>
        setLoadErrorRoots((s) => {
          if (!s.has(root)) return s;
          const next = new Set(s);
          next.delete(root);
          return next;
        }),
      )
      .catch((error) => {
        console.error("[pickforge] flat chat list: failed to load chats for project", root, error);
        setLoadErrorRoots((s) => (s.has(root) ? s : new Set(s).add(root)));
      });
  };

  return {
    filterRoot,
    setFilterRoot,
    flatLive,
    flatQuiet,
    newChatFromProjectPicker,
    loadErrorRoots,
    loadProjectChats,
  };
}

/** Owns every signal and handler shared across the pane's tree/menu/drag
 *  surfaces (RenameField, the per-kind menus, chat/project rows and cards,
 *  group headers). A composable, called synchronously from `ProjectsPane`'s
 *  own setup so its sub-composables' effects run under the same reactive
 *  owner as if written inline. Every hoisted sub-component takes this as
 *  its `ctrl` prop instead of closing over local state directly. */
function createProjectsPaneController() {
  const remoteOn = () => flagEnabled("remoteProjects");
  const menuState = createProjectsMenuState();
  const dragState = createProjectDragState();
  const chatDragState = createChatDragState();
  const [showArchived, setShowArchived] = createSignal<Set<string>>(new Set()); // roots showing archived

  const hasGroups = () => grouping().groups.length > 0;
  const grid = () => grouping().viewMode === "grid";
  const allRoots = () => workspace.projects.map((p) => p.projectRoot);
  const someExpanded = () => anyChatsExpanded(allRoots());

  const buckets = createMemo(() => {
    const projs = workspace.projects;
    const out: { group: ProjectGroup | null; projects: Project[] }[] = [];
    for (const g of grouping().groups) {
      out.push({ group: g, projects: projs.filter((p) => groupOf(p.projectRoot) === g.id) });
    }
    out.push({ group: null, projects: projs.filter((p) => groupOf(p.projectRoot) === null) });
    return out;
  });

  const moveTo = (root: string, groupId: string | null) => { assignProject(root, groupId); menuState.closeMenu(); };
  const newGroupFor = (root: string) => {
    const id = createGroup();
    assignProject(root, id);
    menuState.closeMenu();
    menuState.setRenaming(id);
  };
  const newTerminalChat = (root: string, title?: string) => {
    if (!chatsExpanded(root)) toggleChats(root);
    void addChat(title?.trim() || DEFAULT_CHAT_TITLE, TERMINAL_AGENT_ID, root, "terminal");
  };
  const newAgentChat = (root: string, provider: string, title?: string) => {
    const availableProvider = nativeAgentProfile(provider);
    if (!availableProvider) return;
    if (!chatsExpanded(root)) toggleChats(root);
    setLastAgentProvider(availableProvider.id);
    void addChat(
      title?.trim() || DEFAULT_CHAT_TITLE,
      availableProvider.id,
      root,
      "agent",
    );
  };
  const newChatFromButton = (root: string, e: MouseEvent) => {
    const kind = loadDefaultChatKind();
    // The title ask lives in the new-chat menu, so an enabled ask opens the
    // menu even when a fixed default kind would otherwise create directly.
    if (kind === "ask" || loadAskChatTitle()) {
      menuState.openFromButton("newchat", root, e);
      return;
    }
    e.stopPropagation();
    if (kind === "terminal") newTerminalChat(root);
    else newAgentChat(root, defaultNativeAgentProvider(loadLastAgentProvider()));
  };
  const toggleArchivedFor = (root: string) =>
    setShowArchived((s) => {
      const next = new Set(s);
      next.has(root) ? next.delete(root) : next.add(root);
      return next;
    });

  const doArchiveChat = (id: string) => {
    const chat = findChat(id);
    const root = chat?.projectRoot ?? workspace.activeRoot;
    archiveChat(id);
    if (root) {
      void removeChatFromOrchestra(root, id).catch((error) =>
        console.error("[pickforge] removeChatFromOrchestra failed", error),
      );
    }
    // An archived row renders no busy/attention state — drop the activity too,
    // or a pending quiet-timer would chime with no visible source.
    clearChatActivity(id);
    if (workspace.activeChatId === id) {
      const next = root
        ? chatsFor(root).find(
            (c) => c.chatId !== id && !isChatArchived(c.chatId) && isPrimaryChat(c),
          )
        : undefined;
      selectChat(next?.chatId ?? null);
    }
    menuState.closeMenu();
  };

  return {
    remoteOn,
    ...menuState,
    ...dragState,
    ...chatDragState,
    ...createFlatChatListState(menuState, newTerminalChat, newAgentChat),
    showArchived,
    hasGroups,
    grid,
    allRoots,
    someExpanded,
    buckets,
    moveTo,
    newGroupFor,
    newTerminalChat,
    newAgentChat,
    newChatFromButton,
    toggleArchivedFor,
    doArchiveChat,
    openProject,
  };
}

type ProjectsPaneController = ReturnType<typeof createProjectsPaneController>;

function RenameField(props: {
  ctrl: ProjectsPaneController;
  value: string;
  commit: (v: string) => void;
}) {
  return (
    <input
      class="pf-input pf-rename"
      value={props.value}
      ref={(el) => queueMicrotask(() => { el.focus(); el.select(); })}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={(e) => { props.commit(e.currentTarget.value); props.ctrl.setRenaming(null); }}
      onKeyDown={(e) => {
        if (e.key === "Enter") { props.commit(e.currentTarget.value); props.ctrl.setRenaming(null); }
        else if (e.key === "Escape") props.ctrl.setRenaming(null);
      }}
    />
  );
}

const ConfirmMenu = (props: { ctrl: ProjectsPaneController }) => (
  <Show when={props.ctrl.pendingConfirm()}>
    {(c) => (
      <>
        <div class="pf-menu-label">{c().text}</div>
        <button
          class="pf-menu-item"
          classList={{ "pf-menu-item--danger": c().danger }}
          onClick={() => {
            c().run();
            props.ctrl.closeMenu();
          }}
        >
          {c().label}
        </button>
        <button class="pf-menu-item" onClick={props.ctrl.closeMenu}>Cancel</button>
      </>
    )}
  </Show>
);

// ---- menus ----
const ProjectMenu = (props: { ctrl: ProjectsPaneController; root: string }) => {
  const ctrl = props.ctrl;
  const root = props.root;
  const name = () => workspace.projects.find((x) => x.projectRoot === root)?.displayName ?? "";
  return (
    <>
      <div class="pf-menu-label">{name()}</div>
      <button class="pf-menu-item" onClick={() => { selectProject(root); ctrl.closeMenu(); }}>Open</button>
      <button class="pf-menu-item pf-menu-item--accent" onClick={() => ctrl.setMenu((m) => (m ? { ...m, kind: "newchat" } : m))}>New chat…</button>
      <button class="pf-menu-item" onClick={() => { ctrl.setRenaming(root); ctrl.closeMenu(); }}>Rename</button>
      <Show when={ctrl.remoteOn()}>
        <button class="pf-menu-item" onClick={() => ctrl.setMenu((m) => (m ? { ...m, kind: "remote" } : m))}>Remote host…</button>
      </Show>
      <div class="pf-menu-sep" />
      <div class="pf-menu-label">Move to</div>
      <button class="pf-menu-item" onClick={() => ctrl.moveTo(root, null)}>Ungrouped</button>
      <For each={grouping().groups}>
        {(g) => (
          <button class="pf-menu-item" classList={{ "pf-menu-item--on": groupOf(root) === g.id }} onClick={() => ctrl.moveTo(root, g.id)}>
            {g.name}
          </button>
        )}
      </For>
      <button class="pf-menu-item pf-menu-item--accent" onClick={() => ctrl.newGroupFor(root)}>New group…</button>
      <div class="pf-menu-sep" />
      <button
        class="pf-menu-item"
        onClick={() =>
          ctrl.askConfirm({
            text: `Archive "${name()}"?`,
            label: "Archive project",
            run: () => void archiveProject(root),
          })
        }
      >
        Archive
      </button>
      <button
        class="pf-menu-item pf-menu-item--danger"
        onClick={() =>
          ctrl.askConfirm({
            text: `Delete "${name()}" and its chats?`,
            label: "Delete project",
            danger: true,
            run: () => void deleteProject(root),
          })
        }
      >
        Delete
      </button>
    </>
  );
};

const GroupMenu = (props: { ctrl: ProjectsPaneController; id: string }) => {
  const ctrl = props.ctrl;
  return (
    <>
      <button class="pf-menu-item" onClick={() => { ctrl.setRenaming(props.id); ctrl.closeMenu(); }}>Rename</button>
      <button
        class="pf-menu-item pf-menu-item--danger"
        onClick={() =>
          ctrl.askConfirm({
            text: "Remove this group? Its projects move to Ungrouped.",
            label: "Remove group",
            danger: true,
            run: () => removeGroup(props.id),
          })
        }
      >
        Remove group
      </button>
    </>
  );
};

const NewChatMenu = (props: { ctrl: ProjectsPaneController; root: string }) => {
  const ctrl = props.ctrl;
  const root = props.root;
  const [title, setTitle] = createSignal("");
  // Enter in the title field creates only fixed default kinds; ask keeps the
  // menu open for an explicit kind choice.
  const createDefault = () => {
    const kind = loadDefaultChatKind();
    if (kind === "ask") return;
    if (kind === "agent") {
      ctrl.newAgentChat(
        root,
        defaultNativeAgentProvider(loadLastAgentProvider()),
        title(),
      );
    }
    else ctrl.newTerminalChat(root, title());
    ctrl.closeMenu();
  };
  return (
    <>
      <div class="pf-menu-label">New chat</div>
      <Show when={loadAskChatTitle()}>
        <input
          class="pf-menu-input"
          placeholder="Title (optional)"
          value={title()}
          ref={(el) => setTimeout(() => el.focus())}
          onInput={(e) => setTitle(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              createDefault();
            }
          }}
        />
      </Show>
      <button class="pf-menu-item pf-menu-item--accent pf-menu-item--chat-kind" onClick={() => { ctrl.newTerminalChat(root, title()); ctrl.closeMenu(); }}>
        <IconTerminal size={11} />
        Terminal
      </button>
      <div class="pf-menu-sep" />
      <div class="pf-menu-label">Agent</div>
      <For each={nativeAgentProfiles()}>
        {(a) => {
          const icon = AGENT_CHAT_ICON[a.id];
          return (
            <button class="pf-menu-item pf-menu-item--chat-kind" onClick={() => { ctrl.newAgentChat(root, a.id, title()); ctrl.closeMenu(); }}>
              <Show when={icon}>{(mark) => mark()()}</Show>
              {a.label}
            </button>
          );
        }}
      </For>
    </>
  );
};

const ProbeRow = (p: { label: string; probe: ProbeState }) => (
  <div
    class="pf-remote-probe"
    classList={{
      "pf-remote-probe--ok": p.probe.state === "ok",
      "pf-remote-probe--failed": p.probe.state === "failed",
      "pf-remote-probe--skipped": p.probe.state === "skipped",
    }}
  >
    <span class="pf-remote-probe-key">{p.label}</span>
    <span class="pf-remote-probe-val">{probeText(p.probe)}</span>
  </div>
);

// Per-project remote host: attach (verified via projectRemoteSet), detach, and
// a test connection rendering the three probe results as quiet mono rows. R1
// adds no execution routing — a bound-but-unreachable host only surfaces a
// note here + the sidebar badge; the project still opens locally.
const RemotePanel = (p: { root: string }) => {
  const project = () => workspace.projects.find((x) => x.projectRoot === p.root);
  const bound = () => !!project()?.remoteHost;
  const [host, setHost] = createSignal(project()?.remoteHost ?? "");
  const [remoteRoot, setRemoteRoot] = createSignal(project()?.remoteRoot ?? "");
  const ctrl = createRemoteAttach(() => p.root);

  const busy = () => ctrl.attach().kind === "busy";
  const testing = () => ctrl.test().kind === "running";
  const attachError = () => {
    const a = ctrl.attach();
    return a.kind === "error" ? a.message : null;
  };
  const testError = () => {
    const t = ctrl.test();
    return t.kind === "error" ? t.message : null;
  };
  const testResult = () => {
    const t = ctrl.test();
    return t.kind === "done" ? t : null;
  };
  const unreachable = () => {
    const h = project()?.remoteHost;
    return !!h && healthStatus(h) === "warning";
  };

  const onAttach = async () => {
    const h = host().trim();
    const r = remoteRoot().trim();
    if (await ctrl.doAttach(h, r)) {
      setProjectRemoteLocal(p.root, h, r);
      void refreshHost(h);
    }
  };
  const onDetach = async () => {
    if (await ctrl.doDetach()) setProjectRemoteLocal(p.root, null, null);
  };
  const onTest = async () => {
    // The result carries the host pinned at probe start, so an input edit
    // mid-probe can never cache one host's health under another.
    const res = await ctrl.runTest(host());
    if (res) recordHealth(res.host, res.health);
  };

  return (
    <div class="pf-remote-panel">
      <div class="pf-menu-label">Remote host</div>
      <input
        class="pf-menu-input pf-remote-input"
        placeholder="tailnet name or 100.x.y.z"
        spellcheck={false}
        value={host()}
        ref={(el) => setTimeout(() => el.focus())}
        onInput={(e) => { setHost(e.currentTarget.value); ctrl.clearAttachError(); }}
      />
      <input
        class="pf-menu-input pf-remote-input"
        placeholder="remote project root"
        spellcheck={false}
        value={remoteRoot()}
        onInput={(e) => { setRemoteRoot(e.currentTarget.value); ctrl.clearAttachError(); }}
      />
      <Show when={attachError()}>
        {(msg) => <div class="pf-remote-error">{msg()}</div>}
      </Show>
      <div class="pf-remote-actions">
        <Show
          when={bound()}
          fallback={
            <button class="pf-menu-item pf-menu-item--accent" disabled={busy()} onClick={onAttach}>
              {busy() ? "Verifying…" : "Attach"}
            </button>
          }
        >
          <button class="pf-menu-item pf-menu-item--danger" disabled={busy()} onClick={onDetach}>
            {busy() ? "Detaching…" : "Detach"}
          </button>
        </Show>
        <button class="pf-menu-item" disabled={testing()} onClick={onTest}>
          {testing() ? "Testing…" : "Test connection"}
        </button>
      </div>
      <Show when={unreachable()}>
        <div class="pf-remote-note">Host unreachable — this project still opens locally.</div>
      </Show>
      <Show when={testError()}>
        {(msg) => <div class="pf-remote-error">{msg()}</div>}
      </Show>
      <Show when={testResult()}>
        {(t) => (
          <div class="pf-remote-probes">
            <div class="pf-remote-probes-host">{t().host}</div>
            <ProbeRow label="tailnet" probe={t().health.tailnet} />
            <ProbeRow label="ssh" probe={t().health.ssh} />
            <ProbeRow label="daemon" probe={t().health.daemon} />
          </div>
        )}
      </Show>
    </div>
  );
};

// Sidebar health indicator for a bound project: quiet dot + host in the machine
// voice. Status colors only (never the ember accent); tooltip carries the probe
// summary + checked-at time.
const RemoteBadge = (p: { host: string }) => {
  const status = () => healthStatus(p.host);
  const title = () => {
    const h = healthOf(p.host);
    return h
      ? `${p.host} · ${healthSummary(h)} · checked ${relTime(h.checkedAtMs)}`
      : `${p.host} · not yet checked`;
  };
  return (
    <span
      class="pf-remote-badge"
      classList={{
        "pf-remote-badge--ok": status() === "ok",
        "pf-remote-badge--warn": status() === "warning",
      }}
      title={title()}
    >
      <span class="pf-remote-badge-dot" />
      <span class="pf-remote-badge-host">{p.host}</span>
    </span>
  );
};

const ChatMenu = (props: { ctrl: ProjectsPaneController; id: string }) => {
  const ctrl = props.ctrl;
  const id = props.id;
  return (
    <>
      <button class="pf-menu-item" onClick={() => { selectChat(id); ctrl.closeMenu(); }}>Open</button>
      <button class="pf-menu-item" onClick={() => { ctrl.setRenaming(id); ctrl.closeMenu(); }}>Rename</button>
      <Show
        when={
          !!findChat(id) &&
          chatTitleSourceForPolicy(findChat(id)!) === "user"
        }
      >
        <button
          class="pf-menu-item"
          onClick={() => {
            void resumeChatTitleAuto(id);
            ctrl.closeMenu();
          }}
        >
          Resume automatic titles
        </button>
      </Show>
      <button
        class="pf-menu-item"
        onClick={() =>
          ctrl.askConfirm({
            text: `Archive "${findChat(id)?.title ?? "this chat"}"?`,
            label: "Archive chat",
            run: () => ctrl.doArchiveChat(id),
          })
        }
      >
        Archive
      </button>
      <Show when={recoverChatSessions() && findChat(id)?.kind !== "agent"}>
        <div class="pf-menu-sep" />
        <button
          class="pf-menu-item"
          title="Switch this chat's recovery backend. The current session is destroyed and a fresh one is created on next open. Default is dtach."
          onClick={() => { void migrateChatBackend(id, !isChatTmux(id)); ctrl.closeMenu(); }}
        >
          {isChatTmux(id) ? "Use dtach session" : "Use tmux session"}
        </button>
      </Show>
      <div class="pf-menu-sep" />
      <button
        class="pf-menu-item pf-menu-item--danger"
        onClick={() =>
          ctrl.askConfirm({
            text: `Delete "${findChat(id)?.title ?? "this chat"}"? Its transcript is removed.`,
            label: "Delete chat",
            danger: true,
            run: () => void deleteChat(id),
          })
        }
      >
        Delete
      </button>
    </>
  );
};

// ---- chat rows + a project's chat children ----
const ChatRow = (props: { ctrl: ProjectsPaneController; chat: Chat; root: string; archived?: boolean }) => {
  const ctrl = props.ctrl;
  const id = props.chat.chatId;
  onCleanup(() => ctrl.chatRowEls.delete(id));
  return (
    <div
      class="pf-chat-row"
      ref={(el) => ctrl.chatRowEls.set(id, el)}
      classList={{
        active: workspace.activeChatId === id || (!props.archived && isChatStaged(id)),
        "pf-chat-row--archived": props.archived,
        "pf-chat-row--busy": !props.archived && chatBusy(id) && !chatAttention(id),
        "pf-chat-row--attention": !props.archived && workspace.activeChatId !== id && !isChatStaged(id) && chatAttention(id),
        "pf-chat-row--dragging": ctrl.chatDrag()?.id === id,
        "pf-drop-ember": ctrl.chatDragEdge(id) !== null,
        "pf-drop-before": ctrl.chatDragEdge(id) === "before",
        "pf-drop-after": ctrl.chatDragEdge(id) === "after",
      }}
      onPointerDown={props.archived ? undefined : (e) => ctrl.startChatDrag(e, props.chat, props.root)}
      onDragStart={(e) => e.preventDefault()}
      onClick={() => !props.archived && !ctrl.isChatClickSuppressed() && selectChat(id)}
      onContextMenu={(e) => !props.archived && ctrl.openFromContext("chat", id, e)}
    >
      <span class="pf-chat-dot" />
      <Show
        when={ctrl.renaming() === id}
        fallback={
          <span
            class="pf-chat-title"
            classList={{ "pf-chat-title--typing": chatTitleOverride(id) !== undefined }}
          >
            {chatTitleOverride(id) ?? props.chat.title}
          </span>
        }
      >
        <RenameField ctrl={ctrl} value={props.chat.title} commit={(v) => {
          // Only lock the title from OSC/auto-naming when the user actually
          // changed it — opening the field and blurring it unchanged must not
          // disable the auto-name flow for a still-default chat.
          if (v.trim() && v.trim() !== props.chat.title) markChatTitleManual(id);
          void renameChat(id, v);
        }} />
      </Show>
      <Show when={chatMarkKind(props.chat)}>
        <span
          class="pf-chat-agent-mark"
          title={chatMarkLabel(props.chat)}
          aria-label={chatMarkLabel(props.chat)}
        >
          <ChatMarkIcon chat={props.chat} />
        </span>
      </Show>
      <Show
        when={!props.archived}
        fallback={
          <button class="pf-rail-row-action pf-rail-row-action--shown" title="Unarchive chat" onClick={(e) => { e.stopPropagation(); unarchiveChat(id); }}>
            <IconPlus size={13} />
          </button>
        }
      >
        <button class="pf-rail-row-action" title="Chat options" onClick={(e) => ctrl.openFromButton("chat", id, e)}>
          <IconMore size={14} />
        </button>
      </Show>
    </div>
  );
};

const ChatChildren = (props: { ctrl: ProjectsPaneController; root: string }) => {
  const ctrl = props.ctrl;
  const root = props.root;
  createEffect(() => {
    if (chatsExpanded(root)) void ensureChatsLoaded(root);
  });
  const visible = () =>
    chatsFor(root).filter((c) => !isChatArchived(c.chatId) && isPrimaryChat(c));
  const archived = () =>
    chatsFor(root).filter((c) => isChatArchived(c.chatId) && isPrimaryChat(c));
  const archOpen = () => ctrl.showArchived().has(root);
  return (
    <Collapse open={chatsExpanded(root)}>
      <div class="pf-chat-children">
        <For each={visible()} fallback={<div class="pf-chat-empty">No chats yet</div>}>
          {(chat) => <ChatRow ctrl={ctrl} chat={chat} root={root} />}
        </For>
        <Show when={archived().length > 0}>
          <button class="pf-rail-archived-toggle" onClick={() => ctrl.toggleArchivedFor(root)}>
            <Show when={archOpen()} fallback={<IconChevronRight size={12} />}>
              <IconChevronDown size={12} />
            </Show>
            Archived
            <span class="pf-group-count">{archived().length}</span>
          </button>
          <Collapse open={archOpen()}>
            <For each={archived()}>{(chat) => <ChatRow ctrl={ctrl} chat={chat} root={root} archived />}</For>
          </Collapse>
        </Show>
      </div>
    </Collapse>
  );
};

const ProjectTwisty = (p: { root: string }) => (
  <button
    class="pf-tree-twisty"
    classList={{ "pf-tree-twisty--closed": !chatsExpanded(p.root) }}
    title={chatsExpanded(p.root) ? "Hide chats" : "Show chats"}
    onPointerDown={(e) => e.stopPropagation()}
    onClick={(e) => { e.stopPropagation(); toggleChats(p.root); }}
  >
    <IconChevronDown size={12} />
  </button>
);

// ---- project rows / cards ----
const ProjectRow = (props: { ctrl: ProjectsPaneController; project: Project }) => {
  const ctrl = props.ctrl;
  const root = props.project.projectRoot;
  const count = () =>
    chatsFor(root).filter((c) => !isChatArchived(c.chatId) && isPrimaryChat(c)).length;
  return (
    <div class="pf-tree-node">
      <div
        class="pf-rail-row pf-tree-row"
        classList={{
          active: workspace.activeRoot === root,
          "pf-drop-before": ctrl.edgeFor("project", root) === "before",
          "pf-drop-after": ctrl.edgeFor("project", root) === "after",
        }}
        draggable={true}
        onDragStart={(e) => ctrl.projectDragStart(root, e)}
        onDragOver={(e) => { ctrl.allowProjectDrop(e); ctrl.markEdge("project", root)(e); }}
        onDragLeave={() => ctrl.clearMark("project", root)}
        onDrop={(e) => ctrl.dropProjectReorder(root, e)}
        onDragEnd={() => ctrl.setDropMark(null)}
        onClick={() => ctrl.openProject(root)}
        onContextMenu={(e) => ctrl.openFromContext("project", root, e)}
      >
        <ProjectTwisty root={root} />
        <Show when={ctrl.renaming() === root} fallback={<span class="pf-rail-row-label">{props.project.displayName}</span>}>
          <RenameField ctrl={ctrl} value={props.project.displayName} commit={(v) => void renameProject(root, v)} />
        </Show>
        <Show when={ctrl.remoteOn() && props.project.remoteHost}>
          {(host) => <RemoteBadge host={host()} />}
        </Show>
        <button class="pf-rail-row-action" data-tour="new-chat" title="New chat" onClick={(e) => ctrl.newChatFromButton(root, e)}>
          <IconPlus size={14} />
        </button>
        <button class="pf-rail-row-action" title="Project options" onClick={(e) => ctrl.openFromButton("project", root, e)}>
          <IconMore size={14} />
        </button>
        <Show when={count() > 0}>
          <span class="pf-tree-count">{count()}</span>
        </Show>
      </div>
      <ChatChildren ctrl={ctrl} root={root} />
    </div>
  );
};

// One bubble per project: the header AND its chats live inside the same grid
// card. A card with its chats open spans the full row so the list reads as a
// contained group instead of chats spilling loose beneath the tile grid.
const ProjectCard = (props: { ctrl: ProjectsPaneController; project: Project }) => {
  const ctrl = props.ctrl;
  const root = props.project.projectRoot;
  const count = () =>
    chatsFor(root).filter((c) => !isChatArchived(c.chatId) && isPrimaryChat(c)).length;
  return (
    <div
      class="pf-proj-card"
      classList={{
        active: workspace.activeRoot === root,
        "pf-proj-card--open": chatsExpanded(root),
        "pf-drop-before-x": ctrl.edgeFor("project", root) === "before",
        "pf-drop-after-x": ctrl.edgeFor("project", root) === "after",
      }}
      onDragOver={(e) => { ctrl.allowProjectDrop(e); ctrl.markEdge("project", root, "x")(e); }}
      onDragLeave={() => ctrl.clearMark("project", root)}
      onDrop={(e) => ctrl.dropProjectReorder(root, e)}
      onContextMenu={(e) => ctrl.openFromContext("project", root, e)}
    >
      <div
        class="pf-proj-card-head"
        draggable={true}
        onDragStart={(e) => ctrl.projectDragStart(root, e)}
        onDragEnd={() => ctrl.setDropMark(null)}
        onClick={() => ctrl.openProject(root)}
      >
        <div class="pf-proj-card-top">
          <span class="pf-proj-card-mark">{props.project.displayName.charAt(0).toUpperCase()}</span>
          <ProjectTwisty root={root} />
          <button class="pf-proj-card-menu" title="Project options" onClick={(e) => ctrl.openFromButton("project", root, e)}>
            <IconMore size={14} />
          </button>
        </div>
        <div class="pf-proj-card-meta">
          <Show when={ctrl.renaming() === root} fallback={<span class="pf-proj-card-name">{props.project.displayName}</span>}>
            <RenameField ctrl={ctrl} value={props.project.displayName} commit={(v) => void renameProject(root, v)} />
          </Show>
          <Show when={count() > 0}>
            <span class="pf-proj-card-count">{count()} chat{count() === 1 ? "" : "s"}</span>
          </Show>
          <Show when={ctrl.remoteOn() && props.project.remoteHost}>
            {(host) => <RemoteBadge host={host()} />}
          </Show>
        </div>
      </div>
      <ChatChildren ctrl={ctrl} root={root} />
    </div>
  );
};

const ProjectsBody = (props: { ctrl: ProjectsPaneController; projects: Project[] }) => (
  <Show when={props.projects.length > 0} fallback={<div class="pf-rail-empty">No projects here</div>}>
    <Show
      when={props.ctrl.grid()}
      fallback={<For each={props.projects}>{(x) => <ProjectRow ctrl={props.ctrl} project={x} />}</For>}
    >
      <div class="pf-proj-grid"><For each={props.projects}>{(x) => <ProjectCard ctrl={props.ctrl} project={x} />}</For></div>
    </Show>
  </Show>
);

const GroupHeader = (props: { ctrl: ProjectsPaneController; group: ProjectGroup; count: number; projects: Project[] }) => {
  const ctrl = props.ctrl;
  return (
    <div
      class="pf-group-head"
      classList={{ "pf-drop-target": ctrl.dropGroup() === props.group.id }}
      onContextMenu={(e) => ctrl.openFromContext("group", props.group.id, e)}
      onDragOver={(e) => { ctrl.allowProjectDrop(e); ctrl.setDropGroup(props.group.id); }}
      onDragLeave={() => ctrl.setDropGroup((g) => (g === props.group.id ? null : g))}
      onDrop={(e) => ctrl.dropIntoGroup(props.group.id, e)}
    >
      <button class="pf-group-toggle" onClick={() => toggleGroup(props.group.id)}>
        <span class="pf-tree-twisty" classList={{ "pf-tree-twisty--closed": props.group.collapsed }}>
          <IconChevronDown size={12} />
        </span>
        <Show when={ctrl.renaming() === props.group.id} fallback={<span class="pf-group-name">{props.group.name}</span>}>
          <RenameField ctrl={ctrl} value={props.group.name} commit={(v) => renameGroup(props.group.id, v)} />
        </Show>
        <span class="pf-group-count">{props.count}</span>
      </button>
      <button class="pf-rail-row-action" title="Group options" onClick={(e) => ctrl.openFromButton("group", props.group.id, e)}>
        <IconMore size={14} />
      </button>
    </div>
  );
};

// ---- flat chat list (#306 PR1, behind `flatChatList`) ----
// The project filter is the app's one dropdown (#371). It used to be a row of
// pill chips, which wrapped onto 2-3 rows in a narrow sidebar — 72px of fixed
// chrome that grew with every project and ate the list's height — and rounded
// filled/outlined pills are the shape the design system rules out for
// state-bearing text. Project affordances (rename, remote host, move to group,
// archive) ride each option's right-click, the same ProjectMenu the chips
// opened; the flat list has no other project surface, so that has to survive.
// `ALL PROJECTS` is a real option, not a placeholder.
const ALL_PROJECTS = "__all";

const FlatFilterBar = (props: { ctrl: ProjectsPaneController }) => {
  const ctrl = props.ctrl;
  const options = (): DropdownOption[] => [
    { value: ALL_PROJECTS, label: "All projects" },
    ...workspace.projects.map((p) => ({
      value: p.projectRoot,
      label: p.displayName,
      onContextMenu: (e: MouseEvent) => ctrl.openFromContext("project", p.projectRoot, e),
    })),
  ];
  // Archiving the filtered project — reachable from this very menu — used to
  // leave `filterRoot` pointing at a root that no longer exists, which the
  // dropdown rendered as its generic "Select" placeholder while the list stayed
  // filtered to nothing. A filter aimed at a gone project is not a state worth
  // preserving, so fall back to the all-state.
  createEffect(() => {
    const root = ctrl.filterRoot();
    if (root === null) return;
    if (!workspace.projects.some((p) => p.projectRoot === root)) ctrl.setFilterRoot(null);
  });
  return (
    <div class="pf-pane-toolbar pf-flat-bar">
      <Dropdown
        class="pf-flat-project-filter"
        title="Filter by project"
        value={ctrl.filterRoot() ?? ALL_PROJECTS}
        options={options()}
        onChange={(value) => ctrl.setFilterRoot(value === ALL_PROJECTS ? null : value)}
      />
      <div class="pf-pane-toolbar-actions">
        <button
          class="pf-icon-btn"
          title="New chat"
          disabled={workspace.projects.length === 0}
          onClick={(e) => ctrl.openFromButton("flatNewChat", "__flat", e)}
        >
          <IconPlus size={14} />
        </button>
        <button class="pf-icon-btn" title="Add project" onClick={pickProject}>
          <IconFolderPlus size={14} />
        </button>
      </div>
    </div>
  );
};

// "New chat" project picker: the smallest honest affordance for a chat that
// otherwise has no single current project to attach to.
const NewChatProjectMenu = (props: { ctrl: ProjectsPaneController }) => (
  <>
    <div class="pf-menu-label">New chat in…</div>
    <For each={workspace.projects} fallback={<div class="pf-menu-label">No projects yet</div>}>
      {(p) => (
        <button class="pf-menu-item" onClick={() => props.ctrl.newChatFromProjectPicker(p.projectRoot)}>
          {p.displayName}
        </button>
      )}
    </For>
  </>
);

// Two-line row for quiet chats (#306 PR1, #331 layout pass). PR2 moved the
// rich work-card visuals for busy/needs-you/just-finished to FlatWorkCard
// below, so every chat reaching this renderer is quiet — no state prop to
// branch on anymore. OWNER DEVIATION from the approved sample's one-line
// quiet rows (#331): title gets its own line, with harness mark · project ·
// relative time as a second, quieter meta line below it — the sample's
// single line reads too cramped once the app's full title lengths and
// project names are in play.
const FlatChatRow = (props: { ctrl: ProjectsPaneController; chat: Chat }) => {
  const ctrl = props.ctrl;
  const id = props.chat.chatId;
  const project = () => workspace.projects.find((p) => p.projectRoot === props.chat.projectRoot);
  const staged = () => isChatStaged(id);
  const renaming = () => ctrl.renaming() === id;
  // Shared between the button (normal) and plain-div (renaming) variants
  // below — a real <input> (RenameField) can't nest inside a real <button>.
  const metaLine = () => (
    <span class="pf-flat-row-meta-line">
      <Show when={chatMarkKind(props.chat)}>
        <span
          class="pf-flat-mark"
          title={chatMarkLabel(props.chat)}
          aria-label={chatMarkLabel(props.chat)}
        >
          <ChatMarkIcon chat={props.chat} />
        </span>
      </Show>
      <span class="pf-flat-meta">
        {project()?.displayName ?? "—"} · {shortRelTime(chatActivityMs(props.chat))}
      </span>
    </span>
  );
  return (
    <div
      class="pf-flat-row"
      classList={{ active: workspace.activeChatId === id || staged() }}
      onContextMenu={(e) => ctrl.openFromContext("chat", id, e)}
    >
      <span class="pf-flat-dot" />
      {/* #331 review (finding 4): a real <button> as the row's primary
          interactive element — proper tab stop, accessible name, and native
          Enter/Space activation, instead of a plain clickable <div>. Only
          while not renaming (a text input can't nest inside a button). */}
      <Show
        when={!renaming()}
        fallback={
          <div class="pf-flat-row-lines">
            <RenameField
              ctrl={ctrl}
              value={props.chat.title}
              commit={(v) => {
                if (v.trim() && v.trim() !== props.chat.title) markChatTitleManual(id);
                void renameChat(id, v);
              }}
            />
            {metaLine()}
          </div>
        }
      >
        <button type="button" class="pf-flat-row-lines" onClick={() => selectChat(id)}>
          <span class="pf-flat-title" classList={{ "pf-chat-title--typing": chatTitleOverride(id) !== undefined }}>
            {chatTitleOverride(id) ?? props.chat.title}
          </span>
          {metaLine()}
        </button>
      </Show>
      <button class="pf-rail-row-action" title="Chat options" onClick={(e) => ctrl.openFromButton("chat", id, e)}>
        <IconMore size={14} />
      </button>
    </div>
  );
};

// The mono eyebrow text shown on every live card's status label. "needs you"
// stays literal per the issue's locked bracket rule ("bracketed text only on
// the NEEDS YOU label") rather than branching into mockup-illustrated
// sub-labels like "approval" — chatLifecycleState has one attention bit, not
// a reason, so a single canonical label is the honest one.
// Locked rule (#306): bracketed text appears on the NEEDS YOU label and
// nowhere else. The brackets are literal characters, matching the composer
// chip idiom (`[Image #1]`) rather than the CSS-drawn bracket used for the
// dropdown trigger's mark — this is bracketed *text*, not a frame glyph, and
// keeping it in the string is what lets a test assert the treatment rather
// than a class name that can pass while the treatment is missing (#361).
const CARD_STATUS_TEXT: Record<CardVisualState, string> = {
  needsYou: "needs you",
  working: "working",
  justFinished: "done",
};

// Live work card (#306 PR2): busy/needs-you/just-finished chats render here
// instead of the one-liner. Bracket L-corners are the ONLY place any card
// gets a frame, and only when `needsYou` — a working card is plain
// hairline/ember border + mono ember-soft text, and a justFinished (linger)
// card is plain muted text, matching the locked bracket rule exactly.
// The four L-corner marks — rendered ONLY when the card is showing the
// needs-you bracket treatment (see FlatWorkCard's showBracket).
const WorkCardCorners = () => (
  <>
    <span class="pf-work-card-corner pf-work-card-corner--tl" aria-hidden="true" />
    <span class="pf-work-card-corner pf-work-card-corner--tr" aria-hidden="true" />
    <span class="pf-work-card-corner pf-work-card-corner--bl" aria-hidden="true" />
    <span class="pf-work-card-corner pf-work-card-corner--br" aria-hidden="true" />
  </>
);

// Footer: branch (#306 PR3, only when the project root resolves to a git
// branch), plan M/N (#306 PR3, only with an active plan), lane ticks (only
// when this chat dispatched a swarm), and cost (only when nonzero) — every
// item conditional on real data, per the locked footer principle. Order
// matches the mockup exactly: branch · plan · lanes · cost.
const WorkCardFooter = (props: {
  branch: () => string | null;
  plan: () => CardPlanResult;
  lanes: () => CardLanesResult;
  cost: () => CardCostResult;
}) => (
  <Show when={props.branch() || props.plan() || props.lanes() || props.cost()}>
    <div class="pf-work-card-foot">
      <Show when={props.branch()}>
        {(b) => (
          <span class="pf-work-card-branch" title={b()}>
            {b()}
          </span>
        )}
      </Show>
      <Show when={props.plan()}>
        {(p) => (
          <span class="pf-work-card-plan">
            plan {p().completed}/{p().total}
          </span>
        )}
      </Show>
      <Show when={props.lanes()}>
        {(l) => (
          <span class="pf-work-card-lanes" title="Swarm lanes">
            <For each={l().lanes}>
              {(lane) => {
                const tone = laneTickTone(lane.status);
                return (
                  <i class="pf-work-card-lane" classList={{ [`pf-work-card-lane--${tone}`]: tone !== null }} />
                );
              }}
            </For>
            <span class="pf-work-card-lane-count">
              {l().doneCount}/{l().total}
            </span>
          </span>
        )}
      </Show>
      <Show when={props.cost()}>
        {(c) => <span class="pf-work-card-cost">{formatCardCost(c().amount, c().estimated)}</span>}
      </Show>
    </div>
  </Show>
);

// The 5C context meter as the card's bottom 2px edge — ember while working,
// amber while waiting. Absent for `justFinished` (see FlatWorkCard's edge()).
const WorkCardEdge = (props: { edge: () => CardEdgeResult }) => (
  <Show when={props.edge()}>
    {(e) => (
      <div class="pf-work-card-edge" classList={{ [`pf-work-card-edge--${e().color}`]: true }}>
        <i style={{ width: `${e().fraction * 100}%` }} />
      </div>
    )}
  </Show>
);

type CardLanesResult = ReturnType<typeof cardLanes>;
type CardCostResult = ReturnType<typeof cardCost>;
type CardPlanResult = ReturnType<typeof cardPlanProgress>;
type CardEdgeResult = ReturnType<typeof cardContextEdge> | null;

const FlatWorkCard = (props: { ctrl: ProjectsPaneController; chat: Chat; state: CardVisualState }) => {
  const ctrl = props.ctrl;
  const id = props.chat.chatId;
  const root = props.chat.projectRoot;
  const project = () => workspace.projects.find((p) => p.projectRoot === root);
  const staged = () => isChatStaged(id);
  // #306 PR3: kicks off the cached, per-project branch fetch (a no-op if
  // already cached/in flight for this root — see ensureProjectBranch) rather
  // than a per-chat/per-render git spawn.
  ensureProjectBranch(root);
  // LOCKED bracket rule: the four L-corners frame EVERY needs-you card, full
  // stop — active/staged/focus never suppress it (P2 fix, review of #306
  // PR2: this must not mirror FlatChatRow's active-chat attention
  // suppression, which is a different, unrelated convention).
  const showBracket = () => props.state === "needsYou";
  const branch = () => cardBranch(root, projectBranchOf);
  const plan = () => cardPlanProgress(id, latestPlanForChat);
  const lanes = () => cardLanes(cardSwarmRun(id, root, swarmRuns));
  const cost = () => cardCost(id, agentChat);
  const brief = () => cardBrief(props.chat, latestPlanForChat);
  const edge = () => (props.state === "justFinished" ? null : cardContextEdge(id, props.state, agentChat));
  const renaming = () => ctrl.renaming() === id;
  // Shared between the button (normal) and plain-div (renaming) variants
  // below — a real <input> (RenameField) can't nest inside a real <button>,
  // and the options button below is a SIBLING of this, never nested inside
  // it, for the same reason (#331 review, finding 4).
  const cardBody = () => (
    <>
      <div class="pf-work-card-top">
        <Show when={chatMarkKind(props.chat)}>
          <span
            class="pf-work-card-mark"
            title={chatMarkLabel(props.chat)}
            aria-label={chatMarkLabel(props.chat)}
          >
            <ChatMarkIcon chat={props.chat} />
          </span>
        </Show>
        <span class="pf-work-card-project">{project()?.displayName ?? "—"}</span>
        <span class="pf-work-card-when">{shortRelTime(chatActivityMs(props.chat))}</span>
      </div>
      <div class="pf-work-card-l1">
        <Show
          when={!renaming()}
          fallback={
            <RenameField
              ctrl={ctrl}
              value={props.chat.title}
              commit={(v) => {
                if (v.trim() && v.trim() !== props.chat.title) markChatTitleManual(id);
                void renameChat(id, v);
              }}
            />
          }
        >
          <span class="pf-work-card-title" classList={{ "pf-chat-title--typing": chatTitleOverride(id) !== undefined }}>
            {chatTitleOverride(id) ?? props.chat.title}
          </span>
        </Show>
        <span class="pf-work-card-status" classList={{ "pf-work-card-status--needsyou": showBracket() }}>
          {showBracket()
            ? `[ ${CARD_STATUS_TEXT[props.state]} ]`
            : CARD_STATUS_TEXT[props.state]}
        </span>
      </div>
      <Show when={brief()}>{(text) => <div class="pf-work-card-brief">{text()}</div>}</Show>
      <WorkCardFooter branch={branch} plan={plan} lanes={lanes} cost={cost} />
    </>
  );
  return (
    <div
      class="pf-work-card"
      classList={{
        active: workspace.activeChatId === id || staged(),
        "pf-work-card--working": props.state === "working",
        "pf-work-card--needsyou": showBracket(),
        "pf-work-card--finishing": props.state === "justFinished",
      }}
      onContextMenu={(e) => ctrl.openFromContext("chat", id, e)}
    >
      <Show when={showBracket()}>
        <WorkCardCorners />
      </Show>
      {/* #331 review (finding 4): a real <button> as the card's primary
          interactive element, not a plain clickable <div> — proper tab stop,
          accessible name, native Enter/Space activation. Only while not
          renaming (see cardBody's comment above). The options button below
          stays a sibling, never nested inside this one. */}
      <Show when={!renaming()} fallback={<div class="pf-work-card-primary">{cardBody()}</div>}>
        <button type="button" class="pf-work-card-primary" onClick={() => selectChat(id)}>
          {cardBody()}
        </button>
      </Show>
      <button
        class="pf-rail-row-action pf-work-card-options"
        title="Chat options"
        onClick={(e) => ctrl.openFromButton("chat", id, e)}
      >
        <IconMore size={14} />
      </button>
      <WorkCardEdge edge={edge} />
    </div>
  );
};

// A project's chats failed to load eagerly (#306 PR1's cross-project fetch,
// see createFlatChatListState.loadProjectChats): named per-project rather
// than a blanket error, with its own retry — the other, successfully-loaded
// projects still render normally alongside this.
const FlatLoadErrors = (props: { ctrl: ProjectsPaneController }) => (
  <Show when={props.ctrl.loadErrorRoots().size > 0}>
    <div class="pf-flat-load-error">
      <For each={[...props.ctrl.loadErrorRoots()]}>
        {(root) => (
          <div class="pf-flat-load-error-row">
            <span>{workspace.projects.find((p) => p.projectRoot === root)?.displayName ?? root} failed to load</span>
            <button type="button" class="pf-menu-item" onClick={() => props.ctrl.loadProjectChats(root)}>
              Retry
            </button>
          </div>
        )}
      </For>
    </div>
  </Show>
);

const FlatChatList = (props: { ctrl: ProjectsPaneController }) => {
  const ctrl = props.ctrl;
  const live = ctrl.flatLive;
  const quiet = ctrl.flatQuiet;
  return (
    <div class="pf-flat-list">
      <FlatLoadErrors ctrl={ctrl} />
      <Show when={live().length > 0 || quiet().length > 0} fallback={<div class="pf-rail-empty">No chats yet</div>}>
        <For each={live()}>
          {(chat) => <FlatWorkCard ctrl={ctrl} chat={chat} state={chatCardVisualState(chat.chatId) as CardVisualState} />}
        </For>
        <Show when={quiet().length > 0}>
          <div class="pf-flat-quiet-divider">
            <span>quiet · {quiet().length}</span>
          </div>
          <div class="pf-flat-quiet-list">
            <For each={quiet()}>{(chat) => <FlatChatRow ctrl={ctrl} chat={chat} />}</For>
          </div>
        </Show>
      </Show>
    </div>
  );
};

// The pre-#306 tree toolbar + rail list (view toggle, groups, DnD reorder),
// unchanged byte-for-byte from before the flag — this is the `flatChatList`
// flag-off fallback, and stays the retirement target once the flag ships.
const ProjectsTree = (props: { ctrl: ProjectsPaneController }) => {
  const ctrl = props.ctrl;
  return (
    <>
      <div class="pf-pane-toolbar">
        <button
          class="pf-icon-btn"
          title={ctrl.someExpanded() ? "Collapse all chats" : "Expand all chats"}
          disabled={workspace.projects.length === 0}
          onClick={() => setAllChats(ctrl.allRoots(), !ctrl.someExpanded())}
        >
          <IconCollapseAll size={14} expand={!ctrl.someExpanded()} />
        </button>
        <div class="pf-view-toggle">
          <button classList={{ active: !ctrl.grid() }} title="List view" onClick={() => setViewMode("list")}><IconList size={13} /></button>
          <button classList={{ active: ctrl.grid() }} title="Grid view" onClick={() => setViewMode("grid")}><IconGrid size={13} /></button>
        </div>
        <div class="pf-pane-toolbar-actions">
          <button class="pf-icon-btn" title="New group" onClick={() => ctrl.setRenaming(createGroup())}><IconFolderPlus size={14} /></button>
          <button class="pf-icon-btn" title="Add project" onClick={pickProject}><IconPlus /></button>
        </div>
      </div>

      <div class="pf-rail-list">
        <Show when={workspace.projects.length > 0} fallback={<div class="pf-rail-empty">No projects yet</div>}>
          <Show
            when={ctrl.hasGroups()}
            fallback={
              <div onDragOver={ctrl.allowProjectDrop} onDrop={(e) => ctrl.dropIntoGroup(null, e)}>
                <ProjectsBody ctrl={ctrl} projects={workspace.projects} />
              </div>
            }
          >
            <For each={ctrl.buckets()}>
              {(bucket) => (
                <div class="pf-group">
                  <Show
                    when={bucket.group}
                    fallback={
                      <Show when={bucket.projects.length > 0}>
                        <div
                          class="pf-group-head pf-group-head--ungrouped"
                          classList={{ "pf-drop-target": ctrl.dropGroup() === "__ungrouped" }}
                          onDragOver={(e) => { ctrl.allowProjectDrop(e); ctrl.setDropGroup("__ungrouped"); }}
                          onDragLeave={() => ctrl.setDropGroup((g) => (g === "__ungrouped" ? null : g))}
                          onDrop={(e) => ctrl.dropIntoGroup(null, e)}
                        >
                          <span class="pf-group-name">Ungrouped</span>
                          <span class="pf-group-count">{bucket.projects.length}</span>
                        </div>
                        <ProjectsBody ctrl={ctrl} projects={bucket.projects} />
                      </Show>
                    }
                  >
                    <GroupHeader ctrl={ctrl} group={bucket.group!} count={bucket.projects.length} projects={bucket.projects} />
                    <Collapse open={!bucket.group!.collapsed}>
                      <div onDragOver={ctrl.allowProjectDrop} onDrop={(e) => ctrl.dropIntoGroup(bucket.group!.id, e)}>
                        <ProjectsBody ctrl={ctrl} projects={bucket.projects} />
                      </div>
                    </Collapse>
                  </Show>
                </div>
              )}
            </For>
          </Show>
        </Show>
      </div>
    </>
  );
};

export function ProjectsPane() {
  // Owns the shared remote-health poller for its lifetime (no-op until a project
  // is bound to a host and the remoteProjects flag is on).
  useRemoteHealth();
  const ctrl = createProjectsPaneController();
  const flat = () => flagEnabled("flatChatList");
  const hasVisibleTerminalChats = () => {
    if (flat()) {
      return [...ctrl.flatLive(), ...ctrl.flatQuiet()].some((chat) => chat.kind === "terminal");
    }
    return ctrl.buckets().some((bucket) => {
      if (bucket.group?.collapsed) return false;
      return bucket.projects.some((project) =>
        chatsExpanded(project.projectRoot)
        && chatsFor(project.projectRoot).some((chat) =>
          chat.kind === "terminal"
          && isPrimaryChat(chat)
          && (!isChatArchived(chat.chatId) || ctrl.showArchived().has(project.projectRoot)),
        ),
      );
    });
  };
  useTerminalHarnessPolling(hasVisibleTerminalChats);

  // Flag on: the flat list needs every project's chats, not just the active
  // one's — load them all eagerly instead of the tree's per-project lazy
  // fetch on expand. Re-runs (cheaply, via ensureChatsLoaded's own cache)
  // whenever a project is added. Each load is caught individually
  // (ctrl.loadProjectChats) so one project's rejection can't blank the whole
  // list or escape as an unhandled rejection.
  createEffect(() => {
    if (!flat()) return;
    for (const p of workspace.projects) ctrl.loadProjectChats(p.projectRoot);
  });

  return (
    <div class="pf-pane-scroll" data-tour="projects">
      <Show
        when={flat()}
        fallback={<ProjectsTree ctrl={ctrl} />}
      >
        <FlatFilterBar ctrl={ctrl} />
        <FlatChatList ctrl={ctrl} />
      </Show>

      <Show when={ctrl.chatDrag()}>
        {(d) => (
          <div
            class="pf-chat-drag-ghost"
            style={{ left: `${d().x + 12}px`, top: `${d().y + 10}px` }}
          >
            {d().title}
          </div>
        )}
      </Show>

      <Show when={ctrl.menu()}>
        {(m) => (
          <FloatingMenu anchor={{ x: m().x, y: m().y, align: m().align }} onClose={ctrl.closeMenu}>
            <Switch>
              <Match when={m().kind === "project"}><ProjectMenu ctrl={ctrl} root={m().id} /></Match>
              <Match when={m().kind === "group"}><GroupMenu ctrl={ctrl} id={m().id} /></Match>
              <Match when={m().kind === "chat"}><ChatMenu ctrl={ctrl} id={m().id} /></Match>
              <Match when={m().kind === "newchat"}><NewChatMenu ctrl={ctrl} root={m().id} /></Match>
              <Match when={m().kind === "flatNewChat"}><NewChatProjectMenu ctrl={ctrl} /></Match>
              <Match when={m().kind === "remote"}><RemotePanel root={m().id} /></Match>
              <Match when={m().kind === "confirm"}><ConfirmMenu ctrl={ctrl} /></Match>
            </Switch>
          </FloatingMenu>
        )}
      </Show>
    </div>
  );
}
