// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://${path}`,
}));

vi.mock("../../src/components/chat/ImageLightbox", () => ({
  openLightbox: vi.fn(),
}));

import { renderChatMarkdown } from "../../src/components/chat/ChatBubble";

describe("renderChatMarkdown", () => {
  it("renders assistant markdown without image markers", () => {
    expect(renderChatMarkdown("assistant", "**ready**", undefined)).toContain(
      "<strong>ready</strong>",
    );
  });

  it("embeds user image markers before sanitizing", () => {
    const html = renderChatMarkdown("user", "see [Image #1]", ["shot.png"]);

    expect(html).toContain("<img");
    expect(html).toContain('data-pf-image-index="0"');
    expect(html).not.toContain("shot.png");
  });

  it("skips the shared markdown cache while streaming", () => {
    expect(renderChatMarkdown("assistant", "stream **now**", undefined, true)).toContain(
      "<strong>now</strong>",
    );
  });
});
