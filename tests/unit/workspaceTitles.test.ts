import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateChatTitle: vi.fn(),
  updateChatTitleOwnership: vi.fn(),
  updateChatAgent: vi.fn(),
  chatUpsert: vi.fn(),
  chats: [] as Array<Record<string, unknown>>,
  dynamicChatTitles: true,
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
vi.mock("../../src/stores/flags", () => ({
  flagEnabled: () => mocks.dynamicChatTitles,
}));

import {
  addChat,
  findChat,
  loadWorkspace,
  renameChat,
  setChatAgent,
  setChatTitle,
} from "../../src/stores/workspace";

beforeEach(async () => {
  mocks.updateChatTitle.mockReset();
  mocks.updateChatTitleOwnership.mockReset();
  mocks.updateChatAgent.mockReset();
  mocks.chatUpsert.mockReset();
  mocks.dynamicChatTitles = true;
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

  it("persists an adoptable default sentinel while the flag is off in-run and after reload", async () => {
    const now = vi.spyOn(Date, "now");
    now
      .mockReturnValueOnce(10_000)
      .mockReturnValueOnce(10_001)
      .mockReturnValueOnce(20_000)
      .mockReturnValueOnce(20_001);

    mocks.dynamicChatTitles = false;
    const sameRunId = await addChat("New chat", "codex", "/project", "agent");
    expect(mocks.chatUpsert).toHaveBeenLastCalledWith(
      expect.objectContaining({
        chatId: sameRunId,
        title: "New chat",
        titleSource: "default",
        titleUpdatedAt: 0,
      }),
    );
    mocks.dynamicChatTitles = true;
    mocks.updateChatTitle.mockResolvedValueOnce(true);
    await expect(setChatTitle(sameRunId!, "Adopted in the same run")).resolves.toBe(true);
    expect(findChat(sameRunId!)).toMatchObject({
      title: "Adopted in the same run",
      titleSource: "auto",
    });

    mocks.dynamicChatTitles = false;
    const reloadedId = await addChat("New chat", "codex", "/project", "agent");
    expect(reloadedId).not.toBe(sameRunId);
    await loadWorkspace();
    mocks.dynamicChatTitles = true;
    mocks.updateChatTitle.mockResolvedValueOnce(true);
    await expect(setChatTitle(reloadedId!, "Adopted after reload")).resolves.toBe(true);

    expect(findChat(reloadedId!)).toMatchObject({
      title: "Adopted after reload",
      titleSource: "auto",
    });
    now.mockRestore();
  });
});
