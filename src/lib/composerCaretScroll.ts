/** Keeping the composer's caret visible after a programmatic edit.
 *
 *  The editor is a contenteditable capped at a max height, and every insertion
 *  (Shift+Enter, paste, an attachment marker) re-renders it and re-places the
 *  caret through the Selection API. A browser scrolls the caret into view for
 *  native typing, but not for a scripted selection change — so past the cap the
 *  caret, and everything typed after it, sat below the fold (#352).
 */

const CARET_SCROLL_PAD_PX = 4;

/** Next `scrollTop` that brings a caret spanning `caretTop`..`caretBottom` into
 *  the `viewTop`..`viewBottom` window, with `pad` of breathing room. All inputs
 *  share one coordinate space (client rects); the result is clamped to the
 *  scrollable range. Returns `scrollTop` unchanged when the caret is visible. */
export function scrollTopForCaret({
  scrollTop,
  maxScrollTop,
  viewTop,
  viewBottom,
  caretTop,
  caretBottom,
  pad = CARET_SCROLL_PAD_PX,
}: {
  scrollTop: number;
  maxScrollTop: number;
  viewTop: number;
  viewBottom: number;
  caretTop: number;
  caretBottom: number;
  pad?: number;
}): number {
  const clamp = (value: number) => Math.min(Math.max(value, 0), Math.max(maxScrollTop, 0));
  // Bottom first, so a rect taller than the window still resolves: an oversized
  // rect only comes from the element fallback below, where the caret sits at
  // that element's end.
  if (caretBottom > viewBottom - pad) {
    return clamp(scrollTop + (caretBottom - (viewBottom - pad)));
  }
  if (caretTop < viewTop + pad) {
    return clamp(scrollTop - (viewTop + pad - caretTop));
  }
  return scrollTop;
}

function isUsableRect(rect: DOMRect | undefined): rect is DOMRect {
  return !!rect && (rect.height > 0 || rect.width > 0 || rect.top !== 0);
}

/** Client rect of the collapsed caret. A caret sitting on an element boundary
 *  (between the `<br>`s of a freshly opened empty line) has no rect of its own
 *  in some engines, so fall back to the node it was placed next to. */
function caretRect(range: Range): DOMRect | null {
  // Range geometry is a layout API: present in the webview, absent under jsdom.
  const direct =
    typeof range.getClientRects === "function"
      ? (range.getClientRects()[0] ?? range.getBoundingClientRect())
      : undefined;
  if (isUsableRect(direct)) return direct;
  const container = range.startContainer;
  const neighbour =
    container.nodeType === 1
      ? (container.childNodes[range.startOffset] ??
        container.childNodes[range.startOffset - 1] ??
        container)
      : container;
  const element = neighbour.nodeType === 1 ? (neighbour as Element) : neighbour.parentElement;
  const rect = element?.getBoundingClientRect();
  return isUsableRect(rect) ? rect : null;
}

/** Scroll `field` the minimum amount needed to show its caret. No-op when the
 *  selection is elsewhere, the caret has no measurable position, or it is
 *  already visible. */
export function scrollCaretIntoView(field: HTMLElement): void {
  const selection = field.ownerDocument.getSelection?.();
  if (!selection || selection.rangeCount === 0) return;
  const range = selection.getRangeAt(0);
  if (!field.contains(range.startContainer)) return;
  const caret = caretRect(range);
  if (!caret) return;
  const view = field.getBoundingClientRect();
  const next = scrollTopForCaret({
    scrollTop: field.scrollTop,
    maxScrollTop: field.scrollHeight - field.clientHeight,
    viewTop: view.top,
    viewBottom: view.bottom,
    caretTop: caret.top,
    caretBottom: caret.bottom,
  });
  if (next !== field.scrollTop) field.scrollTop = next;
}
