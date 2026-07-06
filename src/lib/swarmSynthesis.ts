export const SWARM_SYNTHESIS_PROMPT_PREFIX = "Pickforge swarm finished for this chat.";

export function isInternalSwarmSynthesisPrompt(text: string): boolean {
  return text.trimStart().startsWith(SWARM_SYNTHESIS_PROMPT_PREFIX);
}
