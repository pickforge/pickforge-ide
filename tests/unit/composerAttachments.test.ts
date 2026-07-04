import { describe, expect, it } from "vitest";
import {
  type ComposerAttachment,
  addAttachmentWithMarker,
  createPendingAttachment,
  decidePreparingState,
  offsetAfterRemoval,
  readyAttachmentPaths,
  removeAttachmentWithMarker,
  replaceRangeWithText,
  resolveAttachment,
} from "../../src/lib/composerAttachments";

const ready = (id: number, path: string): ComposerAttachment => ({
  id,
  status: "ready",
  path,
  previewUrl: `asset://${id}`,
});

describe("composer attachments", () => {
  it("adds markers and renumbers after removing a ready attachment among pending ones", () => {
    const first = addAttachmentWithMarker([], "look", 4, createPendingAttachment(1, null));
    const second = addAttachmentWithMarker(first.attachments, first.text, first.cursor, ready(2, "/b.png"));
    const third = addAttachmentWithMarker(
      second.attachments,
      second.text,
      second.cursor,
      createPendingAttachment(3, null),
    );

    expect(third.text).toBe("look [Image #1] [Image #2] [Image #3]");

    const removed = removeAttachmentWithMarker(third.attachments, third.text, 2);

    expect(removed.removedIndex).toBe(2);
    expect(removed.removed?.status).toBe("ready");
    expect(removed.attachments.map((attachment) => attachment.id)).toEqual([1, 3]);
    expect(removed.attachments.map((attachment) => attachment.status)).toEqual([
      "pending",
      "pending",
    ]);
    expect(removed.text).toBe("look [Image #1]  [Image #2]");
  });

  it("removal deletes only the chip occurrence, keeping literal duplicates", () => {
    const attachments = [ready(1, "/a.png"), ready(2, "/b.png")];
    const text = "chip [Image #1] lit [Image #1] then [Image #2]";

    const removed = removeAttachmentWithMarker(attachments, text, 1);

    expect(removed.text).toBe("chip  lit [Image #1] then [Image #1]");
    expect(removed.attachments.map((a) => a.id)).toEqual([2]);
  });

  it("offsetAfterRemoval maps a caret across the removed chip and literal duplicates", () => {
    const attachments = [ready(1, "/a.png")];
    const text = "chip [Image #1] lit [Image #1] end";

    // Caret at the very end: only the chip occurrence vanishes ahead of it.
    expect(offsetAfterRemoval(attachments, text, 1, text.length)).toBe(
      "chip  lit [Image #1] end".length,
    );
    // Caret before the chip: unaffected.
    expect(offsetAfterRemoval(attachments, text, 1, 5)).toBe(5);
  });

  it("resolves pending attachments and returns ready paths in attachment order", () => {
    const attachments = [
      createPendingAttachment(1, "blob:first"),
      ready(2, "/already.png"),
    ];
    const resolved = resolveAttachment(attachments, 1, "/first.png", "asset://first");

    expect(resolved.previous).toEqual(attachments[0]);
    expect(resolved.attachments[0]).toMatchObject({
      id: 1,
      status: "ready",
      path: "/first.png",
      previewUrl: "asset://first",
    });
    expect(readyAttachmentPaths(resolved.attachments)).toEqual([
      "/first.png",
      "/already.png",
    ]);
  });
});

describe("decidePreparingState", () => {
  it("waits while any attachment is pending", () => {
    expect(
      decidePreparingState({
        attachments: [createPendingAttachment(1, null), ready(2, "/b.png")],
        failed: false,
        hasContent: true,
      }),
    ).toBe("wait");
  });

  it("dispatches once every current attachment is ready", () => {
    expect(
      decidePreparingState({
        attachments: [ready(1, "/a.png"), ready(2, "/b.png")],
        failed: false,
        hasContent: false,
      }),
    ).toBe("dispatch");
  });

  it("aborts after a stash failure", () => {
    expect(
      decidePreparingState({
        attachments: [ready(1, "/a.png")],
        failed: true,
        hasContent: true,
      }),
    ).toBe("abort");
  });

  it("aborts when there is nothing left to send", () => {
    expect(
      decidePreparingState({
        attachments: [],
        failed: false,
        hasContent: false,
      }),
    ).toBe("abort");
  });
});

describe("replaceRangeWithText", () => {
  it("drops a chip covered by the replaced range and renumbers the rest", () => {
    const attachments = [ready(1, "/a.png"), ready(2, "/b.png"), ready(3, "/c.png")];
    const text = "see [Image #1] mid [Image #2] tail [Image #3]";

    const result = replaceRangeWithText(attachments, text, 15, 30, "and");

    expect(result.text).toBe("see [Image #1] andtail [Image #2]");
    expect(result.attachments.map((a) => a.id)).toEqual([1, 3]);
    expect(result.removed.map((a) => a.id)).toEqual([2]);
    expect(result.cursor).toBe(18);
  });

  it("snaps endpoints strictly inside a chip-backed marker to the whole chip", () => {
    const result = replaceRangeWithText([ready(9, "/a.png")], "a [Image #1] b", 5, 8, "");

    expect(result.text).toBe("a  b");
    expect(result.attachments).toEqual([]);
    expect(result.removed.map((a) => a.id)).toEqual([9]);
    expect(result.cursor).toBe(2);
  });

  it("keeps every attachment on a collapsed insertion (Shift+Enter path)", () => {
    const attachments = [ready(9, "/a.png")];
    const result = replaceRangeWithText(attachments, "a [Image #1] b", 2, 2, "\n");

    expect(result.text).toBe("a \n[Image #1] b");
    expect(result.attachments).toEqual(attachments);
    expect(result.removed).toEqual([]);
    expect(result.cursor).toBe(3);
  });

  it("keeps marker syntax inside the inserted chunk verbatim", () => {
    const attachments = [ready(1, "/a.png"), ready(2, "/b.png")];
    const text = "a [Image #1] b [Image #2]";

    const result = replaceRangeWithText(attachments, text, 2, 12, "quote [Image #1] here");

    expect(result.text).toBe("a quote [Image #1] here b [Image #1]");
    expect(result.attachments.map((a) => a.id)).toEqual([2]);
    expect(result.removed.map((a) => a.id)).toEqual([1]);
    expect(result.cursor).toBe(23);
  });

  it("replacing a literal duplicate marker keeps the attachment", () => {
    const attachments = [ready(1, "/a.png")];
    const text = "caption [Image #1] quoted [Image #1]";

    const result = replaceRangeWithText(attachments, text, 26, 36, "x");

    expect(result.text).toBe("caption [Image #1] quoted x");
    expect(result.attachments).toEqual(attachments);
    expect(result.removed).toEqual([]);
    expect(result.cursor).toBe(27);
  });

  it("dropping the real chip leaves literal duplicates verbatim and renumbers survivors", () => {
    const attachments = [ready(1, "/a.png"), ready(2, "/b.png")];
    const text = "[Image #1] and [Image #1] plus [Image #2]";

    const result = replaceRangeWithText(attachments, text, 0, 10, "");

    expect(result.text).toBe(" and [Image #1] plus [Image #1]");
    expect(result.attachments.map((a) => a.id)).toEqual([2]);
    expect(result.removed.map((a) => a.id)).toEqual([1]);
    expect(result.cursor).toBe(0);
  });

  it("treats markers without a matching attachment as plain text", () => {
    const attachments = [ready(1, "/a.png")];
    const text = "x [Image #1] [Image #7] y";

    const result = replaceRangeWithText(attachments, text, 13, 23, "z");

    expect(result.text).toBe("x [Image #1] z y");
    expect(result.attachments).toEqual(attachments);
    expect(result.removed).toEqual([]);
    expect(result.cursor).toBe(14);
  });

  it("returns dropped pending attachments so their previews can be revoked", () => {
    const attachments = [createPendingAttachment(1, "blob:x"), ready(2, "/b.png")];
    const result = replaceRangeWithText(attachments, "[Image #1] [Image #2]", 0, 10, "");

    expect(result.text).toBe(" [Image #1]");
    expect(result.attachments.map((a) => a.id)).toEqual([2]);
    expect(result.removed).toEqual([attachments[0]]);
    expect(result.cursor).toBe(0);
  });
});
