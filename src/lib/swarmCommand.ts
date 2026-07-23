export type ParsedSwarmCommand = {
  goal: string;
  count: number;
  model: string | null;
  providerPreference: "mixed" | "claudeCode" | "codex";
  mode: "scout" | "review";
};

// eslint-disable-next-line complexity -- TODO(#263): reduce legacy function complexity.
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
  const countMatch =
    body.match(/\bswarm\s+(?:of\s+)?([1-5])\b/i) ??
    body.match(/\bswarm\s+(?:of\s+)?(one|two|three|four|five)\b/i) ??
    body.match(/\b([1-5])\s*(?:agents?|sub-?agents?|workers?|lanes?)\b/i) ??
    body.match(/\b(one|two|three|four|five)\s*(?:agents?|sub-?agents?|workers?|lanes?)\b/i);
  const countWords: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
  };
  const rawCount = countMatch?.[1]?.toLowerCase();
  const count = rawCount ? countWords[rawCount] ?? Number(rawCount) : 3;
  const lower = body.toLowerCase();
  const providerPreference =
    (lower.includes("codex") || lower.includes("gpt") || lower.includes("spark")) &&
    !lower.includes("claude")
      ? "codex"
      : (lower.includes("claude") || lower.includes("opus") || lower.includes("sonnet")) &&
          !lower.includes("codex")
        ? "claudeCode"
        : "mixed";
  const model =
    lower.includes("glm-5.2") || lower.includes("ollama")
      ? "glm-5.2:cloud"
      : lower.includes("opus") && lower.includes("4.8")
        ? "opus 4.8"
        : lower.includes("sonnet") && lower.includes("5")
          ? "sonnet 5"
          : lower.includes("gpt-5.5") || lower.includes("gpt 5.5")
            ? "gpt-5.5"
            : lower.includes("spark") || lower.includes("gpt-5.3") || lower.includes("gpt 5.3")
              ? "gpt-5.3-codex-spark"
              : null;
  return {
    goal: body || "Run a Pickforge swarm for this chat.",
    count,
    model,
    providerPreference,
    mode: lower.includes("review") ? "review" : "scout",
  };
}
