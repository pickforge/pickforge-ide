import { describe, expect, it } from "vitest";
import { insertMarker, removeMarkerAndRenumber } from "../../src/lib/imageAnchors";

describe("insertMarker", () => {
  it("appends into empty text without a leading space", () => {
    expect(insertMarker("", 1, 0)).toEqual({ text: "[Image #1]", cursor: 10 });
  });

  it("prefixes a space when the preceding char isn't whitespace", () => {
    const out = insertMarker("look", 1, 4);
    expect(out.text).toBe("look [Image #1]");
    expect(out.cursor).toBe(15);
  });

  it("does not double a space when one already precedes the cursor", () => {
    const out = insertMarker("look ", 2, 5);
    expect(out.text).toBe("look [Image #2]");
    expect(out.cursor).toBe(15);
  });

  it("inserts mid-string at the cursor", () => {
    const out = insertMarker("ab", 1, 1);
    expect(out.text).toBe("a [Image #1]b");
    expect(out.cursor).toBe(12);
  });

  it("clamps out-of-range cursors to the text length", () => {
    expect(insertMarker("hi", 1, 99).text).toBe("hi [Image #1]");
  });
});

describe("removeMarkerAndRenumber", () => {
  it("drops the removed marker and renumbers higher ones down", () => {
    expect(removeMarkerAndRenumber("a [Image #2] b [Image #3]", 2, 3)).toBe(
      "a  b [Image #2]",
    );
  });

  it("removes every duplicate of the removed marker", () => {
    expect(removeMarkerAndRenumber("[Image #1] x [Image #1] y", 1, 1)).toBe(" x  y");
  });

  it("leaves markers below the removed one untouched", () => {
    expect(removeMarkerAndRenumber("[Image #1] [Image #2] [Image #3]", 2, 3)).toBe(
      "[Image #1]  [Image #2]",
    );
  });

  it("leaves out-of-range markers untouched", () => {
    expect(removeMarkerAndRenumber("[Image #5]", 9, 9)).toBe("[Image #5]");
  });

  it("does not renumber literal markers beyond the attachment count", () => {
    expect(removeMarkerAndRenumber("[Image #1] keep [Image #99]", 1, 2)).toBe(
      " keep [Image #99]",
    );
  });
});
