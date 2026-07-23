// Contenteditable ↔ string bridge for the chat composer. The composer's text
// model is still a plain string carrying `[Image #N]` / `[Text #N]` markers;
// these pure functions map that string to/from the editor DOM so each marker
// renders as an atomic, button-like chip while everything downstream keeps
// consuming the string.
//
// A chip is any element carrying `data-chip-attachment-id`. Its serialized form
// is `[Kind #N]` where N is the 1-based position of that attachment id among
// current attachments of the same kind.

export const CHIP_ATTR = "data-chip-attachment-id";
export const CHIP_KIND_ATTR = "data-chip-attachment-kind";

export type ComposerChipKind = "image" | "text";
export type ComposerChipModel = {
  id: number;
  kind: ComposerChipKind;
};

const BLOCK_TAGS = new Set(["DIV", "P"]);
const MARKER = /\[(Image|Text) #(\d+)\]/g;
const MARKER_LABEL: Record<ComposerChipKind, string> = {
  image: "Image",
  text: "Text",
};

// WebKit paints an element-boundary caret placed right after a trailing
// non-editable inline element at the start of the line, not after the element.
// A zero-width-space text node after a trailing chip gives the caret a text
// position to live in; it is stripped from every serialization so the string
// model never sees it.
const CARET_FILLER = "\u200B";
const FILLER_RE = /\u200B/g;

function isFillerOnly(segment: string): boolean {
  return segment.replace(FILLER_RE, "") === "";
}

function kindFromLabel(label: string): ComposerChipKind {
  return label === "Text" ? "text" : "image";
}

function markerText(kind: ComposerChipKind, index: number): string {
  return `[${MARKER_LABEL[kind]} #${index}]`;
}

function chipIndex(
  attachmentModels: readonly ComposerChipModel[],
  id: number,
): { kind: ComposerChipKind; index: number } | null {
  const model = attachmentModels.find((attachment) => attachment.id === id);
  if (!model) return null;
  const index = attachmentModels
    .filter((attachment) => attachment.kind === model.kind)
    .findIndex((attachment) => attachment.id === id);
  return index < 0 ? null : { kind: model.kind, index: index + 1 };
}

function markerLength(kind: ComposerChipKind, index: number): number {
  return markerText(kind, index).length;
}

export function serializeComposer(
  root: Node,
  attachmentModels: readonly ComposerChipModel[],
): string {
  let out = "";
  const walk = (node: Node): void => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) {
        out += (child as Text).data.replace(FILLER_RE, "");
        continue;
      }
      if (child.nodeType !== 1) continue;
      const el = child as Element;
      if (el.hasAttribute(CHIP_ATTR)) {
        const info = chipIndex(attachmentModels, Number(el.getAttribute(CHIP_ATTR)));
        if (info) out += markerText(info.kind, info.index);
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
 *  children in place.
 *
 *  Only the FIRST occurrence of each marker number becomes a chip; duplicates
 *  (e.g. a pasted literal "[Image #1]" kept verbatim next to the real anchor)
 *  stay plain text. The string can't distinguish the pasted literal from the
 *  generated anchor, but this keeps the invariant that matters: one chip per
 *  attachment id, and serialize(render(text)) === text. */
export function renderComposer(
  root: HTMLElement,
  text: string,
  attachmentModels: readonly ComposerChipModel[],
  buildChip: (attachmentId: number, kind: ComposerChipKind, index: number) => Node,
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
  const byKind = {
    image: attachmentModels.filter((attachment) => attachment.kind === "image"),
    text: attachmentModels.filter((attachment) => attachment.kind === "text"),
  };
  const chipped = {
    image: new Set<number>(),
    text: new Set<number>(),
  };
  let last = 0;
  let m: RegExpExecArray | null;
  const re = new RegExp(MARKER.source, "g");
  while ((m = re.exec(text)) !== null) {
    const kind = kindFromLabel(m[1]);
    const n = Number(m[2]);
    appendText(text.slice(last, m.index));
    if (n >= 1 && n <= byKind[kind].length && !chipped[kind].has(n)) {
      chipped[kind].add(n);
      frag.appendChild(buildChip(byKind[kind][n - 1].id, kind, n));
    } else {
      appendText(m[0]);
    }
    last = m.index + m[0].length;
  }
  appendText(text.slice(last));
  const tail = frag.lastChild;
  if (tail && tail.nodeType === 1 && (tail as Element).hasAttribute(CHIP_ATTR)) {
    frag.appendChild(doc.createTextNode(CARET_FILLER));
  }
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
  attachmentModels: readonly ComposerChipModel[],
): number | null {
  const chip = root.querySelector(`[${CHIP_ATTR}="${id}"]`);
  if (!chip) return null;
  const pre = root.ownerDocument.createRange();
  pre.selectNodeContents(root);
  pre.setEndBefore(chip);
  return serializeComposer(pre.cloneContents(), attachmentModels).length;
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
 *  marker length). `null` when the selection isn't inside `root`. */
export function selectionOffsets(
  root: HTMLElement,
  attachmentModels: readonly ComposerChipModel[],
): { start: number; end: number } | null {
  const sel = activeSelection(root);
  if (!sel) return null;
  const range = sel.getRangeAt(0);
  const measure = (container: Node, offset: number): number => {
    const pre = root.ownerDocument.createRange();
    pre.selectNodeContents(root);
    pre.setEnd(container, offset);
    return serializeComposer(pre.cloneContents(), attachmentModels).length;
  };
  return {
    start: measure(range.startContainer, range.startOffset),
    end: measure(range.endContainer, range.endOffset),
  };
}

/** String offset of the caret (collapsed selection start). */
export function caretOffset(
  root: HTMLElement,
  attachmentModels: readonly ComposerChipModel[],
): number | null {
  return selectionOffsets(root, attachmentModels)?.start ?? null;
}

function locate(
  root: HTMLElement,
  target: number,
  attachmentModels: readonly ComposerChipModel[],
): { node: Node; offset: number } {
  let remaining = target;
  let found: { node: Node; offset: number } | null = null;
  // eslint-disable-next-line complexity -- TODO(#263): reduce legacy function complexity.
  const walk = (node: Node): boolean => {
    const children = Array.from(node.childNodes);
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (child.nodeType === 3) {
        const data = (child as Text).data;
        let at = 0;
        while (at < data.length && remaining > 0) {
          if (data[at] !== CARET_FILLER) remaining -= 1;
          at += 1;
        }
        if (remaining <= 0) {
          found = { node: child, offset: at };
          return true;
        }
        continue;
      }
      if (child.nodeType !== 1) continue;
      const el = child as Element;
      if (el.hasAttribute(CHIP_ATTR)) {
        if (remaining <= 0) {
          found = { node, offset: i };
          return true;
        }
        const info = chipIndex(attachmentModels, Number(el.getAttribute(CHIP_ATTR)));
        remaining -= info ? markerLength(info.kind, info.index) : 0;
        if (remaining <= 0) {
          const next = children[i + 1];
          found =
            next?.nodeType === 3
              ? { node: next, offset: 0 }
              : { node, offset: i + 1 };
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
  attachmentModels: readonly ComposerChipModel[],
): void {
  const sel = root.ownerDocument.getSelection?.();
  if (!sel) return;
  const { node, offset: at } = locate(root, Math.max(0, offset), attachmentModels);
  const range = root.ownerDocument.createRange();
  range.setStart(node, at);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

/** True when a forward Delete at the collapsed caret would only consume the
 *  trailing caret filler (no real content follows). The composer prevents the
 *  default then: eating the filler would put WebKit back on the element-boundary
 *  caret the filler exists to avoid, and a Delete at the end of the message is a
 *  no-op anyway. */
export function deleteTargetsFillerTail(root: HTMLElement): boolean {
  const sel = activeSelection(root);
  if (!sel || !sel.isCollapsed) return false;
  const range = sel.getRangeAt(0);
  const container = range.startContainer;
  if (container.nodeType !== 3) return false;
  const text = container as Text;
  if (!isFillerOnly(text.data.slice(range.startOffset))) return false;
  let node: Node | null = text;
  while (node && node !== root) {
    if (node.nextSibling) return false;
    node = node.parentNode;
  }
  return true;
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
      return isFillerOnly(text.data.slice(0, offset)) ? chipId(text.previousSibling) : null;
    }
    return isFillerOnly(text.data.slice(offset)) ? chipId(text.nextSibling) : null;
  }
  const children = container.childNodes;
  return direction === "before"
    ? chipId(children[offset - 1] ?? null)
    : chipId(children[offset] ?? null);
}
