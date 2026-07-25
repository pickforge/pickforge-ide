import { beforeEach, describe, expect, it, vi } from "vitest";

const mem = vi.hoisted(() => {
  const m = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage;
  return m;
});

import {
  editorCommand,
  setFileOpenCustom,
  setFileOpenMode,
} from "../../src/stores/fileOpenSettings";

beforeEach(() => {
  mem.clear();
  setFileOpenMode("nvim-pane");
});

describe("editorCommand: nvim-pane mode", () => {
  it("opens the bare file with no location", () => {
    expect(editorCommand("/proj/src/a.ts")).toBe("nvim '/proj/src/a.ts'");
  });

  it("positions the cursor at a line with an implicit column of 1", () => {
    expect(editorCommand("/proj/src/a.ts", { line: 12 })).toBe(
      "nvim '+call cursor(12,1)' '/proj/src/a.ts'",
    );
  });

  it("positions the cursor at a line and column", () => {
    expect(editorCommand("/proj/src/a.ts", { line: 12, column: 4 })).toBe(
      "nvim '+call cursor(12,4)' '/proj/src/a.ts'",
    );
  });

  it("ignores endLine (nvim has no range-open concept here)", () => {
    expect(editorCommand("/proj/src/a.ts", { line: 12, endLine: 18 })).toBe(
      "nvim '+call cursor(12,1)' '/proj/src/a.ts'",
    );
  });

  it("ignores an invalid line (zero, negative, non-integer)", () => {
    expect(editorCommand("/proj/src/a.ts", { line: 0 })).toBe("nvim '/proj/src/a.ts'");
    expect(editorCommand("/proj/src/a.ts", { line: -1 })).toBe("nvim '/proj/src/a.ts'");
    expect(editorCommand("/proj/src/a.ts", { line: 1.5 })).toBe("nvim '/proj/src/a.ts'");
  });
});

describe("editorCommand: custom template mode", () => {
  it("an existing {path}-only template still works unchanged and ignores location", () => {
    setFileOpenMode("custom");
    setFileOpenCustom("code -g {path}");
    expect(editorCommand("/proj/src/a.ts", { line: 12, column: 4 })).toBe(
      "code -g '/proj/src/a.ts'",
    );
  });

  it("substitutes {line}/{column}/{endLine} placeholders", () => {
    setFileOpenMode("custom");
    setFileOpenCustom("myeditor {path} --line {line} --col {column}");
    expect(editorCommand("/proj/src/a.ts", { line: 12, column: 4 })).toBe(
      "myeditor '/proj/src/a.ts' --line 12 --col 4",
    );
  });

  it("leaves an absent location placeholder as an empty string", () => {
    setFileOpenMode("custom");
    setFileOpenCustom("myeditor {path}:{line}");
    expect(editorCommand("/proj/src/a.ts")).toBe("myeditor '/proj/src/a.ts':");
  });

  it("appends the path when the template has no {path} placeholder, still substituting location", () => {
    setFileOpenMode("custom");
    setFileOpenCustom("myeditor --line {line}");
    expect(editorCommand("/proj/src/a.ts", { line: 12 })).toBe(
      "myeditor --line 12 '/proj/src/a.ts'",
    );
  });

  it("substitutes {endLine} for a range citation", () => {
    setFileOpenMode("custom");
    setFileOpenCustom("myeditor {path} {line}-{endLine}");
    expect(editorCommand("/proj/src/a.ts", { line: 12, endLine: 18 })).toBe(
      "myeditor '/proj/src/a.ts' 12-18",
    );
  });
});

describe("editorCommand: system mode always ignores location", () => {
  it("returns null regardless of location", () => {
    setFileOpenMode("system");
    expect(editorCommand("/proj/src/a.ts", { line: 12, column: 4 })).toBeNull();
  });
});
