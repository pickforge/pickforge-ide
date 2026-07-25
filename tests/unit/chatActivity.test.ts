import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
const sound = vi.hoisted(() => ({
  playAttentionSound: vi.fn(),
}));

vi.mock("../../src/stores/workspace", () => ({
  findChat: store.findChat,
  setChatTitle: store.setChatTitle,
}));
vi.mock("../../src/lib/attentionSound", () => ({
  playAttentionSound: sound.playAttentionSound,
}));

import {
  armChatAutoName,
  DEFAULT_CHAT_TITLE,
  markChatTitleManual,
  maybeAutoNameChat,
  revokeAgentPane,
  transferAgentPaneOwnership,
} from "../../src/lib/chatAutoName";
import {
  agentTurnCleared,
  agentTurnDone,
  agentTurnStarted,
  CARD_LINGER_MS,
  CHAT_BUSY_QUIET_MS,
  chatAttention,
  chatBusy,
  chatJustFinished,
  clearChatActivity,
  graceChatUnseen,
  handlePaneClosed,
  REATTACH_REPLAY_GRACE_MS,
  recordChatAttention,
  recordChatOutput,
  setActiveChatForActivity,
  setStagedChatsForActivity,
  setWindowFocusForActivity,
} from "../../src/stores/chatActivity";

let counter = 0;
const ids: string[] = [];

function seed(agentPane: string | null = "pane-0") {
  const id = `activity-chat-${++counter}`;
  ids.push(id);
  store.chats.set(id, { chatId: id, title: DEFAULT_CHAT_TITLE });
  if (agentPane) armChatAutoName(id, agentPane);
  return id;
}

beforeEach(() => {
  vi.useFakeTimers();
  sound.playAttentionSound.mockClear();
  store.chats.clear();
  store.findChat.mockClear();
  store.setChatTitle.mockClear();
  setActiveChatForActivity(null);
  setStagedChatsForActivity([]);
  setWindowFocusForActivity(true);
});

afterEach(() => {
  ids.splice(0).forEach(clearChatActivity);
  setActiveChatForActivity(null);
  setStagedChatsForActivity([]);
  setWindowFocusForActivity(true);
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("chatActivity — busy tracking", () => {
  it("only marks output from an agent-owned pane as busy", () => {
    const id = seed(null);
    recordChatOutput(id, "pane-0", "plain shell output");
    expect(chatBusy(id)).toBe(false);

    armChatAutoName(id, "pane-0");
    recordChatOutput(id, "pane-1", "split pane output");
    expect(chatBusy(id)).toBe(false);

    recordChatOutput(id, "pane-0", "agent is working now");
    expect(chatBusy(id)).toBe(true);
  });

  it("keeps activity ownership after a manual rename", () => {
    const id = seed();
    markChatTitleManual(id);
    store.chats.get(id)!.title = "Manual title";

    recordChatOutput(id, "pane-0", "agent is still working");

    expect(chatBusy(id)).toBe(true);
  });

  it("marks hand-typed agent launches in already named chats", () => {
    const id = seed(null);
    store.chats.get(id)!.title = "Existing title";

    recordChatOutput(id, "pane-2", "ignored before launch");
    expect(chatBusy(id)).toBe(false);

    maybeAutoNameChat(id, "claude fix the flaky unit test", "pane-2");
    recordChatOutput(id, "pane-2", "agent is now producing output");

    expect(chatBusy(id)).toBe(true);
    expect(store.setChatTitle).not.toHaveBeenCalled();
  });

  it("supports multiple agent-owned panes in one chat", () => {
    const id = seed(null);
    armChatAutoName(id, "pane-0");
    armChatAutoName(id, "pane-1");

    recordChatOutput(id, "pane-0", "first agent is working");
    expect(chatBusy(id)).toBe(true);

    clearChatActivity(id);
    recordChatOutput(id, "pane-1", "second agent is working");
    expect(chatBusy(id)).toBe(true);

    clearChatActivity(id);
    recordChatOutput(id, "pane-2", "plain shell output");
    expect(chatBusy(id)).toBe(false);
  });

  it("transfers activity ownership when a primary pane remounts", () => {
    const id = seed();
    transferAgentPaneOwnership(id, "pane-0", "pane-remount");

    recordChatOutput(id, "pane-0", "old pane id should be ignored");
    expect(chatBusy(id)).toBe(false);

    recordChatOutput(id, "pane-remount", "remounted agent is working");
    expect(chatBusy(id)).toBe(true);
  });
});

describe("chatActivity — attention only for unseen output", () => {
  it("raises attention with one chime after an unseen busy cycle goes quiet", () => {
    const id = seed();
    setActiveChatForActivity("other-chat");

    recordChatOutput(id, "pane-0", "agent produced a useful answer");
    expect(chatBusy(id)).toBe(true);
    expect(chatAttention(id)).toBe(false);
    expect(sound.playAttentionSound).not.toHaveBeenCalled();

    vi.advanceTimersByTime(CHAT_BUSY_QUIET_MS);

    expect(chatBusy(id)).toBe(false);
    expect(chatAttention(id)).toBe(true);
    expect(sound.playAttentionSound).toHaveBeenCalledTimes(1);
  });

  it("never alerts for output the user watched, even after switching away", () => {
    const id = seed();
    setActiveChatForActivity(id);

    recordChatOutput(id, "pane-0", "the user is reading this answer right now");
    setActiveChatForActivity("other-chat"); // switch away inside the quiet window
    vi.advanceTimersByTime(CHAT_BUSY_QUIET_MS);

    expect(chatBusy(id)).toBe(false);
    expect(chatAttention(id)).toBe(false);
    expect(sound.playAttentionSound).not.toHaveBeenCalled();
  });

  it("alerts for fresh output that streams after the user switched away", () => {
    const id = seed();
    setActiveChatForActivity(id);
    recordChatOutput(id, "pane-0", "watched output does not count");

    setActiveChatForActivity("other-chat");
    recordChatOutput(id, "pane-0", "but this streamed while away");
    vi.advanceTimersByTime(CHAT_BUSY_QUIET_MS);

    expect(chatAttention(id)).toBe(true);
    expect(sound.playAttentionSound).toHaveBeenCalledTimes(1);
  });

  it("ignores a tiny unseen redraw below the attention threshold", () => {
    const id = seed();
    setActiveChatForActivity("other-chat");

    recordChatOutput(id, "pane-0", "ok"); // 2 visible chars — a prompt tick
    vi.advanceTimersByTime(CHAT_BUSY_QUIET_MS);

    expect(chatBusy(id)).toBe(false);
    expect(chatAttention(id)).toBe(false);
    expect(sound.playAttentionSound).not.toHaveBeenCalled();
  });

  it("does not alert when the busy chat stays active and focused", () => {
    const id = seed();
    setActiveChatForActivity(id);

    recordChatOutput(id, "pane-0", "agent produced a useful answer");
    vi.advanceTimersByTime(CHAT_BUSY_QUIET_MS);

    expect(chatBusy(id)).toBe(false);
    expect(chatAttention(id)).toBe(false);
    expect(sound.playAttentionSound).not.toHaveBeenCalled();
  });

  it("does NOT clear attention just from opening the chat (#331)", () => {
    const id = seed();
    setActiveChatForActivity("other-chat");

    recordChatAttention(id, "pane-0");
    expect(chatAttention(id)).toBe(true);
    expect(sound.playAttentionSound).toHaveBeenCalledTimes(1);

    // Merely opening/viewing a needs-you chat must never silently demote it
    // back to quiet mid-glance — it stays needs-you until the user actually
    // acts (see the "structured agent chat turns" describe block below) or
    // an explicit dismissal, neither of which happened here.
    setActiveChatForActivity(id);

    expect(chatAttention(id)).toBe(true);
  });

  it("gates bell and notification attention to the agent-owned pane", () => {
    const id = seed();
    setActiveChatForActivity("other-chat");

    recordChatAttention(id, "pane-1");
    expect(chatAttention(id)).toBe(false);
    expect(sound.playAttentionSound).not.toHaveBeenCalled();

    recordChatAttention(id, "pane-0");
    expect(chatAttention(id)).toBe(true);
    expect(sound.playAttentionSound).toHaveBeenCalledTimes(1);
  });
});

describe("chatActivity — attention survives output; window focus", () => {
  it("keeps a bell-raised attention through later output, without re-chiming", () => {
    const id = seed();
    setActiveChatForActivity("other-chat");

    recordChatAttention(id, "pane-0");
    expect(chatAttention(id)).toBe(true);
    expect(sound.playAttentionSound).toHaveBeenCalledTimes(1);

    recordChatOutput(id, "pane-0", "> "); // the agent repaints its prompt line
    expect(chatAttention(id)).toBe(true);

    recordChatOutput(id, "pane-0", "a larger repaint of the whole dialog box");
    vi.advanceTimersByTime(CHAT_BUSY_QUIET_MS);

    expect(chatAttention(id)).toBe(true);
    expect(sound.playAttentionSound).toHaveBeenCalledTimes(1);
  });

  it("alerts for the ACTIVE chat while the window is unfocused, and refocusing does not clear it (#331)", () => {
    const id = seed();
    setActiveChatForActivity(id);
    setWindowFocusForActivity(false);

    recordChatAttention(id, "pane-0");

    expect(chatAttention(id)).toBe(true);
    expect(sound.playAttentionSound).toHaveBeenCalledTimes(1);

    // Coming back to the window is just looking, not acting — a needs-you
    // chat must stay needs-you through a refocus, the same as through the
    // user opening it (see the "does NOT clear attention" test above).
    setWindowFocusForActivity(true);

    expect(chatAttention(id)).toBe(true);
  });

  it("treats output streamed into the active chat of a blurred window as unseen", () => {
    const id = seed();
    setActiveChatForActivity(id);
    setWindowFocusForActivity(false);

    recordChatOutput(id, "pane-0", "finished while the user was in the browser");
    vi.advanceTimersByTime(CHAT_BUSY_QUIET_MS);

    expect(chatAttention(id)).toBe(true);
    expect(sound.playAttentionSound).toHaveBeenCalledTimes(1);
  });

  it("ignores the re-attach replay (output and bells) during the grace window", () => {
    const id = seed();
    setActiveChatForActivity("other-chat");
    graceChatUnseen(id, REATTACH_REPLAY_GRACE_MS);

    recordChatOutput(id, "pane-0", "replayed screen from the previous session");
    recordChatAttention(id, "pane-0"); // a replayed BEL
    expect(chatAttention(id)).toBe(false);

    vi.advanceTimersByTime(CHAT_BUSY_QUIET_MS);
    expect(chatAttention(id)).toBe(false);
    expect(sound.playAttentionSound).not.toHaveBeenCalled();

    recordChatOutput(id, "pane-0", "fresh output after the grace expired");
    vi.advanceTimersByTime(CHAT_BUSY_QUIET_MS);
    expect(chatAttention(id)).toBe(true);
    expect(sound.playAttentionSound).toHaveBeenCalledTimes(1);
  });
});

describe("chatActivity — escape-sequence scanning across chunks", () => {
  it("skips escape sequences split across pty chunk boundaries", () => {
    const id = seed();
    setActiveChatForActivity("other-chat");

    recordChatOutput(id, "pane-0", "\x1b]2;Building the parser stage now");
    recordChatOutput(id, "pane-0", " and more title\x07");
    recordChatOutput(id, "pane-0", "\x1b[38;5");
    recordChatOutput(id, "pane-0", ";214m");

    expect(chatBusy(id)).toBe(false);
    vi.advanceTimersByTime(CHAT_BUSY_QUIET_MS);
    expect(chatAttention(id)).toBe(false);
  });

  it("skips DCS payloads (sixel etc.) entirely, including a BEL inside", () => {
    const id = seed();
    setActiveChatForActivity("other-chat");

    recordChatOutput(id, "pane-0", "\x1bPq#0;2;0;0;0 sixel-ish payload \x07 with a bell");
    recordChatOutput(id, "pane-0", "more payload without any escapes\x1b\\");

    expect(chatBusy(id)).toBe(false);
  });

  it("recovers from an unterminated string when a new escape sequence arrives", () => {
    const id = seed();
    setActiveChatForActivity("other-chat");

    recordChatOutput(id, "pane-0", "\x1bPan unterminated dcs from binary spew");
    expect(chatBusy(id)).toBe(false);

    recordChatOutput(id, "pane-0", "\x1b[32mreal output is visible again after it");
    expect(chatBusy(id)).toBe(true);
  });

  it("does not count charset designations (ESC ( B) as visible output", () => {
    const id = seed();
    setActiveChatForActivity("other-chat");

    recordChatOutput(id, "pane-0", "\x1b(B\x1b[m\x1b(B\x1b[m\x1b(B\x1b[m\x1b(B\x1b[m\x1b(B\x1b[m");

    expect(chatBusy(id)).toBe(false);
  });

  it("still counts real text following a completed escape sequence", () => {
    const id = seed();
    setActiveChatForActivity("other-chat");

    recordChatOutput(id, "pane-0", "\x1b[1;32mDone:\x1b[0m all twelve tests passed");
    expect(chatBusy(id)).toBe(true);

    vi.advanceTimersByTime(CHAT_BUSY_QUIET_MS);
    expect(chatAttention(id)).toBe(true);
  });
});

describe("chatActivity — structured agent chat turns", () => {
  it("sets busy on turn start and clears it on turn done", () => {
    const id = seed(null);
    expect(chatBusy(id)).toBe(false);

    agentTurnStarted(id);
    expect(chatBusy(id)).toBe(true);

    setActiveChatForActivity(id); // the user is watching this chat
    agentTurnDone(id);
    expect(chatBusy(id)).toBe(false);
    expect(chatAttention(id)).toBe(false);
    expect(sound.playAttentionSound).not.toHaveBeenCalled();
  });

  it("raises attention with one chime when a turn finishes unseen", () => {
    const id = seed(null);
    setActiveChatForActivity("other-chat");

    agentTurnStarted(id);
    expect(chatBusy(id)).toBe(true);
    expect(chatAttention(id)).toBe(false);

    agentTurnDone(id);
    expect(chatBusy(id)).toBe(false);
    expect(chatAttention(id)).toBe(true);
    expect(sound.playAttentionSound).toHaveBeenCalledTimes(1);
  });

  it("does not alert when a turn finishes on the active, focused chat", () => {
    const id = seed(null);
    setActiveChatForActivity(id);

    agentTurnStarted(id);
    agentTurnDone(id);

    expect(chatAttention(id)).toBe(false);
    expect(sound.playAttentionSound).not.toHaveBeenCalled();
  });

  it("does NOT clear attention just from the agent chat becoming active (#331)", () => {
    const id = seed(null);
    setActiveChatForActivity("other-chat");

    agentTurnStarted(id);
    agentTurnDone(id);
    expect(chatAttention(id)).toBe(true);

    setActiveChatForActivity(id); // opening it is just looking
    expect(chatAttention(id)).toBe(true);

    // Sending another message — a fresh turn — is the user actually acting,
    // and that's what resolves the standing needs-you.
    agentTurnStarted(id);
    expect(chatAttention(id)).toBe(false);
  });

  it("clears busy without alerting when a turn is interrupted", () => {
    const id = seed(null);
    setActiveChatForActivity("other-chat");

    agentTurnStarted(id);
    expect(chatBusy(id)).toBe(true);

    agentTurnCleared(id);
    expect(chatBusy(id)).toBe(false);
    expect(chatAttention(id)).toBe(false);
    expect(sound.playAttentionSound).not.toHaveBeenCalled();
  });
});

describe("chatActivity — staged orchestra chats", () => {
  it("does not alert when a staged chat finishes while the window is focused", () => {
    const id = seed(null);
    setActiveChatForActivity("other-chat");
    setStagedChatsForActivity([id]);

    agentTurnStarted(id);
    agentTurnDone(id);

    expect(chatBusy(id)).toBe(false);
    expect(chatAttention(id)).toBe(false);
    expect(sound.playAttentionSound).not.toHaveBeenCalled();
  });

  it("alerts exactly once when a staged chat finishes while the window is blurred", () => {
    const id = seed(null);
    setActiveChatForActivity("other-chat");
    setStagedChatsForActivity([id]);
    setWindowFocusForActivity(false);

    agentTurnStarted(id);
    agentTurnDone(id);

    expect(chatAttention(id)).toBe(true);
    expect(sound.playAttentionSound).toHaveBeenCalledTimes(1);
  });

  it("restores non-active focused attention after a chat is unstaged", () => {
    const id = seed(null);
    setActiveChatForActivity("other-chat");
    setStagedChatsForActivity([id]);
    setStagedChatsForActivity([]);

    agentTurnStarted(id);
    agentTurnDone(id);

    expect(chatAttention(id)).toBe(true);
    expect(sound.playAttentionSound).toHaveBeenCalledTimes(1);
  });

  it("does not double-chime when the active chat is also staged", () => {
    const id = seed(null);
    setActiveChatForActivity(id);
    setStagedChatsForActivity([id]);
    setWindowFocusForActivity(false);

    agentTurnStarted(id);
    agentTurnDone(id);

    expect(chatAttention(id)).toBe(true);
    expect(sound.playAttentionSound).toHaveBeenCalledTimes(1);
  });

  it("does NOT clear existing attention just from a focused window staging the chat (#331)", () => {
    const id = seed(null);
    setActiveChatForActivity("other-chat");

    agentTurnStarted(id);
    agentTurnDone(id);
    expect(chatAttention(id)).toBe(true);

    setStagedChatsForActivity([id]); // staging it on screen is still just looking

    expect(chatAttention(id)).toBe(true);
    expect(sound.playAttentionSound).toHaveBeenCalledTimes(1);
  });
});

describe("chatActivity — pane close and archive cleanup", () => {
  it("cancels a pending cycle when the last agent pane closes", () => {
    const id = seed();
    setActiveChatForActivity("other-chat");

    recordChatOutput(id, "pane-0", "streaming right up until the close");
    expect(chatBusy(id)).toBe(true);

    revokeAgentPane(id, "pane-0");
    handlePaneClosed(id, "pane-0");

    expect(chatBusy(id)).toBe(false);
    vi.advanceTimersByTime(CHAT_BUSY_QUIET_MS);
    expect(chatAttention(id)).toBe(false);
    expect(sound.playAttentionSound).not.toHaveBeenCalled();
  });

  it("keeps the cycle when another agent pane remains", () => {
    const id = seed();
    armChatAutoName(id, "pane-1");
    setActiveChatForActivity("other-chat");

    recordChatOutput(id, "pane-1", "second agent is still streaming");
    revokeAgentPane(id, "pane-0");
    handlePaneClosed(id, "pane-0");

    expect(chatBusy(id)).toBe(true);
    vi.advanceTimersByTime(CHAT_BUSY_QUIET_MS);
    expect(chatAttention(id)).toBe(true);
  });

  it("clearChatActivity drops state and pending timers", () => {
    const id = seed();
    setActiveChatForActivity("other-chat");

    recordChatOutput(id, "pane-0", "output that would otherwise alert soon");
    clearChatActivity(id);

    vi.advanceTimersByTime(CHAT_BUSY_QUIET_MS);
    expect(chatBusy(id)).toBe(false);
    expect(chatAttention(id)).toBe(false);
    expect(sound.playAttentionSound).not.toHaveBeenCalled();
  });
});

// #306 PR2: the sidebar work card lingers for CARD_LINGER_MS after a live
// (busy/needs-you) chat settles quiet, instead of collapsing to the
// one-liner immediately — see chatCardVisualState in flatChatSort.ts.
describe("chatActivity — justFinished linger (#306 PR2)", () => {
  it("lingers after a turn interrupts quietly (no attention), then collapses", () => {
    const id = seed(null);
    setActiveChatForActivity("other-chat");

    agentTurnStarted(id);
    agentTurnCleared(id);

    expect(chatBusy(id)).toBe(false);
    expect(chatAttention(id)).toBe(false);
    expect(chatJustFinished(id)).toBe(true);

    vi.advanceTimersByTime(CARD_LINGER_MS - 1);
    expect(chatJustFinished(id)).toBe(true);

    vi.advanceTimersByTime(1);
    expect(chatJustFinished(id)).toBe(false);
  });

  it("does not start a linger just from the user opening a needs-you chat (#331)", () => {
    // Opening a needs-you chat (markChatSeen) is not real chat-driven
    // activity — it doesn't bump the sort timestamp, doesn't start a card
    // linger, and (#331) doesn't even clear the standing attention flag: the
    // chat stays needs-you, in the live section, exactly as it was before
    // the user looked.
    const id = seed(null);
    setActiveChatForActivity("other-chat");

    agentTurnStarted(id);
    agentTurnDone(id);
    expect(chatAttention(id)).toBe(true);
    expect(chatJustFinished(id)).toBe(false); // still live (needs-you), not finished yet

    setActiveChatForActivity(id); // the user opens it — merely looking

    expect(chatAttention(id)).toBe(true);
    expect(chatJustFinished(id)).toBe(false);
  });

  it("still lingers when a turn finishes on the active, focused chat", () => {
    // The busy->false transition is real chat-driven activity regardless of
    // who's watching (same busy/attention distinction lastActivityMs already
    // draws) — the sidebar card briefly shows "done" even for the chat
    // you're currently in, then settles, same as any other card.
    const id = seed(null);
    setActiveChatForActivity(id);

    agentTurnStarted(id);
    agentTurnDone(id);

    expect(chatAttention(id)).toBe(false);
    expect(chatJustFinished(id)).toBe(true);

    vi.advanceTimersByTime(CARD_LINGER_MS);
    expect(chatJustFinished(id)).toBe(false);
  });

  it("re-entering a live state cancels the pending collapse", () => {
    const id = seed(null);
    setActiveChatForActivity("other-chat");

    agentTurnStarted(id);
    agentTurnCleared(id);
    expect(chatJustFinished(id)).toBe(true);

    vi.advanceTimersByTime(CARD_LINGER_MS / 2);
    agentTurnStarted(id); // busy again before the linger expired

    expect(chatBusy(id)).toBe(true);
    expect(chatJustFinished(id)).toBe(false);

    // The cancelled timer must not fire later and wrongly clear anything.
    vi.advanceTimersByTime(CARD_LINGER_MS);
    expect(chatJustFinished(id)).toBe(false);
    expect(chatBusy(id)).toBe(true);
  });

  it("agentTurnDone straight to needs-you never flashes justFinished", () => {
    // agentTurnDone writes busy:false then attention:true in the same call —
    // the intermediate quiet moment must not leave a stuck justFinished flag
    // once attention lands.
    const id = seed(null);
    setActiveChatForActivity("other-chat");

    agentTurnStarted(id);
    agentTurnDone(id);

    expect(chatAttention(id)).toBe(true);
    expect(chatJustFinished(id)).toBe(false);
  });

  it("clearChatActivity cancels a pending linger timer", () => {
    const id = seed(null);
    setActiveChatForActivity("other-chat");

    agentTurnStarted(id);
    agentTurnCleared(id);
    expect(chatJustFinished(id)).toBe(true);

    clearChatActivity(id);

    // No leaked timer firing a write on a cleared chat.
    vi.advanceTimersByTime(CARD_LINGER_MS);
    expect(chatJustFinished(id)).toBe(false);
  });
});
