export interface ModelPricing {
  inputPerM: number;
  cachedPerM: number;
  outputPerM: number;
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  "claude-haiku-4-5": { inputPerM: 1.0, cachedPerM: 0.1, outputPerM: 5.0 },
  "claude-sonnet-4-6": { inputPerM: 3.0, cachedPerM: 0.3, outputPerM: 15.0 },
  "claude-opus-4-8": { inputPerM: 5.0, cachedPerM: 0.5, outputPerM: 25.0 },
  "gpt-5.5": { inputPerM: 1.25, cachedPerM: 0.125, outputPerM: 10.0 },
  "gpt-5.4-mini": { inputPerM: 0.25, cachedPerM: 0.025, outputPerM: 2.0 },
  "gpt-5.3-codex-spark": { inputPerM: 0.25, cachedPerM: 0.025, outputPerM: 2.0 },
};

export function estimateCostUsd(
  model: string | null,
  usage: { inputTokens: number; cachedInputTokens: number; outputTokens: number },
): number | null {
  if (!model) return null;
  const pricing = MODEL_PRICING[model];
  if (!pricing) return null;

  const cachedInputTokens = Math.max(0, usage.cachedInputTokens);
  const billableInputTokens = Math.max(0, usage.inputTokens - cachedInputTokens);

  return (
    (billableInputTokens * pricing.inputPerM +
      cachedInputTokens * pricing.cachedPerM +
      usage.outputTokens * pricing.outputPerM) /
    1_000_000
  );
}
