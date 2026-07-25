// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  CHIP_ATTR,
  CHIP_KIND_ATTR,
  type ComposerChipKind,
  type ComposerChipModel,
  adjacentChipId,
  chipIdsInOrder,
  chipStartOffset,
  deleteTargetsFillerTail,
  renderComposer,
  serializeComposer,
  setCaretAtOffset,
} from "../../src/lib/composerChips";

// A minimal chip builder mirroring the composer's DOM contract: an atomic
// element carrying the attachment id, with inert inner content the serializer
// must ignore.
function buildChip(attachmentId: number, kind: ComposerChipKind, index: number): HTMLElement {
  const chip = document.createElement("span");
  chip.setAttribute(CHIP_ATTR, String(attachmentId));
  chip.setAttribute(CHIP_KIND_ATTR, kind);
  chip.setAttribute("contenteditable", "false");
  const label = document.createElement("span");
  label.textContent = `${kind === "text" ? "Text" : "Image"} #${index}`;
  chip.appendChild(label);
  return chip;
}

let root: HTMLDivElement;

beforeEach(() => {
  root = document.createElement("div");
  document.body.appendChild(root);
});

const imageModels = (ids: number[]): ComposerChipModel[] =>
  ids.map((id) => ({ id, kind: "image" }));

/** Editor content up to a caret, as the composer measures selection offsets. */
const rangeBefore = (range: Range): DocumentFragment => {
  const before = document.createRange();
  before.selectNodeContents(root);
  before.setEnd(range.startContainer, range.startOffset);
  return before.cloneContents();
};

const roundTrip = (text: string, ids: number[]): string => {
  const models = imageModels(ids);
  renderComposer(root, text, models, buildChip);
  return serializeComposer(root, models);
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

  it("text markers become text chips and keep image numbering separate", () => {
    const models: ComposerChipModel[] = [
      { id: 10, kind: "image" },
      { id: 20, kind: "text" },
      { id: 30, kind: "image" },
    ];
    const out = (() => {
      renderComposer(root, "[Image #1] [Text #1] [Image #2]", models, buildChip);
      return serializeComposer(root, models);
    })();

    expect(out).toBe("[Image #1] [Text #1] [Image #2]");
    expect(chipIdsInOrder(root)).toEqual([10, 20, 30]);
    expect(root.querySelector(`[${CHIP_ATTR}="20"]`)?.textContent).toBe("Text #1");
  });

  it("chips only the first text marker occurrence", () => {
    const models: ComposerChipModel[] = [{ id: 20, kind: "text" }];

    renderComposer(root, "[Text #1] literal [Text #1] [Text #2]", models, buildChip);

    expect(serializeComposer(root, models)).toBe("[Text #1] literal [Text #1] [Text #2]");
    expect(chipIdsInOrder(root)).toEqual([20]);
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
    renderComposer(root, "[Image #1] [Image #2] [Image #3]", imageModels([10, 20, 30]), buildChip);
    expect(serializeComposer(root, imageModels([10, 20, 30]))).toBe(
      "[Image #1] [Image #2] [Image #3]",
    );
    // The DOM keeps chips 10/20/30; removing 20 from the model list drops its
    // marker (id 20 no longer resolves) and renumbers 30 → #2.
    const removed = serializeComposer(root, imageModels([10, 30]));
    expect(removed).toBe("[Image #1]  [Image #2]");
  });

  it("chips only the first occurrence of a duplicated marker", () => {
    renderComposer(root, "quote [Image #1] here b [Image #1]", imageModels([10]), buildChip);
    expect(chipIdsInOrder(root)).toEqual([10]);
    expect(serializeComposer(root, imageModels([10]))).toBe("quote [Image #1] here b [Image #1]");
  });

  it("chip labels follow the model after a re-render from renumbered text", () => {
    renderComposer(root, "[Image #1] [Image #2]", imageModels([10, 20]), buildChip);
    // Drop id 10: text renumbers to a single [Image #1] pointing at id 20.
    renderComposer(root, "[Image #1]", imageModels([20]), buildChip);
    expect(chipIdsInOrder(root)).toEqual([20]);
    expect(root.querySelector(`[${CHIP_ATTR}]`)?.textContent).toBe("Image #1");
    expect(serializeComposer(root, imageModels([20]))).toBe("[Image #1]");
  });
});

describe("serializer ignores chip inner content", () => {
  it("does not leak the chip's label/remove text into the string", () => {
    renderComposer(root, "[Image #1]", imageModels([99]), buildChip);
    const chip = root.querySelector(`[${CHIP_ATTR}]`)!;
    const remove = document.createElement("button");
    remove.textContent = "✕";
    chip.appendChild(remove);
    expect(serializeComposer(root, imageModels([99]))).toBe("[Image #1]");
  });

  it("drops chips that are missing from the current model", () => {
    root.appendChild(buildChip(99, "text", 1));

    expect(serializeComposer(root, [])).toBe("");
  });
});

describe("caret filler after a trailing chip", () => {
  it("appends a zero-width filler text node that never serializes", () => {
    renderComposer(root, "hi [Image #1]", imageModels([10]), buildChip);
    const last = root.lastChild!;
    expect(last.nodeType).toBe(3);
    expect((last as Text).data).toBe("\u200B");
    expect(serializeComposer(root, imageModels([10]))).toBe("hi [Image #1]");
  });

  it("adds no filler when text follows the chip", () => {
    renderComposer(root, "[Image #1] after", imageModels([10]), buildChip);
    expect((root.lastChild as Text).data).toBe(" after");
  });

  it("setCaretAtOffset lands in the filler text node, not at an element boundary", () => {
    renderComposer(root, "hi [Image #1]", imageModels([10]), buildChip);
    setCaretAtOffset(root, "hi [Image #1]".length, imageModels([10]));
    const range = document.getSelection()!.getRangeAt(0);
    expect(range.startContainer.nodeType).toBe(3);
    expect(range.startContainer).toBe(root.lastChild);
    expect(range.startOffset).toBe(0);
  });

  it("adjacentChipId sees a chip through the filler", () => {
    renderComposer(root, "hi [Image #1]", imageModels([10]), buildChip);
    setCaretAtOffset(root, "hi [Image #1]".length, imageModels([10]));
    expect(adjacentChipId(root, "before")).toBe(10);
  });

  it("deleteTargetsFillerTail is true only when Delete would just eat the filler", () => {
    renderComposer(root, "hi [Image #1]", imageModels([10]), buildChip);
    setCaretAtOffset(root, "hi [Image #1]".length, imageModels([10]));
    expect(deleteTargetsFillerTail(root)).toBe(true);

    renderComposer(root, "hi [Image #1] tail", imageModels([10]), buildChip);
    setCaretAtOffset(root, "hi [Image #1]".length, imageModels([10]));
    expect(deleteTargetsFillerTail(root)).toBe(false);
  });
});

describe("line filler after a trailing newline (#352)", () => {
  // A <br> ending a block box creates no line box, so the empty final line a
  // Shift+Enter just opened was invisible until a second one was pressed.
  it("adds a marked second <br> so the empty final line renders", () => {
    renderComposer(root, "abc\n", [], buildChip);

    const breaks = root.querySelectorAll("br");
    expect(breaks.length).toBe(2);
    expect(breaks[0].hasAttribute("data-pf-line-filler")).toBe(false);
    expect(breaks[1].hasAttribute("data-pf-line-filler")).toBe(true);
  });

  it("keeps the filler out of the string model", () => {
    expect(roundTrip("abc\n", [])).toBe("abc\n");
    expect(roundTrip("a\nb\n\n", [])).toBe("a\nb\n\n");
    expect(roundTrip("\n", [])).toBe("\n");
  });

  it("adds no filler when the text does not end in a newline", () => {
    renderComposer(root, "a\nb", [], buildChip);
    expect(root.querySelectorAll("[data-pf-line-filler]").length).toBe(0);
  });

  it("puts the end-of-text caret on the new empty line, before the filler", () => {
    renderComposer(root, "abc\n", [], buildChip);
    setCaretAtOffset(root, "abc\n".length, []);

    const range = document.getSelection()!.getRangeAt(0);
    expect(range.startContainer).toBe(root);
    // Between the real <br> and the filler: children are [text, br, filler].
    expect(range.startOffset).toBe(2);
    expect(serializeComposer(rangeBefore(range), [])).toBe("abc\n");
  });
});

describe("chipStartOffset", () => {
  it("measures the serialized offset where a chip starts", () => {
    renderComposer(root, "ab [Image #1] cd [Image #2]", imageModels([10, 20]), buildChip);
    expect(chipStartOffset(root, 10, imageModels([10, 20]))).toBe(3);
    expect(chipStartOffset(root, 20, imageModels([10, 20]))).toBe(17);
  });

  it("counts newlines and earlier chips at their serialized width", () => {
    renderComposer(root, "a\n[Image #1]\n[Image #2]", imageModels([10, 20]), buildChip);
    expect(chipStartOffset(root, 10, imageModels([10, 20]))).toBe(2);
    expect(chipStartOffset(root, 20, imageModels([10, 20]))).toBe(13);
  });

  it("counts text chips at their own marker width", () => {
    const models: ComposerChipModel[] = [{ id: 20, kind: "text" }];

    renderComposer(root, "ab [Text #1] cd", models, buildChip);

    expect(chipStartOffset(root, 20, models)).toBe(3);
    setCaretAtOffset(root, "ab [Text #1]".length, models);
    expect(adjacentChipId(root, "before")).toBe(20);
  });

  it("returns null for a chip that is not in the editor", () => {
    renderComposer(root, "[Image #1]", imageModels([10]), buildChip);
    expect(chipStartOffset(root, 99, imageModels([10]))).toBeNull();
  });
});
