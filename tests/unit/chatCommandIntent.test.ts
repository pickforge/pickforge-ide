// Contract tests for the chat-command intent seam (issue #220 PR 4):
// src/stores/terminalHosts.ts is the ONE place feature callers (Workbench,
// Ask AI, the widget/CDP/a11y inspectors) go through to act on a chat's
// terminal(s) — they must never reach into a TerminalHostHandle directly.
// Exercised against the REAL chatAutoName module (only its workspace/flags
// dependencies are stubbed) so attribution is proven end-to-end, not against
// a mock of the thing under test.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => {
  const chats = new Map<string, { chatId: string; title: string; titleSource: "default" }>();
  return {
    chats,
    findChat: vi.fn((id: string) => chats.get(id)),
    setChatTitle: vi.fn(async () => true),
    resumeAutomaticChatTitles: vi.fn(),
  };
});
vi.mock("../../src/stores/workspace", () => ({
  findChat: store.findChat,
  setChatTitle: store.setChatTitle,
  resumeAutomaticChatTitles: store.resumeAutomaticChatTitles,
}));
vi.mock("../../src/stores/flags", () => ({ flagEnabled: () => false }));

const opener = vi.hoisted(() => ({ openPathSystem: vi.fn(async () => {}) }));
vi.mock("../../src/lib/opener", () => ({ openPathSystem: opener.openPathSystem }));

const fileOpen = vi.hoisted(() => ({
  editorCommand: vi.fn((path: string) => `nvim '${path}'`),
}));
vi.mock("../../src/stores/fileOpenSettings", () => ({ editorCommand: fileOpen.editorCommand }));

import { isAgentPane, hasAgentPane } from "../../src/lib/chatAutoName";
import {
  chatSpawnMode,
  deleteTerminalHost,
  hasTerminalHost,
  launchAgentInPrimary,
  launchAgentInSplit,
  openFileInChat,
  runInSplit,
  setTerminalHost,
} from "../../src/stores/terminalHosts";
import type { TerminalHostHandle } from "../../src/components/TerminalHost";

function fakeHost(overrides: Partial<TerminalHostHandle> = {}): TerminalHostHandle {
  return {
    typeToFocused: vi.fn(() => null),
    openInNewPane: vi.fn(() => "split-pane"),
    runInPrimary: vi.fn(() => "primary-pane"),
    primarySpawnMode: vi.fn(() => "local"),
    primaryRemotePty: vi.fn(() => null),
    ...overrides,
  };
}

let chatCounter = 0;
function freshChatId(): string {
  return `chat-${++chatCounter}`;
}

beforeEach(() => {
  store.chats.clear();
  store.setChatTitle.mockClear();
  opener.openPathSystem.mockClear();
  fileOpen.editorCommand.mockClear();
  fileOpen.editorCommand.mockImplementation((path: string) => `nvim '${path}'`);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("agent launches use the recoverable primary and attribute once", () => {
  it("runs the command in runInPrimary (never a split) and arms the returned pane", () => {
    const chatId = freshChatId();
    store.chats.set(chatId, { chatId, title: "New chat", titleSource: "default" });
    const host = fakeHost();
    setTerminalHost(chatId, host);

    const paneId = launchAgentInPrimary(chatId, "claude fix the bug");

    expect(host.runInPrimary).toHaveBeenCalledExactlyOnceWith("claude fix the bug");
    expect(host.openInNewPane).not.toHaveBeenCalled();
    expect(paneId).toBe("primary-pane");
    expect(isAgentPane(chatId, "primary-pane")).toBe(true);
  });

  it("does not attribute when the primary handle isn't ready (runInPrimary returns null)", () => {
    const chatId = freshChatId();
    const host = fakeHost({ runInPrimary: vi.fn(() => null) });
    setTerminalHost(chatId, host);

    expect(launchAgentInPrimary(chatId, "claude")).toBeNull();
    expect(hasAgentPane(chatId)).toBe(false);
  });
});

describe("editor/non-agent actions use a split", () => {
  it("runInSplit opens a fresh pane (never the primary) and never attributes", () => {
    const chatId = freshChatId();
    const host = fakeHost();
    setTerminalHost(chatId, host);

    const paneId = runInSplit(chatId, "ls -la");

    expect(host.openInNewPane).toHaveBeenCalledExactlyOnceWith("ls -la");
    expect(host.runInPrimary).not.toHaveBeenCalled();
    expect(paneId).toBe("split-pane");
    expect(hasAgentPane(chatId)).toBe(false);
  });

  it("openFileInChat types the editor command into a split, never the primary", () => {
    const chatId = freshChatId();
    const host = fakeHost();
    setTerminalHost(chatId, host);

    openFileInChat(chatId, "/local/proj/src/main.ts", "/local/proj");

    expect(host.runInPrimary).not.toHaveBeenCalled();
    expect(host.openInNewPane).toHaveBeenCalledExactlyOnceWith(
      "nvim '/local/proj/src/main.ts'",
      { forceLocal: true },
    );
    expect(hasAgentPane(chatId)).toBe(false);
  });

  it("openFileInChat forwards an explicit location through to editorCommand", () => {
    const chatId = freshChatId();
    const host = fakeHost();
    setTerminalHost(chatId, host);

    openFileInChat(chatId, "/local/proj/src/main.ts", "/local/proj", { line: 12, column: 4 });

    expect(fileOpen.editorCommand).toHaveBeenCalledExactlyOnceWith("/local/proj/src/main.ts", {
      line: 12,
      column: 4,
    });
  });

  it("openFileInChat routes through the chat's remote binding when the file is inside it", () => {
    const chatId = freshChatId();
    const remote = { host: "mac-mini", remoteRoot: "/remote/proj" };
    const host = fakeHost({ primaryRemotePty: vi.fn(() => remote) });
    setTerminalHost(chatId, host);

    openFileInChat(chatId, "/local/proj/src/main.ts", "/local/proj");

    expect(fileOpen.editorCommand).toHaveBeenCalledExactlyOnceWith(
      "/remote/proj/src/main.ts",
      undefined,
    );
    expect(host.openInNewPane).toHaveBeenCalledExactlyOnceWith(
      "nvim '/remote/proj/src/main.ts'",
      { remote },
    );
  });

  it("openFileInChat falls back to the OS opener when the file-open setting is system", () => {
    const chatId = freshChatId();
    const host = fakeHost();
    setTerminalHost(chatId, host);
    fileOpen.editorCommand.mockReturnValue(null);

    openFileInChat(chatId, "/local/proj/README.md", "/local/proj");

    expect(host.openInNewPane).not.toHaveBeenCalled();
    expect(opener.openPathSystem).toHaveBeenCalledExactlyOnceWith("/local/proj/README.md");
  });
});

describe("inspector actions remain explicitly local", () => {
  it("launchAgentInSplit(forceLocal) pins the split pane local and arms it once, ignoring any remote binding", () => {
    const chatId = freshChatId();
    store.chats.set(chatId, { chatId, title: "New chat", titleSource: "default" });
    const remote = { host: "mac-mini", remoteRoot: "/remote/proj" };
    const host = fakeHost({ primaryRemotePty: vi.fn(() => remote) });
    setTerminalHost(chatId, host);

    const paneId = launchAgentInSplit(chatId, "claude review capture.md", { forceLocal: true });

    expect(host.openInNewPane).toHaveBeenCalledExactlyOnceWith(
      "claude review capture.md",
      { forceLocal: true },
    );
    expect(host.runInPrimary).not.toHaveBeenCalled();
    expect(paneId).toBe("split-pane");
    expect(isAgentPane(chatId, "split-pane")).toBe(true);
  });
});

describe("pending/unavailable hosts create no attribution side effect", () => {
  it("a chat with no mounted host: every command intent is a safe no-op", () => {
    const chatId = freshChatId();
    expect(hasTerminalHost(chatId)).toBe(false);
    expect(chatSpawnMode(chatId)).toBeUndefined();

    expect(launchAgentInPrimary(chatId, "claude")).toBeNull();
    expect(runInSplit(chatId, "ls")).toBeNull();
    expect(launchAgentInSplit(chatId, "claude", { forceLocal: true })).toBeNull();

    expect(hasAgentPane(chatId)).toBe(false);
    expect(store.setChatTitle).not.toHaveBeenCalled();
  });

  it("openFileInChat falls back to the OS opener for a chat with no mounted host", () => {
    const chatId = freshChatId();

    openFileInChat(chatId, "/local/proj/src/main.ts", "/local/proj");

    expect(opener.openPathSystem).toHaveBeenCalledExactlyOnceWith("/local/proj/src/main.ts");
    expect(fileOpen.editorCommand).not.toHaveBeenCalled();
  });

  it("a disposed host (chat deleted) stops receiving commands", () => {
    const chatId = freshChatId();
    const host = fakeHost();
    setTerminalHost(chatId, host);
    deleteTerminalHost(chatId);

    expect(launchAgentInPrimary(chatId, "claude")).toBeNull();
    expect(host.runInPrimary).not.toHaveBeenCalled();
    expect(hasAgentPane(chatId)).toBe(false);
  });
});
