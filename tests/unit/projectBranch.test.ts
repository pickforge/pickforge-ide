import { beforeEach, describe, expect, it, vi } from "vitest";

// projectBranch.ts reaches Tauri only through gitStatus (lib/git.ts's typed
// git_status invoke) — stub the raw invoke so these tests control what
// "git" reports without a real Tauri runtime or git process.
const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => mockInvoke(...args) }));

import { ensureProjectBranch, projectBranchOf } from "../../src/stores/projectBranch";

async function flushPromises() {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

beforeEach(() => {
  mockInvoke.mockReset();
});

describe("projectBranchOf — undefined (absent, never a placeholder) before any fetch", () => {
  it("is undefined for a root that was never asked for", () => {
    expect(projectBranchOf("/proj/never-fetched")).toBeUndefined();
  });
});

describe("ensureProjectBranch — cached branch fetch, keyed by project root (#306 PR3)", () => {
  it("resolves the branch from git_status and caches it", async () => {
    mockInvoke.mockResolvedValueOnce({ isRepo: true, branch: "feat/flat-card-plumbing", files: [] });

    ensureProjectBranch("/proj/worktree-a");
    await flushPromises();

    expect(projectBranchOf("/proj/worktree-a")).toBe("feat/flat-card-plumbing");
    expect(mockInvoke).toHaveBeenCalledWith("git_status", { projectRoot: "/proj/worktree-a" });
  });

  it("caches null when the root isn't a repo (no branch)", async () => {
    mockInvoke.mockResolvedValueOnce({ isRepo: false, branch: null, files: [] });

    ensureProjectBranch("/proj/not-a-repo");
    await flushPromises();

    expect(projectBranchOf("/proj/not-a-repo")).toBeNull();
  });

  it("caches null for a detached HEAD, not the literal string 'HEAD' (P2 fix)", async () => {
    // pickforge-core's current_branch is `git rev-parse --abbrev-ref HEAD`,
    // which returns "HEAD" — not empty, not a rejection — when the worktree
    // has no branch checked out. That must render as absent, never as a
    // bogus "HEAD" branch name in the footer.
    mockInvoke.mockResolvedValueOnce({ isRepo: true, branch: "HEAD", files: [] });

    ensureProjectBranch("/proj/detached-head");
    await flushPromises();

    expect(projectBranchOf("/proj/detached-head")).toBeNull();
  });

  it("caches null (not left undefined) when the git_status call rejects", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("spawn failed"));

    ensureProjectBranch("/proj/errors-out");
    await flushPromises();

    expect(projectBranchOf("/proj/errors-out")).toBeNull();
  });

  it("is idempotent — a second call for an already-cached root fetches nothing new", async () => {
    mockInvoke.mockResolvedValueOnce({ isRepo: true, branch: "main", files: [] });

    ensureProjectBranch("/proj/idempotent");
    await flushPromises();
    expect(mockInvoke).toHaveBeenCalledTimes(1);

    ensureProjectBranch("/proj/idempotent");
    await flushPromises();
    expect(mockInvoke).toHaveBeenCalledTimes(1); // still one call — cache hit, no re-fetch
  });

  it("is idempotent while a fetch is still in flight — never dispatches a second spawn per render", async () => {
    let resolveFetch: (value: { isRepo: boolean; branch: string | null; files: unknown[] }) => void = () => {};
    mockInvoke.mockImplementationOnce(
      () => new Promise((resolve) => { resolveFetch = resolve; }),
    );

    ensureProjectBranch("/proj/in-flight");
    ensureProjectBranch("/proj/in-flight"); // simulates a second render before the first resolves
    ensureProjectBranch("/proj/in-flight");
    await flushPromises();
    expect(mockInvoke).toHaveBeenCalledTimes(1);

    resolveFetch({ isRepo: true, branch: "sidebar-waiting", files: [] });
    await flushPromises();
    expect(projectBranchOf("/proj/in-flight")).toBe("sidebar-waiting");
  });

  it("scopes the cache per project root — one root's branch never leaks into another's", async () => {
    mockInvoke.mockResolvedValueOnce({ isRepo: true, branch: "feature-a", files: [] });
    mockInvoke.mockResolvedValueOnce({ isRepo: true, branch: "feature-b", files: [] });

    ensureProjectBranch("/proj/root-a");
    ensureProjectBranch("/proj/root-b");
    await flushPromises();

    expect(projectBranchOf("/proj/root-a")).toBe("feature-a");
    expect(projectBranchOf("/proj/root-b")).toBe("feature-b");
  });
});
