// @vitest-environment jsdom
// Mounts the exported preview sub-component directly (see OperatorDock.tsx's export
// comment) so the provider/model, fanout, and egress additions (#195) can be asserted
// on as rendered DOM, without pulling in the whole dock's keyboard trap/voice wiring.
// operatorPreviewInfo's own formatting/honesty logic is covered separately in
// operatorPreviewInfo.test.ts; this file is about the component's wiring/markup only.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import type { OperatorIntent } from "../../src/lib/operatorIntent";
import type { DockView } from "../../src/stores/operatorDock";
import type { FanoutCostEstimate } from "../../src/lib/operatorPreviewInfo";
import type { HostedRouteMeta } from "../../src/stores/operatorDock";

const deps = vi.hoisted(() => ({
  operatorBusy: vi.fn(() => false),
  operatorRouteMeta: vi.fn<() => HostedRouteMeta | null>(() => null),
  runTargetLabel: vi.fn<() => string | null>(() => null),
  swarmFanoutEstimate: vi.fn<() => FanoutCostEstimate | null>(() => null),
}));

vi.mock("../../src/stores/operatorDock", () => ({
  operatorBusy: deps.operatorBusy,
  operatorRouteMeta: deps.operatorRouteMeta,
  cancelOperatorPreview: vi.fn(),
  confirmOperatorPreview: vi.fn(),
  pickOperatorWidgetCandidate: vi.fn(),
  candidateIndexForKey: vi.fn(),
}));

vi.mock("../../src/lib/operatorPreviewInfo", () => ({
  runTargetLabel: deps.runTargetLabel,
  swarmFanoutEstimate: deps.swarmFanoutEstimate,
}));

let root: HTMLDivElement;
let dispose: (() => void) | undefined;

beforeEach(() => {
  root = document.createElement("div");
  document.body.appendChild(root);
  deps.operatorBusy.mockReturnValue(false);
  deps.operatorRouteMeta.mockReturnValue(null);
  deps.runTargetLabel.mockReturnValue(null);
  deps.swarmFanoutEstimate.mockReturnValue(null);
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  root.remove();
});

function startSwarmIntent(): OperatorIntent {
  return {
    v: 2,
    id: "intent-1",
    provenance: "typed",
    confidence: 1,
    projectRef: null,
    action: { action: "startSwarm", mode: "scout", count: 3, goal: "investigate", provider: "mixed" },
  };
}

async function mount(view: Extract<DockView, { kind: "preview" }>) {
  const { OperatorPreviewView } = await import("../../src/components/operator/OperatorDock");
  dispose = render(() => <OperatorPreviewView view={() => view} />, root);
  return root;
}

function preview(intent: OperatorIntent): Extract<DockView, { kind: "preview" }> {
  return {
    kind: "preview",
    intent,
    summary: "Start a scout swarm",
    inputText: "investigate the failing test",
    auditId: "audit-1",
  };
}

function metaTexts(): string[] {
  return Array.from(root.querySelectorAll(".pf-op-meta")).map((el) => el.textContent ?? "");
}

describe("OperatorPreviewView", () => {
  it("renders the resolved provider/model line when a target is known", async () => {
    deps.runTargetLabel.mockReturnValue("Claude Code · Haiku 4.5");

    await mount(preview(startSwarmIntent()));

    expect(metaTexts()).toContain("runs on: Claude Code · Haiku 4.5");
  });

  it("omits the runs-on line for actions with no provider/model concept", async () => {
    deps.runTargetLabel.mockReturnValue(null);

    await mount(preview(startSwarmIntent()));

    expect(metaTexts().some((t) => t.startsWith("runs on:"))).toBe(false);
  });

  it("shows a fanout estimate distinct from the routing charge line", async () => {
    deps.swarmFanoutEstimate.mockReturnValue({ count: 3, costUsd: 0.42 });
    deps.operatorRouteMeta.mockReturnValue({ costCents: 2, balanceCents: 100 });

    await mount(preview(startSwarmIntent()));

    const texts = metaTexts();
    expect(texts).toContain("fanout: ~$0.42 for 3 workers");
    expect(texts).toContain("routed · 2¢ · 100 credits left · charged for routing; confirm runs the action");
  });

  it("shows an honest 'unknown' fanout cost instead of a fabricated number", async () => {
    deps.swarmFanoutEstimate.mockReturnValue({ count: 2, costUsd: null });

    await mount(preview(startSwarmIntent()));

    expect(metaTexts()).toContain("fanout: unknown for 2 workers");
  });

  it("shows the egress indicator for a hosted route, reflecting the reported allowlist", async () => {
    deps.operatorRouteMeta.mockReturnValue({
      costCents: 2,
      balanceCents: 100,
      egressKeys: ["prompt", "project name"],
    });

    await mount(preview(startSwarmIntent()));

    expect(metaTexts()).toContain("sends: prompt + project name");
  });

  it("shows no egress line at all for a local route (no route meta)", async () => {
    deps.operatorRouteMeta.mockReturnValue(null);

    await mount(preview(startSwarmIntent()));

    expect(metaTexts().some((t) => t.startsWith("sends:"))).toBe(false);
    expect(metaTexts().some((t) => t.startsWith("routed ·"))).toBe(false);
  });
});
