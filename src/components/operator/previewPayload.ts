import type { OperatorIntent } from "../../lib/operatorIntent";

export function previewPayloadLines(intent: OperatorIntent): string[] {
  const lines: string[] = [];
  if (intent.projectRef) lines.push(`project: ${intent.projectRef}`);

  switch (intent.action.action) {
    case "openProject":
    case "swarmStatus":
    case "reloadRun":
    case "stopRun":
    case "hotRestart":
    case "enterSelectMode":
    case "takeScreenshot":
      return lines;
    case "openChat":
      if (intent.action.chat) lines.push(`chat: ${intent.action.chat}`);
      return lines;
    case "createChat":
      lines.push(`provider: ${intent.action.provider}`);
      if (intent.action.model) lines.push(`model: ${intent.action.model}`);
      return lines;
    case "sendPrompt":
      lines.push(`prompt: ${intent.action.prompt}`);
      if (intent.action.chat) lines.push(`chat: ${intent.action.chat}`);
      return lines;
    case "startSwarm":
      lines.push(`${intent.action.mode} swarm · ${intent.action.count} lanes`);
      lines.push(`goal: ${intent.action.goal}`);
      lines.push(`provider: ${intent.action.provider}`);
      return lines;
    case "interruptRun":
      if (intent.action.run) lines.push(`run: ${intent.action.run}`);
      return lines;
    case "steerRun":
      if (intent.action.run) lines.push(`run: ${intent.action.run}`);
      lines.push(`instruction: ${intent.action.instruction}`);
      return lines;
    case "launchEmulator":
      if (intent.action.device) lines.push(`device: ${intent.action.device}`);
      return lines;
    case "launchRun":
      if (intent.action.target) lines.push(`target: ${intent.action.target}`);
      return lines;
    case "selectWidget":
      lines.push(`widget: ${intent.action.description}`);
      return lines;
  }
}
