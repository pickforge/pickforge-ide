import { describe, expect, it } from "vitest";
import { resolveDiffViewMode, SPLIT_VIEW_MIN_WIDTH } from "../../src/lib/diffViewMode";

describe("resolveDiffViewMode (#231 PR5 split-vs-unified width gating)", () => {
  it("forces unified below the split-view width threshold regardless of preference", () => {
    expect(resolveDiffViewMode(SPLIT_VIEW_MIN_WIDTH - 1, "split")).toBe("unified");
    expect(resolveDiffViewMode(0, "split")).toBe("unified");
  });

  it("honors the preferred split mode at or above the threshold", () => {
    expect(resolveDiffViewMode(SPLIT_VIEW_MIN_WIDTH, "split")).toBe("split");
    expect(resolveDiffViewMode(SPLIT_VIEW_MIN_WIDTH + 400, "split")).toBe("split");
  });

  it("stays unified at any width when the user's own preference is unified", () => {
    expect(resolveDiffViewMode(SPLIT_VIEW_MIN_WIDTH + 400, "unified")).toBe("unified");
  });

  it("never guesses split from an unmeasured (zero) width", () => {
    expect(resolveDiffViewMode(0, "split")).toBe("unified");
  });
});
