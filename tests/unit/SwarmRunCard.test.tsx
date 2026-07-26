// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";

// `SwarmRunCard` pulls in `stores/workspace`, which reads localStorage at
// module-eval time. jsdom's stub is not callable here, so install one before
// that import graph is evaluated.
vi.hoisted(() => {
  const values = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
    clear: () => values.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage;
});

import { SwarmRunCard } from "../../src/components/chat/SwarmRunCard";
import type { SwarmLaneSnapshot, SwarmRunSnapshot } from "../../src/lib/mcp";

function lane(overrides: Partial<SwarmLaneSnapshot> = {}): SwarmLaneSnapshot {
  return {
    id: "lane-1",
    chatId: "chat-1",
    provider: "claude",
    model: "claude-opus-5",
    title: "scout the parser",
    status: "running",
    summary: null,
    error: null,
    updatedAt: 1_000,
    ...overrides,
  };
}

function run(overrides: Partial<SwarmRunSnapshot> = {}): SwarmRunSnapshot {
  return {
    runId: "run-1",
    projectRoot: "/project",
    goal: "find the bug",
    requestedCount: 2,
    model: "claude-opus-5",
    providerPreference: "claude",
    mode: "scout",
    source: "chat",
    originChatId: "chat-0",
    status: "running",
    synthesisStatus: "idle",
    synthesisError: null,
    synthesizedAt: null,
    lanes: [lane()],
    error: null,
    createdAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  };
}

let root: HTMLDivElement;
let dispose: (() => void) | undefined;

beforeEach(() => {
  root = document.createElement("div");
  document.body.appendChild(root);
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  root.remove();
});

function summary(): HTMLButtonElement {
  const el = root.querySelector<HTMLButtonElement>(".pf-chat-swarm-summary");
  if (!el) throw new Error("swarm summary button not rendered");
  return el;
}

describe("SwarmRunCard", () => {
  it("keeps an expanded run open when the store rebuilds that run's object (#363)", () => {
    const [runs, setRuns] = createSignal<SwarmRunSnapshot[]>([run()]);
    dispose = render(() => <SwarmRunCard runs={runs()} />, root);

    summary().click();
    expect(summary().getAttribute("aria-expanded")).toBe("true");

    // `rememberRun` rebuilds the changed run as a NEW object on every lane
    // update, so `For` disposes and recreates that row. A local expansion
    // signal died with it; keyed-by-runId state must not.
    setRuns([run({ lanes: [lane({ status: "completed", summary: "done" })], updatedAt: 2_000 })]);

    expect(summary().getAttribute("aria-expanded")).toBe("true");
    expect(root.querySelector(".pf-chat-swarm-body")).not.toBeNull();
  });

  it("does not leak one run's expansion onto another run", () => {
    const [runs, setRuns] = createSignal<SwarmRunSnapshot[]>([run()]);
    dispose = render(() => <SwarmRunCard runs={runs()} />, root);

    summary().click();
    expect(summary().getAttribute("aria-expanded")).toBe("true");

    setRuns([run({ runId: "run-2" }), run()]);

    const expanded = Array.from(
      root.querySelectorAll<HTMLButtonElement>(".pf-chat-swarm-summary"),
    ).map((el) => el.getAttribute("aria-expanded"));
    expect(expanded).toEqual(["false", "true"]);
  });

  it("rotates one chevron rather than swapping two icons (#372)", () => {
    dispose = render(() => <SwarmRunCard runs={[run()]} />, root);

    const chevrons = () => root.querySelectorAll(".pf-chat-swarm-summary-chevron svg");
    expect(chevrons()).toHaveLength(1);
    expect(root.querySelector(".pf-chat-swarm-card--open")).toBeNull();

    summary().click();
    // Same single node — the open hook drives a transform, it does not swap
    // the icon for a different one.
    expect(chevrons()).toHaveLength(1);
    expect(root.querySelector(".pf-chat-swarm-card--open")).not.toBeNull();
  });

  it("still collapses on a second click, holding the body for the animation (#372)", async () => {
    vi.useFakeTimers();
    dispose = render(() => <SwarmRunCard runs={[run()]} />, root);

    summary().click();
    expect(summary().getAttribute("aria-expanded")).toBe("true");

    summary().click();
    // The state flips at once; the body lingers just long enough for the
    // collapse to play, instead of vanishing and snapping the rows below.
    expect(summary().getAttribute("aria-expanded")).toBe("false");
    expect(root.querySelector(".pf-chat-swarm-card--open")).toBeNull();

    await vi.advanceTimersByTimeAsync(400);
    expect(root.querySelector(".pf-chat-swarm-body")).toBeNull();
    vi.useRealTimers();
  });
});
