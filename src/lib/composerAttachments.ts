import { insertMarker, markerSpans } from "./imageAnchors";

type MarkerSpan = { n: number; start: number; end: number };

// Chip-backed spans follow renderComposer's rule: only the FIRST occurrence of
// each marker number in 1..count anchors the attachment; literal duplicates
// (a pasted "[Image #1]" next to the real chip) are plain text.
function chipSpansOf(text: string, count: number): MarkerSpan[] {
  const seen = new Set<number>();
  return markerSpans(text).filter((span) => {
    if (span.n < 1 || span.n > count || seen.has(span.n)) return false;
    seen.add(span.n);
    return true;
  });
}

// Rebuild `[segStart, segEnd)` of `text` span-wise: dropped chips vanish,
// surviving chips renumber via `shifted`, everything else — including literal
// duplicate markers — survives verbatim.
function renumberSegment(
  text: string,
  spans: readonly MarkerSpan[],
  dropped: ReadonlySet<number>,
  shifted: (n: number) => number,
  segStart: number,
  segEnd: number,
): string {
  let out = "";
  let at = segStart;
  for (const span of spans) {
    if (span.start < segStart || span.start >= segEnd) continue;
    out += text.slice(at, span.start);
    if (!dropped.has(span.n)) out += `[Image #${shifted(span.n)}]`;
    at = span.end;
  }
  return out + text.slice(at, segEnd);
}

export type ComposerAttachmentStatus = "pending" | "ready";

export type ComposerAttachment = {
  id: number;
  status: ComposerAttachmentStatus;
  path: string | null;
  previewUrl: string | null;
};

export type AttachmentMarkerState = {
  attachments: ComposerAttachment[];
  text: string;
  cursor: number;
  index: number;
};

export type AttachmentRemoval = {
  attachments: ComposerAttachment[];
  text: string;
  removed: ComposerAttachment | null;
  removedIndex: number | null;
};

export type AttachmentResolution = {
  attachments: ComposerAttachment[];
  previous: ComposerAttachment | null;
};

export type PreparingDecision = "wait" | "dispatch" | "abort";

export function createPendingAttachment(
  id: number,
  previewUrl: string | null,
): ComposerAttachment {
  return {
    id,
    status: "pending",
    path: null,
    previewUrl,
  };
}

export function addAttachmentWithMarker(
  attachments: readonly ComposerAttachment[],
  text: string,
  cursor: number,
  attachment: ComposerAttachment,
): AttachmentMarkerState {
  const index = attachments.length + 1;
  const marker = insertMarker(text, index, cursor);
  return {
    attachments: [...attachments, attachment],
    text: marker.text,
    cursor: marker.cursor,
    index,
  };
}

export function removeAttachmentWithMarker(
  attachments: readonly ComposerAttachment[],
  text: string,
  id: number,
): AttachmentRemoval {
  const index = attachments.findIndex((attachment) => attachment.id === id);
  if (index < 0) {
    return {
      attachments: [...attachments],
      text,
      removed: null,
      removedIndex: null,
    };
  }
  const n = index + 1;
  return {
    attachments: attachments.filter((attachment) => attachment.id !== id),
    text: renumberSegment(
      text,
      chipSpansOf(text, attachments.length),
      new Set([n]),
      (v) => (v > n ? v - 1 : v),
      0,
      text.length,
    ),
    removed: attachments[index],
    removedIndex: n,
  };
}

export function resolveAttachment(
  attachments: readonly ComposerAttachment[],
  id: number,
  path: string,
  previewUrl: string,
): AttachmentResolution {
  const index = attachments.findIndex((attachment) => attachment.id === id);
  if (index < 0) {
    return {
      attachments: [...attachments],
      previous: null,
    };
  }
  const previous = attachments[index];
  return {
    attachments: attachments.map((attachment) =>
      attachment.id === id
        ? {
            ...attachment,
            status: "ready",
            path,
            previewUrl,
          }
        : attachment,
    ),
    previous,
  };
}

export type RangeReplacement = {
  attachments: ComposerAttachment[];
  removed: ComposerAttachment[];
  text: string;
  cursor: number;
};

/**
 * Replace `[start, end)` of `text` with `chunk`, upholding the chip invariant:
 * any attachment whose marker is covered by the replaced range is dropped from
 * the list (returned in `removed` so previews can be revoked) and the surviving
 * markers are renumbered. Range endpoints that land strictly inside a
 * chip-backed marker snap outward to the whole marker — chips are atomic.
 * Literal markers with no matching attachment are plain text and are spliced
 * like any other characters. `cursor` is the offset just after `chunk` in the
 * returned text.
 */
export function replaceRangeWithText(
  attachments: readonly ComposerAttachment[],
  text: string,
  start: number,
  end: number,
  chunk: string,
): RangeReplacement {
  let from = Math.max(0, Math.min(start, text.length));
  let to = Math.min(Math.max(from, end), text.length);
  const count = attachments.length;
  const chipSpans = chipSpansOf(text, count);
  for (const span of chipSpans) {
    if (from > span.start && from < span.end) from = span.start;
    if (to > span.start && to < span.end) to = span.end;
  }
  const droppedNs = chipSpans
    .filter((span) => span.start >= from && span.end <= to)
    .map((span) => span.n);
  const dropped = new Set(droppedNs);
  const shifted = (n: number) => n - droppedNs.filter((d) => d < n).length;
  const before = renumberSegment(text, chipSpans, dropped, shifted, 0, from);
  const after = renumberSegment(text, chipSpans, dropped, shifted, to, text.length);
  const droppedIds = new Set(droppedNs.map((n) => attachments[n - 1].id));
  return {
    attachments: attachments.filter((attachment) => !droppedIds.has(attachment.id)),
    removed: attachments.filter((attachment) => droppedIds.has(attachment.id)),
    text: before + chunk + after,
    cursor: before.length + chunk.length,
  };
}

/** Where a caret at `offset` lands after attachment `id` is removed — the
 *  prefix is mapped through the same span-wise removal/renumbering as
 *  `removeAttachmentWithMarker`. `null` when `id` isn't attached. */
export function offsetAfterRemoval(
  attachments: readonly ComposerAttachment[],
  text: string,
  id: number,
  offset: number,
): number | null {
  const index = attachments.findIndex((attachment) => attachment.id === id);
  if (index < 0) return null;
  const n = index + 1;
  return renumberSegment(
    text,
    chipSpansOf(text, attachments.length),
    new Set([n]),
    (v) => (v > n ? v - 1 : v),
    0,
    Math.max(0, Math.min(offset, text.length)),
  ).length;
}

export function hasPendingAttachments(attachments: readonly ComposerAttachment[]): boolean {
  return attachments.some((attachment) => attachment.status === "pending");
}

export function readyAttachmentPaths(attachments: readonly ComposerAttachment[]): string[] {
  return attachments.flatMap((attachment) =>
    attachment.status === "ready" && attachment.path ? [attachment.path] : [],
  );
}

export function decidePreparingState(input: {
  attachments: readonly ComposerAttachment[];
  failed: boolean;
  hasContent: boolean;
}): PreparingDecision {
  if (input.failed) return "abort";
  if (hasPendingAttachments(input.attachments)) return "wait";
  return input.hasContent || input.attachments.length > 0 ? "dispatch" : "abort";
}
