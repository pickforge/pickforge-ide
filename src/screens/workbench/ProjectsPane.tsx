// Projects pane: a tree where each project owns its chats as collapsible
// children (there is no separate Chats pane). Projects keep list/grid views,
// collapsible groups, three-dots + right-click menus, inline rename, and DnD
// into a group; chats keep rename / archive / delete / drag-reorder. A toolbar
// control collapses or expands every project's chats at once.
import { createEffect, createMemo, createSignal, For, Match, onCleanup, Show, Switch } from "solid-js";
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
import { AGENTS } from "../../lib/agentModels";
import {
  loadAskChatTitle,
  loadDefaultChatKind,
  loadLastAgentProvider,
  setLastAgentProvider,
} from "../../lib/chatDefaults";
import { type AgentProvider } from "../../lib/agentChat";
import { chatTitleOverride, DEFAULT_CHAT_TITLE, markChatTitleManual } from "../../lib/chatAutoName";
import { chatAttention, chatBusy, clearChatActivity } from "../../stores/chatActivity";
import { isChatStaged } from "../../stores/orchestraStage";
import { beforeIdForDrop, dropEdgeForRect, dropEdgeForRectX, type DropEdge } from "../../lib/dndReorder";
import { pickProjectDir } from "../../lib/opener";

const PROJECT_MIME = "application/x-pf-project";
const CHAT_MIME = "application/x-pf-chat";

// Providers a structured agent chat can drive (AgentChatView backends). Reuses
// the AGENTS profile labels so the picker stays in sync with the model settings.
const AGENT_CHAT_PROVIDERS = AGENTS.filter((a) => a.id === "claudeCode" || a.id === "codex");
const AGENT_CHAT_MARKS: Record<string, string> = { claudeCode: "CC", codex: "CX" };
const agentChatMark = (agentId: string): string => AGENT_CHAT_MARKS[agentId] ?? "AI";

function basename(path: string): string {
  return path.replace(/[/\\]+$/, "").split(/[/\\]/).pop() || path;
}
async function pickProject() {
  const dir = await pickProjectDir();
  if (dir) await addProject(dir, basename(dir));
}

type MenuKind = "project" | "group" | "chat" | "newchat";
interface MenuState { kind: MenuKind; id: string; x: number; y: number; align: "start" | "end" }

export function ProjectsPane() {
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

  const closeMenu = () => setMenu(null);
  onCleanup(closeMenu);

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
    if (!chatsExpanded(root)) toggleChats(root);
    if (provider === "claudeCode" || provider === "codex") {
      setLastAgentProvider(provider as AgentProvider);
    }
    void addChat(title?.trim() || DEFAULT_CHAT_TITLE, provider, root, "agent");
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
    else newAgentChat(root, loadLastAgentProvider());
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
  const allowChatDrop = (e: DragEvent) => {
    if (e.dataTransfer?.types.includes(CHAT_MIME)) {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    }
  };
  // Drop onto a specific row: insert before or after it by where the pointer sits
  // relative to the row's midpoint, so reordering works in BOTH directions.
  const dropOnChat = (root: string, targetId: string, e: DragEvent) => {
    const id = e.dataTransfer?.getData(CHAT_MIME);
    const edge = edgeFor("chat", targetId);
    setDropMark(null);
    if (!id) return;
    // Only reorder within the same project.
    if (!chatsFor(root).some((c) => c.chatId === id)) return;
    e.preventDefault();
    e.stopPropagation();
    const order = chatsFor(root)
      .filter((c) => !isChatArchived(c.chatId))
      .map((c) => c.chatId);
    void reorderChat(id, edge ? beforeIdForDrop(order, targetId, edge) : null);
  };
  // Drop onto the children container's empty space → append to the end.
  const dropChatAtEnd = (root: string, e: DragEvent) => {
    const id = e.dataTransfer?.getData(CHAT_MIME);
    setDropMark(null);
    if (!id) return;
    if (!chatsFor(root).some((c) => c.chatId === id)) return;
    e.preventDefault();
    e.stopPropagation();
    void reorderChat(id, null);
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
        <button class="pf-menu-item" onClick={() => { void archiveProject(p.root); closeMenu(); }}>Archive</button>
        <button class="pf-menu-item pf-menu-item--danger" onClick={() => { void deleteProject(p.root); closeMenu(); }}>Delete</button>
      </>
    );
  };

  const GroupMenu = (p: { id: string }) => (
    <>
      <button class="pf-menu-item" onClick={() => { setRenaming(p.id); closeMenu(); }}>Rename</button>
      <button class="pf-menu-item pf-menu-item--danger" onClick={() => { removeGroup(p.id); closeMenu(); }}>Remove group</button>
    </>
  );

  const NewChatMenu = (p: { root: string }) => {
    const [title, setTitle] = createSignal("");
    // Enter in the title field creates the default kind without reaching for a
    // kind button; an empty title keeps the default name + auto-naming.
    const createDefault = () => {
      const kind = loadDefaultChatKind();
      if (kind === "agent") newAgentChat(p.root, loadLastAgentProvider(), title());
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
        <For each={AGENT_CHAT_PROVIDERS}>
          {(a) => (
            <button class="pf-menu-item" onClick={() => { newAgentChat(p.root, a.id, title()); closeMenu(); }}>{a.label}</button>
          )}
        </For>
      </>
    );
  };

  const doArchiveChat = (id: string) => {
    const chat = chatsFor(workspace.activeRoot ?? "").find((c) => c.chatId === id);
    archiveChat(id);
    // An archived row renders no busy/attention state — drop the activity too,
    // or a pending quiet-timer would chime with no visible source.
    clearChatActivity(id);
    if (workspace.activeChatId === id) {
      const root = chat?.projectRoot ?? workspace.activeRoot;
      const next = root ? chatsFor(root).find((c) => c.chatId !== id && !isChatArchived(c.chatId)) : undefined;
      selectChat(next?.chatId ?? null);
    }
    closeMenu();
  };

  const ChatMenu = (p: { id: string }) => (
    <>
      <button class="pf-menu-item" onClick={() => { selectChat(p.id); closeMenu(); }}>Open</button>
      <button class="pf-menu-item" onClick={() => { setRenaming(p.id); closeMenu(); }}>Rename</button>
      <button class="pf-menu-item" onClick={() => doArchiveChat(p.id)}>Archive</button>
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
      <button class="pf-menu-item pf-menu-item--danger" onClick={() => { void deleteChat(p.id); closeMenu(); }}>Delete</button>
    </>
  );

  // ---- chat rows + a project's chat children ----
  const ChatRow = (p: { chat: Chat; root: string; archived?: boolean }) => {
    const id = p.chat.chatId;
    return (
      <div
        class="pf-chat-row"
        classList={{
          active: workspace.activeChatId === id || (!p.archived && isChatStaged(id)),
          "pf-chat-row--archived": p.archived,
          "pf-chat-row--busy": !p.archived && chatBusy(id) && !chatAttention(id),
          "pf-chat-row--attention": !p.archived && workspace.activeChatId !== id && !isChatStaged(id) && chatAttention(id),
          "pf-drop-before": edgeFor("chat", id) === "before",
          "pf-drop-after": edgeFor("chat", id) === "after",
        }}
        draggable={!p.archived}
        onDragStart={(e) => {
          e.stopPropagation();
          e.dataTransfer?.setData(CHAT_MIME, id);
          if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
        }}
        onDragOver={p.archived ? undefined : (e) => { allowChatDrop(e); markEdge("chat", id)(e); }}
        onDragLeave={() => clearMark("chat", id)}
        onDrop={p.archived ? undefined : (e) => dropOnChat(p.root, id, e)}
        onDragEnd={() => setDropMark(null)}
        onClick={() => !p.archived && selectChat(id)}
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
    const visible = () => chatsFor(p.root).filter((c) => !isChatArchived(c.chatId));
    const archived = () => chatsFor(p.root).filter((c) => isChatArchived(c.chatId));
    const archOpen = () => showArchived().has(p.root);
    return (
      <Collapse open={chatsExpanded(p.root)}>
        <div
          class="pf-chat-children"
          onDragOver={allowChatDrop}
          onDrop={(e) => dropChatAtEnd(p.root, e)}
        >
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
            <Show when={archOpen()}>
              <For each={archived()}>{(chat) => <ChatRow chat={chat} root={p.root} archived />}</For>
            </Show>
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
    const count = () => chatsFor(root).filter((c) => !isChatArchived(c.chatId)).length;
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

  const ProjectCard = (p: { project: Project }) => {
    const root = p.project.projectRoot;
    const count = () => chatsFor(root).filter((c) => !isChatArchived(c.chatId)).length;
    return (
      <>
        <div
          class="pf-proj-card"
          classList={{
            active: workspace.activeRoot === root,
            "pf-drop-before-x": edgeFor("project", root) === "before",
            "pf-drop-after-x": edgeFor("project", root) === "after",
          }}
          draggable={true}
          onDragStart={(e) => projectDragStart(root, e)}
          onDragOver={(e) => { allowProjectDrop(e); markEdge("project", root, "x")(e); }}
          onDragLeave={() => clearMark("project", root)}
          onDrop={(e) => dropProjectReorder(root, e)}
          onDragEnd={() => setDropMark(null)}
          onClick={() => openProject(root)}
          onContextMenu={(e) => openFromContext("project", root, e)}
        >
          <div class="pf-proj-card-top">
            <span class="pf-proj-card-mark">{p.project.displayName.charAt(0).toUpperCase()}</span>
            <ProjectTwisty root={root} />
          </div>
          <div class="pf-proj-card-meta">
            <Show when={renaming() === root} fallback={<span class="pf-proj-card-name">{p.project.displayName}</span>}>
              <RenameField value={p.project.displayName} commit={(v) => void renameProject(root, v)} />
            </Show>
            <Show when={count() > 0}>
              <span class="pf-proj-card-count">{count()} chat{count() === 1 ? "" : "s"}</span>
            </Show>
          </div>
          <button class="pf-proj-card-menu" title="Project options" onClick={(e) => openFromButton("project", root, e)}>
            <IconMore size={14} />
          </button>
        </div>
        <Show when={chatsExpanded(root)}>
          <div class="pf-grid-chats">
            <ChatChildren root={root} />
          </div>
        </Show>
      </>
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
                    <Show when={!bucket.group!.collapsed}>
                      <div onDragOver={allowProjectDrop} onDrop={(e) => dropIntoGroup(bucket.group!.id, e)}>
                        <ProjectsBody projects={bucket.projects} />
                      </div>
                    </Show>
                  </Show>
                </div>
              )}
            </For>
          </Show>
        </Show>
      </div>

      <Show when={menu()}>
        {(m) => (
          <FloatingMenu anchor={{ x: m().x, y: m().y, align: m().align }} onClose={closeMenu}>
            <Switch>
              <Match when={m().kind === "project"}><ProjectMenu root={m().id} /></Match>
              <Match when={m().kind === "group"}><GroupMenu id={m().id} /></Match>
              <Match when={m().kind === "chat"}><ChatMenu id={m().id} /></Match>
              <Match when={m().kind === "newchat"}><NewChatMenu root={m().id} /></Match>
            </Switch>
          </FloatingMenu>
        )}
      </Show>
    </div>
  );
}
