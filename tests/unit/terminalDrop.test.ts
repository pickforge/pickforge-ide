import { describe, expect, it, vi } from "vitest";

// terminalDrop imports @tauri-apps/api/event for the shared drag-drop
// subscription. Capture the registered handlers so a test can fire a synthetic
// drop and assert dispatch, while pure helper tests stay runtime-free (the
// listener only starts on registerDropTarget).
const handlers = vi.hoisted(() => new Map<string, (e: { payload: unknown }) => void>());
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((name: string, cb: (e: { payload: unknown }) => void) => {
    handlers.set(name, cb);
    return Promise.resolve(() => handlers.delete(name));
  }),
}));

import { quotePaths, registerDropTarget, shellQuotePath } from "../../src/lib/terminalDrop";

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

describe("registerDropTarget — drop dispatch", () => {
  // A fake pane element at a fixed box; the dispatch hit-tests via
  // getBoundingClientRect and converts the physical drop point by devicePixelRatio.
  const fakeEl = (box: { left: number; top: number; right: number; bottom: number }) =>
    ({
      getBoundingClientRect: () => ({
        left: box.left,
        top: box.top,
        right: box.right,
        bottom: box.bottom,
        width: box.right - box.left,
        height: box.bottom - box.top,
      }),
    }) as unknown as HTMLElement;

  const fireDrop = (paths: string[], position: { x: number; y: number }) => {
    (globalThis as { window?: { devicePixelRatio: number } }).window = { devicePixelRatio: 1 };
    handlers.get("tauri://drag-drop")?.({ payload: { paths, position } });
  };

  it("delivers the dropped paths to the pane under the cursor", () => {
    const writes: string[] = [];
    const stop = registerDropTarget({
      el: fakeEl({ left: 0, top: 0, right: 100, bottom: 100 }),
      write: (t) => (writes.push(t), true),
      setHover: () => {},
    });
    fireDrop(["/a/b.png"], { x: 50, y: 50 });
    expect(writes).toEqual(["/a/b.png"]);
    stop();
  });

  it("still delivers when the pane buffers an early drop (write returns true)", () => {
    // A pane whose pty hasn't spawned buffers internally and returns true; the
    // drop must reach it rather than being discarded.
    const writes: string[] = [];
    const stop = registerDropTarget({
      el: fakeEl({ left: 0, top: 0, right: 100, bottom: 100 }),
      write: (t) => (writes.push(t), true),
      setHover: () => {},
    });
    fireDrop(["/early.png"], { x: 10, y: 10 });
    expect(writes).toEqual(["/early.png"]);
    stop();
  });

  it("ignores a drop outside every pane", () => {
    const writes: string[] = [];
    const stop = registerDropTarget({
      el: fakeEl({ left: 0, top: 0, right: 100, bottom: 100 }),
      write: (t) => (writes.push(t), true),
      setHover: () => {},
    });
    fireDrop(["/a/b.png"], { x: 500, y: 500 });
    expect(writes).toEqual([]);
    stop();
  });
});
