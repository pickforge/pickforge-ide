export type ParsedSwarmCommand = {
  goal: string;
  count: number;
  model: string | null;
  providerPreference: "mixed" | "claudeCode" | "codex";
  mode: "scout" | "review";
};

const COUNT_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
};

function swarmLaneCount(body: string): number {
  // Model names carry version digits ("opus 5", "gpt-5.5") that must not be
  // read as lane counts; strip version-shaped model phrases before count
  // matching so "of three opus 5 agents" parses count from "of three agents".
  // Only version shapes are stripped ("opus 5", "haiku 4.5") — a bare family
  // name before a count ("haiku 2 agents") keeps its count.
  const countBody = body.replace(
    /\b(?:opus|sonnet|fable)[-\s]*5(?:\.\d+)?\b|\b(?:gpt|glm|haiku)[-\s]*\d+[.-]\d+(?::\w+)?/gi,
    "",
  );
  const countMatch =
    countBody.match(/\bswarm\s+(?:of\s+)?([1-5])\b/i) ??
    countBody.match(/\bswarm\s+(?:of\s+)?(one|two|three|four|five)\b/i) ??
    countBody.match(/\b([1-5])\s*(?:agents?|sub-?agents?|workers?|lanes?)\b/i) ??
    countBody.match(/\b(one|two|three|four|five)\s*(?:agents?|sub-?agents?|workers?|lanes?)\b/i);
  const rawCount = countMatch?.[1]?.toLowerCase();
  return rawCount ? COUNT_WORDS[rawCount] ?? Number(rawCount) : 3;
}

function swarmProviderPreference(lower: string): ParsedSwarmCommand["providerPreference"] {
  if ((lower.includes("codex") || lower.includes("gpt") || lower.includes("spark")) && !lower.includes("claude")) {
    return "codex";
  }
  if ((lower.includes("claude") || lower.includes("opus") || lower.includes("sonnet")) && !lower.includes("codex")) {
    return "claudeCode";
  }
  return "mixed";
}

function swarmModel(lower: string): string | null {
  if (lower.includes("glm-5.2") || lower.includes("ollama")) return "glm-5.2:cloud";
  if (/\bopus[-\s]*5(?:\.\d+)?\b/.test(lower)) return "opus 5";
  if (/\bsonnet[-\s]*5(?:\.\d+)?\b/.test(lower)) return "sonnet 5";
  if (lower.includes("gpt-5.5") || lower.includes("gpt 5.5")) return "gpt-5.5";
  if (lower.includes("spark") || lower.includes("gpt-5.3") || lower.includes("gpt 5.3")) {
    return "gpt-5.3-codex-spark";
  }
  return null;
}

export function parseSwarmCommand(text: string): ParsedSwarmCommand | null {
  const trimmed = text.trim();
  const slash = /^\/swarm(\s|$)/i.test(trimmed);
  const hasSwarm = /\bswarm\b/i.test(trimmed);
  const hasAction = /\b(spawn|create|start|spin\s+up|launch|run)\b/i.test(trimmed);
  const hasWorkerNoun = /\b(agents?|sub-?agents?|workers?|lanes?)\b/i.test(trimmed);
  const hasSwarmCount = /\bswarm\s+(?:of\s+)?([1-5]|one|two|three|four|five)\b/i.test(
    trimmed,
  );
  const natural = hasSwarm && hasAction && (hasWorkerNoun || hasSwarmCount);
  if (!slash && !natural) return null;
  const body = slash ? trimmed.replace(/^\/swarm\s*/i, "").trim() : trimmed;
  const count = swarmLaneCount(body);
  const lower = body.toLowerCase();
  const providerPreference = swarmProviderPreference(lower);
  const model = swarmModel(lower);
  return {
    goal: body || "Run a Pickforge swarm for this chat.",
    count,
    model,
    providerPreference,
    mode: lower.includes("review") ? "review" : "scout",
  };
}
