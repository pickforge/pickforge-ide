import { describe, expect, it } from "vitest";
import { scrollTopForCaret } from "../../src/lib/composerCaretScroll";

// The editor's visible window in client coordinates, and a caret one line tall.
const view = { viewTop: 100, viewBottom: 300 };
const base = { scrollTop: 50, maxScrollTop: 400, ...view };

describe("composer caret scroll math (#352)", () => {
  it("leaves a visible caret alone", () => {
    expect(scrollTopForCaret({ ...base, caretTop: 180, caretBottom: 200 })).toBe(50);
  });

  it("scrolls down just enough to clear the bottom edge", () => {
    // Caret bottom 320 is 20px past the window, plus the 4px pad.
    expect(scrollTopForCaret({ ...base, caretTop: 300, caretBottom: 320 })).toBe(50 + 24);
  });

  it("scrolls up just enough to clear the top edge", () => {
    expect(scrollTopForCaret({ ...base, caretTop: 90, caretBottom: 110 })).toBe(50 - 14);
  });

  it("never scrolls past the scrollable range", () => {
    expect(
      scrollTopForCaret({ ...base, scrollTop: 395, caretTop: 400, caretBottom: 420 }),
    ).toBe(400);
    expect(scrollTopForCaret({ ...base, scrollTop: 2, caretTop: -50, caretBottom: -30 })).toBe(0);
  });

  it("shows the end of a rect taller than the window", () => {
    // Both branches match. The bottom wins: an oversized rect only comes from
    // the element fallback, where the caret sits at that element's end.
    expect(scrollTopForCaret({ ...base, caretTop: 50, caretBottom: 400 })).toBe(50 + 104);
  });
});
