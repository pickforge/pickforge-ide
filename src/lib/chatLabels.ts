import type { Chat } from "./db";

export interface ChatLabels {
  role?: string;
  swarmRunId?: string;
  swarmLaneId?: string;
  originChatId?: string | null;
  [key: string]: unknown;
}

export function parseChatLabels(labelsJson: string | null): ChatLabels {
  if (!labelsJson) return {};
  try {
    const value = JSON.parse(labelsJson);
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as ChatLabels)
      : {};
  } catch {
    return {};
  }
}

export function isSwarmWorkerChat(chat: Pick<Chat, "labelsJson">): boolean {
  return parseChatLabels(chat.labelsJson).role === "swarmWorker";
}

export function isPrimaryChat(chat: Pick<Chat, "labelsJson">): boolean {
  return !isSwarmWorkerChat(chat);
}

export function swarmWorkerLabels(args: {
  swarmRunId: string;
  swarmLaneId: string;
  originChatId: string | null;
}): string {
  return JSON.stringify({
    role: "swarmWorker",
    swarmRunId: args.swarmRunId,
    swarmLaneId: args.swarmLaneId,
    originChatId: args.originChatId,
  });
}
