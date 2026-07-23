import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateChatTitle: vi.fn(),
  updateChatTitleOwnership: vi.fn(),
  updateChatAgent: vi.fn(),
  chatUpsert: vi.fn(),
  chats: [] as Array<Record<string, unknown>>,
}));

vi.mock("../../src/lib/db", () => ({
  projectsList: vi.fn(async () => [
    {
      projectRoot: "/project",
      displayName: "Project",
      createdAt: 1,
      lastOpenedAt: 1,
      sortOrder: 0,
      archivedAt: null,
      remoteHost: null,
      remoteRoot: null,
    },
  ]),
  chatsList: vi.fn(async () => mocks.chats),
  updateChatTitle: mocks.updateChatTitle,
  updateChatTitleOwnership: mocks.updateChatTitleOwnership,
  updateChatAgent: mocks.updateChatAgent,
  chatUpsert: mocks.chatUpsert,
}));
vi.mock("../../src/lib/chatLabels", () => ({ isPrimaryChat: () => true }));
vi.mock("../../src/lib/pty", () => ({
  clearChatKillMark: vi.fn(),
  markChatForKill: vi.fn(),
  ptyDestroyChatSession: vi.fn(),
}));
vi.mock("../../src/lib/settingsSyncEdits", () => ({ noteSettingsEdit: vi.fn() }));
vi.mock("../../src/stores/chatArchive", () => ({ isChatArchived: () => false }));
vi.mock("../../src/stores/chatSessions", () => ({ setChatTmux: vi.fn() }));

import {
  addChat,
  findChat,
  loadWorkspace,
  renameChat,
  resumeAutomaticChatTitles,
  setChatAgent,
  setChatTitle,
} from "../../src/stores/workspace";

beforeEach(async () => {
  mocks.updateChatTitle.mockReset();
  mocks.updateChatTitleOwnership.mockReset();
  mocks.updateChatAgent.mockReset();
  mocks.chatUpsert.mockReset();
  mocks.updateChatTitleOwnership.mockResolvedValue(true);
  mocks.updateChatAgent.mockResolvedValue(undefined);
  mocks.chatUpsert.mockImplementation(async (chat: Record<string, unknown>) => {
    const index = mocks.chats.findIndex((item) => item.chatId === chat.chatId);
    if (index >= 0) mocks.chats[index] = { ...chat };
    else mocks.chats.push({ ...chat });
  });
  mocks.chats = [
    {
      chatId: "chat-1",
      projectRoot: "/project",
      title: "Current automatic title",
      titleSource: "auto",
      titleUpdatedAt: 1,
      agentId: "codex",
      kind: "agent",
      skillId: null,
      sessionId: null,
      labelsJson: null,
      status: null,
      taskBriefText: null,
      createdAt: 1,
      lastActivityAt: 1,
      sortOrder: 0,
    },
  ];
  await loadWorkspace();
});

describe("automatic chat title persistence", () => {
  it("projects an automatic title only when the durable CAS applies", async () => {
    mocks.updateChatTitle.mockResolvedValueOnce(false);

    await expect(setChatTitle("chat-1", "Stale provider title")).resolves.toBe(false);
    expect(findChat("chat-1")).toMatchObject({
      title: "Current automatic title",
      titleSource: "auto",
      titleUpdatedAt: 1,
    });

    mocks.updateChatTitle.mockResolvedValueOnce(true);
    await expect(setChatTitle("chat-1", "Fresh provider title")).resolves.toBe(true);
    expect(findChat("chat-1")).toMatchObject({
      title: "Fresh provider title",
      titleSource: "auto",
    });
  });

  it("keeps a manual rename authoritative when an applied auto response arrives late", async () => {
    let finishAuto: ((applied: boolean) => void) | undefined;
    mocks.updateChatTitle
      .mockImplementationOnce(
        () => new Promise<boolean>((resolve) => {
          finishAuto = resolve;
        }),
      )
      .mockResolvedValueOnce(true);

    const automatic = setChatTitle("chat-1", "Provider title");
    await renameChat("chat-1", "My deliberate title");
    finishAuto?.(true);

    await expect(automatic).resolves.toBe(false);
    expect(findChat("chat-1")).toMatchObject({
      title: "My deliberate title",
      titleSource: "user",
    });
  });

  it("projects only the newest concurrent automatic response", async () => {
    let finishFirst: ((applied: boolean) => void) | undefined;
    let finishSecond: ((applied: boolean) => void) | undefined;
    mocks.updateChatTitle
      .mockImplementationOnce(
        () => new Promise<boolean>((resolve) => {
          finishFirst = resolve;
        }),
      )
      .mockImplementationOnce(
        () => new Promise<boolean>((resolve) => {
          finishSecond = resolve;
        }),
      );

    const first = setChatTitle("chat-1", "Older provider title");
    const second = setChatTitle("chat-1", "Newest provider title");
    const firstMetadata = mocks.updateChatTitle.mock.calls[0][2];
    const secondMetadata = mocks.updateChatTitle.mock.calls[1][2];
    expect(secondMetadata.titleUpdatedAt).toBeGreaterThan(firstMetadata.titleUpdatedAt);

    finishSecond?.(true);
    await expect(second).resolves.toBe(true);
    finishFirst?.(true);
    await expect(first).resolves.toBe(false);
    expect(findChat("chat-1")).toMatchObject({
      title: "Newest provider title",
      titleSource: "auto",
      titleUpdatedAt: secondMetadata.titleUpdatedAt,
    });
  });

  it("keeps a concurrent manual title when a provider switch finishes late", async () => {
    let finishAgent: (() => void) | undefined;
    mocks.updateChatAgent.mockImplementationOnce(
      () => new Promise<void>((resolve) => {
        finishAgent = resolve;
      }),
    );
    mocks.updateChatTitle.mockResolvedValueOnce(true);

    const switching = setChatAgent("chat-1", "claudeCode", "agent");
    await renameChat("chat-1", "My deliberate title");
    finishAgent?.();
    await switching;

    expect(mocks.updateChatAgent).toHaveBeenCalledWith("chat-1", "claudeCode", "agent");
    expect(mocks.chatUpsert).not.toHaveBeenCalled();
    expect(findChat("chat-1")).toMatchObject({
      title: "My deliberate title",
      titleSource: "user",
      agentId: "claudeCode",
      kind: "agent",
    });
  });

  it("projects only the newest concurrent manual rename", async () => {
    let finishFirst: ((applied: boolean) => void) | undefined;
    mocks.updateChatTitle
      .mockImplementationOnce(
        () => new Promise<boolean>((resolve) => {
          finishFirst = resolve;
        }),
      )
      .mockResolvedValueOnce(true);

    const first = renameChat("chat-1", "Older manual title");
    const second = renameChat("chat-1", "Newest manual title");
    const firstMetadata = mocks.updateChatTitle.mock.calls[0][2];
    const secondMetadata = mocks.updateChatTitle.mock.calls[1][2];
    expect(secondMetadata.titleUpdatedAt).toBeGreaterThan(firstMetadata.titleUpdatedAt);

    await second;
    finishFirst?.(false);
    await first;
    expect(findChat("chat-1")).toMatchObject({
      title: "Newest manual title",
      titleSource: "user",
      titleUpdatedAt: secondMetadata.titleUpdatedAt,
    });
  });

  it("persists manual ownership for a previously automatic chat", async () => {
    mocks.updateChatTitle.mockResolvedValueOnce(true);

    await renameChat("chat-1", "Manual title");

    expect(mocks.updateChatTitle).toHaveBeenCalledWith(
      "chat-1",
      "Manual title",
      expect.objectContaining({ titleSource: "user" }),
    );
    expect(findChat("chat-1")).toMatchObject({
      title: "Manual title",
      titleSource: "user",
    });
  });

  it("creates chats with durable title ownership metadata", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValueOnce(10_000);

    const chatId = await addChat("New chat", "codex", "/project", "agent");

    expect(mocks.chatUpsert).toHaveBeenLastCalledWith(
      expect.objectContaining({
        chatId,
        titleSource: "default",
        titleUpdatedAt: 10_000,
      }),
    );
    now.mockRestore();
  });

  it("resumes automatic ownership for a legacy default/non-default title", async () => {
    mocks.chats[0] = {
      ...mocks.chats[0],
      title: "Legacy automatic title",
      titleSource: "default",
      titleUpdatedAt: 0,
    };
    await loadWorkspace();

    await resumeAutomaticChatTitles("chat-1");

    expect(mocks.updateChatTitleOwnership).toHaveBeenCalledWith(
      "chat-1",
      "auto",
      expect.any(Number),
    );
    expect(findChat("chat-1")).toMatchObject({
      title: "Legacy automatic title",
      titleSource: "auto",
    });
  });

});
