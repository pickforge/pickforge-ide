import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const sdk = vi.hoisted(() => ({
  getSessionMessages: vi.fn(),
  listSessions: vi.fn(),
  query: vi.fn(),
}));

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  getSessionMessages: sdk.getSessionMessages,
  listSessions: sdk.listSessions,
  query: sdk.query,
}));

import { query } from "@anthropic-ai/claude-agent-sdk";
import {
  PushableAsyncQueue,
  createUserTextMessage,
  createPermissionGate,
  createPermissionHandler,
  dispatchCommand,
  permissionResultForDecision,
  resetBridgeStateForTests,
  resolveApprovalDecision,
  type BridgeEvent,
} from "../../scripts/claude-bridge";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function fakeQuery(overrides: { interrupt?: () => Promise<void> } = {}) {
  const closed = deferred<void>();
  const queryObject = {
    interrupt: vi.fn(overrides.interrupt ?? (() => Promise.resolve())),
    close: vi.fn(() => closed.resolve()),
    async *[Symbol.asyncIterator]() {
      await closed.promise;
    },
  };
  return queryObject;
}

function eventsCollector() {
  const events: BridgeEvent[] = [];
  return {
    events,
    emit: (event: BridgeEvent) => events.push(event),
  };
}

beforeEach(() => {
  resetBridgeStateForTests();
  sdk.getSessionMessages.mockReset();
  sdk.listSessions.mockReset();
  sdk.query.mockReset();
});

afterEach(() => {
  resetBridgeStateForTests();
});

describe("PushableAsyncQueue", () => {
  it("yields pushed items and closes after end", async () => {
    const queue = new PushableAsyncQueue<string>();
    const iterator = queue[Symbol.asyncIterator]();
    const next = iterator.next();

    queue.push("hello");

    await expect(next).resolves.toEqual({ done: false, value: "hello" });
    queue.end();
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
  });
});

describe("permissionResultForDecision", () => {
  it("maps approval decisions to SDK permission results", () => {
    expect(permissionResultForDecision("accept")).toEqual({ behavior: "allow" });
    expect(permissionResultForDecision("acceptForSession")).toEqual({ behavior: "allow" });
    expect(permissionResultForDecision("decline")).toEqual({
      behavior: "deny",
      message: "denied by user",
    });
    expect(permissionResultForDecision("cancel")).toEqual({
      behavior: "deny",
      message: "cancelled",
      interrupt: true,
    });
  });
});

describe("createPermissionHandler", () => {
  it("short-circuits future requests for always-allowed tools", async () => {
    const gate = createPermissionGate();
    const events: BridgeEvent[] = [];
    const handler = createPermissionHandler("chat-1", gate, (event) => events.push(event));

    const first = handler(
      "Bash",
      { command: "bun test" },
      {
        toolUseID: "req-1",
        signal: new AbortController().signal,
      },
    );

    expect(events).toEqual([
      {
        ev: "approvalRequest",
        chatId: "chat-1",
        requestId: "req-1",
        toolName: "Bash",
        input: { command: "bun test" },
      },
    ]);

    expect(resolveApprovalDecision(gate, "req-1", "acceptForSession")).toBe(true);
    await expect(first).resolves.toEqual({ behavior: "allow" });

    const second = await handler(
      "Bash",
      { command: "bun test" },
      {
        toolUseID: "req-2",
        signal: new AbortController().signal,
      },
    );

    expect(second).toEqual({ behavior: "allow" });
    expect(events).toHaveLength(1);
    expect(gate.pendingApprovals.has("req-2")).toBe(false);
  });
});

describe("dispatchCommand", () => {
  it("resolves an approval while interrupt is still in flight", async () => {
    const interrupt = deferred<void>();
    const chatQuery = fakeQuery({ interrupt: () => interrupt.promise });
    vi.mocked(query).mockReturnValue(chatQuery as ReturnType<typeof query>);
    const { events, emit } = eventsCollector();

    dispatchCommand({ op: "start", chatId: "chat-1", cwd: "/project" }, emit);

    const options = vi.mocked(query).mock.calls[0]?.[0].options;
    const permission = options?.canUseTool?.("Bash", { command: "bun test" }, {
      toolUseID: "approval-1",
      signal: new AbortController().signal,
    });

    dispatchCommand({ op: "interrupt", chatId: "chat-1" }, emit);
    dispatchCommand({
      op: "approve",
      chatId: "chat-1",
      requestId: "approval-1",
      decision: "accept",
    }, emit);

    await expect(permission).resolves.toEqual({ behavior: "allow" });
    expect(chatQuery.interrupt).toHaveBeenCalledTimes(1);
    expect(events).toContainEqual({
      ev: "approvalRequest",
      chatId: "chat-1",
      requestId: "approval-1",
      toolName: "Bash",
      input: { command: "bun test" },
    });

    interrupt.resolve();
  });

  it("does not let a slow op on one chat delay another chat's send", async () => {
    const interrupt = deferred<void>();
    const chatAQuery = fakeQuery({ interrupt: () => interrupt.promise });
    const chatBQuery = fakeQuery();
    vi.mocked(query)
      .mockReturnValueOnce(chatAQuery as ReturnType<typeof query>)
      .mockReturnValueOnce(chatBQuery as ReturnType<typeof query>);
    const { emit } = eventsCollector();

    dispatchCommand({ op: "start", chatId: "chat-a", cwd: "/project-a" }, emit);
    dispatchCommand({ op: "start", chatId: "chat-b", cwd: "/project-b" }, emit);

    const chatBPrompt = vi.mocked(query).mock.calls[1]?.[0].prompt as AsyncIterable<unknown>;
    const chatBIterator = chatBPrompt[Symbol.asyncIterator]();

    dispatchCommand({ op: "interrupt", chatId: "chat-a" }, emit);
    dispatchCommand({ op: "send", chatId: "chat-b", text: "hello" }, emit);

    await expect(chatBIterator.next()).resolves.toMatchObject({
      done: false,
      value: {
        type: "user",
        message: {
          role: "user",
          content: [{ type: "text", text: "hello" }],
        },
      },
    });
    expect(chatAQuery.interrupt).toHaveBeenCalledTimes(1);

    interrupt.resolve();
  });

  it("serializes image sends as base64 image blocks before text", async () => {
    const chatQuery = fakeQuery();
    vi.mocked(query).mockReturnValue(chatQuery as ReturnType<typeof query>);
    const { emit } = eventsCollector();
    const dir = mkdtempSync(join(tmpdir(), "pickforge-claude-bridge-"));
    const imagePath = join(dir, "shot.png");
    writeFileSync(imagePath, Buffer.from("image-bytes"));

    try {
      dispatchCommand({ op: "start", chatId: "chat-1", cwd: "/project" }, emit);
      const prompt = vi.mocked(query).mock.calls[0]?.[0].prompt as AsyncIterable<unknown>;
      const iterator = prompt[Symbol.asyncIterator]();

      dispatchCommand({
        op: "send",
        chatId: "chat-1",
        text: "look here",
        images: [imagePath],
      }, emit);

      await expect(iterator.next()).resolves.toEqual({
        done: false,
        value: {
          type: "user",
          message: {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/png",
                  data: Buffer.from("image-bytes").toString("base64"),
                },
              },
              { type: "text", text: "look here" },
            ],
          },
          parent_tool_use_id: null,
          session_id: "",
        },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("skips missing images without dropping text or remaining images", () => {
    const dir = mkdtempSync(join(tmpdir(), "pickforge-claude-bridge-"));
    const imagePath = join(dir, "shot.png");
    const missingPath = join(dir, "missing.png");
    const stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    writeFileSync(imagePath, Buffer.from("image-bytes"));

    try {
      expect(createUserTextMessage("look here", [missingPath, imagePath])).toEqual({
        type: "user",
        message: {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
                data: Buffer.from("image-bytes").toString("base64"),
              },
            },
            { type: "text", text: "look here" },
          ],
        },
        parent_tool_use_id: null,
        session_id: "",
      });
      expect(stderrWrite).toHaveBeenCalledWith(expect.stringContaining("skipping image"));
      expect(stderrWrite).toHaveBeenCalledWith(expect.stringContaining(missingPath));
    } finally {
      stderrWrite.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns null when text is empty and no images can be encoded", () => {
    const dir = mkdtempSync(join(tmpdir(), "pickforge-claude-bridge-"));
    const missingPath = join(dir, "missing.png");
    const stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    try {
      expect(createUserTextMessage(" ", [missingPath])).toBeNull();
    } finally {
      stderrWrite.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
