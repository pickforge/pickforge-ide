// Left-rail projects + chats list, backed by the workspace store. Projects
// support a list/grid view and optional collapsible groups (persisted in
// localStorage via the projectGrouping store — no DB migration needed). Every
// row exposes its actions two ways: a three-dots button and a right-click
// context menu, both rendered through a portaled FloatingMenu so they float
// above the other panes.
import { createMemo, createSignal, For, Match, onCleanup, Show, Switch } from "solid-js";
import { open } from "@tauri-apps/plugin-dialog";
import { MonoEyebrow } from "../../components/ui";
import { FloatingMenu } from "../../components/FloatingMenu";
import {
  IconChevronDown,
  IconChevronRight,
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
} from "../../stores/projectGrouping";
import type { ProjectGroup } from "../../stores/projectGrouping";
import type { Project } from "../../lib/db";
import {
  addChat,
  addProject,
  archiveProject,
  deleteChat,
  deleteProject,
  renameChat,
  renameProject,
  selectChat,
  selectProject,
  workspace,
} from "../../stores/workspace";
import { archiveChat, isChatArchived, unarchiveChat } from "../../stores/chatArchive";
import "./workbench.css";

function basename(path: string): string {
  return path.replace(/[/\\]+$/, "").split(/[/\\]/).pop() || path;
}

async function pickProject() {
  const dir = await open({ directory: true, title: "Add a project" });
  if (typeof dir === "string") await addProject(dir, basename(dir));
}

type MenuKind = "project" | "group" | "chat";
interface MenuState {
  kind: MenuKind;
  id: string;
  x: number;
  y: number;
  align: "start" | "end";
}

export function ProjectsChatsPanel() {
  const [menu, setMenu] = createSignal<MenuState | null>(null);
  const [renaming, setRenaming] = createSignal<string | null>(null);
  const [showArchived, setShowArchived] = createSignal(false);

  const closeMenu = () => setMenu(null);
  onCleanup(closeMenu);

  const openFromButton = (kind: MenuKind, id: string, e: MouseEvent) => {
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu((m) =>
      m?.id === id && m.kind === kind
        ? null
        : { kind, id, x: r.right, y: r.bottom + 4, align: "end" },
    );
  };
  const openFromContext = (kind: MenuKind, id: string, e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ kind, id, x: e.clientX, y: e.clientY, align: "start" });
  };

  const hasGroups = () => grouping().groups.length > 0;
  const grid = () => grouping().viewMode === "grid";

  const visibleChats = createMemo(() =>
    workspace.chats.filter((c) => !isChatArchived(c.chatId)),
  );
  const archivedChats = createMemo(() =>
    workspace.chats.filter((c) => isChatArchived(c.chatId)),
  );

  // Bucketed projects: each group, then an Ungrouped bucket.
  const buckets = createMemo(() => {
    const projs = workspace.projects;
    const out: { group: ProjectGroup | null; projects: Project[] }[] = [];
    for (const g of grouping().groups) {
      out.push({ group: g, projects: projs.filter((p) => groupOf(p.projectRoot) === g.id) });
    }
    out.push({ group: null, projects: projs.filter((p) => groupOf(p.projectRoot) === null) });
    return out;
  });

  const moveTo = (root: string, groupId: string | null) => {
    assignProject(root, groupId);
    closeMenu();
  };
  const newGroupFor = (root: string) => {
    const id = createGroup();
    assignProject(root, id);
    closeMenu();
    setRenaming(id);
  };
  const doArchiveChat = (id: string) => {
    archiveChat(id);
    if (workspace.activeChatId === id) {
      const next = visibleChats().find((c) => c.chatId !== id);
      selectChat(next?.chatId ?? null);
    }
    closeMenu();
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

  // ---- menu bodies ----
  const ProjectMenu = (props: { root: string }) => {
    const name = () =>
      workspace.projects.find((p) => p.projectRoot === props.root)?.displayName ?? "";
    return (
      <>
        <div class="pf-menu-label">{name()}</div>
        <button class="pf-menu-item" onClick={() => { selectProject(props.root); closeMenu(); }}>
          Open
        </button>
        <button class="pf-menu-item" onClick={() => { setRenaming(props.root); closeMenu(); }}>
          Rename
        </button>
        <div class="pf-menu-sep" />
        <div class="pf-menu-label">Move to</div>
        <button class="pf-menu-item" onClick={() => moveTo(props.root, null)}>
          Ungrouped
        </button>
        <For each={grouping().groups}>
          {(g) => (
            <button
              class="pf-menu-item"
              classList={{ "pf-menu-item--on": groupOf(props.root) === g.id }}
              onClick={() => moveTo(props.root, g.id)}
            >
              {g.name}
            </button>
          )}
        </For>
        <button class="pf-menu-item pf-menu-item--accent" onClick={() => newGroupFor(props.root)}>
          New group…
        </button>
        <div class="pf-menu-sep" />
        <button class="pf-menu-item" onClick={() => { void archiveProject(props.root); closeMenu(); }}>
          Archive
        </button>
        <button class="pf-menu-item pf-menu-item--danger" onClick={() => { void deleteProject(props.root); closeMenu(); }}>
          Delete
        </button>
      </>
    );
  };

  const GroupMenu = (props: { id: string }) => (
    <>
      <button class="pf-menu-item" onClick={() => { setRenaming(props.id); closeMenu(); }}>
        Rename
      </button>
      <button class="pf-menu-item pf-menu-item--danger" onClick={() => { removeGroup(props.id); closeMenu(); }}>
        Remove group
      </button>
    </>
  );

  const ChatMenu = (props: { id: string }) => (
    <>
      <button class="pf-menu-item" onClick={() => { selectChat(props.id); closeMenu(); }}>
        Open
      </button>
      <button class="pf-menu-item" onClick={() => { setRenaming(props.id); closeMenu(); }}>
        Rename
      </button>
      <button class="pf-menu-item" onClick={() => doArchiveChat(props.id)}>
        Archive
      </button>
      <div class="pf-menu-sep" />
      <button class="pf-menu-item pf-menu-item--danger" onClick={() => { void deleteChat(props.id); closeMenu(); }}>
        Delete
      </button>
    </>
  );

  // ---- rows ----
  const ProjectRow = (props: { project: Project }) => {
    const root = props.project.projectRoot;
    const active = () => workspace.activeRoot === root;
    return (
      <div
        class="pf-rail-row"
        classList={{ active: active() }}
        onClick={() => selectProject(root)}
        onContextMenu={(e) => openFromContext("project", root, e)}
      >
        <Show
          when={renaming() === root}
          fallback={<span class="pf-rail-row-label">{props.project.displayName}</span>}
        >
          <RenameField value={props.project.displayName} commit={(v) => void renameProject(root, v)} />
        </Show>
        <button
          class="pf-rail-row-action"
          title="Project options"
          onClick={(e) => openFromButton("project", root, e)}
        >
          <IconMore size={14} />
        </button>
      </div>
    );
  };

  const ProjectCard = (props: { project: Project }) => {
    const root = props.project.projectRoot;
    const active = () => workspace.activeRoot === root;
    return (
      <div
        class="pf-proj-card"
        classList={{ active: active() }}
        onClick={() => selectProject(root)}
        onContextMenu={(e) => openFromContext("project", root, e)}
      >
        <span class="pf-proj-card-mark">{props.project.displayName.charAt(0).toUpperCase()}</span>
        <Show
          when={renaming() === root}
          fallback={<span class="pf-proj-card-name">{props.project.displayName}</span>}
        >
          <RenameField value={props.project.displayName} commit={(v) => void renameProject(root, v)} />
        </Show>
        <button
          class="pf-proj-card-menu"
          title="Project options"
          onClick={(e) => openFromButton("project", root, e)}
        >
          <IconMore size={14} />
        </button>
      </div>
    );
  };

  const ProjectsBody = (props: { projects: Project[] }) => (
    <Show
      when={props.projects.length > 0}
      fallback={<div class="pf-rail-empty">No projects here</div>}
    >
      <Show
        when={grid()}
        fallback={<For each={props.projects}>{(p) => <ProjectRow project={p} />}</For>}
      >
        <div class="pf-proj-grid">
          <For each={props.projects}>{(p) => <ProjectCard project={p} />}</For>
        </div>
      </Show>
    </Show>
  );

  const GroupHeader = (props: { group: ProjectGroup; count: number }) => (
    <div
      class="pf-group-head"
      onContextMenu={(e) => openFromContext("group", props.group.id, e)}
    >
      <button class="pf-group-toggle" onClick={() => toggleGroup(props.group.id)}>
        <Show when={!props.group.collapsed} fallback={<IconChevronRight size={13} />}>
          <IconChevronDown size={13} />
        </Show>
        <Show
          when={renaming() === props.group.id}
          fallback={<span class="pf-group-name">{props.group.name}</span>}
        >
          <RenameField value={props.group.name} commit={(v) => renameGroup(props.group.id, v)} />
        </Show>
        <span class="pf-group-count">{props.count}</span>
      </button>
      <button
        class="pf-rail-row-action"
        title="Group options"
        onClick={(e) => openFromButton("group", props.group.id, e)}
      >
        <IconMore size={14} />
      </button>
    </div>
  );

  const ChatRow = (props: { chat: { chatId: string; title: string }; archived?: boolean }) => {
    const id = props.chat.chatId;
    return (
      <div
        class="pf-rail-row"
        classList={{ active: workspace.activeChatId === id, "pf-rail-row--archived": props.archived }}
        onClick={() => !props.archived && selectChat(id)}
        onContextMenu={(e) => !props.archived && openFromContext("chat", id, e)}
      >
        <Show
          when={renaming() === id}
          fallback={<span class="pf-rail-row-label">{props.chat.title}</span>}
        >
          <RenameField value={props.chat.title} commit={(v) => void renameChat(id, v)} />
        </Show>
        <Show
          when={!props.archived}
          fallback={
            <button
              class="pf-rail-row-action pf-rail-row-action--shown"
              title="Unarchive chat"
              onClick={(e) => { e.stopPropagation(); unarchiveChat(id); }}
            >
              <IconPlus size={13} />
            </button>
          }
        >
          <button
            class="pf-rail-row-action"
            title="Chat options"
            onClick={(e) => openFromButton("chat", id, e)}
          >
            <IconMore size={14} />
          </button>
        </Show>
      </div>
    );
  };

  return (
    <div class="pf-rail">
      <section class="pf-rail-section pf-rail-projects">
        <div class="pf-rail-head">
          <MonoEyebrow text="Projects" tick />
          <div class="pf-rail-tools">
            <div class="pf-view-toggle">
              <button classList={{ active: !grid() }} title="List view" onClick={() => setViewMode("list")}>
                <IconList size={13} />
              </button>
              <button classList={{ active: grid() }} title="Grid view" onClick={() => setViewMode("grid")}>
                <IconGrid size={13} />
              </button>
            </div>
            <button class="pf-icon-btn" title="New group" onClick={() => setRenaming(createGroup())}>
              <IconFolderPlus size={14} />
            </button>
            <button class="pf-icon-btn" title="Add project" onClick={pickProject}>
              <IconPlus />
            </button>
          </div>
        </div>

        <div class="pf-rail-list">
          <Show
            when={workspace.projects.length > 0}
            fallback={<div class="pf-rail-empty">No projects yet</div>}
          >
            <Show when={hasGroups()} fallback={<ProjectsBody projects={workspace.projects} />}>
              <For each={buckets()}>
                {(bucket) => (
                  <div class="pf-group">
                    <Show
                      when={bucket.group}
                      fallback={
                        <Show when={bucket.projects.length > 0}>
                          <div class="pf-group-head pf-group-head--ungrouped">
                            <span class="pf-group-name">Ungrouped</span>
                            <span class="pf-group-count">{bucket.projects.length}</span>
                          </div>
                          <ProjectsBody projects={bucket.projects} />
                        </Show>
                      }
                    >
                      <GroupHeader group={bucket.group!} count={bucket.projects.length} />
                      <Show when={!bucket.group!.collapsed}>
                        <ProjectsBody projects={bucket.projects} />
                      </Show>
                    </Show>
                  </div>
                )}
              </For>
            </Show>
          </Show>
        </div>
      </section>

      <section class="pf-rail-section pf-rail-chats">
        <div class="pf-rail-head">
          <MonoEyebrow text="Chats" tick />
          <button
            class="pf-icon-btn"
            title="New chat"
            disabled={!workspace.activeRoot}
            onClick={() => addChat("New chat", "claudeCode")}
          >
            <IconPlus />
          </button>
        </div>
        <div class="pf-rail-list">
          <Show
            when={visibleChats().length > 0}
            fallback={<div class="pf-rail-empty">No chats</div>}
          >
            <For each={visibleChats()}>{(chat) => <ChatRow chat={chat} />}</For>
          </Show>

          <Show when={archivedChats().length > 0}>
            <button
              class="pf-rail-archived-toggle"
              onClick={() => setShowArchived((s) => !s)}
            >
              <Show when={showArchived()} fallback={<IconChevronRight size={12} />}>
                <IconChevronDown size={12} />
              </Show>
              Archived
              <span class="pf-group-count">{archivedChats().length}</span>
            </button>
            <Show when={showArchived()}>
              <For each={archivedChats()}>{(chat) => <ChatRow chat={chat} archived />}</For>
            </Show>
          </Show>
        </div>
      </section>

      <Show when={menu()}>
        {(m) => (
          <FloatingMenu anchor={{ x: m().x, y: m().y, align: m().align }} onClose={closeMenu}>
            <Switch>
              <Match when={m().kind === "project"}>
                <ProjectMenu root={m().id} />
              </Match>
              <Match when={m().kind === "group"}>
                <GroupMenu id={m().id} />
              </Match>
              <Match when={m().kind === "chat"}>
                <ChatMenu id={m().id} />
              </Match>
            </Switch>
          </FloatingMenu>
        )}
      </Show>
    </div>
  );
}
