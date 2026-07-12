import { afterEach, describe, expect, it, vi } from "vitest";

import type { Chat } from "../../src/lib/db";
import { installTauriMock } from "../../src/lib/tauriMock";

type MockInternals = {
  invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Tauri browser mock chat title persistence", () => {
  it("models legacy, flagged CAS, ownership, and narrow agent writes statefully", async () => {
    const browserWindow: { __TAURI_INTERNALS__?: MockInternals } = {};
    vi.stubGlobal("window", browserWindow);
    installTauriMock();
    const invoke = browserWindow.__TAURI_INTERNALS__!.invoke;

    const makeChat = (chatId: string, title: string, titleSource: Chat["titleSource"]): Chat => ({
      chatId,
      projectRoot: "/home/dev/acme-app",
      title,
      titleSource,
      titleUpdatedAt: 0,
      kind: "terminal",
      agentId: "codex",
      skillId: null,
      sessionId: null,
      labelsJson: null,
      status: null,
      taskBriefText: null,
      createdAt: 1,
      lastActivityAt: 1,
      sortOrder: 99,
    });

    await invoke("chat_upsert", { chat: makeChat("mock-legacy", "New chat", "user") });
    await expect(
      invoke("update_chat_title", { chatId: "mock-legacy", title: "Legacy title" }),
    ).resolves.toBe(true);
    let chats = await invoke("chats_list", {
      projectRoot: "/home/dev/acme-app",
    }) as Chat[];
    expect(chats.find((chat) => chat.chatId === "mock-legacy")).toMatchObject({
      title: "Legacy title",
      titleSource: "user",
      titleUpdatedAt: 0,
    });

    await invoke("chat_upsert", { chat: makeChat("mock-flagged", "New chat", "user") });
    await expect(
      invoke("update_chat_title", {
        chatId: "mock-flagged",
        title: "Newest automatic title",
        titleSource: "auto",
        titleUpdatedAt: 2,
      }),
    ).resolves.toBe(true);
    await expect(
      invoke("update_chat_title", {
        chatId: "mock-flagged",
        title: "Stale automatic title",
        titleSource: "auto",
        titleUpdatedAt: 1,
      }),
    ).resolves.toBe(false);
    await invoke("update_chat_title_ownership", {
      chatId: "mock-flagged",
      titleSource: "user",
      titleUpdatedAt: 3,
    });
    await expect(
      invoke("update_chat_title", {
        chatId: "mock-flagged",
        title: "Rejected after manual ownership",
        titleSource: "auto",
        titleUpdatedAt: 4,
      }),
    ).resolves.toBe(false);
    await invoke("update_chat_agent", {
      chatId: "mock-flagged",
      agentId: "claudeCode",
      kind: "agent",
    });

    chats = await invoke("chats_list", {
      projectRoot: "/home/dev/acme-app",
    }) as Chat[];
    expect(chats.find((chat) => chat.chatId === "mock-flagged")).toMatchObject({
      title: "Newest automatic title",
      titleSource: "user",
      titleUpdatedAt: 3,
      agentId: "claudeCode",
      kind: "agent",
    });

    await invoke("chat_upsert", {
      chat: makeChat("mock-custom-legacy", "Deliberate legacy title", "default"),
    });
    await expect(
      invoke("update_chat_title", {
        chatId: "mock-custom-legacy",
        title: "Must stay locked",
        titleSource: "auto",
        titleUpdatedAt: 5,
      }),
    ).resolves.toBe(false);
  });
});
