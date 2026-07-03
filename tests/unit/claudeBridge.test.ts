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
  approvalScopeKey,
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

async function flushMicrotasks() {
  for (let i = 0; i < 10; i += 1) {
    await Promise.resolve();
  }
}

function fakeQuery(
  overrides: {
    interrupt?: () => Promise<void>;
    setModel?: (model?: string) => Promise<void>;
  } = {},
) {
  const closed = deferred<void>();
  const queryObject = {
    interrupt: vi.fn(overrides.interrupt ?? (() => Promise.resolve())),
    setModel: vi.fn(overrides.setModel ?? (() => Promise.resolve())),
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

describe("approvalScopeKey", () => {
  it("scopes file-like tool inputs by their path aliases", () => {
    expect(approvalScopeKey("NotebookEdit", { notebook_path: "/notes/a.ipynb" })).toBe(
      "NotebookEdit\u0000/notes/a.ipynb",
    );
    expect(approvalScopeKey("Read", { path: "/notes/a.md" })).toBe("Read\u0000/notes/a.md");
    expect(approvalScopeKey("Edit", { file_path: "/notes/a.md", path: "/other.md" })).toBe(
      "Edit\u0000/notes/a.md",
    );
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

  it("re-prompts when the same tool is used with a different command", async () => {
    const gate = createPermissionGate();
    const events: BridgeEvent[] = [];
    const handler = createPermissionHandler("chat-1", gate, (event) => events.push(event));

    const first = handler(
      "Bash",
      { command: "bun test" },
      { toolUseID: "req-1", signal: new AbortController().signal },
    );
    expect(resolveApprovalDecision(gate, "req-1", "acceptForSession")).toBe(true);
    await expect(first).resolves.toEqual({ behavior: "allow" });

    void handler(
      "Bash",
      { command: "rm -rf /" },
      { toolUseID: "req-2", signal: new AbortController().signal },
    );

    expect(events).toHaveLength(2);
    expect(gate.pendingApprovals.has("req-2")).toBe(true);
    expect(resolveApprovalDecision(gate, "req-2", "decline")).toBe(true);
  });

  it("re-prompts NotebookEdit when the notebook path changes", async () => {
    const gate = createPermissionGate();
    const events: BridgeEvent[] = [];
    const handler = createPermissionHandler("chat-1", gate, (event) => events.push(event));

    const first = handler(
      "NotebookEdit",
      { notebook_path: "/notes/a.ipynb" },
      { toolUseID: "req-1", signal: new AbortController().signal },
    );
    expect(resolveApprovalDecision(gate, "req-1", "acceptForSession")).toBe(true);
    await expect(first).resolves.toEqual({ behavior: "allow" });

    const second = await handler(
      "NotebookEdit",
      { notebook_path: "/notes/a.ipynb" },
      { toolUseID: "req-2", signal: new AbortController().signal },
    );
    expect(second).toEqual({ behavior: "allow" });
    expect(events).toHaveLength(1);

    const third = handler(
      "NotebookEdit",
      { notebook_path: "/notes/b.ipynb" },
      { toolUseID: "req-3", signal: new AbortController().signal },
    );

    expect(events).toHaveLength(2);
    expect(gate.pendingApprovals.has("req-3")).toBe(true);
    expect(resolveApprovalDecision(gate, "req-3", "decline")).toBe(true);
    await expect(third).resolves.toEqual({ behavior: "deny", message: "denied by user" });
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

  it("serializes setModel commands per chat in submission order", async () => {
    const slowModel = deferred<void>();
    let activeModel: string | undefined;
    const chatQuery = fakeQuery({
      setModel: (model) => {
        if (model === "slow") {
          return slowModel.promise.then(() => {
            activeModel = model;
          });
        }
        activeModel = model;
        return Promise.resolve();
      },
    });
    vi.mocked(query).mockReturnValue(chatQuery as ReturnType<typeof query>);
    const { events, emit } = eventsCollector();

    dispatchCommand({ op: "start", chatId: "chat-1", cwd: "/project" }, emit);
    dispatchCommand({ op: "setModel", chatId: "chat-1", model: "slow" }, emit);
    dispatchCommand({ op: "setModel", chatId: "chat-1", model: "fast" }, emit);

    await flushMicrotasks();

    expect(chatQuery.setModel).toHaveBeenCalledTimes(1);
    expect(chatQuery.setModel).toHaveBeenNthCalledWith(1, "slow");
    expect(activeModel).toBeUndefined();

    slowModel.resolve();
    await flushMicrotasks();

    expect(chatQuery.setModel).toHaveBeenCalledTimes(2);
    expect(chatQuery.setModel).toHaveBeenNthCalledWith(2, "fast");
    expect(activeModel).toBe("fast");
    expect(events).not.toContainEqual(expect.objectContaining({ ev: "fatal" }));
  });

  it("waits for a pending model mutation before sending", async () => {
    const modelChange = deferred<void>();
    const chatQuery = fakeQuery({ setModel: () => modelChange.promise });
    vi.mocked(query).mockReturnValue(chatQuery as ReturnType<typeof query>);
    const { emit } = eventsCollector();

    dispatchCommand({ op: "start", chatId: "chat-1", cwd: "/project" }, emit);
    const prompt = vi.mocked(query).mock.calls[0]?.[0].prompt as AsyncIterable<unknown>;
    const iterator = prompt[Symbol.asyncIterator]();
    let delivered = false;
    const nextMessage = iterator.next().then((result) => {
      delivered = true;
      return result;
    });

    dispatchCommand({ op: "setModel", chatId: "chat-1", model: "claude-opus-4-1" }, emit);
    await flushMicrotasks();

    expect(chatQuery.setModel).toHaveBeenCalledWith("claude-opus-4-1");

    dispatchCommand({ op: "send", chatId: "chat-1", text: "hello" }, emit);
    await flushMicrotasks();

    expect(delivered).toBe(false);

    modelChange.resolve();

    await expect(nextMessage).resolves.toMatchObject({
      done: false,
      value: {
        type: "user",
        message: {
          role: "user",
          content: [{ type: "text", text: "hello" }],
        },
      },
    });
  });

  it("does not send a prompt when a pending model mutation rejects", async () => {
    const modelChange = deferred<void>();
    const chatQuery = fakeQuery({ setModel: () => modelChange.promise });
    vi.mocked(query).mockReturnValue(chatQuery as ReturnType<typeof query>);
    const { events, emit } = eventsCollector();

    dispatchCommand({ op: "start", chatId: "chat-1", cwd: "/project" }, emit);
    const prompt = vi.mocked(query).mock.calls[0]?.[0].prompt as AsyncIterable<unknown>;
    const iterator = prompt[Symbol.asyncIterator]();
    let delivered = false;
    const nextMessage = iterator.next().then((result) => {
      delivered = true;
      return result;
    });

    dispatchCommand({ op: "setModel", chatId: "chat-1", model: "invalid-model" }, emit);
    await flushMicrotasks();
    dispatchCommand({ op: "send", chatId: "chat-1", text: "blocked" }, emit);
    await flushMicrotasks();

    expect(delivered).toBe(false);

    modelChange.reject(new Error("invalid model"));
    await flushMicrotasks();

    expect(delivered).toBe(false);
    expect(events.filter((event) => event.ev === "fatal")).toEqual([
      { ev: "fatal", chatId: "chat-1", error: expect.stringContaining("invalid model") },
      { ev: "fatal", chatId: "chat-1", error: expect.stringContaining("invalid model") },
    ]);

    dispatchCommand({ op: "send", chatId: "chat-1", text: "after failure" }, emit);

    await expect(nextMessage).resolves.toMatchObject({
      done: false,
      value: {
        type: "user",
        message: {
          role: "user",
          content: [{ type: "text", text: "after failure" }],
        },
      },
    });
  });

  it("does not send the next prompt after an idle model mutation rejects", async () => {
    const chatQuery = fakeQuery({
      setModel: () => Promise.reject(new Error("invalid model")),
    });
    vi.mocked(query).mockReturnValue(chatQuery as ReturnType<typeof query>);
    const { events, emit } = eventsCollector();

    dispatchCommand({ op: "start", chatId: "chat-1", cwd: "/project" }, emit);
    const prompt = vi.mocked(query).mock.calls[0]?.[0].prompt as AsyncIterable<unknown>;
    const iterator = prompt[Symbol.asyncIterator]();
    let delivered = false;
    const nextMessage = iterator.next().then((result) => {
      delivered = true;
      return result;
    });

    dispatchCommand({ op: "setModel", chatId: "chat-1", model: "invalid-model" }, emit);
    await flushMicrotasks();

    expect(events.filter((event) => event.ev === "fatal")).toEqual([
      { ev: "fatal", chatId: "chat-1", error: expect.stringContaining("invalid model") },
    ]);

    dispatchCommand({ op: "send", chatId: "chat-1", text: "blocked" }, emit);
    await flushMicrotasks();

    expect(delivered).toBe(false);
    expect(events.filter((event) => event.ev === "fatal")).toEqual([
      { ev: "fatal", chatId: "chat-1", error: expect.stringContaining("invalid model") },
      { ev: "fatal", chatId: "chat-1", error: expect.stringContaining("invalid model") },
    ]);

    dispatchCommand({ op: "send", chatId: "chat-1", text: "after failure" }, emit);

    await expect(nextMessage).resolves.toMatchObject({
      done: false,
      value: {
        type: "user",
        message: {
          role: "user",
          content: [{ type: "text", text: "after failure" }],
        },
      },
    });
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

  it("emits fatal when an image-only send has no readable images", async () => {
    const chatQuery = fakeQuery();
    vi.mocked(query).mockReturnValue(chatQuery as ReturnType<typeof query>);
    const { events, emit } = eventsCollector();
    const dir = mkdtempSync(join(tmpdir(), "pickforge-claude-bridge-"));
    const missingPath = join(dir, "missing.png");
    const stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    try {
      dispatchCommand({ op: "start", chatId: "chat-1", cwd: "/project" }, emit);
      dispatchCommand({
        op: "send",
        chatId: "chat-1",
        text: " ",
        images: [missingPath],
      }, emit);

      await Promise.resolve();

      expect(events).toContainEqual({
        ev: "fatal",
        chatId: "chat-1",
        error: expect.stringContaining(
          "no sendable content: all image attachments were unreadable",
        ),
      });
    } finally {
      stderrWrite.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
