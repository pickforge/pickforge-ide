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
  armChatAutoName,
  cleanOscTitle,
  forgetChatAutoName,
  handleOscTitle,
  hasAgentPane,
  isAgentPane,
  markChatTitleManual,
  maybeAutoNameChat,
  revokeAgentPane,
  transferAgentPaneOwnership,
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
  // Seed a chat AND mark pane-0 as its agent-owned pane (an OSC title is only
  // adopted from the agent pane now), so the title pipeline is exercised. Pass
  // `agentPane: null` to seed a chat with NO agent pane (for the gating test).
  const seed = (title = DEFAULT_CHAT_TITLE, agentPane: string | null = "pane-0"): string => {
    const id = `chat-${++counter}`;
    store.chats.set(id, { chatId: id, title });
    if (agentPane) armChatAutoName(id, agentPane);
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

  it("ignores OSC titles from a chat with NO agent pane", () => {
    const id = seed(DEFAULT_CHAT_TITLE, null); // no agent ever launched
    handleOscTitle(id, "pane-0", "A build script set this title");
    vi.advanceTimersByTime(2000);
    expect(store.setChatTitle).not.toHaveBeenCalled();
  });

  it("only adopts OSC titles from the agent-owned pane, not other split panes", () => {
    const id = seed(DEFAULT_CHAT_TITLE, "pane-1"); // agent runs in pane-1
    // A non-agent split pane (pane-0) sets a window title — must be ignored.
    handleOscTitle(id, "pane-0", "Editor opened a file");
    vi.advanceTimersByTime(2000);
    expect(store.setChatTitle).not.toHaveBeenCalled();
    // The agent's own pane names the chat.
    handleOscTitle(id, "pane-1", "Wiring up the agent task");
    vi.advanceTimersByTime(1200);
    expect(store.setChatTitle).toHaveBeenCalledWith(id, "Wiring up the agent task");
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

// isAgentPane is the gate the rail's "live session" ember glow now relies on:
// only a pane KNOWN to run an agent drives the running/working cue, so a plain
// interactive shell (a prompt, `ls`, a build) never glows. These cover the ways
// a pane becomes agent-owned (chip/hotkey arm, hand-typed launch) and confirm a
// bare shell pane is not.
describe("isAgentPane — agent ownership for the live-session glow", () => {
  let counter = 1000;
  const mkChat = (title = DEFAULT_CHAT_TITLE): string => {
    const id = `agent-chat-${++counter}`;
    store.chats.set(id, { chatId: id, title });
    return id;
  };

  it("is false for a chat with no launched/typed agent (plain shell pane)", () => {
    const id = mkChat();
    expect(isAgentPane(id, "pane-0")).toBe(false);
  });

  it("is true for every pane a chip/hotkey armed", () => {
    const id = mkChat();
    armChatAutoName(id, "pane-0");
    armChatAutoName(id, "pane-1");
    expect(isAgentPane(id, "pane-0")).toBe(true);
    expect(isAgentPane(id, "pane-1")).toBe(true);
    expect(isAgentPane(id, "pane-2")).toBe(false);
  });

  it("marks the pane when a recognised agent command is hand-typed", () => {
    const id = mkChat();
    // A plain shell command does NOT mark the pane as an agent.
    maybeAutoNameChat(id, "ls -la", "pane-0");
    expect(isAgentPane(id, "pane-0")).toBe(false);
    // Typing `claude …` does.
    maybeAutoNameChat(id, "claude fix the bug", "pane-0");
    expect(isAgentPane(id, "pane-0")).toBe(true);
  });

  it("marks hand-typed agent commands in non-default titled chats", () => {
    const id = mkChat("Existing title");
    maybeAutoNameChat(id, "codex --model gpt-5.5 fix the bug", "pane-0");
    expect(isAgentPane(id, "pane-0")).toBe(true);
    expect(store.setChatTitle).not.toHaveBeenCalled();
  });

  it("transfers agent activity ownership to a remounted pane id", () => {
    const id = mkChat();
    armChatAutoName(id, "pane-0");
    transferAgentPaneOwnership(id, "pane-0", "pane-remount");
    expect(isAgentPane(id, "pane-0")).toBe(false);
    expect(isAgentPane(id, "pane-remount")).toBe(true);
  });

  it("keeps agent activity ownership after a manual rename", () => {
    const id = mkChat();
    armChatAutoName(id, "pane-0");
    expect(isAgentPane(id, "pane-0")).toBe(true);
    markChatTitleManual(id);
    expect(isAgentPane(id, "pane-0")).toBe(true);
  });

  it("marks a hand-typed launch in another pane of a chip-armed default chat", () => {
    const id = mkChat();
    armChatAutoName(id, "pane-0"); // chip launch — pane-0 armed for the title
    maybeAutoNameChat(id, "codex fix the tests", "pane-1");
    expect(isAgentPane(id, "pane-1")).toBe(true);
    // The arming stands: the first real prompt in pane-0 still names the chat.
    maybeAutoNameChat(id, "refactor the auth flow", "pane-0");
    expect(store.chats.get(id)!.title).toBe("Refactor the auth flow");
  });

  it("revoking a closed pane removes its activity and title claims", () => {
    const id = mkChat();
    armChatAutoName(id, "pane-0");
    expect(hasAgentPane(id)).toBe(true);
    revokeAgentPane(id, "pane-0");
    expect(isAgentPane(id, "pane-0")).toBe(false);
    expect(hasAgentPane(id)).toBe(false);
    handleOscTitle(id, "pane-0", "Ghost pane summary");
    vi.advanceTimersByTime(2000);
    expect(store.setChatTitle).not.toHaveBeenCalled();
  });

  it("forgetChatAutoName drops all state and cancels a pending OSC commit", () => {
    const id = mkChat();
    armChatAutoName(id, "pane-0");
    handleOscTitle(id, "pane-0", "About to be deleted");
    forgetChatAutoName(id);
    vi.advanceTimersByTime(2000);
    expect(store.setChatTitle).not.toHaveBeenCalled();
    expect(isAgentPane(id, "pane-0")).toBe(false);
  });
});

describe("title authority — the newest agent launch names the chat", () => {
  let counter = 3000;
  const mkChat = (title = DEFAULT_CHAT_TITLE): string => {
    const id = `authority-chat-${++counter}`;
    store.chats.set(id, { chatId: id, title });
    return id;
  };

  it("a newer launch takes naming over; the stale agent pane is ignored", () => {
    const id = mkChat();
    // Hand-typed claude in a split names the chat and holds title authority.
    maybeAutoNameChat(id, "claude fix the login bug", "pane-1");
    expect(store.chats.get(id)!.title).toBe("Fix the login bug");

    // A chip-launched codex in the primary takes the authority with it.
    armChatAutoName(id, "pane-0");
    handleOscTitle(id, "pane-1", "Stale claude summary");
    vi.advanceTimersByTime(1200);
    expect(store.chats.get(id)!.title).toBe("Fix the login bug");

    handleOscTitle(id, "pane-0", "Codex task summary");
    vi.advanceTimersByTime(1200);
    expect(store.chats.get(id)!.title).toBe("Codex task summary");
  });
});
