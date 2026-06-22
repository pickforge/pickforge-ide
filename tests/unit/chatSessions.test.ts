import { beforeEach, describe, expect, it, vi } from "vitest";

// chatSessions reads its prefs from localStorage at MODULE LOAD (top-level), so
// the global must exist before the (hoisted) import runs — set it in vi.hoisted.
// The kill-mark helpers live in lib/pty, which pulls in @tauri-apps/api/core
// (invoke); mock it so the pure logic runs under node with no runtime.
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
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), Channel: class {} }));

import {
  backendFromSessionId,
  chatBackend,
  setChatTmux,
  setRecoverChatSessions,
} from "../../src/stores/chatSessions";
import {
  clearChatKillMark,
  isChatMarkedForKill,
  markChatForKill,
} from "../../src/lib/pty";

beforeEach(() => {
  mem.clear();
  setRecoverChatSessions(true); // default ON
});

describe("backendFromSessionId — derive backend from the stored tag", () => {
  it("reads the backend tag off a stored handle", () => {
    expect(backendFromSessionId("dtach:pf-abc")).toBe("dtach");
    expect(backendFromSessionId("tmux:pf-abc")).toBe("tmux");
  });

  it("is null for no handle, a raw handle, or an unknown tag", () => {
    expect(backendFromSessionId(null)).toBeNull();
    expect(backendFromSessionId(undefined)).toBeNull();
    expect(backendFromSessionId("")).toBeNull();
    expect(backendFromSessionId("raw:whatever")).toBeNull();
    expect(backendFromSessionId("bogus:pf-abc")).toBeNull();
  });
});

describe("chatBackend — reopen honors the persisted backend tag", () => {
  it("reopens with the stored backend, ignoring the per-chat opt-in", () => {
    // A tmux-backed chat must reopen as tmux even with the (default) dtach opt-in,
    // so it never abandons its tmux session / overwrites the handle.
    expect(chatBackend("c1", "tmux:pf-c1")).toBe("tmux");
    // And a dtach-backed chat reopens as dtach even if it's in the tmux opt-in set
    // (the persisted handle wins until an explicit migration clears it).
    setChatTmux("c2", true);
    expect(chatBackend("c2", "dtach:pf-c2")).toBe("dtach");
  });

  it("falls back to the opt-in for a chat with no stored handle (new / migrated)", () => {
    expect(chatBackend("fresh", null)).toBe("dtach"); // default
    setChatTmux("fresh", true);
    expect(chatBackend("fresh", null)).toBe("tmux"); // opted in
  });

  it("is raw whenever global recovery is off, regardless of the stored tag", () => {
    setRecoverChatSessions(false);
    expect(chatBackend("c1", "tmux:pf-c1")).toBe("raw");
    expect(chatBackend("c1", null)).toBe("raw");
  });
});

describe("kill-mark registry — delete kills (not detaches) the mounted pane", () => {
  it("marks, reads, and clears a chat's kill flag", () => {
    expect(isChatMarkedForKill("c1")).toBe(false);
    markChatForKill("c1");
    expect(isChatMarkedForKill("c1")).toBe(true);
    // Other chats are unaffected.
    expect(isChatMarkedForKill("c2")).toBe(false);
    clearChatKillMark("c1");
    expect(isChatMarkedForKill("c1")).toBe(false);
  });
});
