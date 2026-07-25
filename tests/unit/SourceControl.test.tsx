// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { ChangedFile } from "../../src/lib/changes";

const testEnv = vi.hoisted(() => ({
  invoke: vi.fn(),
  workspaceMock: { activeRoot: null as string | null, activeChatId: null as string | null },
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: testEnv.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));
vi.mock("../../src/stores/workspace", () => ({ workspace: testEnv.workspaceMock }));

import { buildChangesListItems, type ScListItem } from "../../src/screens/workbench/SourceControl";

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
