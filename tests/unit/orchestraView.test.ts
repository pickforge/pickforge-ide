import { describe, expect, it } from "vitest";

import {
  DIFF_CHAR_CAP,
  buildWorkingDiff,
  fillDiffTemplate,
} from "../../src/components/orchestra/diff";

describe("buildWorkingDiff", () => {
  it("returns an empty string when there are no non-blank diffs", () => {
    expect(buildWorkingDiff([])).toBe("");
    expect(buildWorkingDiff([{ path: "a.ts", diff: "   \n\n" }])).toBe("");
  });

  it("joins per-file diffs with a blank-line separator", () => {
    const out = buildWorkingDiff([
      { path: "a.ts", diff: "diff a\n" },
      { path: "b.ts", diff: "diff b" },
    ]);
    expect(out).toBe("diff a\n\ndiff b");
  });

  it("caps the total length and appends a truncation note", () => {
    const big = "x".repeat(DIFF_CHAR_CAP + 500);
    const out = buildWorkingDiff([{ path: "big.ts", diff: big }], 100);
    expect(out.startsWith("x".repeat(100))).toBe(true);
    expect(out).toContain("diff truncated at 100 characters");
    expect(out.length).toBeLessThan(big.length);
  });

  it("stops adding blocks once the cap is exceeded", () => {
    const out = buildWorkingDiff(
      [
        { path: "a.ts", diff: "a".repeat(60) },
        { path: "b.ts", diff: "b".repeat(60) },
      ],
      100,
    );
    expect(out).toContain("a".repeat(60));
    expect(out).toContain("diff truncated at 100 characters");
  });
});

describe("fillDiffTemplate", () => {
  it("replaces every {{diff}} placeholder", () => {
    expect(fillDiffTemplate("before {{diff}} after {{diff}}", "PATCH")).toBe(
      "before PATCH after PATCH",
    );
  });

  it("returns the body unchanged when there is no placeholder", () => {
    expect(fillDiffTemplate("no slot here", "PATCH")).toBe("no slot here");
  });
});
