import { describe, expect, it, vi } from "vitest";

// terminalDrop imports @tauri-apps/api/event for the shared drag-drop
// subscription; stub it so importing the pure path-quoting helpers never
// touches the Tauri runtime (the listener only starts on registerDropTarget).
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

import { quotePaths, shellQuotePath } from "../../src/lib/terminalDrop";

describe("shellQuotePath", () => {
  it("leaves a plain path unquoted", () => {
    expect(shellQuotePath("/home/dev/pic.png")).toBe("/home/dev/pic.png");
  });

  it("single-quotes a path with spaces", () => {
    expect(shellQuotePath("/home/dev/my pic.png")).toBe("'/home/dev/my pic.png'");
  });

  it("quotes shell metacharacters so they stay inert", () => {
    expect(shellQuotePath("/tmp/$(rm -rf).png")).toBe("'/tmp/$(rm -rf).png'");
    expect(shellQuotePath("/tmp/a*b?.png")).toBe("'/tmp/a*b?.png'");
    expect(shellQuotePath("/tmp/a;b.png")).toBe("'/tmp/a;b.png'");
  });

  it("escapes an embedded single quote (close, literal, reopen)", () => {
    expect(shellQuotePath("/tmp/it's a.png")).toBe(`'/tmp/it'\\''s a.png'`);
  });
});

describe("quotePaths", () => {
  it("space-joins multiple paths, quoting only the ones that need it", () => {
    expect(quotePaths(["/a/b.png", "/c d/e.png"])).toBe("/a/b.png '/c d/e.png'");
  });

  it("handles a single path", () => {
    expect(quotePaths(["/a/b.png"])).toBe("/a/b.png");
  });
});
