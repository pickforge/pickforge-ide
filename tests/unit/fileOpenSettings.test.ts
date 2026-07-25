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
  shellQuote,
} from "../../src/stores/fileOpenSettings";

beforeEach(() => {
  mem.clear();
  setFileOpenMode("nvim-pane");
});

// The composed command string is typed straight into a live shell pane —
// this is the highest-risk quoting surface in the file-open path. A path
// segment is untrusted here: it can come from a chat citation the assistant
// wrote (#234). Every case below must single-quote the adversarial content
// into ONE inert shell word; none of it may ever execute.
describe("shellQuote: adversarial path content stays a single inert shell word", () => {
  it("quotes a command substitution so it never executes", () => {
    expect(shellQuote("/tmp/$(id).png")).toBe("'/tmp/$(id).png'");
  });

  it("quotes backtick command substitution", () => {
    expect(shellQuote("/tmp/`id`.png")).toBe("'/tmp/`id`.png'");
  });

  it("quotes shell control operators (; | &) so they stay literal text", () => {
    expect(shellQuote("/tmp/a;rm -rf ~.png")).toBe("'/tmp/a;rm -rf ~.png'");
    expect(shellQuote("/tmp/a|cat /etc/passwd.png")).toBe("'/tmp/a|cat /etc/passwd.png'");
    expect(shellQuote("/tmp/a&&curl evil.sh.png")).toBe("'/tmp/a&&curl evil.sh.png'");
    expect(shellQuote("/tmp/a & background.png")).toBe("'/tmp/a & background.png'");
  });

  it("quotes a path containing spaces", () => {
    expect(shellQuote("/tmp/my file.png")).toBe("'/tmp/my file.png'");
  });

  it("escapes an embedded single quote (close, literal, reopen) rather than breaking out of quoting", () => {
    expect(shellQuote("/tmp/it's a.png")).toBe(`'/tmp/it'\\''s a.png'`);
  });

  it("composes into editorCommand as one inert argument, end to end", () => {
    const path = "/tmp/$(id); rm -rf ~ #it's.png";
    const cmd = editorCommand(path);
    expect(cmd).toBe(`nvim ${shellQuote(path)}`);
    // The dangerous substring is present only INSIDE the single-quoted word,
    // never as an unquoted, shell-interpretable prefix/suffix.
    expect(cmd).toBe("nvim '/tmp/$(id); rm -rf ~ #it'\\''s.png'");
  });
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

  it("falls back to an implicit column of 1 for an invalid column (zero, negative, non-integer), never embedding it raw", () => {
    expect(editorCommand("/proj/src/a.ts", { line: 12, column: 0 })).toBe(
      "nvim '+call cursor(12,1)' '/proj/src/a.ts'",
    );
    expect(editorCommand("/proj/src/a.ts", { line: 12, column: -4 })).toBe(
      "nvim '+call cursor(12,1)' '/proj/src/a.ts'",
    );
    expect(editorCommand("/proj/src/a.ts", { line: 12, column: 2.5 })).toBe(
      "nvim '+call cursor(12,1)' '/proj/src/a.ts'",
    );
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

  it("substitutes an invalid line/column/endLine (zero, negative, non-integer) as empty, never raw", () => {
    setFileOpenMode("custom");
    setFileOpenCustom("myeditor {path} L{line}C{column}-{endLine}");
    expect(editorCommand("/proj/src/a.ts", { line: 0, column: -1, endLine: 1.5 })).toBe(
      "myeditor '/proj/src/a.ts' LC-",
    );
  });
});

describe("editorCommand: system mode always ignores location", () => {
  it("returns null regardless of location", () => {
    setFileOpenMode("system");
    expect(editorCommand("/proj/src/a.ts", { line: 12, column: 4 })).toBeNull();
  });
});
