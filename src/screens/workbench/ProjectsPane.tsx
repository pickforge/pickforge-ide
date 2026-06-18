// Projects pane body: list/grid view, collapsible groups, three-dots + right-
// click menus, inline rename, and drag-and-drop of a project into a group.
import { createMemo, createSignal, For, Match, onCleanup, Show, Switch } from "solid-js";
import { open } from "@tauri-apps/plugin-dialog";
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
  type ProjectGroup,
} from "../../stores/projectGrouping";
import type { Project } from "../../lib/db";
import {
  addProject,
  archiveProject,
  deleteProject,
  renameProject,
  selectProject,
  workspace,
} from "../../stores/workspace";

const PROJECT_MIME = "application/x-pf-project";

function basename(path: string): string {
  return path.replace(/[/\\]+$/, "").split(/[/\\]/).pop() || path;
}
async function pickProject() {
  const dir = await open({ directory: true, title: "Add a project" });
  if (typeof dir === "string") await addProject(dir, basename(dir));
}

type MenuKind = "project" | "group";
interface MenuState { kind: MenuKind; id: string; x: number; y: number; align: "start" | "end" }

export function ProjectsPane() {
  const [menu, setMenu] = createSignal<MenuState | null>(null);
  const [renaming, setRenaming] = createSignal<string | null>(null);
  const [dropGroup, setDropGroup] = createSignal<string | null>(null); // group id or "__ungrouped"

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

  // ---- drag and drop a project into a group ----
  const dragStart = (root: string, e: DragEvent) => {
    e.dataTransfer?.setData(PROJECT_MIME, root);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
  };
  const allowProjectDrop = (e: DragEvent) => {
    if (e.dataTransfer?.types.includes(PROJECT_MIME)) {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    }
  };
  const dropInto = (groupId: string | null, e: DragEvent) => {
    const root = e.dataTransfer?.getData(PROJECT_MIME);
    setDropGroup(null);
    if (!root) return;
    e.preventDefault();
    e.stopPropagation();
    assignProject(root, groupId);
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

  const ProjectMenu = (p: { root: string }) => {
    const name = () => workspace.projects.find((x) => x.projectRoot === p.root)?.displayName ?? "";
    return (
      <>
        <div class="pf-menu-label">{name()}</div>
        <button class="pf-menu-item" onClick={() => { selectProject(p.root); closeMenu(); }}>Open</button>
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

  const ProjectRow = (p: { project: Project }) => {
    const root = p.project.projectRoot;
    return (
      <div
        class="pf-rail-row"
        classList={{ active: workspace.activeRoot === root }}
        draggable={true}
        onDragStart={(e) => dragStart(root, e)}
        onClick={() => selectProject(root)}
        onContextMenu={(e) => openFromContext("project", root, e)}
      >
        <Show when={renaming() === root} fallback={<span class="pf-rail-row-label">{p.project.displayName}</span>}>
          <RenameField value={p.project.displayName} commit={(v) => void renameProject(root, v)} />
        </Show>
        <button class="pf-rail-row-action" title="Project options" onClick={(e) => openFromButton("project", root, e)}>
          <IconMore size={14} />
        </button>
      </div>
    );
  };

  const ProjectCard = (p: { project: Project }) => {
    const root = p.project.projectRoot;
    return (
      <div
        class="pf-proj-card"
        classList={{ active: workspace.activeRoot === root }}
        draggable={true}
        onDragStart={(e) => dragStart(root, e)}
        onClick={() => selectProject(root)}
        onContextMenu={(e) => openFromContext("project", root, e)}
      >
        <span class="pf-proj-card-mark">{p.project.displayName.charAt(0).toUpperCase()}</span>
        <Show when={renaming() === root} fallback={<span class="pf-proj-card-name">{p.project.displayName}</span>}>
          <RenameField value={p.project.displayName} commit={(v) => void renameProject(root, v)} />
        </Show>
        <button class="pf-proj-card-menu" title="Project options" onClick={(e) => openFromButton("project", root, e)}>
          <IconMore size={14} />
        </button>
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

  const GroupHeader = (p: { group: ProjectGroup; count: number }) => (
    <div
      class="pf-group-head"
      classList={{ "pf-drop-target": dropGroup() === p.group.id }}
      onContextMenu={(e) => openFromContext("group", p.group.id, e)}
      onDragOver={(e) => { allowProjectDrop(e); setDropGroup(p.group.id); }}
      onDragLeave={() => setDropGroup((g) => (g === p.group.id ? null : g))}
      onDrop={(e) => dropInto(p.group.id, e)}
    >
      <button class="pf-group-toggle" onClick={() => toggleGroup(p.group.id)}>
        <Show when={!p.group.collapsed} fallback={<IconChevronRight size={13} />}>
          <IconChevronDown size={13} />
        </Show>
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

  return (
    <div class="pf-pane-scroll">
      <div class="pf-pane-toolbar">
        <div class="pf-view-toggle">
          <button classList={{ active: !grid() }} title="List view" onClick={() => setViewMode("list")}><IconList size={13} /></button>
          <button classList={{ active: grid() }} title="Grid view" onClick={() => setViewMode("grid")}><IconGrid size={13} /></button>
        </div>
        <button class="pf-icon-btn" title="New group" onClick={() => setRenaming(createGroup())}><IconFolderPlus size={14} /></button>
        <button class="pf-icon-btn" title="Add project" onClick={pickProject}><IconPlus /></button>
      </div>

      <div class="pf-rail-list">
        <Show when={workspace.projects.length > 0} fallback={<div class="pf-rail-empty">No projects yet</div>}>
          <Show when={hasGroups()} fallback={<div onDragOver={allowProjectDrop} onDrop={(e) => dropInto(null, e)}><ProjectsBody projects={workspace.projects} /></div>}>
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
                          onDrop={(e) => dropInto(null, e)}
                        >
                          <span class="pf-group-name">Ungrouped</span>
                          <span class="pf-group-count">{bucket.projects.length}</span>
                        </div>
                        <ProjectsBody projects={bucket.projects} />
                      </Show>
                    }
                  >
                    <GroupHeader group={bucket.group!} count={bucket.projects.length} />
                    <Show when={!bucket.group!.collapsed}>
                      <div onDragOver={allowProjectDrop} onDrop={(e) => dropInto(bucket.group!.id, e)}>
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
            </Switch>
          </FloatingMenu>
        )}
      </Show>
    </div>
  );
}
