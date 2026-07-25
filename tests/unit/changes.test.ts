// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChangeSet, WorkingTreeChanges } from "../../src/lib/changes";

const testEnv = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: testEnv.invoke }));

async function loadStore() {
  vi.resetModules();
  return import("../../src/stores/changes");
}

const TURN_CHANGE_SET: ChangeSet = {
  id: "turn:chat-1:1",
  scope: "turn",
  source: "providerSnapshot",
  chatId: "chat-1",
  turnSeq: 1,
  repoRoot: "/repo",
  capturedAt: 1_000,
  stale: false,
  truncated: false,
  files: [
    {
      path: "src/lib.rs",
      oldPath: null,
      status: "modify",
      staged: null,
      unstaged: null,
      additions: 3,
      deletions: 1,
      binary: false,
      truncated: false,
      diffAvailable: true,
    },
  ],
  totals: { files: 1, additions: 3, deletions: 1 },
};

const OTHER_TURN_CHANGE_SET: ChangeSet = { ...TURN_CHANGE_SET, id: "turn:chat-1:2", turnSeq: 2 };

const WORKING_TREE_READY: WorkingTreeChanges = {
  state: "ready",
  changeSet: {
    id: "workingTree:/repo",
    scope: "workingTree",
    source: "gitLive",
    chatId: null,
    turnSeq: null,
    repoRoot: "/repo",
    capturedAt: 2_000,
    stale: false,
    truncated: false,
    files: [
      {
        path: "a.txt",
        oldPath: null,
        status: "modify",
        staged: false,
        unstaged: true,
        additions: 1,
        deletions: 0,
        binary: false,
        truncated: false,
        diffAvailable: true,
      },
    ],
    totals: { files: 1, additions: 1, deletions: 0 },
  },
};

beforeEach(() => {
  testEnv.invoke.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("changes store — this-turn scope", () => {
  it("fetches and selects the matching turn on setThisTurnTarget", async () => {
    testEnv.invoke.mockResolvedValueOnce([TURN_CHANGE_SET, OTHER_TURN_CHANGE_SET]);
    const store = await loadStore();

    store.setThisTurnTarget("chat-1", "/repo", 1);
    await vi.waitFor(() => expect(store.changesReviewLoading()).toBe(false));

    expect(testEnv.invoke).toHaveBeenCalledWith("changes_list_turn_change_sets", {
      chatId: "chat-1",
      projectRoot: "/repo",
    });
    expect(store.changesReviewChangeSet()).toEqual(TURN_CHANGE_SET);
    expect(store.changesReviewError()).toBeNull();
    expect(store.changesReviewCapturedAt()).not.toBeNull();
    expect(store.changesReviewStale()).toBe(false);
  });

  it("resolves changeSet to null when no turn in the listing matches turnSeq", async () => {
    testEnv.invoke.mockResolvedValueOnce([OTHER_TURN_CHANGE_SET]);
    const store = await loadStore();

    store.setThisTurnTarget("chat-1", "/repo", 999);
    await vi.waitFor(() => expect(store.changesReviewLoading()).toBe(false));

    expect(store.changesReviewChangeSet()).toBeNull();
  });

  it("surfaces a failed load as an error without throwing", async () => {
    testEnv.invoke.mockRejectedValueOnce(new Error("db unavailable"));
    const store = await loadStore();

    store.setThisTurnTarget("chat-1", "/repo", 1);
    await vi.waitFor(() => expect(store.changesReviewLoading()).toBe(false));

    expect(store.changesReviewError()).toBe("db unavailable");
    expect(store.changesReviewChangeSet()).toBeNull();
  });
});

describe("changes store — working-tree scope", () => {
  it("fetches the live working tree and exposes its explicit state", async () => {
    testEnv.invoke.mockResolvedValueOnce(WORKING_TREE_READY);
    const store = await loadStore();

    store.setChangesReviewScope("workingTree");
    store.setWorkingTreeTarget("/repo");
    await vi.waitFor(() => expect(store.changesReviewLoading()).toBe(false));

    expect(testEnv.invoke).toHaveBeenCalledWith("changes_working_tree", { projectRoot: "/repo" });
    expect(store.changesReviewChangeSet()).toEqual(WORKING_TREE_READY.changeSet);
    expect(store.changesReviewWorkingTreeState()).toBe("ready");
  });

  it("surfaces notARepo/remoteUnsupported as an explicit state with a null change-set", async () => {
    testEnv.invoke.mockResolvedValueOnce({ state: "notARepo" } satisfies WorkingTreeChanges);
    const store = await loadStore();

    store.setChangesReviewScope("workingTree");
    store.setWorkingTreeTarget("/not-a-repo");
    await vi.waitFor(() => expect(store.changesReviewLoading()).toBe(false));

    expect(store.changesReviewWorkingTreeState()).toBe("notARepo");
    expect(store.changesReviewChangeSet()).toBeNull();
  });
});

describe("changes store — scope switch preserves each slice's own state", () => {
  it("keeps the this-turn result available after switching to working tree and back", async () => {
    testEnv.invoke.mockResolvedValueOnce([TURN_CHANGE_SET]);
    testEnv.invoke.mockResolvedValueOnce(WORKING_TREE_READY);
    const store = await loadStore();

    store.setThisTurnTarget("chat-1", "/repo", 1);
    await vi.waitFor(() => expect(store.changesReviewLoading()).toBe(false));
    expect(store.changesReviewChangeSet()).toEqual(TURN_CHANGE_SET);

    store.setChangesReviewScope("workingTree");
    store.setWorkingTreeTarget("/repo");
    await vi.waitFor(() => expect(store.changesReviewLoading()).toBe(false));
    expect(store.changesReviewChangeSet()).toEqual(WORKING_TREE_READY.changeSet);

    store.setChangesReviewScope("thisTurn");
    expect(store.changesReviewChangeSet()).toEqual(TURN_CHANGE_SET);
    expect(testEnv.invoke).toHaveBeenCalledTimes(2); // switching scope alone never refetches
  });
});

describe("changes store — lazy per-file diff fetch", () => {
  it("fetches a this-turn file diff keyed by path and dedupes concurrent requests", async () => {
    testEnv.invoke.mockResolvedValueOnce([TURN_CHANGE_SET]);
    const store = await loadStore();
    store.setThisTurnTarget("chat-1", "/repo", 1);
    await vi.waitFor(() => expect(store.changesReviewLoading()).toBe(false));

    let resolveDiff: (value: unknown) => void = () => {};
    testEnv.invoke.mockImplementationOnce(
      () => new Promise((resolve) => { resolveDiff = resolve; }),
    );

    const first = store.loadChangeDiff("src/lib.rs");
    const second = store.loadChangeDiff("src/lib.rs");
    expect(testEnv.invoke).toHaveBeenCalledTimes(2); // 1 listing + 1 diff fetch, not 2 diff fetches
    resolveDiff({ diff: "+a\n", binary: false, truncated: false, available: true });

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult).toBe(secondResult);
    expect(testEnv.invoke).toHaveBeenLastCalledWith("changes_turn_file_diff", {
      chatId: "chat-1",
      projectRoot: "/repo",
      turnSeq: 1,
      path: "src/lib.rs",
    });
  });

  it("keys a working-tree diff fetch by staged/unstaged separately for the same path", async () => {
    testEnv.invoke.mockResolvedValueOnce(WORKING_TREE_READY);
    const store = await loadStore();
    store.setChangesReviewScope("workingTree");
    store.setWorkingTreeTarget("/repo");
    await vi.waitFor(() => expect(store.changesReviewLoading()).toBe(false));

    testEnv.invoke.mockResolvedValueOnce({ diff: "unstaged", binary: false, truncated: false, available: true });
    testEnv.invoke.mockResolvedValueOnce({ diff: "staged", binary: false, truncated: false, available: true });

    const unstaged = await store.loadChangeDiff("a.txt", false);
    const staged = await store.loadChangeDiff("a.txt", true);

    expect(unstaged.diff).toBe("unstaged");
    expect(staged.diff).toBe("staged");
    expect(testEnv.invoke).toHaveBeenNthCalledWith(2, "changes_working_tree_file_diff", {
      projectRoot: "/repo",
      path: "a.txt",
      staged: false,
    });
    expect(testEnv.invoke).toHaveBeenNthCalledWith(3, "changes_working_tree_file_diff", {
      projectRoot: "/repo",
      path: "a.txt",
      staged: true,
    });
  });

  it("evicts a rejected diff fetch so a later call retries instead of replaying the failure", async () => {
    testEnv.invoke.mockResolvedValueOnce([TURN_CHANGE_SET]);
    const store = await loadStore();
    store.setThisTurnTarget("chat-1", "/repo", 1);
    await vi.waitFor(() => expect(store.changesReviewLoading()).toBe(false));

    testEnv.invoke.mockRejectedValueOnce(new Error("git diff timed out"));
    await expect(store.loadChangeDiff("src/lib.rs")).rejects.toThrow("git diff timed out");

    testEnv.invoke.mockResolvedValueOnce({ diff: "+a\n", binary: false, truncated: false, available: true });
    const retried = await store.loadChangeDiff("src/lib.rs");
    expect(retried.diff).toBe("+a\n");
  });

  it("rejects immediately when no target is set for the active scope", async () => {
    const store = await loadStore();
    await expect(store.loadChangeDiff("src/lib.rs")).rejects.toThrow();
  });
});

describe("changes store — refresh triggers", () => {
  it("refreshes on a matching turn-completion notification, ignores an unrelated chat", async () => {
    testEnv.invoke.mockResolvedValueOnce([TURN_CHANGE_SET]);
    const store = await loadStore();
    store.setThisTurnTarget("chat-1", "/repo", 1);
    await vi.waitFor(() => expect(store.changesReviewLoading()).toBe(false));

    store.notifyChangesReviewTurnCompleted("chat-unrelated");
    expect(testEnv.invoke).toHaveBeenCalledTimes(1); // no refetch for a different chat

    testEnv.invoke.mockResolvedValueOnce([TURN_CHANGE_SET]);
    store.notifyChangesReviewTurnCompleted("chat-1");
    await vi.waitFor(() => expect(testEnv.invoke).toHaveBeenCalledTimes(2));
  });

  it("refreshes the working-tree slice on a matching project-change notification only", async () => {
    testEnv.invoke.mockResolvedValueOnce(WORKING_TREE_READY);
    const store = await loadStore();
    store.setChangesReviewScope("workingTree");
    store.setWorkingTreeTarget("/repo");
    await vi.waitFor(() => expect(store.changesReviewLoading()).toBe(false));

    store.notifyChangesReviewProjectChanged("/other-project");
    expect(testEnv.invoke).toHaveBeenCalledTimes(1);

    testEnv.invoke.mockResolvedValueOnce(WORKING_TREE_READY);
    store.notifyChangesReviewProjectChanged("/repo");
    await vi.waitFor(() => expect(testEnv.invoke).toHaveBeenCalledTimes(2));
  });

  it("refreshes whichever targets are set on window refocus once started, with no polling otherwise", async () => {
    testEnv.invoke.mockResolvedValueOnce([TURN_CHANGE_SET]);
    const store = await loadStore();
    store.setThisTurnTarget("chat-1", "/repo", 1);
    await vi.waitFor(() => expect(store.changesReviewLoading()).toBe(false));

    // Not listening yet: a focus event before start() is a no-op.
    window.dispatchEvent(new Event("focus"));
    expect(testEnv.invoke).toHaveBeenCalledTimes(1);

    store.startChangesReviewFocusRefresh();
    testEnv.invoke.mockResolvedValueOnce([TURN_CHANGE_SET]);
    window.dispatchEvent(new Event("focus"));
    await vi.waitFor(() => expect(testEnv.invoke).toHaveBeenCalledTimes(2));

    // No timer-driven refetch: waiting without another trigger stays at 2 calls.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(testEnv.invoke).toHaveBeenCalledTimes(2);

    // A second start() is idempotent — no doubled listener.
    store.startChangesReviewFocusRefresh();
    testEnv.invoke.mockResolvedValueOnce([TURN_CHANGE_SET]);
    window.dispatchEvent(new Event("focus"));
    await vi.waitFor(() => expect(testEnv.invoke).toHaveBeenCalledTimes(3));

    store.stopChangesReviewFocusRefresh();
    window.dispatchEvent(new Event("focus"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(testEnv.invoke).toHaveBeenCalledTimes(3);
  });
});

// A per-slice request generation guards every commit site (this-turn
// listing, working-tree listing, and the lazy per-file diff cache's eviction
// closure) against an older, slower request finishing after a newer one has
// already landed — same pattern as `stores/agentChat.ts`'s `ensureGenerations`.
describe("changes store — out-of-order request completion", () => {
  it("this-turn: an older target's late response does not clobber a newer target's result", async () => {
    const store = await loadStore();

    let resolveA: (value: unknown) => void = () => {};
    testEnv.invoke.mockImplementationOnce(() => new Promise((resolve) => { resolveA = resolve; }));
    store.setThisTurnTarget("chat-1", "/repo", 1); // request A: turnSeq 1

    let resolveB: (value: unknown) => void = () => {};
    testEnv.invoke.mockImplementationOnce(() => new Promise((resolve) => { resolveB = resolve; }));
    store.setThisTurnTarget("chat-1", "/repo", 2); // request B: turnSeq 2, supersedes A

    // B resolves first...
    resolveB([OTHER_TURN_CHANGE_SET]);
    await vi.waitFor(() => expect(store.changesReviewChangeSet()).toEqual(OTHER_TURN_CHANGE_SET));
    expect(store.changesReviewLoading()).toBe(false);

    // ...then A's late response arrives. It must be a no-op: B's result stays,
    // and A finishing must not flip `loading` back to true then immediately
    // false either (it must simply never touch loading at all).
    resolveA([TURN_CHANGE_SET]);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(store.changesReviewChangeSet()).toEqual(OTHER_TURN_CHANGE_SET);
    expect(store.changesReviewLoading()).toBe(false);
  });

  it("working-tree: an older project's late response does not clobber a newer project's result", async () => {
    const store = await loadStore();
    const OTHER_PROJECT_READY: WorkingTreeChanges = {
      state: "ready",
      changeSet: { ...WORKING_TREE_READY.changeSet, id: "workingTree:/other", repoRoot: "/other" },
    };

    let resolveA: (value: unknown) => void = () => {};
    testEnv.invoke.mockImplementationOnce(() => new Promise((resolve) => { resolveA = resolve; }));
    store.setChangesReviewScope("workingTree");
    store.setWorkingTreeTarget("/repo"); // request A

    let resolveB: (value: unknown) => void = () => {};
    testEnv.invoke.mockImplementationOnce(() => new Promise((resolve) => { resolveB = resolve; }));
    store.setWorkingTreeTarget("/other"); // request B, supersedes A

    resolveB(OTHER_PROJECT_READY);
    await vi.waitFor(() => expect(store.changesReviewChangeSet()).toEqual(OTHER_PROJECT_READY.changeSet));
    expect(store.changesReviewLoading()).toBe(false);

    resolveA(WORKING_TREE_READY);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(store.changesReviewChangeSet()).toEqual(OTHER_PROJECT_READY.changeSet);
    expect(store.changesReviewLoading()).toBe(false);
  });

  it("lazy diff fetch: an old target's late-rejecting fetch never evicts the new target's own cache entry for the same key", async () => {
    testEnv.invoke.mockResolvedValueOnce([TURN_CHANGE_SET]);
    const store = await loadStore();
    store.setThisTurnTarget("chat-1", "/repo", 1);
    await vi.waitFor(() => expect(store.changesReviewLoading()).toBe(false));

    let rejectOld: (err: unknown) => void = () => {};
    testEnv.invoke.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectOld = reject; }));
    const oldDiff = store.loadChangeDiff("src/lib.rs"); // in flight against turnSeq 1
    oldDiff.catch(() => {}); // this test asserts on cache state, not on this rejection

    // Switch target (turnSeq 1 -> 2): the diff cache resets to a fresh Map,
    // so the in-flight `oldDiff` promise above belongs to a map no longer
    // reachable via the store.
    testEnv.invoke.mockResolvedValueOnce([OTHER_TURN_CHANGE_SET]);
    store.setThisTurnTarget("chat-1", "/repo", 2);
    await vi.waitFor(() => expect(store.changesReviewLoading()).toBe(false));

    // The new target caches its OWN promise under the same path.
    testEnv.invoke.mockImplementationOnce(
      () => new Promise((resolve) => resolve({ diff: "+new\n", binary: false, truncated: false, available: true })),
    );
    const newDiff = store.loadChangeDiff("src/lib.rs");

    // The OLD (superseded) fetch now rejects. If its eviction closure reads
    // the mutable `turnDiffCache` binding instead of the map it was stored
    // in, this would incorrectly delete the NEW target's cache entry.
    rejectOld(new Error("stale target's fetch failed"));
    await new Promise((resolve) => setTimeout(resolve, 10));

    // A second call for the same path/target must still return the SAME
    // cached promise — proof the new entry was never evicted.
    expect(store.loadChangeDiff("src/lib.rs")).toBe(newDiff);
    await expect(newDiff).resolves.toEqual({ diff: "+new\n", binary: false, truncated: false, available: true });
  });
});
