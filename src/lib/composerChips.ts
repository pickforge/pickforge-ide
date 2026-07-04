// Contenteditable ↔ string bridge for the chat composer. The composer's text
// model is still a plain string carrying `[Image #N]` markers (see
// imageAnchors.ts); these pure functions map that string to/from the editor DOM
// so each marker renders as an atomic, button-like chip while everything
// downstream keeps consuming the string.
//
// A chip is any element carrying `data-chip-attachment-id`. Its serialized form
// is `[Image #N]` where N is the 1-based position of that attachment id in the
// current attachment list — so removing an attachment renumbers every chip via
// the id→index mapping alone.

export const CHIP_ATTR = "data-chip-attachment-id";

const BLOCK_TAGS = new Set(["DIV", "P"]);

function markerLength(index: number): number {
  return `[Image #${index}]`.length;
}

/** DOM → string. Text nodes verbatim; `<br>` and block boundaries → `\n`; a chip
 *  → `[Image #N]` (N = 1-based index of its attachment id). Chips whose id is not
 *  in `attachmentIds` are dropped (the model/DOM re-sync handles that case). */
export function serializeComposer(root: Node, attachmentIds: readonly number[]): string {
  let out = "";
  const walk = (node: Node): void => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) {
        out += (child as Text).data;
        continue;
      }
      if (child.nodeType !== 1) continue;
      const el = child as Element;
      if (el.hasAttribute(CHIP_ATTR)) {
        const idx = attachmentIds.indexOf(Number(el.getAttribute(CHIP_ATTR)));
        if (idx >= 0) out += `[Image #${idx + 1}]`;
        continue;
      }
      if (el.tagName === "BR") {
        out += "\n";
        continue;
      }
      if (BLOCK_TAGS.has(el.tagName) && out.length > 0 && !out.endsWith("\n")) {
        out += "\n";
      }
      walk(el);
    }
  };
  walk(root);
  return out;
}

/** String → DOM. Markers pointing at an existing attachment become chips (built
 *  by `buildChip`); any other text — including a hand-typed `[Image #7]` with no
 *  matching attachment — stays plain text. `\n` → `<br>`. Replaces `root`'s
 *  children in place. */
export function renderComposer(
  root: HTMLElement,
  text: string,
  attachmentIds: readonly number[],
  buildChip: (attachmentId: number, index: number) => Node,
): void {
  const doc = root.ownerDocument;
  const frag = doc.createDocumentFragment();
  const appendText = (segment: string): void => {
    if (segment === "") return;
    const lines = segment.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (i > 0) frag.appendChild(doc.createElement("br"));
      if (lines[i]) frag.appendChild(doc.createTextNode(lines[i]));
    }
  };
  const re = /\[Image #(\d+)\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const n = Number(m[1]);
    appendText(text.slice(last, m.index));
    if (n >= 1 && n <= attachmentIds.length) {
      frag.appendChild(buildChip(attachmentIds[n - 1], n));
    } else {
      appendText(m[0]);
    }
    last = m.index + m[0].length;
  }
  appendText(text.slice(last));
  root.replaceChildren(frag);
}

/** Chip attachment ids in document order — used to reconcile the model after the
 *  user deletes or reorders chips by editing. */
export function chipIdsInOrder(root: HTMLElement): number[] {
  return Array.from(root.querySelectorAll(`[${CHIP_ATTR}]`)).map((el) =>
    Number(el.getAttribute(CHIP_ATTR)),
  );
}

/** Serialized string offset at which the chip for `id` starts, or `null` when
 *  no such chip is in the editor. Offsets before the chip are unaffected by its
 *  removal, so this is the caret target for delete-in-place. */
export function chipStartOffset(
  root: HTMLElement,
  id: number,
  attachmentIds: readonly number[],
): number | null {
  const chip = root.querySelector(`[${CHIP_ATTR}="${id}"]`);
  if (!chip) return null;
  const pre = root.ownerDocument.createRange();
  pre.selectNodeContents(root);
  pre.setEndBefore(chip);
  return serializeComposer(pre.cloneContents(), attachmentIds).length;
}

function activeSelection(root: HTMLElement): Selection | null {
  const sel = root.ownerDocument.getSelection?.() ?? null;
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.startContainer)) return null;
  return sel;
}

/** String offsets of the current selection's start/end within `root`, measured
 *  in the same units as `serializeComposer` (so a chip counts as its full
 *  `[Image #N]` length). `null` when the selection isn't inside `root`. */
export function selectionOffsets(
  root: HTMLElement,
  attachmentIds: readonly number[],
): { start: number; end: number } | null {
  const sel = activeSelection(root);
  if (!sel) return null;
  const range = sel.getRangeAt(0);
  const measure = (container: Node, offset: number): number => {
    const pre = root.ownerDocument.createRange();
    pre.selectNodeContents(root);
    pre.setEnd(container, offset);
    return serializeComposer(pre.cloneContents(), attachmentIds).length;
  };
  return {
    start: measure(range.startContainer, range.startOffset),
    end: measure(range.endContainer, range.endOffset),
  };
}

/** String offset of the caret (collapsed selection start). */
export function caretOffset(
  root: HTMLElement,
  attachmentIds: readonly number[],
): number | null {
  return selectionOffsets(root, attachmentIds)?.start ?? null;
}

function locate(
  root: HTMLElement,
  target: number,
  attachmentIds: readonly number[],
): { node: Node; offset: number } {
  let remaining = target;
  let found: { node: Node; offset: number } | null = null;
  const walk = (node: Node): boolean => {
    const children = Array.from(node.childNodes);
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (child.nodeType === 3) {
        const len = (child as Text).data.length;
        if (remaining <= len) {
          found = { node: child, offset: remaining };
          return true;
        }
        remaining -= len;
        continue;
      }
      if (child.nodeType !== 1) continue;
      const el = child as Element;
      if (el.hasAttribute(CHIP_ATTR)) {
        if (remaining <= 0) {
          found = { node, offset: i };
          return true;
        }
        const idx = attachmentIds.indexOf(Number(el.getAttribute(CHIP_ATTR)));
        remaining -= idx >= 0 ? markerLength(idx + 1) : 0;
        if (remaining <= 0) {
          found = { node, offset: i + 1 };
          return true;
        }
        continue;
      }
      if (el.tagName === "BR") {
        if (remaining <= 0) {
          found = { node, offset: i };
          return true;
        }
        remaining -= 1;
        if (remaining <= 0) {
          found = { node, offset: i + 1 };
          return true;
        }
        continue;
      }
      if (walk(el)) return true;
    }
    return false;
  };
  if (!walk(root)) found = { node: root, offset: root.childNodes.length };
  return found!;
}

/** Place the caret at a string offset (inverse of `caretOffset`). Snaps to chip
 *  boundaries — never inside a chip. */
export function setCaretAtOffset(
  root: HTMLElement,
  offset: number,
  attachmentIds: readonly number[],
): void {
  const sel = root.ownerDocument.getSelection?.();
  if (!sel) return;
  const { node, offset: at } = locate(root, Math.max(0, offset), attachmentIds);
  const range = root.ownerDocument.createRange();
  range.setStart(node, at);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

/** Attachment id of the chip immediately adjacent to the collapsed caret in the
 *  given direction, or `null`. Lets the composer delete a whole chip on a single
 *  Backspace/Delete regardless of the engine's atomic-deletion behavior. */
export function adjacentChipId(
  root: HTMLElement,
  direction: "before" | "after",
): number | null {
  const sel = activeSelection(root);
  if (!sel || !sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  const container = range.startContainer;
  const offset = range.startOffset;
  const chipId = (node: Node | null): number | null => {
    if (node && node.nodeType === 1 && (node as Element).hasAttribute(CHIP_ATTR)) {
      return Number((node as Element).getAttribute(CHIP_ATTR));
    }
    return null;
  };
  if (container.nodeType === 3) {
    const text = container as Text;
    if (direction === "before") {
      return offset === 0 ? chipId(text.previousSibling) : null;
    }
    return offset >= text.data.length ? chipId(text.nextSibling) : null;
  }
  const children = container.childNodes;
  return direction === "before"
    ? chipId(children[offset - 1] ?? null)
    : chipId(children[offset] ?? null);
}
