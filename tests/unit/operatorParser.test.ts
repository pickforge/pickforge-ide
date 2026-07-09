import { describe, expect, it } from "vitest";

import { parseOperatorIntent, type OperatorAction } from "../../src/lib/operatorIntent";
import { parseCommand } from "../../src/lib/operatorParser";

function expectIntent(input: string, action: OperatorAction, projectRef: string | null = null) {
  const parsed = parseCommand(input);
  expect(parsed.kind, input).toBe("intent");
  if (parsed.kind !== "intent") throw new Error(`Expected intent for ${input}`);

  const contract = parseOperatorIntent(JSON.stringify(parsed.intent));
  expect(contract.ok, input).toBe(true);
  expect(parsed.intent).toMatchObject({
    v: 1,
    provenance: "typed",
    confidence: 1,
    projectRef,
    action,
  });
}

describe("parseCommand", () => {
  it("parses deterministic operator commands", () => {
    const cases: Array<{
      input: string;
      action: OperatorAction;
      projectRef?: string | null;
    }> = [
      {
        input: "  OPEN   PROJECT   Games List  ",
        action: { action: "openProject" },
        projectRef: "Games List",
      },
      {
        input: "open chat Main",
        action: { action: "openChat", chat: "Main" },
      },
      {
        input: "open chat Main in PickForge",
        action: { action: "openChat", chat: "Main" },
        projectRef: "PickForge",
      },
      {
        input: "new claude chat",
        action: { action: "createChat", provider: "claude", model: null },
      },
      {
        input: "new codex chat in PickForge with model gpt-5.5",
        action: { action: "createChat", provider: "codex", model: "gpt-5.5" },
        projectRef: "PickForge",
      },
      {
        input: "create claude chat with model opus",
        action: { action: "createChat", provider: "claude", model: "opus" },
      },
      {
        input: "send fix the bug to chat Main",
        action: { action: "sendPrompt", prompt: "fix the bug", chat: "Main" },
      },
      {
        input: "send fix the bug",
        action: { action: "sendPrompt", prompt: "fix the bug", chat: null },
      },
      {
        input: "start scout swarm of 4 map the repo",
        action: {
          action: "startSwarm",
          mode: "scout",
          count: 4,
          goal: "map the repo",
          provider: "mixed",
        },
      },
      {
        input: "start review swarm review this change",
        action: {
          action: "startSwarm",
          mode: "review",
          count: 3,
          goal: "review this change",
          provider: "mixed",
        },
      },
      {
        input: "swarm scout 2x map risks",
        action: {
          action: "startSwarm",
          mode: "scout",
          count: 2,
          goal: "map risks",
          provider: "mixed",
        },
      },
      {
        input: "swarm review check tests",
        action: {
          action: "startSwarm",
          mode: "review",
          count: 3,
          goal: "check tests",
          provider: "mixed",
        },
      },
      {
        input: "swarm status",
        action: { action: "swarmStatus" },
      },
      {
        input: "interrupt",
        action: { action: "interruptRun", run: null },
      },
      {
        input: "interrupt run",
        action: { action: "interruptRun", run: null },
      },
      {
        input: "interrupt chat",
        action: { action: "interruptRun", run: null },
      },
      {
        input: "interrupt Main",
        action: { action: "interruptRun", run: "Main" },
      },
      {
        input: "steer focus on tests",
        action: { action: "steerRun", run: null, instruction: "focus on tests" },
      },
    ];

    for (const item of cases) {
      expectIntent(item.input, item.action, item.projectRef ?? null);
    }
  });

  it("routes ambiguous and unknown input away from the deterministic parser", () => {
    expect(parseCommand("open Main")).toEqual({
      kind: "needsRouter",
      reason: "ambiguous between project/chat",
    });
    expect(parseCommand("start scout swarm of 6 map the repo")).toEqual({
      kind: "needsRouter",
      reason: "swarm count must be 1-5",
    });
    expect(parseCommand("swarm review 0x check tests")).toEqual({
      kind: "needsRouter",
      reason: "swarm count must be 1-5",
    });
    expect(parseCommand("make it better")).toEqual({
      kind: "needsRouter",
      reason: "no deterministic match",
    });
  });

  it("returns empty for blank input", () => {
    expect(parseCommand(" \n\t ")).toEqual({ kind: "empty" });
  });
});
