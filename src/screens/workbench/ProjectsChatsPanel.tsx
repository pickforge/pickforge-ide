// Left-rail projects + chats list, backed by the workspace store. Projects
// support a list/grid view and optional collapsible groups (persisted in
// localStorage via the projectGrouping store — no DB migration needed).
import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { open } from "@tauri-apps/plugin-dialog";
import { MonoEyebrow } from "../../components/ui";
import {
  IconChevronDown,
  IconChevronRight,
  IconClose,
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
  selectChat,
  selectProject,
  workspace,
} from "../../stores/workspace";
import "./workbench.css";

function basename(path: string): string {
  return path.replace(/[/\\]+$/, "").split(/[/\\]/).pop() || path;
}

async function pickProject() {
  const dir = await open({ directory: true, title: "Add a project" });
  if (typeof dir === "string") await addProject(dir, basename(dir));
}

export function ProjectsChatsPanel() {
  const [menuRoot, setMenuRoot] = createSignal<string | null>(null);
  const [menuGroup, setMenuGroup] = createSignal<string | null>(null);
  const [renaming, setRenaming] = createSignal<string | null>(null);

  onMount(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest(".pf-menu") && !t.closest(".pf-menu-trigger")) {
        setMenuRoot(null);
        setMenuGroup(null);
      }
    };
    window.addEventListener("pointerdown", onDown);
    onCleanup(() => window.removeEventListener("pointerdown", onDown));
  });

  const hasGroups = () => grouping().groups.length > 0;
  const grid = () => grouping().viewMode === "grid";

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
    setMenuRoot(null);
  };
  const newGroupFor = (root: string) => {
    const id = createGroup();
    assignProject(root, id);
    setMenuRoot(null);
    setRenaming(id);
  };

  const ProjectMenu = (props: { root: string }) => (
    <div
      class="pf-menu pf-menu--proj"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
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
      <button
        class="pf-menu-item"
        onClick={() => {
          void archiveProject(props.root);
          setMenuRoot(null);
        }}
      >
        Archive
      </button>
    </div>
  );

  const ProjectRow = (props: { project: Project }) => {
    const active = () => workspace.activeRoot === props.project.projectRoot;
    return (
      <div
        class="pf-rail-row"
        classList={{ active: active() }}
        onClick={() => selectProject(props.project.projectRoot)}
      >
        <span class="pf-rail-row-label">{props.project.displayName}</span>
        <div class="pf-row-menu-wrap">
          <button
            class="pf-rail-row-action pf-menu-trigger"
            title="Project options"
            onClick={(e) => {
              e.stopPropagation();
              setMenuRoot((m) => (m === props.project.projectRoot ? null : props.project.projectRoot));
            }}
          >
            <IconMore size={14} />
          </button>
          <Show when={menuRoot() === props.project.projectRoot}>
            <ProjectMenu root={props.project.projectRoot} />
          </Show>
        </div>
      </div>
    );
  };

  const ProjectCard = (props: { project: Project }) => {
    const active = () => workspace.activeRoot === props.project.projectRoot;
    return (
      <div
        class="pf-proj-card"
        classList={{ active: active() }}
        onClick={() => selectProject(props.project.projectRoot)}
      >
        <span class="pf-proj-card-mark">{props.project.displayName.charAt(0).toUpperCase()}</span>
        <span class="pf-proj-card-name">{props.project.displayName}</span>
        <button
          class="pf-proj-card-menu pf-menu-trigger"
          title="Project options"
          onClick={(e) => {
            e.stopPropagation();
            setMenuRoot((m) => (m === props.project.projectRoot ? null : props.project.projectRoot));
          }}
        >
          <IconMore size={14} />
        </button>
        <Show when={menuRoot() === props.project.projectRoot}>
          <ProjectMenu root={props.project.projectRoot} />
        </Show>
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
    <div class="pf-group-head">
      <button class="pf-group-toggle" onClick={() => toggleGroup(props.group.id)}>
        <Show when={!props.group.collapsed} fallback={<IconChevronRight size={13} />}>
          <IconChevronDown size={13} />
        </Show>
        <Show
          when={renaming() === props.group.id}
          fallback={<span class="pf-group-name">{props.group.name}</span>}
        >
          <input
            class="pf-input pf-group-rename"
            value={props.group.name}
            ref={(el) => queueMicrotask(() => { el.focus(); el.select(); })}
            onClick={(e) => e.stopPropagation()}
            onBlur={(e) => {
              renameGroup(props.group.id, e.currentTarget.value);
              setRenaming(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                renameGroup(props.group.id, e.currentTarget.value);
                setRenaming(null);
              } else if (e.key === "Escape") setRenaming(null);
            }}
          />
        </Show>
        <span class="pf-group-count">{props.count}</span>
      </button>
      <div class="pf-row-menu-wrap">
        <button
          class="pf-rail-row-action pf-menu-trigger"
          title="Group options"
          onClick={(e) => {
            e.stopPropagation();
            setMenuGroup((m) => (m === props.group.id ? null : props.group.id));
          }}
        >
          <IconMore size={14} />
        </button>
        <Show when={menuGroup() === props.group.id}>
          <div
            class="pf-menu"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              class="pf-menu-item"
              onClick={() => {
                setRenaming(props.group.id);
                setMenuGroup(null);
              }}
            >
              Rename
            </button>
            <button
              class="pf-menu-item"
              onClick={() => {
                removeGroup(props.group.id);
                setMenuGroup(null);
              }}
            >
              Remove group
            </button>
          </div>
        </Show>
      </div>
    </div>
  );

  return (
    <div class="pf-rail">
      <section class="pf-rail-section pf-rail-projects">
        <div class="pf-rail-head">
          <MonoEyebrow text="Projects" tick />
          <div class="pf-rail-tools">
            <div class="pf-view-toggle">
              <button
                classList={{ active: !grid() }}
                title="List view"
                onClick={() => setViewMode("list")}
              >
                <IconList size={13} />
              </button>
              <button
                classList={{ active: grid() }}
                title="Grid view"
                onClick={() => setViewMode("grid")}
              >
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
            when={workspace.chats.length > 0}
            fallback={<div class="pf-rail-empty">No chats</div>}
          >
            <For each={workspace.chats}>
              {(chat) => (
                <div
                  class="pf-rail-row"
                  classList={{ active: workspace.activeChatId === chat.chatId }}
                  onClick={() => selectChat(chat.chatId)}
                >
                  <span class="pf-rail-row-label">{chat.title}</span>
                  <button
                    class="pf-rail-row-action"
                    title="Delete chat"
                    onClick={(e) => {
                      e.stopPropagation();
                      void deleteChat(chat.chatId);
                    }}
                  >
                    <IconClose size={14} />
                  </button>
                </div>
              )}
            </For>
          </Show>
        </div>
      </section>
    </div>
  );
}
