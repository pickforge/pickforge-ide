// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import type { ChangeSet, ChangedFile, WorkingTreeChanges } from "../../src/lib/changes";

const testEnv = vi.hoisted(() => ({ invoke: vi.fn(), workspaceMock: { activeRoot: null as string | null } }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: testEnv.invoke }));
vi.mock("../../src/stores/workspace", () => ({ workspace: testEnv.workspaceMock }));

let root: HTMLDivElement;
let dispose: (() => void) | undefined;

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
    ...overrides,
  };
}

function turnChangeSet(files: ChangedFile[], overrides: Partial<ChangeSet> = {}): ChangeSet {
  return {
    id: "turn:chat-1:1",
    scope: "turn",
    source: "providerSnapshot",
    chatId: "chat-1",
    turnSeq: 1,
    repoRoot: "/project",
    capturedAt: 1_000,
    stale: false,
    truncated: false,
    files,
    totals: {
      files: files.length,
      additions: files.reduce((n, f) => n + (f.additions ?? 0), 0),
      deletions: files.reduce((n, f) => n + (f.deletions ?? 0), 0),
    },
    ...overrides,
  };
}

function workingTreeReady(files: ChangedFile[]): WorkingTreeChanges {
  return {
    state: "ready",
    changeSet: {
      id: "workingTree:/project",
      scope: "workingTree",
      source: "gitLive",
      chatId: null,
      turnSeq: null,
      repoRoot: "/project",
      capturedAt: 2_000,
      stale: false,
      truncated: false,
      files,
      totals: {
        files: files.length,
        additions: files.reduce((n, f) => n + (f.additions ?? 0), 0),
        deletions: files.reduce((n, f) => n + (f.deletions ?? 0), 0),
      },
    },
  };
}

/** Fresh module graph per test: `stores/changes.ts` is a module-level
 *  singleton, so it (and the component under test, which imports it) must be
 *  re-imported after `resetModules` — matching `tests/unit/changes.test.ts`'s
 *  own pattern for the same store. */
async function loadSurface() {
  vi.resetModules();
  testEnv.invoke.mockReset();
  // A safe, honest default for any invoke call a test doesn't explicitly
  // configure (most commonly the auto-selected first file's lazy diff
  // fetch, which every mount triggers) — a resolved "unavailable" diff
  // rather than an unconfigured mock returning `undefined` and crashing
  // `loadChangeDiff`'s `.catch` on a non-Promise. `mockResolvedValueOnce`
  // calls layered on top of this in individual tests still take priority.
  testEnv.invoke.mockResolvedValue({ diff: null, binary: false, truncated: false, available: false });
  testEnv.workspaceMock.activeRoot = null;
  const changesStore = await import("../../src/stores/changes");
  const { ChangesReviewSurface } = await import("../../src/screens/workbench/ChangesReviewSurface");
  return { changesStore, ChangesReviewSurface };
}

beforeEach(() => {
  root = document.createElement("div");
  document.body.appendChild(root);
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  root.remove();
});

function mount(el: () => unknown) {
  dispose = render(el as never, root);
}

describe("ChangesReviewSurface — header honesty states", () => {
  it("renders totals, flags unknown stats, and flags a truncated listing", async () => {
    const { changesStore, ChangesReviewSurface } = await loadSurface();
    testEnv.invoke.mockResolvedValueOnce([
      turnChangeSet(
        [file({ path: "a.rs", additions: 3, deletions: 0 }), file({ path: "b.rs", additions: null, deletions: null })],
        { truncated: true },
      ),
    ]);
    changesStore.setThisTurnTarget("chat-1", "/project", 1);
    await vi.waitFor(() => expect(changesStore.changesReviewLoading()).toBe(false));

    mount(() => <ChangesReviewSurface branch={null} />);

    expect(root.querySelector(".pf-crs-meta")?.textContent).toBe("2 files");
    expect(root.querySelector(".pf-crs-stat--add")?.textContent).toBe("+3");
    expect(root.querySelector(".pf-crs-stat--del")?.textContent).toBe("−0");
    expect(root.querySelector(".pf-crs-unknown-flag")).not.toBeNull();
    expect(root.querySelector(".pf-crs-header .pf-crs-badge")?.textContent).toBe("truncated");
  });

  it("shows the this-turn empty prompt before any turn is selected, distinct from a not-found turn", async () => {
    const { ChangesReviewSurface } = await loadSurface();
    mount(() => <ChangesReviewSurface branch={null} />);
    expect(root.querySelector(".pf-rail-empty")?.textContent).toContain("Review changes");
  });

  it("shows an honest empty message for a clean working tree, not a loading/not-a-repo message", async () => {
    const { changesStore, ChangesReviewSurface } = await loadSurface();
    // Set scope ahead of mount and let the surface's OWN mount lifecycle
    // (`useChangesReviewSurfaceLifecycle`) seed the working-tree target for
    // the active project — calling `setWorkingTreeTarget` a second time here
    // would race the surface's own call and reset loading state underfoot.
    testEnv.invoke.mockResolvedValueOnce(workingTreeReady([]));
    testEnv.workspaceMock.activeRoot = "/project";
    changesStore.setChangesReviewScope("workingTree");

    mount(() => <ChangesReviewSurface branch="main" />);
    await vi.waitFor(() => expect(changesStore.changesReviewLoading()).toBe(false));
    expect(root.querySelector(".pf-rail-empty")?.textContent).toBe("No changes in the working tree.");
  });

  it("shows the branch only in working-tree scope, never for a historical turn", async () => {
    const { changesStore, ChangesReviewSurface } = await loadSurface();
    testEnv.invoke.mockResolvedValueOnce([turnChangeSet([file()])]);
    changesStore.setThisTurnTarget("chat-1", "/project", 1);
    await vi.waitFor(() => expect(changesStore.changesReviewLoading()).toBe(false));

    mount(() => <ChangesReviewSurface branch="main" />);
    expect(root.querySelector(".pf-crs-branch")).toBeNull();
  });
});

describe("ChangesReviewSurface — file navigator + diff pane", () => {
  async function mountWithTwoFiles() {
    const { changesStore, ChangesReviewSurface } = await loadSurface();
    testEnv.invoke.mockResolvedValueOnce([
      turnChangeSet([
        file({ path: "a.rs", additions: 2, deletions: 0 }),
        file({ path: "z-new.rs", oldPath: "z-old.rs", status: "rename", additions: 1, deletions: 1 }),
      ]),
    ]);
    changesStore.setThisTurnTarget("chat-1", "/project", 1);
    await vi.waitFor(() => expect(changesStore.changesReviewLoading()).toBe(false));
    testEnv.invoke.mockResolvedValue({
      diff: "@@ -1,1 +1,1 @@\n-old\n+new\n",
      binary: false,
      truncated: false,
      available: true,
    });
    mount(() => <ChangesReviewSurface branch={null} />);
    return { changesStore };
  }

  it("renders one navigator row per file, a rename as old arrow new, and defaults the first file active", async () => {
    await mountWithTwoFiles();
    await vi.waitFor(() => expect(root.querySelectorAll(".pf-crs-navrow")).toHaveLength(2));

    const rows = root.querySelectorAll(".pf-crs-navrow");
    expect(rows[0].classList.contains("pf-crs-navrow--active")).toBe(true);
    expect(rows[1].classList.contains("pf-crs-navrow--active")).toBe(false);
    expect(rows[1].querySelector(".pf-crs-navpath-old")?.textContent).toBe("z-old.rs");
    expect(rows[1].querySelector(".pf-crs-navpath")?.textContent).toContain("z-new.rs");
    expect(root.querySelector(".pf-crs-diffpath")?.textContent).toBe("a.rs");
  });

  it("renders parsed hunk gutters and add/del tints for the active file's diff", async () => {
    await mountWithTwoFiles();
    await vi.waitFor(() => expect(root.querySelector(".pf-crs-diffline")).not.toBeNull());

    const lines = root.querySelectorAll(".pf-crs-diffline");
    expect(lines).toHaveLength(2);
    expect(lines[0].classList.contains("pf-diff-del")).toBe(true);
    expect(lines[1].classList.contains("pf-diff-add")).toBe(true);
    expect(lines[0].querySelectorAll(".pf-crs-gutter")[0].textContent).toBe("1");
  });

  it("switches the active file and its diff when a navigator row is clicked", async () => {
    await mountWithTwoFiles();
    await vi.waitFor(() => expect(root.querySelectorAll(".pf-crs-navrow")).toHaveLength(2));

    root.querySelectorAll<HTMLButtonElement>(".pf-crs-navrow")[1].click();
    expect(root.querySelector(".pf-crs-diffpath")?.textContent).toBe("z-new.rs");
    expect(root.querySelectorAll(".pf-crs-navrow")[1].classList.contains("pf-crs-navrow--active")).toBe(true);
  });

  it("moves the active file through next/previous controls in navigator order", async () => {
    await mountWithTwoFiles();
    await vi.waitFor(() => expect(root.querySelectorAll(".pf-crs-navrow")).toHaveLength(2));

    const [prevBtn, nextBtn] = root.querySelectorAll<HTMLButtonElement>(".pf-crs-diffnav button");
    expect(prevBtn.disabled).toBe(true);
    expect(nextBtn.disabled).toBe(false);

    nextBtn.click();
    expect(root.querySelector(".pf-crs-diffpath")?.textContent).toBe("z-new.rs");
    expect(root.querySelectorAll<HTMLButtonElement>(".pf-crs-diffnav button")[1].disabled).toBe(true);

    root.querySelectorAll<HTMLButtonElement>(".pf-crs-diffnav button")[0].click();
    expect(root.querySelector(".pf-crs-diffpath")?.textContent).toBe("a.rs");
  });

  it("collapses and re-expands the active file's diff body without losing the header", async () => {
    await mountWithTwoFiles();
    await vi.waitFor(() => expect(root.querySelector(".pf-crs-diffline")).not.toBeNull());

    const collapseBtn = root.querySelector<HTMLButtonElement>(".pf-crs-diffhead .pf-icon-btn");
    collapseBtn?.click();
    expect(root.querySelector(".pf-crs-diffbody")).toBeNull();
    expect(root.querySelector(".pf-crs-diffpath")?.textContent).toBe("a.rs");

    collapseBtn?.click();
    await vi.waitFor(() => expect(root.querySelector(".pf-crs-diffline")).not.toBeNull());
  });

  it("renders an honest fallback for binary content instead of attempting to parse it", async () => {
    const { changesStore, ChangesReviewSurface } = await loadSurface();
    testEnv.invoke.mockResolvedValueOnce([turnChangeSet([file({ path: "logo.png", binary: true, additions: null, deletions: null })])]);
    changesStore.setThisTurnTarget("chat-1", "/project", 1);
    await vi.waitFor(() => expect(changesStore.changesReviewLoading()).toBe(false));
    testEnv.invoke.mockResolvedValueOnce({ diff: null, binary: true, truncated: false, available: true });

    mount(() => <ChangesReviewSurface branch={null} />);
    await vi.waitFor(() => expect(root.querySelector(".pf-crs-diffmessage")).not.toBeNull());
    expect(root.querySelector(".pf-crs-diffmessage")?.textContent).toContain("binary");
  });
});

describe("ChangesReviewSurface — scope switch", () => {
  it("switching scope shows the other scope's already-fetched files without refetching", async () => {
    const { changesStore, ChangesReviewSurface } = await loadSurface();
    testEnv.invoke.mockResolvedValueOnce([turnChangeSet([file({ path: "turn-file.rs" })])]);
    changesStore.setThisTurnTarget("chat-1", "/project", 1);
    await vi.waitFor(() => expect(changesStore.changesReviewLoading()).toBe(false));

    testEnv.invoke.mockResolvedValueOnce(workingTreeReady([file({ path: "wt-file.rs", staged: false, unstaged: true })]));
    testEnv.workspaceMock.activeRoot = "/project";

    mount(() => <ChangesReviewSurface branch={null} />);
    // The surface's own mount lifecycle seeds the working-tree slice for the
    // active project (#231 PR4's "project change" trigger wiring).
    await vi.waitFor(() => expect(testEnv.invoke).toHaveBeenCalledWith("changes_working_tree", { projectRoot: "/project" }));

    expect(root.querySelector(".pf-crs-navpath")?.textContent).toBe("turn-file.rs");

    // Selecting a file no test here has fetched a diff for keeps the mock's
    // unconfigured default (undefined) rather than throwing; only the LISTING
    // call count is asserted below — a lazy per-file diff fetch for the newly
    // active file is expected and is not what this test guards against.
    const listingCallsBeforeSwitch = () =>
      testEnv.invoke.mock.calls.filter(([cmd]) => cmd === "changes_working_tree").length;
    const before = listingCallsBeforeSwitch();
    root.querySelectorAll<HTMLButtonElement>(".pf-sc-viewtoggle button")[1].click();
    expect(root.querySelector(".pf-crs-navpath")?.textContent).toBe("wt-file.rs");
    expect(listingCallsBeforeSwitch()).toBe(before); // pure scope toggle, no re-listing
  });
});
