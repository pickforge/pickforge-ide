// Per-project git branch cache for the flat work card footer (#306 PR3):
// the "branch/worktree name" plumbing the Chat schema doesn't carry today.
// Reuses `gitStatus` — the SAME `git_status` Tauri command SourceControl.tsx
// and OrchestraView.tsx already call — rather than spawning a new git
// process; this just adds a new, cached call site keyed by projectRoot, so
// every card sharing a project (multiple chats, one worktree) pays for
// exactly one status call, not one per chat/render.
//
// No live-refresh wiring (no window-focus/branch-switch invalidation, unlike
// `stores/changes.ts`'s working-tree scope): the footer's branch name is a
// cheap, mostly-static label, and this cache only needs to resolve once per
// project for the lifetime of the flat list being open.
import { createStore } from "solid-js/store";
import { gitStatus } from "../lib/git";

// `undefined`: never fetched. `null`: fetched, no branch (not a repo, or a
// repo with no resolvable branch). Both read as "absent" by `cardBranch`;
// the distinction only matters to `ensureProjectBranch`'s own re-fetch guard.
type BranchEntry = string | null;

const [branches, setBranches] = createStore<Record<string, BranchEntry>>({});
const inFlight = new Set<string>();

/** The cached branch for `projectRoot` — `undefined` before the first fetch
 *  resolves (footer principle: absent while loading, never a placeholder),
 *  `null` once resolved with no branch, otherwise the branch name. */
export function projectBranchOf(projectRoot: string): string | null | undefined {
  return branches[projectRoot];
}

// pickforge-core's `current_branch` runs `git rev-parse --abbrev-ref HEAD`,
// which returns the literal string "HEAD" (not empty, not an error) when the
// worktree is in detached-HEAD state — there is no branch to report. Treat
// that, and a blank/whitespace-only result, the same as "no branch" rather
// than caching a bogus or empty literal — a detached-HEAD project's footer
// stays branch-absent instead of showing "HEAD" or a blank chip.
function normalizeBranch(branch: string | null): string | null {
  const trimmed = branch?.trim() ?? "";
  return trimmed && trimmed !== "HEAD" ? trimmed : null;
}

/** Kicks off the cached branch fetch for `projectRoot`, once. Idempotent —
 *  a call while already cached (including a cached "no branch") or already
 *  in flight is a no-op, so callers (`FlatWorkCard`) can call this
 *  unconditionally on every render without triggering a new git spawn. */
export function ensureProjectBranch(projectRoot: string): void {
  if (projectRoot in branches || inFlight.has(projectRoot)) return;
  inFlight.add(projectRoot);
  void gitStatus(projectRoot)
    .then((status) => setBranches(projectRoot, normalizeBranch(status.branch)))
    .catch(() => setBranches(projectRoot, null))
    .finally(() => inFlight.delete(projectRoot));
}
