import {
  parseOperatorIntent,
  type OperatorAction,
  type OperatorIntent,
} from "./operatorIntent";

export type ParseResult =
  | { kind: "intent"; intent: OperatorIntent }
  | { kind: "needsRouter"; reason: string }
  | { kind: "empty" };

type RuleResult =
  | { action: OperatorAction; projectRef: string | null }
  | { needsRouter: string };

type CommandRule = {
  match(input: string): RuleResult | null;
};

function clean(input: string): string {
  return input.trim().replace(/\s+/g, " ");
}

function nonEmpty(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
}

function parseCount(raw: string | undefined): number | "invalid" {
  if (!raw) return 3;
  const count = Number(raw);
  if (!Number.isInteger(count) || count < 1 || count > 5) return "invalid";
  return count;
}

function compose(action: OperatorAction, projectRef: string | null): ParseResult {
  const parsed = parseOperatorIntent(JSON.stringify({
    v: 1,
    id: crypto.randomUUID(),
    provenance: "typed",
    confidence: 1,
    projectRef,
    action,
  }));

  if (!parsed.ok) return { kind: "needsRouter", reason: parsed.error };
  return { kind: "intent", intent: parsed.intent };
}

const rules: CommandRule[] = [
  {
    match(input) {
      const match = /^open\s+project\s+(.+)$/i.exec(input);
      const projectRef = nonEmpty(match?.[1]);
      if (!projectRef) return null;
      return { action: { action: "openProject" }, projectRef };
    },
  },
  {
    match(input) {
      const match = /^open\s+chat\s+(.+?)(?:\s+in\s+(.+))?$/i.exec(input);
      const chat = nonEmpty(match?.[1]);
      if (!chat) return null;
      return {
        action: { action: "openChat", chat },
        projectRef: nonEmpty(match?.[2]),
      };
    },
  },
  {
    match(input) {
      return /^open\s+.+$/i.test(input)
        ? { needsRouter: "ambiguous between project/chat" }
        : null;
    },
  },
  {
    match(input) {
      const match = /^(?:new|create)\s+(claude|codex)\s+chat(?:\s+in\s+(.+?))?(?:\s+with\s+model\s+(.+))?$/i.exec(input);
      const provider = match?.[1]?.toLowerCase();
      if (provider !== "claude" && provider !== "codex") return null;
      return {
        action: {
          action: "createChat",
          provider,
          model: nonEmpty(match?.[3]),
        },
        projectRef: nonEmpty(match?.[2]),
      };
    },
  },
  {
    match(input) {
      const named = /^send\s+(.+?)\s+to\s+chat\s+(.+)$/i.exec(input);
      const namedPrompt = nonEmpty(named?.[1]);
      const chat = nonEmpty(named?.[2]);
      if (namedPrompt && chat) {
        return {
          action: { action: "sendPrompt", prompt: namedPrompt, chat },
          projectRef: null,
        };
      }

      const active = /^send\s+(.+)$/i.exec(input);
      const prompt = nonEmpty(active?.[1]);
      if (!prompt) return null;
      return {
        action: { action: "sendPrompt", prompt, chat: null },
        projectRef: null,
      };
    },
  },
  {
    match(input) {
      const match = /^start\s+(scout|review)\s+swarm(?:\s+of\s+(\d+))?\s+(.+)$/i.exec(input);
      const mode = match?.[1]?.toLowerCase();
      const goal = nonEmpty(match?.[3]);
      if ((mode !== "scout" && mode !== "review") || !goal) return null;
      const count = parseCount(match?.[2]);
      if (count === "invalid") return { needsRouter: "swarm count must be 1-5" };
      return {
        action: { action: "startSwarm", mode, count, goal, provider: "mixed" },
        projectRef: null,
      };
    },
  },
  {
    match(input) {
      const match = /^swarm\s+(scout|review)(?:\s+(\d+)x)?\s+(.+)$/i.exec(input);
      const mode = match?.[1]?.toLowerCase();
      const goal = nonEmpty(match?.[3]);
      if ((mode !== "scout" && mode !== "review") || !goal) return null;
      const count = parseCount(match?.[2]);
      if (count === "invalid") return { needsRouter: "swarm count must be 1-5" };
      return {
        action: { action: "startSwarm", mode, count, goal, provider: "mixed" },
        projectRef: null,
      };
    },
  },
  {
    match(input) {
      return /^swarm\s+status$/i.test(input)
        ? { action: { action: "swarmStatus" }, projectRef: null }
        : null;
    },
  },
  {
    match(input) {
      if (/^interrupt(?:\s+(?:run|chat))?$/i.test(input)) {
        return { action: { action: "interruptRun", run: null }, projectRef: null };
      }
      const match = /^interrupt\s+(.+)$/i.exec(input);
      const run = nonEmpty(match?.[1]);
      if (!run) return null;
      return { action: { action: "interruptRun", run }, projectRef: null };
    },
  },
  {
    match(input) {
      const match = /^steer\s+(.+)$/i.exec(input);
      const instruction = nonEmpty(match?.[1]);
      if (!instruction) return null;
      return {
        action: { action: "steerRun", run: null, instruction },
        projectRef: null,
      };
    },
  },
];

export function parseCommand(input: string): ParseResult {
  const command = clean(input);
  if (!command) return { kind: "empty" };

  for (const rule of rules) {
    const result = rule.match(command);
    if (!result) continue;
    if ("needsRouter" in result) {
      return { kind: "needsRouter", reason: result.needsRouter };
    }
    return compose(result.action, result.projectRef);
  }

  return { kind: "needsRouter", reason: "no deterministic match" };
}
