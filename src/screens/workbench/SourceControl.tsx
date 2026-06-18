// Git "Source Control" pane: branch + changed-file list (porcelain), with a
// portaled unified-diff viewer. Read-only — stage/commit happen in the terminal.
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { IconClose, IconRefresh } from "../../components/icons";
import { gitDiff, gitStatus, type GitFileStatus, type GitStatus } from "../../lib/git";
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

export function SourceControl() {
  const [status, setStatus] = createSignal<GitStatus | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [diffFor, setDiffFor] = createSignal<{ file: GitFileStatus; staged: boolean; text: string } | null>(null);

  const refresh = async () => {
    const root = workspace.activeRoot;
    if (!root) {
      setStatus(null);
      return;
    }
    setLoading(true);
    try {
      const next = await gitStatus(root);
      if (workspace.activeRoot !== root) return; // project switched mid-flight
      setStatus(next);
    } catch (err) {
      console.error("[pickforge] git_status failed", err);
      if (workspace.activeRoot === root) setStatus({ isRepo: false, branch: null, files: [] });
    } finally {
      if (workspace.activeRoot === root) setLoading(false);
    }
  };

  // Reload whenever the active project changes.
  createEffect(() => {
    workspace.activeRoot;
    void refresh();
  });

  const openDiff = async (file: GitFileStatus, staged: boolean) => {
    const root = workspace.activeRoot;
    if (!root) return;
    try {
      const text = await gitDiff(root, file.path, staged);
      setDiffFor({ file, staged, text });
    } catch (err) {
      console.error("[pickforge] git_diff failed", err);
    }
  };

  const count = createMemo(() => status()?.files.length ?? 0);

  return (
    <div class="pf-pane-scroll pf-sc">
      <div class="pf-pane-toolbar pf-pane-toolbar--end">
        <Show when={status()?.branch}>
          <span class="pf-sc-branch">{status()!.branch}</span>
        </Show>
        <Show when={count() > 0}>
          <span class="pf-group-count">{count()}</span>
        </Show>
        <button class="pf-icon-btn" title="Refresh" disabled={!workspace.activeRoot} onClick={() => void refresh()}>
          <IconRefresh size={14} />
        </button>
      </div>

      <Show
        when={status()?.isRepo}
        fallback={
          <div class="pf-rail-empty">
            {loading() ? "Checking…" : "Not a git repository"}
          </div>
        }
      >
        <Show when={count() > 0} fallback={<div class="pf-rail-empty">No changes</div>}>
          <div class="pf-rail-list pf-sc-list">
            <For each={status()!.files}>
              {(f) => (
                <div
                  class="pf-sc-row"
                  title={f.path}
                  onClick={() => void openDiff(f, f.staged && !f.unstaged)}
                >
                  <span class={`pf-sc-letter ${tone(f)}`}>{letter(f)}</span>
                  <span class="pf-sc-name">{baseName(f.path)}</span>
                  <span class="pf-sc-dir">{dirName(f.path)}</span>
                </div>
              )}
            </For>
          </div>
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
                      onClick={() => void openDiff(d().file, false)}
                    >
                      Working
                    </button>
                    <button
                      classList={{ active: d().staged }}
                      onClick={() => void openDiff(d().file, true)}
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
