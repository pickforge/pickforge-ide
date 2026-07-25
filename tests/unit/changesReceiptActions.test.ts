import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChangeSet } from "../../src/lib/changes";

const mocks = vi.hoisted(() => ({
  openChangesReviewForTurn: vi.fn(),
  focusChangesReviewSurface: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock("../../src/stores/changes", () => ({
  openChangesReviewForTurn: mocks.openChangesReviewForTurn,
}));
vi.mock("../../src/stores/workbenchLayout", () => ({
  focusChangesReviewSurface: mocks.focusChangesReviewSurface,
}));
vi.mock("../../src/router", () => ({ navigate: mocks.navigate }));

import { reviewTurnChanges } from "../../src/lib/changesReceiptActions";

function turnChangeSet(overrides: Partial<ChangeSet> = {}): ChangeSet {
  return {
    id: "turn:chat-1:1",
    scope: "turn",
    source: "providerSnapshot",
    chatId: "chat-1",
    turnSeq: 5,
    repoRoot: "/project",
    capturedAt: 1,
    stale: false,
    truncated: false,
    files: [],
    totals: { files: 0, additions: 0, deletions: 0 },
    ...overrides,
  };
}

beforeEach(() => {
  mocks.openChangesReviewForTurn.mockClear();
  mocks.focusChangesReviewSurface.mockClear();
  mocks.navigate.mockClear();
});

describe("reviewTurnChanges", () => {
  it("selects the turn's ChangeSet as the active thisTurn review target, navigates to the Workbench, and focuses the Source Control pane", () => {
    const callOrder: string[] = [];
    mocks.openChangesReviewForTurn.mockImplementation(() => callOrder.push("select"));
    mocks.navigate.mockImplementation(() => callOrder.push("navigate"));
    mocks.focusChangesReviewSurface.mockImplementation(() => callOrder.push("focus"));

    reviewTurnChanges("chat-1", "/project", turnChangeSet({ turnSeq: 5 }));

    expect(mocks.openChangesReviewForTurn).toHaveBeenCalledWith("chat-1", "/project", 5);
    expect(mocks.navigate).toHaveBeenCalledWith("workbench");
    expect(mocks.focusChangesReviewSurface).toHaveBeenCalledTimes(1);
    // Select the scope/target before pulling focus toward it.
    expect(callOrder).toEqual(["select", "navigate", "focus"]);
  });

  it("is a defensive no-op for a null turnSeq (a workingTree-scope set, never produced by a chat receipt)", () => {
    reviewTurnChanges("chat-1", "/project", turnChangeSet({ turnSeq: null }));

    expect(mocks.openChangesReviewForTurn).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.focusChangesReviewSurface).not.toHaveBeenCalled();
  });
});
