import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OperatorAction, OperatorIntent } from "../../src/lib/operatorIntent";
import { previewPayloadLines } from "../../src/components/operator/previewPayload";
import type { DispatchResult } from "../../src/stores/operator";

const deps = vi.hoisted(() => ({
  parseCommand: vi.fn(),
  routeCommand: vi.fn(),
  dispatchIntent: vi.fn(),
  selectWidgetCandidate: vi.fn(),
  discardWidgetSelection: vi.fn(),
  flagEnabled: vi.fn(),
  operatorAuditList: vi.fn(),
  operatorAuditUpdate: vi.fn(),
  refreshCreditBalance: vi.fn(),
  creditBalance: null as number | null,
}));

vi.mock("../../src/lib/operatorParser", () => ({
  parseCommand: deps.parseCommand,
}));
vi.mock("../../src/lib/operatorRouter", () => ({
  routeCommand: deps.routeCommand,
}));
vi.mock("../../src/stores/operator", () => ({
  dispatchIntent: deps.dispatchIntent,
  selectWidgetCandidate: deps.selectWidgetCandidate,
  discardWidgetSelection: deps.discardWidgetSelection,
}));
vi.mock("../../src/stores/flags", () => ({
  flagEnabled: deps.flagEnabled,
}));
vi.mock("../../src/stores/credits", () => ({
  refreshCreditBalance: deps.refreshCreditBalance,
  creditBalanceCents: () => deps.creditBalance,
}));
vi.mock("../../src/lib/db", () => ({
  operatorAuditList: deps.operatorAuditList,
  operatorAuditUpdate: deps.operatorAuditUpdate,
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

async function flushAsync() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function auditUpdatesFor(id: string) {
  return deps.operatorAuditUpdate.mock.calls.filter(([rowId]) => rowId === id);
}

beforeEach(() => {
  deps.parseCommand.mockReset();
  deps.routeCommand.mockReset().mockResolvedValue({ kind: "unconfigured" });
  deps.dispatchIntent.mockReset();
  deps.selectWidgetCandidate.mockReset();
  deps.discardWidgetSelection.mockReset();
  deps.flagEnabled.mockReset().mockReturnValue(true);
  deps.operatorAuditList.mockReset().mockResolvedValue([]);
  deps.operatorAuditUpdate.mockReset().mockResolvedValue(undefined);
  deps.refreshCreditBalance.mockReset().mockResolvedValue(undefined);
  deps.creditBalance = null;
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

  it("surfaces validation errors without routing", async () => {
    deps.parseCommand.mockReturnValue({
      kind: "validationError",
      reason: "swarm count must be 1-5",
    });
    const s = await loadStore();

    s.setOperatorInput("start scout swarm of 6 map the repo");
    await s.submitOperatorCommand();

    expect(s.operatorView()).toEqual({
      kind: "validationError",
      reason: "swarm count must be 1-5",
    });
    expect(deps.routeCommand).not.toHaveBeenCalled();
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
      auditId: "audit-routed",
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
      auditId: "audit-routed",
    });
    expect(previewPayloadLines(sendPrompt)).toContain("prompt: hi");
  });

  it("formats compact preview payloads for risky composed actions", () => {
    expect(previewPayloadLines(intent({
      action: "steerRun",
      run: "app",
      instruction: "focus on the failing widget test",
    }))).toEqual([
      "run: app",
      "instruction: focus on the failing widget test",
    ]);
    expect(previewPayloadLines(intent({
      action: "startSwarm",
      mode: "review",
      count: 3,
      goal: "review the router diff",
      provider: "mixed",
    }))).toEqual([
      "review swarm · 3 lanes",
      "goal: review the router diff",
      "provider: mixed",
    ]);
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

  it("surfaces a hosted needsCredits result as a quiet buy-credits state", async () => {
    deps.parseCommand.mockReturnValue({ kind: "needsRouter", reason: "no deterministic match" });
    deps.routeCommand.mockResolvedValue({ kind: "needsCredits", balance: 40 });
    const s = await loadStore();

    s.setOperatorInput("open the billing project");
    await s.submitOperatorCommand();

    expect(s.operatorView()).toEqual({ kind: "needsCredits", balance: 40 });
    expect(deps.dispatchIntent).not.toHaveBeenCalled();
  });

  it("records hosted cost and refreshed balance after a hosted route", async () => {
    const openProject = intent({ action: "openProject" });
    deps.parseCommand.mockReturnValue({ kind: "needsRouter", reason: "no deterministic match" });
    deps.routeCommand.mockResolvedValue({
      kind: "proposal",
      intent: openProject,
      confidence: 0.9,
      latencyMs: 900,
      costCents: 2,
    });
    deps.dispatchIntent.mockResolvedValue({ status: "done", summary: "Opened project Billing" } as DispatchResult);
    deps.refreshCreditBalance.mockImplementation(async () => {
      deps.creditBalance = 148;
    });
    const s = await loadStore();

    s.setOperatorInput("open Billing");
    await s.submitOperatorCommand();

    expect(deps.refreshCreditBalance).toHaveBeenCalled();
    expect(s.operatorRouteMeta()).toEqual({ costCents: 2, balanceCents: 148 });
    expect(s.operatorView()).toMatchObject({ kind: "result" });
  });

  it("surfaces the routing cost on an unclear hosted answer", async () => {
    deps.parseCommand.mockReturnValue({ kind: "needsRouter", reason: "no deterministic match" });
    deps.routeCommand.mockResolvedValue({ kind: "unclear", reason: "too vague", costCents: 1 });
    deps.refreshCreditBalance.mockImplementation(async () => {
      deps.creditBalance = 148;
    });
    const s = await loadStore();

    s.setOperatorInput("make it better");
    await s.submitOperatorCommand();

    expect(deps.refreshCreditBalance).toHaveBeenCalled();
    expect(s.operatorView()).toEqual({ kind: "needsRouter", reason: "too vague" });
    expect(s.operatorRouteMeta()).toEqual({ costCents: 1, balanceCents: 148 });
  });

  it("still refreshes the balance when a hosted route settles after the dock closed", async () => {
    const openProject = intent({ action: "openProject" });
    deps.parseCommand.mockReturnValue({ kind: "needsRouter", reason: "no deterministic match" });
    let resolveRoute!: (r: unknown) => void;
    deps.routeCommand.mockReturnValue(
      new Promise((resolve) => {
        resolveRoute = resolve;
      }),
    );
    deps.refreshCreditBalance.mockResolvedValue(undefined);
    const s = await loadStore();

    s.openOperatorDock();
    s.setOperatorInput("open App");
    const pending = s.submitOperatorCommand();

    s.closeOperatorDock();
    resolveRoute({
      kind: "proposal",
      intent: openProject,
      confidence: 0.9,
      latencyMs: 900,
      costCents: 2,
    });
    await pending;

    // The money truth reconciles even though the dock is gone…
    expect(deps.refreshCreditBalance).toHaveBeenCalled();
    // …while the dropped UI stays cleared and nothing dispatches.
    expect(s.operatorRouteMeta()).toBeNull();
    expect(s.operatorView()).toEqual({ kind: "idle" });
    expect(deps.dispatchIntent).not.toHaveBeenCalled();
  });

  it("keeps the routing cost meta on a tier-1 hosted preview so the card can show it", async () => {
    const sendPrompt = intent({ action: "sendPrompt", prompt: "hi", chat: null });
    deps.parseCommand.mockReturnValue({ kind: "needsRouter", reason: "no deterministic match" });
    deps.routeCommand.mockResolvedValue({
      kind: "proposal",
      intent: sendPrompt,
      confidence: 0.74,
      latencyMs: 1300,
      costCents: 2,
    });
    deps.dispatchIntent.mockResolvedValue({
      status: "needsConfirmation",
      summary: "Send prompt to active chat",
      auditId: "audit-routed",
    } as DispatchResult);
    deps.refreshCreditBalance.mockImplementation(async () => {
      deps.creditBalance = 148;
    });
    const s = await loadStore();

    s.setOperatorInput("tell it hi");
    await s.submitOperatorCommand();

    expect(s.operatorView()).toMatchObject({ kind: "preview", auditId: "audit-routed" });
    expect(s.operatorRouteMeta()).toEqual({ costCents: 2, balanceCents: 148 });
  });

  it("clears the stale hosted cost meta when a routed preview is cancelled", async () => {
    const sendPrompt = intent({ action: "sendPrompt", prompt: "hi", chat: null });
    deps.parseCommand.mockReturnValue({ kind: "needsRouter", reason: "no deterministic match" });
    deps.routeCommand.mockResolvedValue({
      kind: "proposal",
      intent: sendPrompt,
      confidence: 0.74,
      latencyMs: 1300,
      costCents: 3,
    });
    deps.dispatchIntent.mockResolvedValue({
      status: "needsConfirmation",
      summary: "Send prompt to active chat",
      auditId: "audit-routed",
    } as DispatchResult);
    deps.refreshCreditBalance.mockImplementation(async () => {
      deps.creditBalance = 100;
    });
    const s = await loadStore();

    s.setOperatorInput("tell it hi");
    await s.submitOperatorCommand();
    expect(s.operatorView().kind).toBe("preview");
    expect(s.operatorRouteMeta()).toEqual({ costCents: 3, balanceCents: 100 });

    await s.cancelOperatorPreview();

    expect(s.operatorView()).toEqual({ kind: "idle" });
    expect(s.operatorRouteMeta()).toBeNull();
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
      .mockResolvedValueOnce({
        status: "needsConfirmation",
        summary: "Send prompt to active chat",
        auditId: "audit-1",
      } as DispatchResult)
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
      reuseAuditId: "audit-1",
    });
    expect(s.operatorView()).toEqual({
      kind: "result",
      result: { status: "done", summary: "Sent prompt to Chat" },
    });
    expect(s.operatorInput()).toBe("");
  });

  it("marks a cancelled preview audit as denied and refreshes recent activity", async () => {
    const startSwarm = intent({ action: "startSwarm", mode: "scout", count: 3, goal: "g", provider: "mixed" });
    const awaitingRow = {
      id: "audit-1",
      createdAt: 1,
      projectRoot: "/repo/app",
      inputText: "start scout swarm g",
      intentJson: "{}",
      riskTier: 1,
      status: "needs_confirmation" as const,
      result: "Start scout swarm with 3 lanes",
    };
    deps.parseCommand.mockReturnValue({ kind: "intent", intent: startSwarm });
    deps.dispatchIntent.mockResolvedValue({
      status: "needsConfirmation",
      summary: "Start scout swarm with 3 lanes",
      auditId: "audit-1",
    } as DispatchResult);
    deps.operatorAuditList
      .mockResolvedValueOnce([awaitingRow])
      .mockResolvedValueOnce([{ ...awaitingRow, status: "denied" as const, result: "dismissed" }]);
    const s = await loadStore();

    s.setOperatorInput("start scout swarm g");
    await s.submitOperatorCommand();
    expect(s.operatorView().kind).toBe("preview");

    await s.cancelOperatorPreview();

    expect(s.operatorView()).toEqual({ kind: "idle" });
    expect(deps.dispatchIntent).toHaveBeenCalledTimes(1);
    expect(deps.operatorAuditUpdate).toHaveBeenCalledWith("audit-1", "denied", "dismissed");
    expect(s.operatorRecent().some((row) => row.status === "needs_confirmation")).toBe(false);
    expect(s.operatorRecent()[0]).toMatchObject({ id: "audit-1", status: "denied" });
  });

  it("picks an ambiguous widget candidate and settles the same audit row", async () => {
    const selectWidget = intent({ action: "selectWidget", description: "the login button" });
    deps.parseCommand.mockReturnValue({ kind: "intent", intent: selectWidget });
    deps.dispatchIntent.mockResolvedValue({
      status: "needsConfirmation",
      summary: "Choose the matching widget",
      auditId: "audit-widget",
      candidates: [
        { index: 4, className: "LoginButton", label: "Sign in" },
        { index: 8, className: "LoginButton", label: "Create account" },
      ],
    } as DispatchResult);
    deps.selectWidgetCandidate.mockResolvedValue({
      status: "done",
      summary: "Selected LoginButton — 'Create account'",
    } as DispatchResult);
    const s = await loadStore();

    s.setOperatorInput("select the login button");
    await s.submitOperatorCommand();
    expect(s.operatorView()).toMatchObject({ kind: "preview", auditId: "audit-widget" });

    await s.pickOperatorWidgetCandidate(8);

    expect(deps.selectWidgetCandidate).toHaveBeenCalledWith("audit-widget", 8);
    expect(deps.operatorAuditUpdate).toHaveBeenCalledWith(
      "audit-widget",
      "done",
      "Selected LoginButton — 'Create account'",
    );
    expect(s.operatorView()).toEqual({
      kind: "result",
      result: { status: "done", summary: "Selected LoginButton — 'Create account'" },
    });
  });

  it("dismisses an ambiguous widget candidate view and discards its local mapping", async () => {
    const selectWidget = intent({ action: "selectWidget", description: "the login button" });
    deps.parseCommand.mockReturnValue({ kind: "intent", intent: selectWidget });
    deps.dispatchIntent.mockResolvedValue({
      status: "needsConfirmation",
      summary: "Choose the matching widget",
      auditId: "audit-widget",
      candidates: [{ index: 4, className: "LoginButton", label: "Sign in" }],
    } as DispatchResult);
    const s = await loadStore();

    s.setOperatorInput("select the login button");
    await s.submitOperatorCommand();
    await s.cancelOperatorPreview();

    expect(deps.discardWidgetSelection).toHaveBeenCalledWith("audit-widget");
    expect(deps.operatorAuditUpdate).toHaveBeenCalledWith("audit-widget", "denied", "dismissed");
    expect(s.operatorView()).toEqual({ kind: "idle" });
  });

  it("maps candidate-view keyboard choices one through three to candidate indexes", async () => {
    const s = await loadStore();
    const candidates = [
      { index: 4, className: "LoginButton", label: "Sign in" },
      { index: 8, className: "LoginButton", label: "Create account" },
    ];

    expect(s.candidateIndexForKey("1", candidates)).toBe(4);
    expect(s.candidateIndexForKey("2", candidates)).toBe(8);
    expect(s.candidateIndexForKey("3", candidates)).toBeNull();
    expect(s.candidateIndexForKey("Enter", candidates)).toBeNull();
  });

  it("marks a pending preview audit as denied when the input text is edited", async () => {
    const sendPrompt = intent({ action: "sendPrompt", prompt: "hi", chat: null });
    deps.parseCommand.mockReturnValue({ kind: "intent", intent: sendPrompt });
    deps.dispatchIntent.mockResolvedValue({
      status: "needsConfirmation",
      summary: "Send prompt to active chat",
      auditId: "audit-1",
    } as DispatchResult);
    const s = await loadStore();

    s.setOperatorInput("send hi");
    await s.submitOperatorCommand();
    expect(s.operatorView().kind).toBe("preview");

    s.setOperatorInput("send hi there");
    await flushAsync();

    expect(s.operatorView()).toEqual({ kind: "idle" });
    expect(deps.operatorAuditUpdate).toHaveBeenCalledWith("audit-1", "denied", "dismissed");

    await s.confirmOperatorPreview();

    expect(deps.dispatchIntent).toHaveBeenCalledTimes(1);
  });

  it("marks a pending preview audit as denied when the dock closes", async () => {
    const sendPrompt = intent({ action: "sendPrompt", prompt: "hi", chat: null });
    deps.parseCommand.mockReturnValue({ kind: "intent", intent: sendPrompt });
    deps.dispatchIntent.mockResolvedValue({
      status: "needsConfirmation",
      summary: "Send prompt to active chat",
      auditId: "audit-1",
    } as DispatchResult);
    const s = await loadStore();

    s.openOperatorDock();
    s.setOperatorInput("send hi");
    await s.submitOperatorCommand();
    expect(s.operatorView().kind).toBe("preview");

    s.closeOperatorDock();
    await flushAsync();

    expect(s.operatorDockOpen()).toBe(false);
    expect(s.operatorView()).toEqual({ kind: "idle" });
    expect(deps.operatorAuditUpdate).toHaveBeenCalledWith("audit-1", "denied", "dismissed");
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
      .mockResolvedValueOnce({
        status: "needsConfirmation",
        summary: "Send prompt to active chat",
        auditId: "audit-1",
      } as DispatchResult)
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
    expect(deps.dispatchIntent).toHaveBeenLastCalledWith(sendPrompt, {
      confirmed: true,
      inputText: "send hi",
      reuseAuditId: "audit-1",
    });

    void s.cancelOperatorPreview();
    expect(s.operatorView().kind).toBe("preview");

    resolveDispatch({ status: "done", summary: "Sent prompt to Chat" });
    await confirming;

    expect(s.operatorView()).toEqual({
      kind: "result",
      result: { status: "done", summary: "Sent prompt to Chat" },
    });
  });

  it("does not deny the preview audit when the dock closes during confirm", async () => {
    const sendPrompt = intent({ action: "sendPrompt", prompt: "hi", chat: null });
    deps.parseCommand.mockReturnValue({ kind: "intent", intent: sendPrompt });
    let resolveDispatch!: (r: DispatchResult) => void;
    deps.dispatchIntent
      .mockResolvedValueOnce({
        status: "needsConfirmation",
        summary: "Send prompt to active chat",
        auditId: "audit-1",
      } as DispatchResult)
      .mockReturnValueOnce(
        new Promise<DispatchResult>((resolve) => {
          resolveDispatch = resolve;
        }),
      );
    const s = await loadStore();

    s.openOperatorDock();
    s.setOperatorInput("send hi");
    await s.submitOperatorCommand();
    const confirming = s.confirmOperatorPreview();
    expect(s.operatorBusy()).toBe(true);
    expect(deps.dispatchIntent).toHaveBeenLastCalledWith(sendPrompt, {
      confirmed: true,
      inputText: "send hi",
      reuseAuditId: "audit-1",
    });

    s.closeOperatorDock();
    await flushAsync();
    expect(deps.operatorAuditUpdate).not.toHaveBeenCalledWith("audit-1", "denied", "dismissed");

    resolveDispatch({ status: "done", summary: "Sent prompt to Chat" });
    await confirming;

    expect(auditUpdatesFor("audit-1")).toEqual([]);
    expect(s.operatorDockOpen()).toBe(false);
    expect(s.operatorView()).toEqual({ kind: "idle" });
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

  it("denies a stale needsConfirmation audit after the dock closes", async () => {
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
    resolveDispatch({ status: "needsConfirmation", summary: "Send prompt to active chat", auditId: "audit-1" });
    await pending;
    await flushAsync();

    expect(s.operatorView()).toEqual({ kind: "idle" });
    await s.confirmOperatorPreview();
    expect(deps.dispatchIntent).toHaveBeenCalledTimes(1);
    expect(auditUpdatesFor("audit-1")).toEqual([["audit-1", "denied", "dismissed"]]);
  });

  it("discards stale ambiguous widget candidates after the dock closes", async () => {
    const selectWidget = intent({ action: "selectWidget", description: "the login button" });
    deps.parseCommand.mockReturnValue({ kind: "intent", intent: selectWidget });
    let resolveDispatch!: (r: DispatchResult) => void;
    deps.dispatchIntent.mockReturnValue(
      new Promise<DispatchResult>((resolve) => {
        resolveDispatch = resolve;
      }),
    );
    const s = await loadStore();

    s.openOperatorDock();
    s.setOperatorInput("select the login button");
    const pending = s.submitOperatorCommand();

    s.closeOperatorDock();
    resolveDispatch({
      status: "needsConfirmation",
      summary: "Choose the matching widget",
      auditId: "audit-widget-stale",
      candidates: [{ index: 4, className: "LoginButton", label: "Sign in" }],
    });
    await pending;
    await flushAsync();

    expect(s.operatorView()).toEqual({ kind: "idle" });
    expect(deps.discardWidgetSelection).toHaveBeenCalledWith("audit-widget-stale");
    expect(auditUpdatesFor("audit-widget-stale")).toEqual([
      ["audit-widget-stale", "denied", "dismissed"],
    ]);
    await s.pickOperatorWidgetCandidate(4);
    expect(deps.selectWidgetCandidate).not.toHaveBeenCalled();
  });

  it("denies a stale routed needsConfirmation audit after the dock closes", async () => {
    const sendPrompt = intent({ action: "sendPrompt", prompt: "hi", chat: null });
    deps.parseCommand.mockReturnValue({ kind: "needsRouter", reason: "no deterministic match" });
    deps.routeCommand.mockResolvedValue({
      kind: "proposal",
      intent: sendPrompt,
      confidence: 0.72,
      latencyMs: 1000,
    });
    let resolveDispatch!: (r: DispatchResult) => void;
    deps.dispatchIntent.mockReturnValue(
      new Promise<DispatchResult>((resolve) => {
        resolveDispatch = resolve;
      }),
    );
    const s = await loadStore();

    s.openOperatorDock();
    s.setOperatorInput("tell it hi");
    const pending = s.submitOperatorCommand();
    await flushAsync();
    expect(deps.dispatchIntent).toHaveBeenCalledWith(sendPrompt, { inputText: "tell it hi" });

    s.closeOperatorDock();
    resolveDispatch({
      status: "needsConfirmation",
      summary: "Send prompt to active chat",
      auditId: "audit-routed",
    });
    await pending;
    await flushAsync();

    expect(s.operatorView()).toEqual({ kind: "idle" });
    expect(auditUpdatesFor("audit-routed")).toEqual([["audit-routed", "denied", "dismissed"]]);
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
