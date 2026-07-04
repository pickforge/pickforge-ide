import { insertMarker, markerSpans, removeMarkerAndRenumber } from "./imageAnchors";

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
  return {
    attachments: attachments.filter((attachment) => attachment.id !== id),
    text: removeMarkerAndRenumber(text, index + 1, attachments.length),
    removed: attachments[index],
    removedIndex: index + 1,
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
  const chipSpans = markerSpans(text).filter((span) => span.n >= 1 && span.n <= count);
  for (const span of chipSpans) {
    if (from > span.start && from < span.end) from = span.start;
    if (to > span.start && to < span.end) to = span.end;
  }
  const droppedNs = [
    ...new Set(
      chipSpans
        .filter((span) => span.start >= from && span.end <= to)
        .map((span) => span.n),
    ),
  ].sort((a, b) => b - a);
  // Renumber only the pre-existing text around the replacement — the inserted
  // chunk is user content and must survive verbatim even when it happens to
  // contain marker syntax like "[Image #1]".
  let before = text.slice(0, from);
  let after = text.slice(to);
  let remaining = count;
  for (const n of droppedNs) {
    before = removeMarkerAndRenumber(before, n, remaining);
    after = removeMarkerAndRenumber(after, n, remaining);
    remaining -= 1;
  }
  const droppedIds = new Set(droppedNs.map((n) => attachments[n - 1].id));
  return {
    attachments: attachments.filter((attachment) => !droppedIds.has(attachment.id)),
    removed: attachments.filter((attachment) => droppedIds.has(attachment.id)),
    text: before + chunk + after,
    cursor: before.length + chunk.length,
  };
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
