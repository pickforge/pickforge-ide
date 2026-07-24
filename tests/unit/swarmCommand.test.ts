import { describe, expect, it } from "vitest";

import { parseSwarmCommand } from "../../src/lib/swarmCommand";

describe("parseSwarmCommand", () => {
  it("intercepts swarm-of-count prompts without an explicit worker noun", () => {
    expect(
      parseSwarmCommand(
        "Create a swarm of 3 GPT 5.3 Codex Spark to investigate this codebase and return me the result",
      ),
    ).toEqual({
      goal: "Create a swarm of 3 GPT 5.3 Codex Spark to investigate this codebase and return me the result",
      count: 3,
      model: "gpt-5.3-codex-spark",
      providerPreference: "codex",
      mode: "scout",
    });
  });

  it("keeps slash swarm commands and word counts working", () => {
    expect(parseSwarmCommand("/swarm of three opus 5 agents review auth")).toMatchObject({
      count: 3,
      model: "opus 5",
      providerPreference: "claudeCode",
      mode: "review",
    });
  });

  it("does not read model version digits as lane counts", () => {
    expect(parseSwarmCommand("/swarm of two sonnet 5 workers")).toMatchObject({
      count: 2,
      model: "sonnet 5",
      providerPreference: "claudeCode",
    });
  });

  it("does not read a stray digit elsewhere in the goal as a model version", () => {
    // "two" is not adjacent to "agents", so the count stays the default 3;
    // the point is that "opus … 5" split across the goal is not a model.
    expect(parseSwarmCommand("/swarm of two opus agents for issue 5")).toMatchObject({
      count: 3,
      model: null,
    });
  });

  it("keeps a count that follows a bare model family name", () => {
    expect(parseSwarmCommand("/swarm of haiku 2 agents")).toMatchObject({
      count: 2,
      model: null,
    });
  });

  it("does not intercept non-action swarm mentions", () => {
    expect(parseSwarmCommand("What do you think about swarm orchestration?")).toBeNull();
  });
});
