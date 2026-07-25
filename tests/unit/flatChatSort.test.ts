import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// chatLifecycleState reads the real `chatActivity` store, which (via
// chatAutoName) imports the full `workspace` store — pull in the same
// localStorage shim + mocks `chatActivity.test.ts` uses so that import chain
// doesn't need a real Tauri/DOM runtime.
vi.hoisted(() => {
  const m = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage;
});
vi.mock("../../src/stores/workspace", () => ({
  findChat: vi.fn(),
  setChatTitle: vi.fn(),
}));
vi.mock("../../src/lib/attentionSound", () => ({
  playAttentionSound: vi.fn(),
}));

import type { Chat } from "../../src/lib/db";
import {
  type ChatLifecycleState,
  chatLifecycleState,
  shortRelTime,
  sortFlatChats,
} from "../../src/stores/flatChatSort";
import {
  agentTurnCleared,
  agentTurnDone,
  agentTurnStarted,
  chatAttention,
  chatBusy,
  clearChatActivity,
} from "../../src/stores/chatActivity";

let now = 1_800_000_000_000;

function chat(id: string, projectRoot: string, lastActivityAt = now): Chat {
  return {
    chatId: id,
    projectRoot,
    title: id,
    titleSource: "user",
    titleUpdatedAt: now,
    kind: "terminal",
    agentId: "claudeCode",
    skillId: null,
    sessionId: null,
    labelsJson: null,
    status: null,
    taskBriefText: null,
    createdAt: now,
    lastActivityAt,
    sortOrder: 0,
  };
}

describe("sortFlatChats — state buckets, across projects", () => {
  it("sorts needs-you above working above quiet regardless of project", () => {
    const quietA = chat("quiet-a", "/proj/a");
    const workingB = chat("working-b", "/proj/b");
    const needsYouA = chat("needsyou-a", "/proj/a");
    const chats = [quietA, workingB, needsYouA];
    const stateOf = (id: string): ChatLifecycleState =>
      id === "needsyou-a" ? "needsYou" : id === "working-b" ? "working" : "quiet";

    const sorted = sortFlatChats(chats, stateOf);

    expect(sorted.map((c) => c.chatId)).toEqual(["needsyou-a", "working-b", "quiet-a"]);
  });

  it("keeps every needs-you chat above every working chat, mixed projects", () => {
    const chats = [
      chat("working-1", "/proj/a"),
      chat("needsyou-1", "/proj/b"),
      chat("working-2", "/proj/b"),
      chat("needsyou-2", "/proj/a"),
    ];
    const stateOf = (id: string): ChatLifecycleState => (id.startsWith("needsyou") ? "needsYou" : "working");

    const sorted = sortFlatChats(chats, stateOf);
    const firstWorkingIndex = sorted.findIndex((c) => c.chatId.startsWith("working"));
    const lastNeedsYouIndex = sorted.map((c) => c.chatId).lastIndexOf(
      sorted.map((c) => c.chatId).find((id) => id.startsWith("needsyou"))!,
    );
    expect(sorted.every((c) => c.chatId.startsWith("needsyou") || c.chatId.startsWith("working"))).toBe(true);
    expect(lastNeedsYouIndex).toBeLessThan(firstWorkingIndex);
  });

  it("orders the quiet bucket by most-recent activity first", () => {
    const oldest = chat("oldest", "/proj/a", now - 3 * 86_400_000);
    const newest = chat("newest", "/proj/b", now - 60_000);
    const middle = chat("middle", "/proj/a", now - 3_600_000);
    const chats = [oldest, newest, middle];

    const sorted = sortFlatChats(chats, () => "quiet");

    expect(sorted.map((c) => c.chatId)).toEqual(["newest", "middle", "oldest"]);
  });

  it("does not mutate the input array", () => {
    const chats = [chat("a", "/proj/a", now - 1000), chat("b", "/proj/a", now)];
    const copy = [...chats];

    sortFlatChats(chats, () => "quiet");

    expect(chats).toEqual(copy);
  });
});

describe("chatLifecycleState — live chatActivity store", () => {
  const id = "activity-chat";

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    clearChatActivity(id);
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("is quiet with no recorded activity", () => {
    expect(chatLifecycleState(id)).toBe("quiet");
  });

  it("is working while a turn is in flight", () => {
    agentTurnStarted(id);
    expect(chatBusy(id)).toBe(true);
    expect(chatLifecycleState(id)).toBe("working");
  });

  it("is needsYou once an unseen turn finishes", () => {
    agentTurnStarted(id);
    agentTurnDone(id);
    expect(chatAttention(id)).toBe(true);
    expect(chatLifecycleState(id)).toBe("needsYou");
  });

  it("falls back to quiet once a turn is interrupted (no chime)", () => {
    agentTurnStarted(id);
    agentTurnCleared(id);
    expect(chatLifecycleState(id)).toBe("quiet");
  });
});

describe("shortRelTime", () => {
  it("reads 'now' for the first minute", () => {
    expect(shortRelTime(now, now)).toBe("now");
    expect(shortRelTime(now - 30_000, now)).toBe("now");
  });

  it("reads bare minutes under an hour", () => {
    expect(shortRelTime(now - 4 * 60_000, now)).toBe("4m");
  });

  it("reads bare hours under a day", () => {
    expect(shortRelTime(now - 2 * 3_600_000, now)).toBe("2h");
  });

  it("reads bare days beyond that", () => {
    expect(shortRelTime(now - 3 * 86_400_000, now)).toBe("3d");
  });
});
