// Git "Source Control" pane: branch + changed-file list with per-file
// +adds/-dels, with a portaled unified-diff viewer. Read-only — stage/commit
// happen in the terminal.
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { IconChevronDown, IconClose, IconRefresh } from "../../components/icons";
import { gitDiff, gitDiscoverRepos, gitStatus, type GitStatus } from "../../lib/git";
import { changesWorkingTree, type ChangedFile } from "../../lib/changes";
import { watchGitChanges, type WatchHandle } from "../../lib/fsWatch";
import { GitGraph } from "./GitGraph";
import { ChangesReviewSurface, STATUS_LETTER, STATUS_TONE, FileStatsInline } from "./ChangesReviewSurface";
import { Dropdown } from "../../components/Dropdown";
import { workspace } from "../../stores/workspace";
import { isScmCollapsed, toggleScmCollapsed } from "../../stores/scmCollapsed";
import { changesReviewFocusEpoch } from "../../stores/workbenchLayout";
import { flagEnabled } from "../../stores/flags";
import { notifyChangesReviewProjectChanged } from "../../stores/changes";
import { lastTurnCompletedProjectRoot, turnCompletedEpoch } from "../../stores/repoRefresh";

function baseName(p: string): string {
  return p.replace(/[/\\]+$/, "").split(/[/\\]/).pop() || p;
}
function dirName(p: string): string {
  const parts = p.split(/[/\\]/);
  parts.pop();
  return parts.join("/");
}

interface RepoStatus {
  path: string;
  status: GitStatus;
  /** Changed-file rows with per-file +adds/−dels, from the shared
   *  changes/numstat backend (#333) — `changesWorkingTree`'s `ready` result,
   *  or `[]` when that repo isn't in a state a live read applies to (not a
   *  repo, a remote-bound project) rather than a separate error path; the
   *  legacy `status.isRepo`/loading states already cover "no git repo here"
   *  for the pane as a whole. */
  changedFiles: ChangedFile[];
}

type DiffTarget = { repo: string; path: string; staged: boolean; text: string };

/** One item in the flat, ordered list `ChangesList` renders: a monorepo
 *  section header (skipped entirely in `flat` mode — a single root repo
 *  never gets one), or a changed-file row. */
export type ScListItem =
  | { kind: "header"; repo: RepoStatus; collapsed: boolean }
  | { kind: "row"; repo: RepoStatus; file: ChangedFile };

/** The file-row mapping (#333): flattens `repos` into the exact ordered
 *  sequence `ChangesList` renders — a repo with no changed files contributes
 *  nothing at all; a non-flat repo gets a header item (always, even
 *  collapsed, so it stays clickable to expand); a collapsed repo's files are
 *  omitted, an expanded (or `flat`) repo's aren't. Pure and side-effect-free
 *  so it's unit-testable directly, independent of the rendered DOM — this
 *  drives the actual render (a single flat `<For>`) AND is what the
 *  keyboard-navigation query below scopes itself to (`.pf-sc-row` elements
 *  only, in this same order), so the two can never disagree about which row
 *  is "row 3". */
export function buildChangesListItems(
  repos: RepoStatus[],
  flat: boolean,
  isCollapsed: (repoPath: string) => boolean,
): ScListItem[] {
  const items: ScListItem[] = [];
  for (const repo of repos) {
    if (repo.changedFiles.length === 0) continue;
    const collapsed = !flat && isCollapsed(repo.path);
    if (!flat) items.push({ kind: "header", repo, collapsed });
    if (!collapsed) {
      for (const file of repo.changedFiles) items.push({ kind: "row", repo, file });
    }
  }
  return items;
}

/** The branch/view-toggle/refresh toolbar. A presentational child component —
 *  everything is an accessor/callback prop, so reactivity is preserved. */
function SourceControlToolbar(props: {
  repos: () => RepoStatus[];
  flat: () => boolean;
  view: () => "changes" | "graph";
  onViewChange: (v: "changes" | "graph") => void;
  total: () => number;
  canRefresh: () => boolean;
  onRefresh: () => void;
}) {
  return (
    <div class="pf-pane-toolbar pf-sc-toolbar">
      <span class="pf-sc-branch" title={props.flat() ? props.repos()[0].status.branch ?? "" : ""}>
        {props.flat()
          ? props.repos()[0].status.branch ?? "—"
          : props.repos().length > 1
            ? `${props.repos().length} repos`
            : "—"}
      </span>
      <div class="pf-sc-toolbar-end">
        <div class="pf-sc-viewtoggle">
          <button
            classList={{ "pf-sc-view--on": props.view() === "changes" }}
            title="Changes"
            onClick={() => props.onViewChange("changes")}
          >
            Changes
          </button>
          <button
            classList={{ "pf-sc-view--on": props.view() === "graph" }}
            title="Commit graph"
            onClick={() => props.onViewChange("graph")}
          >
            Graph
          </button>
        </div>
        <Show when={props.view() === "changes" && props.total() > 0}>
          <span class="pf-sc-count">{props.total()}</span>
        </Show>
        <button class="pf-icon-btn" title="Refresh" disabled={!props.canRefresh()} onClick={props.onRefresh}>
          <IconRefresh size={14} />
        </button>
      </div>
    </div>
  );
}

/** The changed-file list for the "Changes" view: a flat single-repo list, or
 *  collapsible per-repo sections for a monorepo. A presentational child
 *  component — everything is an accessor/callback prop, so reactivity is
 *  preserved. */
function ChangesList(props: {
  repos: () => RepoStatus[];
  total: () => number;
  flat: () => boolean;
  loading: () => boolean;
  repoName: (path: string) => string;
  onOpenDiff: (repo: string, file: ChangedFile, staged: boolean) => void;
}) {
  // The file-row mapping (`buildChangesListItems`) is this list's single
  // source of truth for what renders, in order — see its doc comment.
  const items = createMemo(() => buildChangesListItems(props.repos(), props.flat(), isScmCollapsed));

  // Keyboard nav (#333): queries the rendered `.pf-sc-row` elements back out
  // of the DOM in document order — which, because `items()` above is the
  // single flat list actually rendered below, always exactly matches
  // `items()`'s row entries (a collapsed section's rows are simply absent
  // from both). Moving focus this way needs no separate index bookkeeping
  // that could drift out of sync with what's on screen.
  let listEl: HTMLDivElement | undefined;
  const onListKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const rows = Array.from(listEl?.querySelectorAll<HTMLElement>(".pf-sc-row") ?? []);
    if (rows.length === 0) return;
    e.preventDefault();
    const current = rows.indexOf(document.activeElement as HTMLElement);
    const next =
      e.key === "ArrowDown" ? Math.min(current + 1, rows.length - 1) : Math.max(current - 1, 0);
    rows[Math.max(next, 0)]?.focus();
  };

  return (
    <Show
      when={props.repos().length > 0}
      fallback={
        <div class="pf-rail-empty">{props.loading() ? "Checking…" : "Not a git repository"}</div>
      }
    >
      <Show when={props.total() > 0} fallback={<div class="pf-rail-empty">No changes</div>}>
        <div class="pf-rail-list pf-sc-list" ref={listEl} onKeyDown={onListKeyDown}>
          <For each={items()}>
            {(item) =>
              item.kind === "header" ? (
                <button
                  class="pf-sc-section"
                  classList={{ "pf-sc-section--collapsed": item.collapsed }}
                  title={item.repo.path}
                  onClick={() => toggleScmCollapsed(item.repo.path)}
                >
                  <span class="pf-sc-section-chevron">
                    <IconChevronDown size={12} />
                  </span>
                  <span class="pf-sc-section-name">{props.repoName(item.repo.path)}</span>
                  <Show when={item.repo.status.branch}>
                    <span class="pf-sc-section-branch">{item.repo.status.branch}</span>
                  </Show>
                  <span class="pf-sc-count">{item.repo.changedFiles.length}</span>
                </button>
              ) : (
                <div
                  class="pf-sc-row"
                  tabIndex={0}
                  role="button"
                  title={item.file.path}
                  onClick={() => props.onOpenDiff(item.repo.path, item.file, item.file.staged === true)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" && e.key !== " ") return;
                    e.preventDefault();
                    props.onOpenDiff(item.repo.path, item.file, item.file.staged === true);
                  }}
                >
                  <span class={`pf-sc-letter ${STATUS_TONE[item.file.status]}`}>
                    {STATUS_LETTER[item.file.status]}
                  </span>
                  <span class="pf-sc-name">{baseName(item.file.path)}</span>
                  <span class="pf-sc-dir">{dirName(item.file.path)}</span>
                  <span class="pf-sc-stats">
                    <FileStatsInline file={item.file} />
                  </span>
                </div>
              )
            }
          </For>
        </div>
      </Show>
    </Show>
  );
}

/** The portaled unified-diff overlay for a selected file. A presentational
 *  child component — everything is an accessor/callback prop. */
function DiffModal(props: {
  diffFor: () => DiffTarget | null;
  onClose: () => void;
  onSelectTab: (repo: string, path: string, staged: boolean) => void;
}) {
  return (
    <Show when={props.diffFor()}>
      {(d) => (
        <Portal>
          <div class="pf-diff-overlay" onClick={props.onClose}>
            <div class="pf-diff-modal" onClick={(e) => e.stopPropagation()}>
              <div class="pf-diff-head">
                <span class="pf-diff-path">{d().path}</span>
                <div class="pf-diff-tabs">
                  <button
                    classList={{ active: !d().staged }}
                    onClick={() => props.onSelectTab(d().repo, d().path, false)}
                  >
                    Working
                  </button>
                  <button
                    classList={{ active: d().staged }}
                    onClick={() => props.onSelectTab(d().repo, d().path, true)}
                  >
                    Staged
                  </button>
                </div>
                <button class="pf-icon-btn" title="Close" onClick={props.onClose}>
                  <IconClose size={14} />
                </button>
              </div>
              <div class="pf-diff-body">
                <Show when={d().text.trim()} fallback={<div class="pf-rail-empty">No diff</div>}>
                  <For each={d().text.split("\n")}>
                    {(line) => <div class={`pf-diff-line ${diffLineClass(line)}`}>{line || " "}</div>}
                  </For>
                </Show>
              </div>
            </div>
          </div>
        </Portal>
      )}
    </Show>
  );
}

/** Discovers repos beneath the active project root and their status,
 *  re-scanning whenever the active project changes. A composable, called
 *  synchronously from `SourceControl`'s own setup so its `createEffect`
 *  runs under the same reactive owner as if written inline. */
function createRepoScanner() {
  const [repos, setRepos] = createSignal<RepoStatus[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [graphVersion, setGraphVersion] = createSignal(0);

  const refresh = async () => {
    const root = workspace.activeRoot;
    if (!root) {
      setRepos([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      // Discover repos at/beneath the root (monorepos keep their git in app/, api/…).
      const paths = await gitDiscoverRepos(root);
      if (workspace.activeRoot !== root) return; // project switched mid-flight
      const loaded = await Promise.all(
        paths.map(async (p) => {
          const [status, changes] = await Promise.all([gitStatus(p), changesWorkingTree(p)]);
          // #333: the changed-file list's data source is the shared
          // changes/numstat backend, not the porcelain `status.files` — see
          // `RepoStatus.changedFiles`'s doc comment. `status` itself is kept
          // for branch/isRepo (used by the toolbar and the Graph view).
          const changedFiles = changes.state === "ready" ? changes.changeSet.files : [];
          return { path: p, status, changedFiles };
        }),
      );
      if (workspace.activeRoot !== root) return;
      setRepos(loaded.filter((r) => r.status.isRepo));
      setGraphVersion((v) => v + 1); // let the graph view refetch on Refresh too
    } catch (err) {
      console.error("[pickforge] git scan failed", err);
      if (workspace.activeRoot === root) setRepos([]);
    } finally {
      if (workspace.activeRoot === root) setLoading(false);
    }
  };

  // Reload whenever the active project changes.
  createEffect(() => {
    workspace.activeRoot;
    void refresh();
  });

  // #333 auto-refresh triggers, generalized from `stores/changes.ts`'s
  // per-target notify pattern (project-change is already covered by the
  // effect above — the scanner IS keyed to `workspace.activeRoot`):
  //  - agent-turn completion in the active project (`stores/repoRefresh.ts`
  //    — NOT gated by the `changesReview` flag, since this pane is the
  //    default UI with the flag off).
  //  - window refocus, for changes made outside PickForge (another editor,
  //    a terminal git command) while the window was unfocused.
  createEffect(() => {
    turnCompletedEpoch();
    if (lastTurnCompletedProjectRoot() === workspace.activeRoot) void refresh();
  });
  onMount(() => {
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    onCleanup(() => window.removeEventListener("focus", onFocus));
  });

  return { repos, loading, graphVersion, refresh };
}

/** #333's filesystem-driven refresh trigger: watches the active project root
 *  for writes (via the generalized `"git"`-mode watcher — see
 *  `watchGitChanges`'s doc comment for what it ignores) and calls `refresh`
 *  on each debounced burst, so a change made by another process (a terminal
 *  `git checkout`, an external editor save) shows up without a manual
 *  Refresh click or a polling loop. Also nudges the `changesReview` store's
 *  working-tree slice the same way `useChangesReviewProjectSync` (project
 *  switch) already does — `notifyChangesReviewProjectChanged` is already a
 *  no-op unless that slice is currently targeting this exact root, so this
 *  is cheap to call unconditionally rather than tracking the Changes review
 *  surface's mount state here too. A composable, called synchronously from
 *  `SourceControl`'s own setup so its `createEffect`/`onCleanup` run under
 *  the same reactive owner as if written inline. */
function useGitFsWatchRefresh(refresh: () => void): void {
  let handle: WatchHandle | null = null;
  let watchedRoot: string | null = null;

  const stopWatch = () => {
    handle?.stop();
    handle = null;
    watchedRoot = null;
  };

  createEffect(() => {
    const root = workspace.activeRoot;
    if (root === watchedRoot) return;
    stopWatch();
    if (!root) return;
    watchedRoot = root;
    void watchGitChanges(root, () => {
      refresh();
      if (flagEnabled("changesReview")) notifyChangesReviewProjectChanged(root);
    })
      .then((h) => {
        // The active root may have changed again while this await was in
        // flight — a stale watcher for an abandoned root must never be kept.
        if (watchedRoot === root) handle = h;
        else void h.stop();
      })
      .catch((err) => console.error("[pickforge] git fs watch failed", err));
  });

  onCleanup(stopWatch);
}

export function SourceControl() {
  const { repos, loading, graphVersion, refresh } = createRepoScanner();
  useGitFsWatchRefresh(() => void refresh());
  const [view, setView] = createSignal<"changes" | "graph">("changes");
  const [graphSel, setGraphSel] = createSignal("");
  const [diffFor, setDiffFor] = createSignal<DiffTarget | null>(null);
  // The repo to graph: the user's pick if still present, else the first repo.
  const graphRepo = () => {
    const sel = graphSel();
    if (sel && repos().some((r) => r.path === sel)) return sel;
    return repos()[0]?.path ?? workspace.activeRoot ?? "";
  };
  // #231 PR4 retarget seam: `focusChangesReviewSurface` reveals this pane AND
  // bumps this epoch, so a receipt's "Review changes" click lands on the
  // Changes review surface even if this pane was last left on "Graph".
  createEffect(() => {
    changesReviewFocusEpoch();
    setView("changes");
  });
  // The active project's branch, already fetched by `createRepoScanner` for
  // the legacy toolbar — the Changes review surface (PR4) reuses it for its
  // header rather than issuing a second `git_status` call.
  const activeBranch = () =>
    repos().find((r) => r.path === (workspace.activeRoot ?? ""))?.status.branch
    ?? repos()[0]?.status.branch
    ?? null;

  const openDiff = async (repo: string, path: string, staged: boolean) => {
    try {
      const text = await gitDiff(repo, path, staged);
      setDiffFor({ repo, path, staged, text });
    } catch (err) {
      console.error("[pickforge] git_diff failed", err);
    }
  };

  const total = createMemo(() => repos().reduce((n, r) => n + r.changedFiles.length, 0));
  // A single repo at the project root keeps the original headerless layout.
  const flat = () => repos().length === 1 && repos()[0].path === (workspace.activeRoot ?? "");
  const repoName = (path: string) => {
    const root = workspace.activeRoot ?? "";
    if (path === root) return baseName(root);
    const rel = path.startsWith(root) ? path.slice(root.length).replace(/^[/\\]+/, "") : path;
    return rel || baseName(path);
  };

  return (
    <div class="pf-pane-scroll pf-sc">
      <SourceControlToolbar
        repos={repos}
        flat={flat}
        view={view}
        onViewChange={setView}
        total={total}
        canRefresh={() => !!workspace.activeRoot}
        onRefresh={() => void refresh()}
      />

      <Show when={view() === "graph"}>
        <Show
          when={repos().length > 0}
          fallback={<div class="pf-rail-empty">{loading() ? "Checking…" : "Not a git repository"}</div>}
        >
          <Show when={repos().length > 1}>
            <div class="pf-sc-graphrepo">
              <Dropdown
                value={graphRepo()}
                onChange={setGraphSel}
                options={repos().map((r) => ({ value: r.path, label: repoName(r.path) }))}
              />
            </div>
          </Show>
          <GitGraph repo={graphRepo()} version={graphVersion()} />
        </Show>
      </Show>

      <Show when={view() === "changes"}>
        <Show
          when={flagEnabled("changesReview")}
          fallback={
            <ChangesList
              repos={repos}
              total={total}
              flat={flat}
              loading={loading}
              repoName={repoName}
              onOpenDiff={(repo, f, staged) => void openDiff(repo, f.path, staged)}
            />
          }
        >
          <ChangesReviewSurface branch={activeBranch()} />
        </Show>
      </Show>

      <DiffModal
        diffFor={diffFor}
        onClose={() => setDiffFor(null)}
        onSelectTab={(repo, f, staged) => void openDiff(repo, f, staged)}
      />
    </div>
  );
}

function diffLineClass(line: string): string {
  if (line.startsWith("@@")) return "pf-diff-hunk";
  if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff ") || line.startsWith("index "))
    return "pf-diff-meta";
  if (line.startsWith("+")) return "pf-diff-add";
  if (line.startsWith("-")) return "pf-diff-del";
  return "";
}
