import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OperatorAction, OperatorIntent } from "../../src/lib/operatorIntent";
import type { DispatchResult } from "../../src/stores/operator";

const deps = vi.hoisted(() => ({
  parseCommand: vi.fn(),
  routeCommand: vi.fn(),
  dispatchIntent: vi.fn(),
  flagEnabled: vi.fn(),
  operatorAuditList: vi.fn(),
}));

vi.mock("../../src/lib/operatorParser", () => ({
  parseCommand: deps.parseCommand,
}));
vi.mock("../../src/lib/operatorRouter", () => ({
  routeCommand: deps.routeCommand,
}));
vi.mock("../../src/stores/operator", () => ({
  dispatchIntent: deps.dispatchIntent,
}));
vi.mock("../../src/stores/flags", () => ({
  flagEnabled: deps.flagEnabled,
}));
vi.mock("../../src/lib/db", () => ({
  operatorAuditList: deps.operatorAuditList,
}));
vi.mock("../../src/router", () => {
  let current = "workbench";
  const listeners = new Set<(r: string) => void>();
  return {
    route: () => current,
    onRouteChange: (listener: (r: string) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    navigate: (r: string) => {
      const changed = r !== current;
      current = r;
      if (changed) for (const listener of listeners) listener(r);
    },
  };
});

function intent(action: OperatorAction): OperatorIntent {
  return {
    v: 1,
    id: `intent-${action.action}`,
    provenance: "typed",
    confidence: 1,
    projectRef: null,
    action,
  };
}

async function loadStore() {
  vi.resetModules();
  return import("../../src/stores/operatorDock");
}

beforeEach(() => {
  deps.parseCommand.mockReset();
  deps.routeCommand.mockReset().mockResolvedValue({ kind: "unconfigured" });
  deps.dispatchIntent.mockReset();
  deps.flagEnabled.mockReset().mockReturnValue(true);
  deps.operatorAuditList.mockReset().mockResolvedValue([]);
});

describe("operatorDock store", () => {
  it("opens and closes, resetting input and view on close", async () => {
    const s = await loadStore();

    expect(s.operatorDockOpen()).toBe(false);
    expect(s.openOperatorDock()).toBe(true);
    expect(s.operatorDockOpen()).toBe(true);

    s.setOperatorInput("open project app");
    s.closeOperatorDock();

    expect(s.operatorDockOpen()).toBe(false);
    expect(s.operatorInput()).toBe("");
    expect(s.operatorView()).toEqual({ kind: "idle" });
  });

  it("never opens when the operator flag is off", async () => {
    deps.flagEnabled.mockReturnValue(false);
    const s = await loadStore();

    expect(s.openOperatorDock()).toBe(false);
    expect(s.operatorDockOpen()).toBe(false);
    expect(s.toggleOperatorDock()).toBe(false);
    expect(s.operatorDockOpen()).toBe(false);
    expect(deps.operatorAuditList).not.toHaveBeenCalled();
  });

  it("toggles open then closed", async () => {
    const s = await loadStore();

    expect(s.toggleOperatorDock()).toBe(true);
    expect(s.operatorDockOpen()).toBe(true);
    expect(s.toggleOperatorDock()).toBe(false);
    expect(s.operatorDockOpen()).toBe(false);
  });

  it("does nothing on an empty command", async () => {
    deps.parseCommand.mockReturnValue({ kind: "empty" });
    const s = await loadStore();

    await s.submitOperatorCommand();

    expect(s.operatorView()).toEqual({ kind: "idle" });
    expect(deps.dispatchIntent).not.toHaveBeenCalled();
  });

  it("surfaces an unconfigured router state without dispatching", async () => {
    deps.parseCommand.mockReturnValue({ kind: "needsRouter", reason: "no deterministic match" });
    const s = await loadStore();

    s.setOperatorInput("teach me to fly");
    await s.submitOperatorCommand();

    expect(deps.routeCommand).toHaveBeenCalledWith("teach me to fly");
    expect(s.operatorView()).toEqual({
      kind: "needsRouter",
      reason: "Operator router is off. Choose a backend in Settings.",
    });
    expect(deps.dispatchIntent).not.toHaveBeenCalled();
  });

  it("routes a tier-0 proposal through the normal dispatch result path", async () => {
    const openProject = intent({ action: "openProject" });
    deps.parseCommand.mockReturnValue({ kind: "needsRouter", reason: "no deterministic match" });
    deps.routeCommand.mockResolvedValue({
      kind: "proposal",
      intent: openProject,
      confidence: 0.86,
      latencyMs: 1200,
    });
    deps.dispatchIntent.mockResolvedValue({ status: "done", summary: "Opened project App" } as DispatchResult);
    const s = await loadStore();

    s.setOperatorInput("open App");
    await s.submitOperatorCommand();

    expect(deps.dispatchIntent).toHaveBeenCalledWith(openProject, { inputText: "open App" });
    expect(s.operatorView()).toEqual({
      kind: "result",
      result: { status: "done", summary: "Opened project App" },
    });
    expect(s.operatorInput()).toBe("");
  });

  it("routes a tier-1 proposal to preview with confidence", async () => {
    const sendPrompt = intent({ action: "sendPrompt", prompt: "hi", chat: null });
    deps.parseCommand.mockReturnValue({ kind: "needsRouter", reason: "no deterministic match" });
    deps.routeCommand.mockResolvedValue({
      kind: "proposal",
      intent: sendPrompt,
      confidence: 0.74,
      latencyMs: 1300,
    });
    deps.dispatchIntent.mockResolvedValue({
      status: "needsConfirmation",
      summary: "Send prompt to active chat",
    } as DispatchResult);
    const s = await loadStore();

    s.setOperatorInput("tell it hi");
    await s.submitOperatorCommand();

    expect(s.operatorView()).toMatchObject({
      kind: "preview",
      intent: sendPrompt,
      summary: "Send prompt to active chat",
      inputText: "tell it hi",
      confidence: 0.74,
    });
  });

  it("surfaces router unclear and error states without dispatching", async () => {
    deps.parseCommand.mockReturnValue({ kind: "needsRouter", reason: "no deterministic match" });
    const s = await loadStore();

    deps.routeCommand.mockResolvedValueOnce({ kind: "unclear", reason: "too vague" });
    s.setOperatorInput("make it better");
    await s.submitOperatorCommand();
    expect(s.operatorView()).toEqual({ kind: "needsRouter", reason: "too vague" });

    deps.routeCommand.mockResolvedValueOnce({ kind: "error", message: "model not found" });
    s.setOperatorInput("open project App");
    await s.submitOperatorCommand();
    expect(s.operatorView()).toEqual({ kind: "needsRouter", reason: "model not found" });
    expect(deps.dispatchIntent).not.toHaveBeenCalled();
  });

  it("dispatches a tier-0 intent straight to a result and clears input on done", async () => {
    const openProject = intent({ action: "openProject" });
    deps.parseCommand.mockReturnValue({ kind: "intent", intent: openProject });
    deps.dispatchIntent.mockResolvedValue({ status: "done", summary: "Opened project App" } as DispatchResult);
    const s = await loadStore();

    s.setOperatorInput("open project app");
    await s.submitOperatorCommand();

    expect(deps.dispatchIntent).toHaveBeenCalledWith(openProject, { inputText: "open project app" });
    expect(s.operatorView()).toEqual({
      kind: "result",
      result: { status: "done", summary: "Opened project App" },
    });
    expect(s.operatorInput()).toBe("");
  });

  it("takes a tier-1 intent to a preview, then confirms with confirmed:true", async () => {
    const sendPrompt = intent({ action: "sendPrompt", prompt: "hi", chat: null });
    deps.parseCommand.mockReturnValue({ kind: "intent", intent: sendPrompt });
    deps.dispatchIntent
      .mockResolvedValueOnce({ status: "needsConfirmation", summary: "Send prompt to active chat" } as DispatchResult)
      .mockResolvedValueOnce({ status: "done", summary: "Sent prompt to Chat" } as DispatchResult);
    const s = await loadStore();

    s.setOperatorInput("send hi");
    await s.submitOperatorCommand();

    expect(s.operatorView()).toMatchObject({
      kind: "preview",
      intent: sendPrompt,
      summary: "Send prompt to active chat",
      inputText: "send hi",
    });
    expect(s.operatorInput()).toBe("send hi");

    await s.confirmOperatorPreview();

    expect(deps.dispatchIntent).toHaveBeenLastCalledWith(sendPrompt, {
      confirmed: true,
      inputText: "send hi",
    });
    expect(s.operatorView()).toEqual({
      kind: "result",
      result: { status: "done", summary: "Sent prompt to Chat" },
    });
    expect(s.operatorInput()).toBe("");
  });

  it("cancels a preview back to idle without dispatching again", async () => {
    const startSwarm = intent({ action: "startSwarm", mode: "scout", count: 3, goal: "g", provider: "mixed" });
    deps.parseCommand.mockReturnValue({ kind: "intent", intent: startSwarm });
    deps.dispatchIntent.mockResolvedValue({ status: "needsConfirmation", summary: "Start scout swarm with 3 lanes" } as DispatchResult);
    const s = await loadStore();

    s.setOperatorInput("start scout swarm g");
    await s.submitOperatorCommand();
    expect(s.operatorView().kind).toBe("preview");

    s.cancelOperatorPreview();

    expect(s.operatorView()).toEqual({ kind: "idle" });
    expect(deps.dispatchIntent).toHaveBeenCalledTimes(1);
  });

  it("clears a pending preview when the input text is edited", async () => {
    const sendPrompt = intent({ action: "sendPrompt", prompt: "hi", chat: null });
    deps.parseCommand.mockReturnValue({ kind: "intent", intent: sendPrompt });
    deps.dispatchIntent.mockResolvedValue({ status: "needsConfirmation", summary: "Send prompt to active chat" } as DispatchResult);
    const s = await loadStore();

    s.setOperatorInput("send hi");
    await s.submitOperatorCommand();
    expect(s.operatorView().kind).toBe("preview");

    s.setOperatorInput("send hi there");

    expect(s.operatorView()).toEqual({ kind: "idle" });

    await s.confirmOperatorPreview();

    expect(deps.dispatchIntent).toHaveBeenCalledTimes(1);
  });

  it("clears needsRouter feedback when the input is edited", async () => {
    deps.parseCommand.mockReturnValue({ kind: "needsRouter", reason: "no deterministic match" });
    const s = await loadStore();

    s.setOperatorInput("do something vague");
    await s.submitOperatorCommand();
    expect(s.operatorView().kind).toBe("needsRouter");

    s.setOperatorInput("do something vaguer");

    expect(s.operatorView()).toEqual({ kind: "idle" });
  });

  it("clears a shown result when the input is edited", async () => {
    const openChat = intent({ action: "openChat", chat: "ghost" });
    deps.parseCommand.mockReturnValue({ kind: "intent", intent: openChat });
    deps.dispatchIntent.mockResolvedValue({ status: "failed", message: "nope" } as DispatchResult);
    const s = await loadStore();

    s.setOperatorInput("open chat ghost");
    await s.submitOperatorCommand();
    expect(s.operatorView().kind).toBe("result");

    s.setOperatorInput("open chat ghost2");

    expect(s.operatorView()).toEqual({ kind: "idle" });
  });

  it("closes the dock when the route leaves the workbench", async () => {
    const s = await loadStore();
    const router = (await import("../../src/router")) as unknown as {
      route: () => string;
      navigate: (r: string) => void;
    };

    expect(s.openOperatorDock()).toBe(true);
    s.setOperatorInput("open project app");

    router.navigate("settings");

    expect(s.operatorDockOpen()).toBe(false);
    expect(s.operatorInput()).toBe("");
    expect(s.operatorView()).toEqual({ kind: "idle" });

    router.navigate("workbench");
    expect(s.operatorDockOpen()).toBe(false);
    expect(s.openOperatorDock()).toBe(true);
    expect(s.operatorDockOpen()).toBe(true);
  });

  it("ignores cancel while a confirm is in flight", async () => {
    const sendPrompt = intent({ action: "sendPrompt", prompt: "hi", chat: null });
    deps.parseCommand.mockReturnValue({ kind: "intent", intent: sendPrompt });
    let resolveDispatch!: (r: DispatchResult) => void;
    deps.dispatchIntent
      .mockResolvedValueOnce({ status: "needsConfirmation", summary: "Send prompt to active chat" } as DispatchResult)
      .mockReturnValueOnce(
        new Promise<DispatchResult>((resolve) => {
          resolveDispatch = resolve;
        }),
      );
    const s = await loadStore();

    s.setOperatorInput("send hi");
    await s.submitOperatorCommand();
    const confirming = s.confirmOperatorPreview();
    expect(s.operatorBusy()).toBe(true);

    s.cancelOperatorPreview();
    expect(s.operatorView().kind).toBe("preview");

    resolveDispatch({ status: "done", summary: "Sent prompt to Chat" });
    await confirming;

    expect(s.operatorView()).toEqual({
      kind: "result",
      result: { status: "done", summary: "Sent prompt to Chat" },
    });
  });

  it("ignores a dispatch result that lands after the dock was closed", async () => {
    const openProject = intent({ action: "openProject" });
    deps.parseCommand.mockReturnValue({ kind: "intent", intent: openProject });
    let resolveDispatch!: (r: DispatchResult) => void;
    deps.dispatchIntent.mockReturnValue(
      new Promise<DispatchResult>((resolve) => {
        resolveDispatch = resolve;
      }),
    );
    const s = await loadStore();

    s.openOperatorDock();
    s.setOperatorInput("open project app");
    const pending = s.submitOperatorCommand();
    expect(s.operatorBusy()).toBe(true);

    s.closeOperatorDock();
    resolveDispatch({ status: "done", summary: "Opened project App" });
    await pending;

    expect(s.operatorView()).toEqual({ kind: "idle" });
    expect(s.operatorBusy()).toBe(false);

    s.openOperatorDock();
    expect(s.operatorView()).toEqual({ kind: "idle" });
  });

  it("ignores a slow router result that lands after the dock was closed", async () => {
    const openProject = intent({ action: "openProject" });
    deps.parseCommand.mockReturnValue({ kind: "needsRouter", reason: "no deterministic match" });
    let resolveRoute!: (r: unknown) => void;
    deps.routeCommand.mockReturnValue(
      new Promise((resolve) => {
        resolveRoute = resolve;
      }),
    );
    const s = await loadStore();

    s.openOperatorDock();
    s.setOperatorInput("open App");
    const pending = s.submitOperatorCommand();
    expect(s.operatorBusy()).toBe(true);
    expect(s.operatorView()).toEqual({ kind: "needsRouter", reason: "routing…" });

    s.closeOperatorDock();
    resolveRoute({
      kind: "proposal",
      intent: openProject,
      confidence: 0.7,
      latencyMs: 1000,
    });
    await pending;

    expect(s.operatorView()).toEqual({ kind: "idle" });
    expect(s.operatorBusy()).toBe(false);
    expect(deps.dispatchIntent).not.toHaveBeenCalled();
  });

  it("ignores a late needsConfirmation preview after close", async () => {
    const sendPrompt = intent({ action: "sendPrompt", prompt: "hi", chat: null });
    deps.parseCommand.mockReturnValue({ kind: "intent", intent: sendPrompt });
    let resolveDispatch!: (r: DispatchResult) => void;
    deps.dispatchIntent.mockReturnValue(
      new Promise<DispatchResult>((resolve) => {
        resolveDispatch = resolve;
      }),
    );
    const s = await loadStore();

    s.openOperatorDock();
    s.setOperatorInput("send hi");
    const pending = s.submitOperatorCommand();

    s.closeOperatorDock();
    resolveDispatch({ status: "needsConfirmation", summary: "Send prompt to active chat" });
    await pending;

    expect(s.operatorView()).toEqual({ kind: "idle" });
    await s.confirmOperatorPreview();
    expect(deps.dispatchIntent).toHaveBeenCalledTimes(1);
  });

  it("keeps a failed result visible and does not clear input", async () => {
    const openChat = intent({ action: "openChat", chat: "ghost" });
    deps.parseCommand.mockReturnValue({ kind: "intent", intent: openChat });
    deps.dispatchIntent.mockResolvedValue({ status: "failed", message: "Chat \"ghost\" was not found" } as DispatchResult);
    const s = await loadStore();

    s.setOperatorInput("open chat ghost");
    await s.submitOperatorCommand();

    expect(s.operatorView()).toEqual({
      kind: "result",
      result: { status: "failed", message: "Chat \"ghost\" was not found" },
    });
    expect(s.operatorInput()).toBe("open chat ghost");
  });

  it("refreshes recent activity from the audit list, capped at five", async () => {
    const rows = Array.from({ length: 7 }, (_, i) => ({
      id: `row-${i}`,
      createdAt: i,
      projectRoot: null,
      inputText: `cmd ${i}`,
      intentJson: "{}",
      riskTier: 0,
      status: "done" as const,
      result: null,
    }));
    deps.operatorAuditList.mockResolvedValue(rows);
    const s = await loadStore();

    await s.refreshRecent();

    expect(deps.operatorAuditList).toHaveBeenCalledWith(5);
    expect(s.operatorRecent()).toHaveLength(5);
  });

  it("formats relative times in the machine voice", async () => {
    const s = await loadStore();
    const now = 10_000_000;

    expect(s.relativeTime(now - 5_000, now)).toBe("5s ago");
    expect(s.relativeTime(now - 120_000, now)).toBe("2m ago");
    expect(s.relativeTime(now - 3_600_000, now)).toBe("1h ago");
    expect(s.relativeTime(now - 172_800_000, now)).toBe("2d ago");
  });
});
