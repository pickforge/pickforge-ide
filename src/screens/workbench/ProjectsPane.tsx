// Projects pane: a tree where each project owns its chats as collapsible
// children (there is no separate Chats pane). Projects keep list/grid views,
// collapsible groups, three-dots + right-click menus, inline rename, and DnD
// into a group; chats keep rename / archive / delete / drag-reorder. A toolbar
// control collapses or expands every project's chats at once.
import { createEffect, createMemo, createSignal, For, Match, onCleanup, onMount, Show, Switch } from "solid-js";
import { FloatingMenu } from "../../components/FloatingMenu";
import { Collapse } from "../../components/ui";
import {
  IconChevronDown,
  IconChevronRight,
  IconCollapseAll,
  IconFolderPlus,
  IconGrid,
  IconList,
  IconMore,
  IconPlus,
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
import { normalizeAgentProvider } from "../../lib/agentBackends";
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
import { removeChatFromOrchestra } from "../../stores/orchestra";
import { isChatStaged } from "../../stores/orchestraStage";
import { beforeIdForDrop, dropEdgeForRect, dropEdgeForRectX, type DropEdge } from "../../lib/dndReorder";
import { pickProjectDir } from "../../lib/opener";
import { flagEnabled } from "../../stores/flags";
import { setProjectRemoteLocal } from "../../stores/workspace";
import { createRemoteAttach } from "../../lib/remoteAttach";
import type { ProbeState } from "../../lib/remoteHost";
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

const AGENT_CHAT_MARKS: Record<string, string> = {
  claudeCode: "CC",
  codex: "CX",
  omp: "OM",
  pi: "PI",
};
const agentChatMark = (agentId: string): string =>
  AGENT_CHAT_MARKS[normalizeAgentProvider(agentId) ?? agentId] ?? "AI";

function basename(path: string): string {
  return path.replace(/[/\\]+$/, "").split(/[/\\]/).pop() || path;
}
async function pickProject() {
  const dir = await pickProjectDir();
  if (dir) await addProject(dir, basename(dir));
}

type MenuKind = "project" | "group" | "chat" | "newchat" | "confirm" | "remote";
interface MenuState { kind: MenuKind; id: string; x: number; y: number; align: "start" | "end" }

interface PendingConfirm {
  text: string;
  label: string;
  danger?: boolean;
  run: () => void;
}

export function ProjectsPane() {
  // Owns the shared remote-health poller for its lifetime (no-op until a project
  // is bound to a host and the remoteProjects flag is on).
  useRemoteHealth();
  const remoteOn = () => flagEnabled("remoteProjects");
  const [agentChatProviders, setAgentChatProviders] =
    createSignal<readonly AgentBackendDescriptor[]>(NATIVE_AGENT_BACKENDS);
  onMount(() => {
    if (!flagEnabled("ompPiAgents")) return;
    void discoverAgentCli("pi")
      .then((diagnostic) => {
        setAgentChatProviders(
          selectableNativeAgentBackends(true, diagnostic.installed ? diagnostic.version : null),
        );
      })
      .catch(() => setAgentChatProviders(NATIVE_AGENT_BACKENDS));
  });

  const [menu, setMenu] = createSignal<MenuState | null>(null);
  const [renaming, setRenaming] = createSignal<string | null>(null);
  const [dropGroup, setDropGroup] = createSignal<string | null>(null); // group id or "__ungrouped"
  // Reorder indicator: the row being hovered + which edge the drop lands on, for
  // both chat reorder and project reorder. A thin line renders on that edge.
  const [dropMark, setDropMark] = createSignal<{ kind: "chat" | "project"; id: string; edge: DropEdge } | null>(null);
  const [showArchived, setShowArchived] = createSignal<Set<string>>(new Set()); // roots showing archived

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

  const closeMenu = () => {
    setMenu(null);
    setPendingConfirm(null);
  };
  onCleanup(closeMenu);

  // Destructive menu actions swap the open menu for a confirm step in place —
  // the action only runs on the explicit confirm click.
  const [pendingConfirm, setPendingConfirm] = createSignal<PendingConfirm | null>(null);
  const askConfirm = (confirm: PendingConfirm) => {
    setPendingConfirm(confirm);
    setMenu((m) => (m ? { ...m, kind: "confirm" } : m));
  };

  const ConfirmMenu = () => (
    <Show when={pendingConfirm()}>
      {(c) => (
        <>
          <div class="pf-menu-label">{c().text}</div>
          <button
            class="pf-menu-item"
            classList={{ "pf-menu-item--danger": c().danger }}
            onClick={() => {
              c().run();
              closeMenu();
            }}
          >
            {c().label}
          </button>
          <button class="pf-menu-item" onClick={closeMenu}>Cancel</button>
        </>
      )}
    </Show>
  );

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

  const moveTo = (root: string, groupId: string | null) => { assignProject(root, groupId); closeMenu(); };
  const newGroupFor = (root: string) => { const id = createGroup(); assignProject(root, id); closeMenu(); setRenaming(id); };
  const newTerminalChat = (root: string, title?: string) => {
    if (!chatsExpanded(root)) toggleChats(root);
    void addChat(title?.trim() || DEFAULT_CHAT_TITLE, "claudeCode", root, "terminal");
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
      openFromButton("newchat", root, e);
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

  // ---- chat reorder drag (within a project) ----
  // Pointer-based, not HTML5 dnd: webkit's drag events were unreliable here
  // (missed targets in row gaps, giant default drag images, delayed drops).
  // A pressed row past a small threshold becomes a compact floating ghost; the
  // slot it would land in renders an ember line, matching the lane drag accent.
  const chatRowEls = new Map<string, HTMLElement>();
  const [chatDrag, setChatDrag] = createSignal<{
    id: string;
    root: string;
    title: string;
    x: number;
    y: number;
    targetId: string | null;
    edge: DropEdge | null;
  } | null>(null);
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

  const RenameField = (props: { value: string; commit: (v: string) => void }) => (
    <input
      class="pf-input pf-rename"
      value={props.value}
      ref={(el) => queueMicrotask(() => { el.focus(); el.select(); })}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={(e) => { props.commit(e.currentTarget.value); setRenaming(null); }}
      onKeyDown={(e) => {
        if (e.key === "Enter") { props.commit(e.currentTarget.value); setRenaming(null); }
        else if (e.key === "Escape") setRenaming(null);
      }}
    />
  );

  // ---- menus ----
  const ProjectMenu = (p: { root: string }) => {
    const name = () => workspace.projects.find((x) => x.projectRoot === p.root)?.displayName ?? "";
    return (
      <>
        <div class="pf-menu-label">{name()}</div>
        <button class="pf-menu-item" onClick={() => { selectProject(p.root); closeMenu(); }}>Open</button>
        <button class="pf-menu-item pf-menu-item--accent" onClick={() => setMenu((m) => (m ? { ...m, kind: "newchat" } : m))}>New chat…</button>
        <button class="pf-menu-item" onClick={() => { setRenaming(p.root); closeMenu(); }}>Rename</button>
        <Show when={remoteOn()}>
          <button class="pf-menu-item" onClick={() => setMenu((m) => (m ? { ...m, kind: "remote" } : m))}>Remote host…</button>
        </Show>
        <div class="pf-menu-sep" />
        <div class="pf-menu-label">Move to</div>
        <button class="pf-menu-item" onClick={() => moveTo(p.root, null)}>Ungrouped</button>
        <For each={grouping().groups}>
          {(g) => (
            <button class="pf-menu-item" classList={{ "pf-menu-item--on": groupOf(p.root) === g.id }} onClick={() => moveTo(p.root, g.id)}>
              {g.name}
            </button>
          )}
        </For>
        <button class="pf-menu-item pf-menu-item--accent" onClick={() => newGroupFor(p.root)}>New group…</button>
        <div class="pf-menu-sep" />
        <button
          class="pf-menu-item"
          onClick={() =>
            askConfirm({
              text: `Archive "${name()}"?`,
              label: "Archive project",
              run: () => void archiveProject(p.root),
            })
          }
        >
          Archive
        </button>
        <button
          class="pf-menu-item pf-menu-item--danger"
          onClick={() =>
            askConfirm({
              text: `Delete "${name()}" and its chats?`,
              label: "Delete project",
              danger: true,
              run: () => void deleteProject(p.root),
            })
          }
        >
          Delete
        </button>
      </>
    );
  };

  const GroupMenu = (p: { id: string }) => (
    <>
      <button class="pf-menu-item" onClick={() => { setRenaming(p.id); closeMenu(); }}>Rename</button>
      <button
        class="pf-menu-item pf-menu-item--danger"
        onClick={() =>
          askConfirm({
            text: "Remove this group? Its projects move to Ungrouped.",
            label: "Remove group",
            danger: true,
            run: () => removeGroup(p.id),
          })
        }
      >
        Remove group
      </button>
    </>
  );

  const NewChatMenu = (p: { root: string }) => {
    const [title, setTitle] = createSignal("");
    // Enter in the title field creates only fixed default kinds; ask keeps the
    // menu open for an explicit kind choice.
    const createDefault = () => {
      const kind = loadDefaultChatKind();
      if (kind === "ask") return;
      if (kind === "agent") {
        newAgentChat(
          p.root,
          defaultNativeAgentProvider(loadLastAgentProvider()),
          title(),
        );
      }
      else newTerminalChat(p.root, title());
      closeMenu();
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
        <button class="pf-menu-item pf-menu-item--accent" onClick={() => { newTerminalChat(p.root, title()); closeMenu(); }}>Terminal</button>
        <div class="pf-menu-sep" />
        <div class="pf-menu-label">Agent</div>
        <For each={nativeAgentProfiles()}>
          {(a) => (
            <button class="pf-menu-item" onClick={() => { newAgentChat(p.root, a.id, title()); closeMenu(); }}>{a.label}</button>
          )}
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
    closeMenu();
  };

  const ChatMenu = (p: { id: string }) => (
    <>
      <button class="pf-menu-item" onClick={() => { selectChat(p.id); closeMenu(); }}>Open</button>
      <button class="pf-menu-item" onClick={() => { setRenaming(p.id); closeMenu(); }}>Rename</button>
      <Show
        when={
          flagEnabled("dynamicChatTitles") &&
          !!findChat(p.id) &&
          chatTitleSourceForPolicy(findChat(p.id)!) === "user"
        }
      >
        <button
          class="pf-menu-item"
          onClick={() => {
            void resumeChatTitleAuto(p.id);
            closeMenu();
          }}
        >
          Resume automatic titles
        </button>
      </Show>
      <button
        class="pf-menu-item"
        onClick={() =>
          askConfirm({
            text: `Archive "${findChat(p.id)?.title ?? "this chat"}"?`,
            label: "Archive chat",
            run: () => doArchiveChat(p.id),
          })
        }
      >
        Archive
      </button>
      <Show when={recoverChatSessions() && findChat(p.id)?.kind !== "agent"}>
        <div class="pf-menu-sep" />
        <button
          class="pf-menu-item"
          title="Switch this chat's recovery backend. The current session is destroyed and a fresh one is created on next open. Default is dtach."
          onClick={() => { void migrateChatBackend(p.id, !isChatTmux(p.id)); closeMenu(); }}
        >
          {isChatTmux(p.id) ? "Use dtach session" : "Use tmux session"}
        </button>
      </Show>
      <div class="pf-menu-sep" />
      <button
        class="pf-menu-item pf-menu-item--danger"
        onClick={() =>
          askConfirm({
            text: `Delete "${findChat(p.id)?.title ?? "this chat"}"? Its transcript is removed.`,
            label: "Delete chat",
            danger: true,
            run: () => void deleteChat(p.id),
          })
        }
      >
        Delete
      </button>
    </>
  );

  // ---- chat rows + a project's chat children ----
  const ChatRow = (p: { chat: Chat; root: string; archived?: boolean }) => {
    const id = p.chat.chatId;
    onCleanup(() => chatRowEls.delete(id));
    return (
      <div
        class="pf-chat-row"
        ref={(el) => chatRowEls.set(id, el)}
        classList={{
          active: workspace.activeChatId === id || (!p.archived && isChatStaged(id)),
          "pf-chat-row--archived": p.archived,
          "pf-chat-row--busy": !p.archived && chatBusy(id) && !chatAttention(id),
          "pf-chat-row--attention": !p.archived && workspace.activeChatId !== id && !isChatStaged(id) && chatAttention(id),
          "pf-chat-row--dragging": chatDrag()?.id === id,
          "pf-drop-ember": chatDragEdge(id) !== null,
          "pf-drop-before": chatDragEdge(id) === "before",
          "pf-drop-after": chatDragEdge(id) === "after",
        }}
        onPointerDown={p.archived ? undefined : (e) => startChatDrag(e, p.chat, p.root)}
        onDragStart={(e) => e.preventDefault()}
        onClick={() => !p.archived && !suppressChatClick && selectChat(id)}
        onContextMenu={(e) => !p.archived && openFromContext("chat", id, e)}
      >
        <span class="pf-chat-dot" />
        <Show
          when={renaming() === id}
          fallback={
            <span
              class="pf-chat-title"
              classList={{ "pf-chat-title--typing": chatTitleOverride(id) !== undefined }}
            >
              {chatTitleOverride(id) ?? p.chat.title}
            </span>
          }
        >
          <RenameField value={p.chat.title} commit={(v) => {
            // Only lock the title from OSC/auto-naming when the user actually
            // changed it — opening the field and blurring it unchanged must not
            // disable the auto-name flow for a still-default chat.
            if (v.trim() && v.trim() !== p.chat.title) markChatTitleManual(id);
            void renameChat(id, v);
          }} />
        </Show>
        <Show when={p.chat.kind === "agent"}>
          <span class="pf-chat-agent-mark" title="Agent chat">{agentChatMark(p.chat.agentId)}</span>
        </Show>
        <Show
          when={!p.archived}
          fallback={
            <button class="pf-rail-row-action pf-rail-row-action--shown" title="Unarchive chat" onClick={(e) => { e.stopPropagation(); unarchiveChat(id); }}>
              <IconPlus size={13} />
            </button>
          }
        >
          <button class="pf-rail-row-action" title="Chat options" onClick={(e) => openFromButton("chat", id, e)}>
            <IconMore size={14} />
          </button>
        </Show>
      </div>
    );
  };

  const ChatChildren = (p: { root: string }) => {
    createEffect(() => {
      if (chatsExpanded(p.root)) void ensureChatsLoaded(p.root);
    });
    const visible = () =>
      chatsFor(p.root).filter((c) => !isChatArchived(c.chatId) && isPrimaryChat(c));
    const archived = () =>
      chatsFor(p.root).filter((c) => isChatArchived(c.chatId) && isPrimaryChat(c));
    const archOpen = () => showArchived().has(p.root);
    return (
      <Collapse open={chatsExpanded(p.root)}>
        <div class="pf-chat-children">
          <For each={visible()} fallback={<div class="pf-chat-empty">No chats yet</div>}>
            {(chat) => <ChatRow chat={chat} root={p.root} />}
          </For>
          <Show when={archived().length > 0}>
            <button class="pf-rail-archived-toggle" onClick={() => toggleArchivedFor(p.root)}>
              <Show when={archOpen()} fallback={<IconChevronRight size={12} />}>
                <IconChevronDown size={12} />
              </Show>
              Archived
              <span class="pf-group-count">{archived().length}</span>
            </button>
            <Collapse open={archOpen()}>
              <For each={archived()}>{(chat) => <ChatRow chat={chat} root={p.root} archived />}</For>
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
  const openProject = (root: string) => {
    void selectProject(root);
  };

  const ProjectRow = (p: { project: Project }) => {
    const root = p.project.projectRoot;
    const count = () =>
      chatsFor(root).filter((c) => !isChatArchived(c.chatId) && isPrimaryChat(c)).length;
    return (
      <div class="pf-tree-node">
        <div
          class="pf-rail-row pf-tree-row"
          classList={{
            active: workspace.activeRoot === root,
            "pf-drop-before": edgeFor("project", root) === "before",
            "pf-drop-after": edgeFor("project", root) === "after",
          }}
          draggable={true}
          onDragStart={(e) => projectDragStart(root, e)}
          onDragOver={(e) => { allowProjectDrop(e); markEdge("project", root)(e); }}
          onDragLeave={() => clearMark("project", root)}
          onDrop={(e) => dropProjectReorder(root, e)}
          onDragEnd={() => setDropMark(null)}
          onClick={() => openProject(root)}
          onContextMenu={(e) => openFromContext("project", root, e)}
        >
          <ProjectTwisty root={root} />
          <Show when={renaming() === root} fallback={<span class="pf-rail-row-label">{p.project.displayName}</span>}>
            <RenameField value={p.project.displayName} commit={(v) => void renameProject(root, v)} />
          </Show>
          <Show when={remoteOn() && p.project.remoteHost}>
            {(host) => <RemoteBadge host={host()} />}
          </Show>
          <button class="pf-rail-row-action" data-tour="new-chat" title="New chat" onClick={(e) => newChatFromButton(root, e)}>
            <IconPlus size={14} />
          </button>
          <button class="pf-rail-row-action" title="Project options" onClick={(e) => openFromButton("project", root, e)}>
            <IconMore size={14} />
          </button>
          <Show when={count() > 0}>
            <span class="pf-tree-count">{count()}</span>
          </Show>
        </div>
        <ChatChildren root={root} />
      </div>
    );
  };

  // One bubble per project: the header AND its chats live inside the same grid
  // card. A card with its chats open spans the full row so the list reads as a
  // contained group instead of chats spilling loose beneath the tile grid.
  const ProjectCard = (p: { project: Project }) => {
    const root = p.project.projectRoot;
    const count = () =>
      chatsFor(root).filter((c) => !isChatArchived(c.chatId) && isPrimaryChat(c)).length;
    return (
      <div
        class="pf-proj-card"
        classList={{
          active: workspace.activeRoot === root,
          "pf-proj-card--open": chatsExpanded(root),
          "pf-drop-before-x": edgeFor("project", root) === "before",
          "pf-drop-after-x": edgeFor("project", root) === "after",
        }}
        onDragOver={(e) => { allowProjectDrop(e); markEdge("project", root, "x")(e); }}
        onDragLeave={() => clearMark("project", root)}
        onDrop={(e) => dropProjectReorder(root, e)}
        onContextMenu={(e) => openFromContext("project", root, e)}
      >
        <div
          class="pf-proj-card-head"
          draggable={true}
          onDragStart={(e) => projectDragStart(root, e)}
          onDragEnd={() => setDropMark(null)}
          onClick={() => openProject(root)}
        >
          <div class="pf-proj-card-top">
            <span class="pf-proj-card-mark">{p.project.displayName.charAt(0).toUpperCase()}</span>
            <ProjectTwisty root={root} />
            <button class="pf-proj-card-menu" title="Project options" onClick={(e) => openFromButton("project", root, e)}>
              <IconMore size={14} />
            </button>
          </div>
          <div class="pf-proj-card-meta">
            <Show when={renaming() === root} fallback={<span class="pf-proj-card-name">{p.project.displayName}</span>}>
              <RenameField value={p.project.displayName} commit={(v) => void renameProject(root, v)} />
            </Show>
            <Show when={count() > 0}>
              <span class="pf-proj-card-count">{count()} chat{count() === 1 ? "" : "s"}</span>
            </Show>
            <Show when={remoteOn() && p.project.remoteHost}>
              {(host) => <RemoteBadge host={host()} />}
            </Show>
          </div>
        </div>
        <ChatChildren root={root} />
      </div>
    );
  };

  const ProjectsBody = (p: { projects: Project[] }) => (
    <Show when={p.projects.length > 0} fallback={<div class="pf-rail-empty">No projects here</div>}>
      <Show when={grid()} fallback={<For each={p.projects}>{(x) => <ProjectRow project={x} />}</For>}>
        <div class="pf-proj-grid"><For each={p.projects}>{(x) => <ProjectCard project={x} />}</For></div>
      </Show>
    </Show>
  );

  const GroupHeader = (p: { group: ProjectGroup; count: number; projects: Project[] }) => {
    return (
    <div
      class="pf-group-head"
      classList={{ "pf-drop-target": dropGroup() === p.group.id }}
      onContextMenu={(e) => openFromContext("group", p.group.id, e)}
      onDragOver={(e) => { allowProjectDrop(e); setDropGroup(p.group.id); }}
      onDragLeave={() => setDropGroup((g) => (g === p.group.id ? null : g))}
      onDrop={(e) => dropIntoGroup(p.group.id, e)}
    >
      <button class="pf-group-toggle" onClick={() => toggleGroup(p.group.id)}>
        <span class="pf-tree-twisty" classList={{ "pf-tree-twisty--closed": p.group.collapsed }}>
          <IconChevronDown size={12} />
        </span>
        <Show when={renaming() === p.group.id} fallback={<span class="pf-group-name">{p.group.name}</span>}>
          <RenameField value={p.group.name} commit={(v) => renameGroup(p.group.id, v)} />
        </Show>
        <span class="pf-group-count">{p.count}</span>
      </button>
      <button class="pf-rail-row-action" title="Group options" onClick={(e) => openFromButton("group", p.group.id, e)}>
        <IconMore size={14} />
      </button>
    </div>
    );
  };

  return (
    <div class="pf-pane-scroll" data-tour="projects">
      <div class="pf-pane-toolbar">
        <button
          class="pf-icon-btn"
          title={someExpanded() ? "Collapse all chats" : "Expand all chats"}
          disabled={workspace.projects.length === 0}
          onClick={() => setAllChats(allRoots(), !someExpanded())}
        >
          <IconCollapseAll size={14} expand={!someExpanded()} />
        </button>
        <div class="pf-view-toggle">
          <button classList={{ active: !grid() }} title="List view" onClick={() => setViewMode("list")}><IconList size={13} /></button>
          <button classList={{ active: grid() }} title="Grid view" onClick={() => setViewMode("grid")}><IconGrid size={13} /></button>
        </div>
        <div class="pf-pane-toolbar-actions">
          <button class="pf-icon-btn" title="New group" onClick={() => setRenaming(createGroup())}><IconFolderPlus size={14} /></button>
          <button class="pf-icon-btn" title="Add project" onClick={pickProject}><IconPlus /></button>
        </div>
      </div>

      <div class="pf-rail-list">
        <Show when={workspace.projects.length > 0} fallback={<div class="pf-rail-empty">No projects yet</div>}>
          <Show when={hasGroups()} fallback={<div onDragOver={allowProjectDrop} onDrop={(e) => dropIntoGroup(null, e)}><ProjectsBody projects={workspace.projects} /></div>}>
            <For each={buckets()}>
              {(bucket) => (
                <div class="pf-group">
                  <Show
                    when={bucket.group}
                    fallback={
                      <Show when={bucket.projects.length > 0}>
                        <div
                          class="pf-group-head pf-group-head--ungrouped"
                          classList={{ "pf-drop-target": dropGroup() === "__ungrouped" }}
                          onDragOver={(e) => { allowProjectDrop(e); setDropGroup("__ungrouped"); }}
                          onDragLeave={() => setDropGroup((g) => (g === "__ungrouped" ? null : g))}
                          onDrop={(e) => dropIntoGroup(null, e)}
                        >
                          <span class="pf-group-name">Ungrouped</span>
                          <span class="pf-group-count">{bucket.projects.length}</span>
                        </div>
                        <ProjectsBody projects={bucket.projects} />
                      </Show>
                    }
                  >
                    <GroupHeader group={bucket.group!} count={bucket.projects.length} projects={bucket.projects} />
                    <Collapse open={!bucket.group!.collapsed}>
                      <div onDragOver={allowProjectDrop} onDrop={(e) => dropIntoGroup(bucket.group!.id, e)}>
                        <ProjectsBody projects={bucket.projects} />
                      </div>
                    </Collapse>
                  </Show>
                </div>
              )}
            </For>
          </Show>
        </Show>
      </div>

      <Show when={chatDrag()}>
        {(d) => (
          <div
            class="pf-chat-drag-ghost"
            style={{ left: `${d().x + 12}px`, top: `${d().y + 10}px` }}
          >
            {d().title}
          </div>
        )}
      </Show>

      <Show when={menu()}>
        {(m) => (
          <FloatingMenu anchor={{ x: m().x, y: m().y, align: m().align }} onClose={closeMenu}>
            <Switch>
              <Match when={m().kind === "project"}><ProjectMenu root={m().id} /></Match>
              <Match when={m().kind === "group"}><GroupMenu id={m().id} /></Match>
              <Match when={m().kind === "chat"}><ChatMenu id={m().id} /></Match>
              <Match when={m().kind === "newchat"}><NewChatMenu root={m().id} /></Match>
              <Match when={m().kind === "remote"}><RemotePanel root={m().id} /></Match>
              <Match when={m().kind === "confirm"}><ConfirmMenu /></Match>
            </Switch>
          </FloatingMenu>
        )}
      </Show>
    </div>
  );
}
