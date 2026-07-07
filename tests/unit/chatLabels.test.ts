import { describe, expect, it } from "vitest";

import {
  isPrimaryChat,
  isSwarmWorkerChat,
  parseChatLabels,
  swarmWorkerLabels,
} from "../../src/lib/chatLabels";

describe("chatLabels", () => {
  it("identifies swarm worker chats from labelsJson", () => {
    const labelsJson = swarmWorkerLabels({
      swarmRunId: "swarm-1",
      swarmLaneId: "lane-1",
      originChatId: "chat-main",
    });

    expect(isSwarmWorkerChat({ labelsJson })).toBe(true);
    expect(isPrimaryChat({ labelsJson })).toBe(false);
    expect(parseChatLabels(labelsJson).originChatId).toBe("chat-main");
  });

  it("treats empty or invalid labels as primary chats", () => {
    expect(isPrimaryChat({ labelsJson: null })).toBe(true);
    expect(isPrimaryChat({ labelsJson: "{bad" })).toBe(true);
  });
});
