// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";

const testEnv = vi.hoisted(() => ({
  addChat: vi.fn(async () => "chat-id"),
  workspace: {
    projects: [{
      projectRoot: "/project",
      displayName: "Project",
      createdAt: 1,
      lastOpenedAt: 1,
      sortOrder: 0,
      archivedAt: null,
      remoteHost: null,
      remoteRoot: null,
    }],
    activeRoot: null as string | null,
    activeChatId: null as string | null,
  },
}));

vi.hoisted(() => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
      removeItem: (key: string) => void values.delete(key),
      clear: () => values.clear(),
      key: () => null,
      length: 0,
    },
  });
});

vi.mock("../../src/stores/workspace", () => ({
  addChat: testEnv.addChat,
  addProject: vi.fn(),
  archiveProject: vi.fn(),
  chatsFor: () => [],
  deleteChat: vi.fn(),
  deleteProject: vi.fn(),
  ensureChatsLoaded: vi.fn(async () => undefined),
  findChat: vi.fn(),
  migrateChatBackend: vi.fn(),
  renameChat: vi.fn(),
  renameProject: vi.fn(),
  reorderChat: vi.fn(),
  reorderProject: vi.fn(),
  selectChat: vi.fn(),
  selectProject: vi.fn(),
  setProjectRemoteLocal: vi.fn(),
  workspace: testEnv.workspace,
}));
vi.mock("../../src/lib/chatDefaults", () => ({
  loadAskChatTitle: () => false,
  loadDefaultChatKind: () => "terminal",
  loadLastAgentProvider: () => "claudeCode",
  setLastAgentProvider: vi.fn(),
}));
vi.mock("../../src/stores/remoteHealth", () => ({
  healthOf: vi.fn(),
  healthStatus: vi.fn(),
  healthSummary: vi.fn(),
  probeText: vi.fn(),
  recordHealth: vi.fn(),
  refreshHost: vi.fn(),
  relTime: vi.fn(),
  useRemoteHealth: vi.fn(),
}));

import type { Chat } from "../../src/lib/db";
import { chatMarkKind, ProjectsPane } from "../../src/screens/workbench/ProjectsPane";

let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.replaceChildren();
  testEnv.addChat.mockClear();
});

function chat(kind: string, agentId: string): Chat {
  return {
    chatId: `${kind}-${agentId}`,
    projectRoot: "/project",
    title: "Chat",
    titleSource: "user",
    titleUpdatedAt: 1,
    kind,
    agentId,
    skillId: null,
    sessionId: null,
    labelsJson: null,
    status: null,
    taskBriefText: null,
    createdAt: 1,
    lastActivityAt: 1,
    sortOrder: 0,
  };
}

describe("ProjectsPane chat identity", () => {
  it("creates terminal chats with the terminal sentinel instead of a harness stamp", () => {
    const root = document.createElement("div");
    document.body.append(root);
    dispose = render(() => ProjectsPane(), root);

    root.querySelector<HTMLButtonElement>('[data-tour="new-chat"]')?.click();

    expect(testEnv.addChat).toHaveBeenCalledWith(
      "New chat",
      "terminal",
      "/project",
      "terminal",
    );
  });

  it("uses the terminal mark for terminal chats", () => {
    expect(chatMarkKind(chat("terminal", "claudeCode"))).toBe("terminal");
  });

  it.each(["claudeCode", "codex", "omp", "pi"])(
    "keeps the agent mark for %s agent chats",
    (agentId) => {
      expect(chatMarkKind(chat("agent", agentId))).toBe("agent");
    },
  );
});
