// Git "Source Control" pane: branch + changed-file list (porcelain), with a
// portaled unified-diff viewer. Read-only — stage/commit happen in the terminal.
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { IconChevronDown, IconClose, IconRefresh } from "../../components/icons";
import { gitDiff, gitDiscoverRepos, gitStatus, type GitFileStatus, type GitStatus } from "../../lib/git";
import { GitGraph } from "./GitGraph";
import { ChangesReviewSurface } from "./ChangesReviewSurface";
import { Dropdown } from "../../components/Dropdown";
import { workspace } from "../../stores/workspace";
import { isScmCollapsed, toggleScmCollapsed } from "../../stores/scmCollapsed";
import { changesReviewFocusEpoch } from "../../stores/workbenchLayout";
import { flagEnabled } from "../../stores/flags";

function letter(f: GitFileStatus): string {
  if (f.untracked) return "U";
  const x = f.status[0] !== " " ? f.status[0] : f.status[1];
  return x === " " ? "•" : x;
}
function tone(f: GitFileStatus): string {
  if (f.untracked) return "pf-sc-u";
  const c = (f.status[0] !== " " ? f.status[0] : f.status[1]).toUpperCase();
  if (c === "A") return "pf-sc-a";
  if (c === "D") return "pf-sc-d";
  if (c === "R" || c === "C") return "pf-sc-r";
  if (c === "U") return "pf-sc-x";
  return "pf-sc-m";
}
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
}

type DiffTarget = { repo: string; file: GitFileStatus; staged: boolean; text: string };

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
  onOpenDiff: (repo: string, file: GitFileStatus, staged: boolean) => void;
}) {
  return (
    <Show
      when={props.repos().length > 0}
      fallback={
        <div class="pf-rail-empty">{props.loading() ? "Checking…" : "Not a git repository"}</div>
      }
    >
      <Show when={props.total() > 0} fallback={<div class="pf-rail-empty">No changes</div>}>
        <div class="pf-rail-list pf-sc-list">
          <For each={props.repos()}>
            {(repo) => {
              // Sub-repo sections collapse (persisted per path); a single root
              // repo keeps its original flat, always-open list.
              const collapsed = () => !props.flat() && isScmCollapsed(repo.path);
              return (
                <Show when={repo.status.files.length > 0}>
                  <Show when={!props.flat()}>
                    <button
                      class="pf-sc-section"
                      classList={{ "pf-sc-section--collapsed": collapsed() }}
                      title={repo.path}
                      onClick={() => toggleScmCollapsed(repo.path)}
                    >
                      <span class="pf-sc-section-chevron">
                        <IconChevronDown size={12} />
                      </span>
                      <span class="pf-sc-section-name">{props.repoName(repo.path)}</span>
                      <Show when={repo.status.branch}>
                        <span class="pf-sc-section-branch">{repo.status.branch}</span>
                      </Show>
                      <span class="pf-sc-count">{repo.status.files.length}</span>
                    </button>
                  </Show>
                  <Show when={!collapsed()}>
                    <For each={repo.status.files}>
                      {(f) => (
                        <div
                          class="pf-sc-row"
                          title={f.path}
                          onClick={() => props.onOpenDiff(repo.path, f, f.staged && !f.unstaged)}
                        >
                          <span class={`pf-sc-letter ${tone(f)}`}>{letter(f)}</span>
                          <span class="pf-sc-name">{baseName(f.path)}</span>
                          <span class="pf-sc-dir">{dirName(f.path)}</span>
                        </div>
                      )}
                    </For>
                  </Show>
                </Show>
              );
            }}
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
  onSelectTab: (repo: string, file: GitFileStatus, staged: boolean) => void;
}) {
  return (
    <Show when={props.diffFor()}>
      {(d) => (
        <Portal>
          <div class="pf-diff-overlay" onClick={props.onClose}>
            <div class="pf-diff-modal" onClick={(e) => e.stopPropagation()}>
              <div class="pf-diff-head">
                <span class="pf-diff-path">{d().file.path}</span>
                <div class="pf-diff-tabs">
                  <button
                    classList={{ active: !d().staged }}
                    onClick={() => props.onSelectTab(d().repo, d().file, false)}
                  >
                    Working
                  </button>
                  <button
                    classList={{ active: d().staged }}
                    onClick={() => props.onSelectTab(d().repo, d().file, true)}
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
        paths.map(async (p) => ({ path: p, status: await gitStatus(p) })),
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

  return { repos, loading, graphVersion, refresh };
}

export function SourceControl() {
  const { repos, loading, graphVersion, refresh } = createRepoScanner();
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

  const openDiff = async (repo: string, file: GitFileStatus, staged: boolean) => {
    try {
      const text = await gitDiff(repo, file.path, staged);
      setDiffFor({ repo, file, staged, text });
    } catch (err) {
      console.error("[pickforge] git_diff failed", err);
    }
  };

  const total = createMemo(() => repos().reduce((n, r) => n + r.status.files.length, 0));
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
              onOpenDiff={(repo, f, staged) => void openDiff(repo, f, staged)}
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
