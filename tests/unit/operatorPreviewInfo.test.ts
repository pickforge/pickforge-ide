// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OperatorAction, OperatorIntent } from "../../src/lib/operatorIntent";

const memory = vi.hoisted(() => {
  const values = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
    clear: () => values.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage;
  return values;
});

// Only the swarm-lane assignment is mocked — it's covered directly in swarm.test.ts
// (providersFor/resolveModel), and mocking it here isolates operatorPreviewInfo's own
// label-formatting/dedup/honesty logic from that assignment logic. agentModels,
// agentBackends, and agentPricing stay real: they're lightweight, pure(ish), and this
// is exactly where a real catalog/pricing-table mismatch would otherwise go unnoticed.
const swarmDeps = vi.hoisted(() => ({
  providersFor: vi.fn(),
  resolveModel: vi.fn(),
}));
vi.mock("../../src/stores/swarm", () => ({
  providersFor: swarmDeps.providersFor,
  resolveModel: swarmDeps.resolveModel,
}));

function intent(action: OperatorAction): OperatorIntent {
  return { v: 2, id: `intent-${action.action}`, provenance: "typed", confidence: 1, projectRef: null, action };
}

beforeEach(() => {
  memory.clear();
  swarmDeps.providersFor.mockReset();
  swarmDeps.resolveModel.mockReset();
});

describe("runTargetLabel", () => {
  it("resolves createChat's explicit provider/model to a catalog display label", async () => {
    const { runTargetLabel } = await import("../../src/lib/operatorPreviewInfo");

    const label = runTargetLabel(
      intent({ action: "createChat", provider: "claude", model: "claude-haiku-4-5" }),
    );

    expect(label).toBe("Claude Code · Haiku 4.5");
  });

  it("falls back to the raw model id when it isn't in the catalog", async () => {
    const { runTargetLabel } = await import("../../src/lib/operatorPreviewInfo");

    const label = runTargetLabel(
      intent({ action: "createChat", provider: "codex", model: "gpt-9000-mystery" }),
    );

    expect(label).toBe("Codex · gpt-9000-mystery");
  });

  it("falls back to the persisted default model when createChat leaves model unset", async () => {
    const { runTargetLabel } = await import("../../src/lib/operatorPreviewInfo");

    const label = runTargetLabel(intent({ action: "createChat", provider: "claude", model: null }));

    expect(label).toBe("Claude Code · Haiku 4.5");
  });

  it("returns null for actions with no provider/model concept", async () => {
    const { runTargetLabel } = await import("../../src/lib/operatorPreviewInfo");

    expect(runTargetLabel(intent({ action: "openProject" }))).toBeNull();
    expect(runTargetLabel(intent({ action: "takeScreenshot" }))).toBeNull();
    expect(
      runTargetLabel(intent({ action: "sendPrompt", prompt: "hi", chat: null })),
    ).toBeNull();
  });

  it("labels a single-provider startSwarm proposal with its resolved worker model", async () => {
    swarmDeps.providersFor.mockReturnValue(["claudeCode", "claudeCode", "claudeCode"]);
    swarmDeps.resolveModel.mockReturnValue({ ok: true, model: "claude-haiku-4-5" });
    const { runTargetLabel } = await import("../../src/lib/operatorPreviewInfo");

    const label = runTargetLabel(
      intent({ action: "startSwarm", mode: "scout", count: 3, goal: "g", provider: "claude" }),
    );

    expect(label).toBe("Claude Code · Haiku 4.5");
    expect(swarmDeps.providersFor).toHaveBeenCalledWith("claudeCode", 3, null);
  });

  it("dedupes a mixed startSwarm proposal to its distinct provider/model pairs", async () => {
    swarmDeps.providersFor.mockReturnValue(["claudeCode", "codex", "claudeCode", "codex"]);
    swarmDeps.resolveModel.mockImplementation((provider: string) =>
      provider === "claudeCode"
        ? { ok: true, model: "claude-haiku-4-5" }
        : { ok: true, model: "gpt-5.3-codex-spark" },
    );
    const { runTargetLabel } = await import("../../src/lib/operatorPreviewInfo");

    const label = runTargetLabel(
      intent({ action: "startSwarm", mode: "review", count: 4, goal: "g", provider: "mixed" }),
    );

    expect(label).toBe("Claude Code · Haiku 4.5 + Codex · GPT-5.3 Codex Spark");
    expect(swarmDeps.providersFor).toHaveBeenCalledWith("mixed", 4, null);
  });
});

describe("swarmFanoutEstimate", () => {
  it("returns null for non-swarm actions", async () => {
    const { swarmFanoutEstimate } = await import("../../src/lib/operatorPreviewInfo");

    expect(swarmFanoutEstimate(intent({ action: "openProject" }))).toBeNull();
  });

  it("estimates a priced fanout across the inferred worker count", async () => {
    swarmDeps.providersFor.mockReturnValue(["claudeCode", "claudeCode", "claudeCode"]);
    swarmDeps.resolveModel.mockReturnValue({ ok: true, model: "claude-haiku-4-5" });
    const { swarmFanoutEstimate } = await import("../../src/lib/operatorPreviewInfo");

    const estimate = swarmFanoutEstimate(
      intent({ action: "startSwarm", mode: "scout", count: 3, goal: "g", provider: "claude" }),
    );

    expect(estimate?.count).toBe(3);
    expect(estimate?.costUsd).not.toBeNull();
    expect(estimate!.costUsd!).toBeGreaterThan(0);
  });

  it("is honest-unknown when any assigned lane's model isn't in the pricing table", async () => {
    swarmDeps.providersFor.mockReturnValue(["claudeCode", "codex"]);
    swarmDeps.resolveModel.mockImplementation((provider: string) =>
      // claude-sonnet-5 has no entry in agentPricing's MODEL_PRICING table.
      provider === "claudeCode"
        ? { ok: true, model: "claude-sonnet-5" }
        : { ok: true, model: "gpt-5.3-codex-spark" },
    );
    const { swarmFanoutEstimate } = await import("../../src/lib/operatorPreviewInfo");

    const estimate = swarmFanoutEstimate(
      intent({ action: "startSwarm", mode: "review", count: 2, goal: "g", provider: "mixed" }),
    );

    expect(estimate).toEqual({ count: 2, costUsd: null });
  });
});
