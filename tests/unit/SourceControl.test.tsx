// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import type { ChangedFile } from "../../src/lib/changes";

const testEnv = vi.hoisted(() => ({
  invoke: vi.fn(),
  workspaceMock: { activeRoot: null as string | null, activeChatId: null as string | null },
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: testEnv.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));
vi.mock("../../src/stores/workspace", () => ({ workspace: testEnv.workspaceMock }));

import { buildChangesListItems, createRepoScanner, type ScListItem } from "../../src/screens/workbench/SourceControl";
import { notifyProjectTurnCompleted } from "../../src/stores/changes";

function file(overrides: Partial<ChangedFile> = {}): ChangedFile {
  return {
    path: "src/lib.rs",
    oldPath: null,
    status: "modify",
    staged: null,
    unstaged: null,
    additions: 4,
    deletions: 1,
    binary: false,
    truncated: false,
    diffAvailable: true,
    kind: "regular",
    ...overrides,
  };
}

function repo(path: string, changedFiles: ChangedFile[], branch: string | null = "main") {
  return { path, status: { isRepo: true, branch, files: [] }, changedFiles };
}

describe("buildChangesListItems (the #333 file-row mapping)", () => {
  it("a single flat repo gets no header, just its rows in order", () => {
    const files = [file({ path: "a.ts" }), file({ path: "b.ts" })];
    const items = buildChangesListItems([repo("/root", files)], true, () => false);
    expect(items).toEqual([
      { kind: "row", repo: expect.objectContaining({ path: "/root" }), file: files[0] },
      { kind: "row", repo: expect.objectContaining({ path: "/root" }), file: files[1] },
    ]);
  });

  it("a repo with zero changed files contributes nothing at all, not even a header", () => {
    const items = buildChangesListItems([repo("/root/app", [])], false, () => false);
    expect(items).toEqual([]);
  });

  it("a non-flat (monorepo) repo gets a header before its rows", () => {
    const files = [file({ path: "a.ts" })];
    const items = buildChangesListItems([repo("/root/app", files)], false, () => false);
    expect(items[0]).toMatchObject({ kind: "header", collapsed: false });
    expect(items[1]).toMatchObject({ kind: "row", file: files[0] });
  });

  it("a collapsed repo still gets its header, but none of its rows", () => {
    const files = [file({ path: "a.ts" }), file({ path: "b.ts" })];
    const items = buildChangesListItems([repo("/root/app", files)], false, () => true);
    expect(items).toEqual([
      { kind: "header", repo: expect.objectContaining({ path: "/root/app" }), collapsed: true },
    ]);
  });

  it("multiple repos: order follows the input array, each independently collapsible", () => {
    const appFiles = [file({ path: "app.ts" })];
    const apiFiles = [file({ path: "api.ts" })];
    const items = buildChangesListItems(
      [repo("/root/app", appFiles), repo("/root/api", apiFiles)],
      false,
      (p) => p === "/root/app", // only "app" is collapsed
    );
    const kinds = items.map((i: ScListItem) => [i.kind, i.repo.path]);
    expect(kinds).toEqual([
      ["header", "/root/app"],
      ["header", "/root/api"],
      ["row", "/root/api"],
    ]);
  });

  it("skips a repo entirely once its files are all gone, even if it was previously collapsed", () => {
    const items = buildChangesListItems([repo("/root/app", [])], false, () => true);
    expect(items).toEqual([]);
  });
});

/** Routes the three commands `createRepoScanner` issues per scan to minimal,
 *  always-`ready`, zero-file responses — enough for the scanner to complete a
 *  scan without erroring; these tests only care HOW MANY TIMES it scans, not
 *  what it renders. */
function mockGitBackend() {
  testEnv.invoke.mockImplementation((cmd: string) => {
    switch (cmd) {
      case "git_discover_repos":
        return Promise.resolve(["/repo"]);
      case "git_status":
        return Promise.resolve({ isRepo: true, branch: "main", files: [] });
      case "changes_working_tree":
        return Promise.resolve({
          state: "ready",
          changeSet: {
            id: "workingTree:/repo",
            scope: "workingTree",
            source: "gitLive",
            chatId: null,
            turnSeq: null,
            repoRoot: "/repo",
            capturedAt: 0,
            stale: false,
            truncated: false,
            files: [],
            totals: { files: 0, additions: 0, deletions: 0 },
          },
        });
      default:
        return Promise.resolve(undefined);
    }
  });
}

function discoverRepoCallCount(): number {
  return testEnv.invoke.mock.calls.filter((c) => c[0] === "git_discover_repos").length;
}

describe("createRepoScanner auto-refresh triggers (#333 review P2)", () => {
  beforeEach(() => {
    testEnv.invoke.mockReset();
    testEnv.workspaceMock.activeRoot = null;
  });

  it("mounting after a turn-completed event fired before subscription does only the normal initial scan", async () => {
    mockGitBackend();
    testEnv.workspaceMock.activeRoot = "/repo";

    // Fires BEFORE anything subscribes — a signal/epoch-based design (read at
    // mount) would replay this the instant a scanner mounts and "reads" it;
    // a real event must not (#333 review P2).
    notifyProjectTurnCompleted("/repo");

    const el = document.createElement("div");
    const dispose = render(() => {
      createRepoScanner();
      return null;
    }, el);

    await vi.waitFor(() => expect(discoverRepoCallCount()).toBe(1));
    // Give an (incorrect) replay-triggered second scan a chance to have
    // started before asserting it never did.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(discoverRepoCallCount()).toBe(1);

    dispose();
  });

  it("a matching turn-completed event AFTER mount triggers exactly one extra scan", async () => {
    mockGitBackend();
    testEnv.workspaceMock.activeRoot = "/repo";

    const el = document.createElement("div");
    const dispose = render(() => {
      createRepoScanner();
      return null;
    }, el);

    await vi.waitFor(() => expect(discoverRepoCallCount()).toBe(1));

    notifyProjectTurnCompleted("/repo");
    await vi.waitFor(() => expect(discoverRepoCallCount()).toBe(2));

    dispose();
  });

  it("an unrelated project's turn-completed event does not trigger a scan", async () => {
    mockGitBackend();
    testEnv.workspaceMock.activeRoot = "/repo";

    const el = document.createElement("div");
    const dispose = render(() => {
      createRepoScanner();
      return null;
    }, el);

    await vi.waitFor(() => expect(discoverRepoCallCount()).toBe(1));

    notifyProjectTurnCompleted("/other-repo");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(discoverRepoCallCount()).toBe(1);

    dispose();
  });
});
