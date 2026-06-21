// Git "Source Control" pane: branch + changed-file list (porcelain), with a
// portaled unified-diff viewer. Read-only — stage/commit happen in the terminal.
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { IconClose, IconRefresh } from "../../components/icons";
import { gitDiff, gitDiscoverRepos, gitStatus, type GitFileStatus, type GitStatus } from "../../lib/git";
import { GitGraph } from "./GitGraph";
import { workspace } from "../../stores/workspace";

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

export function SourceControl() {
  const [repos, setRepos] = createSignal<RepoStatus[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [view, setView] = createSignal<"changes" | "graph">("changes");
  const [diffFor, setDiffFor] = createSignal<{ repo: string; file: GitFileStatus; staged: boolean; text: string } | null>(null);
  const graphRepo = () => repos()[0]?.path ?? workspace.activeRoot ?? "";

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
      <div class="pf-pane-toolbar pf-sc-toolbar">
        <span class="pf-sc-branch" title={flat() ? repos()[0].status.branch ?? "" : ""}>
          {flat()
            ? repos()[0].status.branch ?? "—"
            : repos().length > 1
              ? `${repos().length} repos`
              : "—"}
        </span>
        <div class="pf-sc-toolbar-end">
          <div class="pf-sc-viewtoggle">
            <button
              classList={{ "pf-sc-view--on": view() === "changes" }}
              title="Changes"
              onClick={() => setView("changes")}
            >
              Changes
            </button>
            <button
              classList={{ "pf-sc-view--on": view() === "graph" }}
              title="Commit graph"
              onClick={() => setView("graph")}
            >
              Graph
            </button>
          </div>
          <Show when={view() === "changes" && total() > 0}>
            <span class="pf-sc-count">{total()}</span>
          </Show>
          <button class="pf-icon-btn" title="Refresh" disabled={!workspace.activeRoot} onClick={() => void refresh()}>
            <IconRefresh size={14} />
          </button>
        </div>
      </div>

      <Show when={view() === "graph"}>
        <Show
          when={repos().length > 0}
          fallback={<div class="pf-rail-empty">{loading() ? "Checking…" : "Not a git repository"}</div>}
        >
          <GitGraph repo={graphRepo()} />
        </Show>
      </Show>

      <Show when={view() === "changes"}>

      <Show
        when={repos().length > 0}
        fallback={
          <div class="pf-rail-empty">
            {loading() ? "Checking…" : "Not a git repository"}
          </div>
        }
      >
        <Show when={total() > 0} fallback={<div class="pf-rail-empty">No changes</div>}>
          <div class="pf-rail-list pf-sc-list">
            <For each={repos()}>
              {(repo) => (
                <Show when={repo.status.files.length > 0}>
                  {/* Per-repo header — only when there are sub-repos, so a single
                      root repo keeps the original flat list. */}
                  <Show when={!flat()}>
                    <div class="pf-sc-section">
                      <span class="pf-sc-section-name" title={repo.path}>{repoName(repo.path)}</span>
                      <Show when={repo.status.branch}>
                        <span class="pf-sc-section-branch">{repo.status.branch}</span>
                      </Show>
                      <span class="pf-sc-count">{repo.status.files.length}</span>
                    </div>
                  </Show>
                  <For each={repo.status.files}>
                    {(f) => (
                      <div
                        class="pf-sc-row"
                        title={f.path}
                        onClick={() => void openDiff(repo.path, f, f.staged && !f.unstaged)}
                      >
                        <span class={`pf-sc-letter ${tone(f)}`}>{letter(f)}</span>
                        <span class="pf-sc-name">{baseName(f.path)}</span>
                        <span class="pf-sc-dir">{dirName(f.path)}</span>
                      </div>
                    )}
                  </For>
                </Show>
              )}
            </For>
          </div>
        </Show>
      </Show>
      </Show>

      <Show when={diffFor()}>
        {(d) => (
          <Portal>
            <div class="pf-diff-overlay" onClick={() => setDiffFor(null)}>
              <div class="pf-diff-modal" onClick={(e) => e.stopPropagation()}>
                <div class="pf-diff-head">
                  <span class="pf-diff-path">{d().file.path}</span>
                  <div class="pf-diff-tabs">
                    <button
                      classList={{ active: !d().staged }}
                      onClick={() => void openDiff(d().repo, d().file, false)}
                    >
                      Working
                    </button>
                    <button
                      classList={{ active: d().staged }}
                      onClick={() => void openDiff(d().repo, d().file, true)}
                    >
                      Staged
                    </button>
                  </div>
                  <button class="pf-icon-btn" title="Close" onClick={() => setDiffFor(null)}>
                    <IconClose size={14} />
                  </button>
                </div>
                <div class="pf-diff-body">
                  <Show when={d().text.trim()} fallback={<div class="pf-rail-empty">No diff</div>}>
                    <For each={d().text.split("\n")}>
                      {(line) => <div class={`pf-diff-line ${diffLineClass(line)}`}>{line || " "}</div>}
                    </For>
                  </Show>
                </div>
              </div>
            </div>
          </Portal>
        )}
      </Show>
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
