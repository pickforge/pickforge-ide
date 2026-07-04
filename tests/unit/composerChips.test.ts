// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  CHIP_ATTR,
  adjacentChipId,
  chipIdsInOrder,
  chipStartOffset,
  renderComposer,
  serializeComposer,
  setCaretAtOffset,
} from "../../src/lib/composerChips";

// A minimal chip builder mirroring the composer's DOM contract: an atomic
// element carrying the attachment id, with inert inner content the serializer
// must ignore.
function buildChip(attachmentId: number, index: number): HTMLElement {
  const chip = document.createElement("span");
  chip.setAttribute(CHIP_ATTR, String(attachmentId));
  chip.setAttribute("contenteditable", "false");
  const label = document.createElement("span");
  label.textContent = `Image #${index}`;
  chip.appendChild(label);
  return chip;
}

let root: HTMLDivElement;

beforeEach(() => {
  root = document.createElement("div");
  document.body.appendChild(root);
});

const roundTrip = (text: string, ids: number[]): string => {
  renderComposer(root, text, ids, buildChip);
  return serializeComposer(root, ids);
};

describe("composer chip serialization round-trips", () => {
  it("plain text with no markers", () => {
    expect(roundTrip("hello world", [])).toBe("hello world");
  });

  it("newlines survive as <br>", () => {
    expect(roundTrip("a\nb\n\nc", [])).toBe("a\nb\n\nc");
    expect(root.querySelectorAll("br").length).toBe(3);
  });

  it("markers backed by attachments become chips and back", () => {
    const out = roundTrip("look [Image #1] then [Image #2]", [10, 20]);
    expect(out).toBe("look [Image #1] then [Image #2]");
    expect(chipIdsInOrder(root)).toEqual([10, 20]);
  });

  it("adjacent markers keep no separator", () => {
    expect(roundTrip("[Image #1][Image #2]", [7, 8])).toBe("[Image #1][Image #2]");
    expect(chipIdsInOrder(root)).toEqual([7, 8]);
  });

  it("markers and newlines interleave", () => {
    expect(roundTrip("first\n[Image #1]\nlast", [42])).toBe("first\n[Image #1]\nlast");
  });

  it("hand-typed marker with no matching attachment stays plain text", () => {
    const out = roundTrip("keep [Image #7] literal", [10]);
    expect(out).toBe("keep [Image #7] literal");
    expect(chipIdsInOrder(root)).toEqual([]);
  });

  it("out-of-range marker stays literal while in-range one chips", () => {
    const out = roundTrip("[Image #1] and [Image #3]", [10, 20]);
    expect(out).toBe("[Image #1] and [Image #3]");
    expect(chipIdsInOrder(root)).toEqual([10]);
  });

  it("empty string yields a truly empty editor (placeholder can show)", () => {
    renderComposer(root, "", [], buildChip);
    expect(root.childNodes.length).toBe(0);
    expect(serializeComposer(root, [])).toBe("");
  });
});

describe("serialization reflects renumbering via id→index", () => {
  it("renumbers remaining chips when the middle attachment is dropped", () => {
    // Render three chips, then re-derive text against a list missing id 20.
    renderComposer(root, "[Image #1] [Image #2] [Image #3]", [10, 20, 30], buildChip);
    expect(serializeComposer(root, [10, 20, 30])).toBe(
      "[Image #1] [Image #2] [Image #3]",
    );
    // The DOM keeps chips 10/20/30; removing 20 from the model list drops its
    // marker (id 20 no longer resolves) and renumbers 30 → #2.
    const removed = serializeComposer(root, [10, 30]);
    expect(removed).toBe("[Image #1]  [Image #2]");
  });

  it("chips only the first occurrence of a duplicated marker", () => {
    renderComposer(root, "quote [Image #1] here b [Image #1]", [10], buildChip);
    expect(chipIdsInOrder(root)).toEqual([10]);
    expect(serializeComposer(root, [10])).toBe("quote [Image #1] here b [Image #1]");
  });

  it("chip labels follow the model after a re-render from renumbered text", () => {
    renderComposer(root, "[Image #1] [Image #2]", [10, 20], buildChip);
    // Drop id 10: text renumbers to a single [Image #1] pointing at id 20.
    renderComposer(root, "[Image #1]", [20], buildChip);
    expect(chipIdsInOrder(root)).toEqual([20]);
    expect(root.querySelector(`[${CHIP_ATTR}]`)?.textContent).toBe("Image #1");
    expect(serializeComposer(root, [20])).toBe("[Image #1]");
  });
});

describe("serializer ignores chip inner content", () => {
  it("does not leak the chip's label/remove text into the string", () => {
    renderComposer(root, "[Image #1]", [99], buildChip);
    const chip = root.querySelector(`[${CHIP_ATTR}]`)!;
    const remove = document.createElement("button");
    remove.textContent = "✕";
    chip.appendChild(remove);
    expect(serializeComposer(root, [99])).toBe("[Image #1]");
  });
});

describe("caret filler after a trailing chip", () => {
  it("appends a zero-width filler text node that never serializes", () => {
    renderComposer(root, "hi [Image #1]", [10], buildChip);
    const last = root.lastChild!;
    expect(last.nodeType).toBe(3);
    expect((last as Text).data).toBe("\u200B");
    expect(serializeComposer(root, [10])).toBe("hi [Image #1]");
  });

  it("adds no filler when text follows the chip", () => {
    renderComposer(root, "[Image #1] after", [10], buildChip);
    expect((root.lastChild as Text).data).toBe(" after");
  });

  it("setCaretAtOffset lands in the filler text node, not at an element boundary", () => {
    renderComposer(root, "hi [Image #1]", [10], buildChip);
    setCaretAtOffset(root, "hi [Image #1]".length, [10]);
    const range = document.getSelection()!.getRangeAt(0);
    expect(range.startContainer.nodeType).toBe(3);
    expect(range.startContainer).toBe(root.lastChild);
    expect(range.startOffset).toBe(0);
  });

  it("adjacentChipId sees a chip through the filler", () => {
    renderComposer(root, "hi [Image #1]", [10], buildChip);
    setCaretAtOffset(root, "hi [Image #1]".length, [10]);
    expect(adjacentChipId(root, "before")).toBe(10);
  });
});

describe("chipStartOffset", () => {
  it("measures the serialized offset where a chip starts", () => {
    renderComposer(root, "ab [Image #1] cd [Image #2]", [10, 20], buildChip);
    expect(chipStartOffset(root, 10, [10, 20])).toBe(3);
    expect(chipStartOffset(root, 20, [10, 20])).toBe(17);
  });

  it("counts newlines and earlier chips at their serialized width", () => {
    renderComposer(root, "a\n[Image #1]\n[Image #2]", [10, 20], buildChip);
    expect(chipStartOffset(root, 10, [10, 20])).toBe(2);
    expect(chipStartOffset(root, 20, [10, 20])).toBe(13);
  });

  it("returns null for a chip that is not in the editor", () => {
    renderComposer(root, "[Image #1]", [10], buildChip);
    expect(chipStartOffset(root, 99, [10])).toBeNull();
  });
});
