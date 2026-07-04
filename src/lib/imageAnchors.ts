// Composer image anchors: `[Image #N]` markers (1-based into the attachment
// list) let the send path interleave images at the exact spot they were
// dropped/pasted. Pure text transforms so they can be unit-tested without the
// SolidJS composer.

const MARKER = /\[Image #(\d+)\]/g;

/**
 * Insert `[Image #n]` into `text` at `cursor`. Prefixes a space when the
 * preceding character isn't whitespace (and the field isn't empty), so the
 * marker never fuses onto the previous word. Returns the new text and the
 * cursor position just after the inserted marker.
 */
export function insertMarker(
  text: string,
  n: number,
  cursor: number,
): { text: string; cursor: number } {
  const at = Math.max(0, Math.min(cursor, text.length));
  const before = text.slice(0, at);
  const after = text.slice(at);
  const needsSpace = before.length > 0 && !/\s$/.test(before);
  const insertion = `${needsSpace ? " " : ""}[Image #${n}]`;
  return { text: before + insertion + after, cursor: at + insertion.length };
}

/**
 * Every `[Image #N]` occurrence in `text` with its number and [start, end)
 * span, in document order.
 */
export function markerSpans(
  text: string,
): { n: number; start: number; end: number }[] {
  const spans: { n: number; start: number; end: number }[] = [];
  const re = new RegExp(MARKER.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    spans.push({ n: Number(m[1]), start: m.index, end: m.index + m[0].length });
  }
  return spans;
}

/**
 * Drop every literal `[Image #removed]` occurrence and decrement every marker
 * numbered above it, keeping markers in lockstep with the attachment list after
 * an image is removed. Markers below `removed`, and markers beyond
 * `imageCount` (literal text that never referenced an attachment), are left
 * untouched.
 */
export function removeMarkerAndRenumber(
  text: string,
  removed: number,
  imageCount: number,
): string {
  return text.replace(MARKER, (match, digits: string) => {
    const value = Number(digits);
    if (value === removed) return "";
    if (value > removed && value <= imageCount) return `[Image #${value - 1}]`;
    return match;
  });
}
