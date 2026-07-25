import { describe, expect, it } from "vitest";
import type { Chat } from "../../src/lib/db";
import type { SwarmLaneSnapshot, SwarmRunSnapshot } from "../../src/lib/mcp";
import {
  type CardAgentChatLike,
  cardBrief,
  cardContextEdge,
  cardCost,
  cardLanes,
  cardSwarmRun,
  laneTickTone,
} from "../../src/stores/flatWorkCard";

const now = 1_800_000_000_000;

function chat(overrides: Partial<Chat> = {}): Chat {
  return {
    chatId: "chat-1",
    projectRoot: "/proj/a",
    title: "A chat",
    titleSource: "user",
    titleUpdatedAt: now,
    kind: "agent",
    agentId: "claudeCode",
    skillId: null,
    sessionId: null,
    labelsJson: null,
    status: null,
    taskBriefText: null,
    createdAt: now,
    lastActivityAt: now,
    sortOrder: 0,
    ...overrides,
  };
}

function lane(overrides: Partial<SwarmLaneSnapshot> = {}): SwarmLaneSnapshot {
  return {
    id: "lane-1",
    chatId: "lane-chat-1",
    provider: "claudeCode",
    model: null,
    title: "Code map",
    status: "queued",
    summary: null,
    error: null,
    updatedAt: now,
    ...overrides,
  };
}

function run(overrides: Partial<SwarmRunSnapshot> = {}): SwarmRunSnapshot {
  return {
    runId: "run-1",
    projectRoot: "/proj/a",
    goal: "Investigate the thing",
    requestedCount: 3,
    model: null,
    providerPreference: "mixed",
    mode: "scout",
    source: "pickforge",
    originChatId: "chat-1",
    status: "running",
    synthesisStatus: "idle",
    synthesisError: null,
    synthesizedAt: null,
    lanes: [],
    error: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("cardSwarmRun — footer principle: lane ticks only for the chat that DISPATCHED a swarm", () => {
  it("finds the run whose originChatId matches this chat in this project", () => {
    const target = run({ originChatId: "chat-1" });
    const other = run({ runId: "run-2", originChatId: "chat-2" });

    const found = cardSwarmRun("chat-1", "/proj/a", () => [other, target]);

    expect(found).toBe(target);
  });

  it("is null for a chat that is itself a swarm WORKER lane, not the origin", () => {
    // A lane chat's id shows up as lane.chatId, never as originChatId — this
    // chat dispatched nothing, so it must get no lane ticks of its own.
    const workerRun = run({ originChatId: "chat-origin", lanes: [lane({ chatId: "chat-1" })] });

    const found = cardSwarmRun("chat-1", "/proj/a", () => [workerRun]);

    expect(found).toBeNull();
  });

  it("is null when no run exists for this chat", () => {
    expect(cardSwarmRun("chat-1", "/proj/a", () => [])).toBeNull();
  });

  it("scopes by project — a same-id chat in another project never matches", () => {
    const otherProject = run({ originChatId: "chat-1", projectRoot: "/proj/b" });

    expect(cardSwarmRun("chat-1", "/proj/a", () => [otherProject])).toBeNull();
  });
});

describe("cardLanes — footer principle: no ticks for a run with no lanes yet", () => {
  it("is null for a run with zero lanes (still queued/starting)", () => {
    expect(cardLanes(run({ lanes: [] }))).toBeNull();
  });

  it("is null when there is no run at all", () => {
    expect(cardLanes(null)).toBeNull();
  });

  it("counts terminal lanes (completed + failed + cancelled) as done, out of total", () => {
    const lanes = cardLanes(
      run({
        lanes: [
          lane({ id: "l1", status: "completed" }),
          lane({ id: "l2", status: "failed" }),
          lane({ id: "l3", status: "cancelled" }),
          lane({ id: "l4", status: "running" }),
        ],
      }),
    );

    expect(lanes).toEqual({
      lanes: expect.any(Array),
      doneCount: 3,
      total: 4,
    });
  });
});

describe("laneTickTone", () => {
  it("maps completed/failed/running/starting to their tones", () => {
    expect(laneTickTone("completed")).toBe("done");
    expect(laneTickTone("failed")).toBe("fail");
    expect(laneTickTone("running")).toBe("run");
    expect(laneTickTone("starting")).toBe("run");
  });

  it("is unlit (null) for a lane that has not started (queued/cancelled)", () => {
    expect(laneTickTone("queued")).toBeNull();
    expect(laneTickTone("cancelled")).toBeNull();
  });
});

describe("cardCost — footer principle: present only when nonzero", () => {
  function agentChatOf(costUsd: number, estimated = false): (id: string) => CardAgentChatLike {
    return () => ({ contextUsed: null, contextWindow: null, totals: { costUsd, estimated } });
  }

  it("is null when the chat has no agent-chat state at all", () => {
    expect(cardCost("chat-1", () => undefined)).toBeNull();
  });

  it("is null for a zero cost — never rendered as $0.0000", () => {
    expect(cardCost("chat-1", agentChatOf(0))).toBeNull();
  });

  it("carries the amount and estimated flag when cost is real", () => {
    expect(cardCost("chat-1", agentChatOf(0.41, true))).toEqual({ amount: 0.41, estimated: true });
  });
});

describe("cardContextEdge — ember while working, amber while waiting", () => {
  function agentChatOf(used: number | null, contextWindow: number | null): (id: string) => CardAgentChatLike {
    return () => ({ contextUsed: used, contextWindow, totals: { costUsd: 0, estimated: false } });
  }

  it("is ember for the working state", () => {
    expect(cardContextEdge("chat-1", "working", agentChatOf(50_000, 200_000)).color).toBe("ember");
  });

  it("is amber for the needsYou (waiting) state", () => {
    expect(cardContextEdge("chat-1", "needsYou", agentChatOf(50_000, 200_000)).color).toBe("amber");
  });

  it("computes the used/window fraction", () => {
    expect(cardContextEdge("chat-1", "working", agentChatOf(50_000, 200_000)).fraction).toBe(0.25);
  });

  it("clamps to 0 when there is no context window yet (before the first usage event)", () => {
    expect(cardContextEdge("chat-1", "working", agentChatOf(null, null)).fraction).toBe(0);
  });

  it("clamps to 1 when used exceeds the window (mirrors ContextMeter's own clamp)", () => {
    expect(cardContextEdge("chat-1", "working", agentChatOf(230_000, 200_000)).fraction).toBe(1);
  });
});

describe("cardBrief — present only with real task-brief text", () => {
  it("is null when taskBriefText is null", () => {
    expect(cardBrief(chat({ taskBriefText: null }))).toBeNull();
  });

  it("is null for whitespace-only text", () => {
    expect(cardBrief(chat({ taskBriefText: "   " }))).toBeNull();
  });

  it("returns the trimmed brief text", () => {
    expect(cardBrief(chat({ taskBriefText: "  Fix the flaky test  " }))).toBe("Fix the flaky test");
  });
});
