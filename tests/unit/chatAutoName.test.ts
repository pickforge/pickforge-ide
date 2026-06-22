import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// chatAutoName imports findChat/setChatTitle from the workspace store (which
// pulls in the Tauri db + a SolidJS store). Stub the store with an in-memory
// chat map so the title logic can be exercised with no runtime. solid-js's
// createSignal is used for the typing-animation overrides; it works under node.
const store = vi.hoisted(() => {
  const chats = new Map<string, { chatId: string; title: string }>();
  return {
    chats,
    findChat: vi.fn((id: string) => chats.get(id)),
    setChatTitle: vi.fn(async (id: string, title: string) => {
      const c = chats.get(id);
      if (c) c.title = title;
    }),
  };
});
vi.mock("../../src/stores/workspace", () => ({
  findChat: store.findChat,
  setChatTitle: store.setChatTitle,
}));

import {
  cleanOscTitle,
  handleOscTitle,
  markChatTitleManual,
  DEFAULT_CHAT_TITLE,
} from "../../src/lib/chatAutoName";

beforeEach(() => {
  vi.useFakeTimers();
  store.chats.clear();
  store.setChatTitle.mockClear();
  // Force the non-animated path (commit persists synchronously, no timers).
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("cleanOscTitle — noise filter", () => {
  it("drops empty / whitespace / control-only", () => {
    expect(cleanOscTitle("")).toBe("");
    expect(cleanOscTitle("   ")).toBe("");
    expect(cleanOscTitle("\u0001\u0007\u001b")).toBe("");
    // @ts-expect-error — defends the non-string guard.
    expect(cleanOscTitle(undefined)).toBe("");
  });

  it("drops user@host and bare hostnames / FQDNs", () => {
    expect(cleanOscTitle("dev@devbox")).toBe("");
    expect(cleanOscTitle("dev@devbox:~/code/app")).toBe("");
    expect(cleanOscTitle("devbox.local")).toBe("");
    expect(cleanOscTitle("host.example.com")).toBe("");
  });

  it("drops paths and cwds", () => {
    expect(cleanOscTitle("/home/dev/code/app")).toBe("");
    expect(cleanOscTitle("~/code/app")).toBe("");
    expect(cleanOscTitle("~")).toBe("");
    expect(cleanOscTitle("C:\\Users\\dev\\app")).toBe("");
    expect(cleanOscTitle("./scripts")).toBe("");
  });

  it("drops prompt-ending lines", () => {
    expect(cleanOscTitle("dev@box:~/app $")).toBe("");
    expect(cleanOscTitle("zsh %")).toBe("");
    expect(cleanOscTitle("root@box #")).toBe("");
    expect(cleanOscTitle("PS C:\\app>")).toBe("");
  });

  it("drops the bare shell / agent binary name", () => {
    expect(cleanOscTitle("zsh")).toBe("");
    expect(cleanOscTitle("bash")).toBe("");
    expect(cleanOscTitle("claude")).toBe("");
    expect(cleanOscTitle("codex")).toBe("");
  });

  it("keeps a real agent summary, tidied", () => {
    expect(cleanOscTitle("Fixing the login redirect bug")).toBe(
      "Fixing the login redirect bug",
    );
    // Leading lowercase is capitalised; surrounding quotes stripped.
    expect(cleanOscTitle('"add a dark mode toggle"')).toBe("Add a dark mode toggle");
    // A summary that merely contains a slash but has spaces is kept.
    expect(cleanOscTitle("Refactor src/auth flow")).toBe("Refactor src/auth flow");
  });
});

describe("handleOscTitle — debounce + ownership", () => {
  // The module keeps per-chat ownership state for the session that never clears
  // between tests; give each test a FRESH chat id so its state can't leak.
  let counter = 0;
  const seed = (title = DEFAULT_CHAT_TITLE): string => {
    const id = `chat-${++counter}`;
    store.chats.set(id, { chatId: id, title });
    return id;
  };

  it("commits the title only after the debounce quiet window", () => {
    const id = seed();
    handleOscTitle(id, "pane-0", "Working on auth");
    expect(store.setChatTitle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1199);
    expect(store.setChatTitle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(store.setChatTitle).toHaveBeenCalledWith(id, "Working on auth");
  });

  it("debounces rapid rewrites, committing only the last", () => {
    const id = seed();
    handleOscTitle(id, "pane-0", "Reading files");
    vi.advanceTimersByTime(800);
    handleOscTitle(id, "pane-0", "Editing the router");
    vi.advanceTimersByTime(800); // 1600 since first, 800 since second
    expect(store.setChatTitle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(400); // 1200 since the last update
    expect(store.setChatTitle).toHaveBeenCalledTimes(1);
    expect(store.setChatTitle).toHaveBeenCalledWith(id, "Editing the router");
  });

  it("ignores noise titles without arming a commit", () => {
    const id = seed();
    handleOscTitle(id, "pane-0", "dev@box:~/app $");
    vi.advanceTimersByTime(2000);
    expect(store.setChatTitle).not.toHaveBeenCalled();
  });

  it("lets the FIRST pane own the title; a second split can't steal it", () => {
    const id = seed();
    handleOscTitle(id, "pane-0", "Pane zero summary");
    handleOscTitle(id, "pane-1", "Pane one summary"); // ignored — not the owner
    vi.advanceTimersByTime(1200);
    expect(store.setChatTitle).toHaveBeenCalledTimes(1);
    expect(store.setChatTitle).toHaveBeenCalledWith(id, "Pane zero summary");
  });

  it("never overwrites a manually renamed chat", () => {
    const id = seed();
    markChatTitleManual(id);
    store.chats.get(id)!.title = "My deliberate name";
    handleOscTitle(id, "pane-0", "Some agent summary");
    vi.advanceTimersByTime(2000);
    expect(store.setChatTitle).not.toHaveBeenCalled();
  });

  it("a manual rename mid-debounce cancels the pending commit", () => {
    const id = seed();
    handleOscTitle(id, "pane-0", "About to be cancelled");
    vi.advanceTimersByTime(600);
    markChatTitleManual(id);
    store.chats.get(id)!.title = "User typed this";
    vi.advanceTimersByTime(1200);
    expect(store.setChatTitle).not.toHaveBeenCalled();
  });

  it("refines an OSC name from the SAME owning pane after first commit", () => {
    const id = seed();
    handleOscTitle(id, "pane-0", "First summary");
    vi.advanceTimersByTime(1200);
    expect(store.setChatTitle).toHaveBeenLastCalledWith(id, "First summary");
    expect(store.chats.get(id)!.title).toBe("First summary");
    // Title is no longer the default, but the same pane still owns it.
    handleOscTitle(id, "pane-0", "Refined summary");
    vi.advanceTimersByTime(1200);
    expect(store.setChatTitle).toHaveBeenLastCalledWith(id, "Refined summary");
  });
});
