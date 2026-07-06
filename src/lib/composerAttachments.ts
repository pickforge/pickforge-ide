export type ComposerAttachmentKind = "image" | "text";

const MARKER_LABEL: Record<ComposerAttachmentKind, string> = {
  image: "Image",
  text: "Text",
};
const MARKER = /\[(Image|Text) #(\d+)\]/g;
const IMAGE_MARKER_IN_TEXT = /\[Image #(\d+)\]/g;

type MarkerSpan = {
  kind: ComposerAttachmentKind;
  n: number;
  id: number;
  start: number;
  end: number;
};

type DroppedMarker = Pick<MarkerSpan, "kind" | "n" | "id">;

function kindFromLabel(label: string): ComposerAttachmentKind {
  return label === "Text" ? "text" : "image";
}

function markerText(kind: ComposerAttachmentKind, n: number): string {
  return `[${MARKER_LABEL[kind]} #${n}]`;
}

function insertMarker(
  text: string,
  kind: ComposerAttachmentKind,
  n: number,
  cursor: number,
): { text: string; cursor: number } {
  const at = Math.max(0, Math.min(cursor, text.length));
  const before = text.slice(0, at);
  const after = text.slice(at);
  const needsSpace = kind === "image" && before.length > 0 && !/\s$/.test(before);
  const insertion = `${needsSpace ? " " : ""}${markerText(kind, n)}`;
  return { text: before + insertion + after, cursor: at + insertion.length };
}

export function escapeImageMarkersInTextAttachment(content: string): string {
  return content.replace(
    IMAGE_MARKER_IN_TEXT,
    (_match, index: string) => `[Image #${index}\u200B]`,
  );
}

function attachmentIndex(
  attachments: readonly ComposerAttachment[],
  id: number,
): { kind: ComposerAttachmentKind; index: number } | null {
  const attachment = attachments.find((a) => a.id === id);
  if (!attachment) return null;
  const index = attachments
    .filter((a) => a.kind === attachment.kind)
    .findIndex((a) => a.id === id);
  return index < 0 ? null : { kind: attachment.kind, index: index + 1 };
}

export function attachmentMarkerText(
  attachments: readonly ComposerAttachment[],
  id: number,
): string | null {
  const info = attachmentIndex(attachments, id);
  return info ? markerText(info.kind, info.index) : null;
}

function chipSpansOf(
  text: string,
  attachments: readonly ComposerAttachment[],
): MarkerSpan[] {
  const byKind = {
    image: attachments.filter((attachment) => attachment.kind === "image"),
    text: attachments.filter((attachment) => attachment.kind === "text"),
  };
  const seen = {
    image: new Set<number>(),
    text: new Set<number>(),
  };
  const spans: MarkerSpan[] = [];
  const re = new RegExp(MARKER.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const kind = kindFromLabel(m[1]);
    const n = Number(m[2]);
    const attachment = byKind[kind][n - 1];
    if (!attachment || seen[kind].has(n)) continue;
    seen[kind].add(n);
    spans.push({ kind, n, id: attachment.id, start: m.index, end: m.index + m[0].length });
  }
  return spans;
}

// Rebuild `[segStart, segEnd)` of `text` span-wise: dropped chips vanish,
// surviving chips renumber via `shifted`, everything else — including literal
// duplicate markers — survives verbatim.
function renumberSegment(
  text: string,
  spans: readonly MarkerSpan[],
  dropped: readonly DroppedMarker[],
  segStart: number,
  segEnd: number,
): string {
  const droppedKeys = new Set(dropped.map((span) => `${span.kind}:${span.n}`));
  const shifted = (span: MarkerSpan) =>
    span.n - dropped.filter((d) => d.kind === span.kind && d.n < span.n).length;
  let out = "";
  let at = segStart;
  for (const span of spans) {
    if (span.start < segStart || span.start >= segEnd) continue;
    out += text.slice(at, span.start);
    if (!droppedKeys.has(`${span.kind}:${span.n}`)) {
      out += markerText(span.kind, shifted(span));
    }
    at = span.end;
  }
  return out + text.slice(at, segEnd);
}

export type ComposerAttachmentStatus = "pending" | "ready";

export type ImageComposerAttachment = {
  id: number;
  kind: "image";
  status: ComposerAttachmentStatus;
  path: string | null;
  previewUrl: string | null;
};

export type TextComposerAttachment = {
  id: number;
  kind: "text";
  status: "ready";
  content: string;
};

export type ComposerAttachment = ImageComposerAttachment | TextComposerAttachment;

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
  previous: ImageComposerAttachment | null;
};

export type PreparingDecision = "wait" | "dispatch" | "abort";

export function createPendingAttachment(
  id: number,
  previewUrl: string | null,
): ImageComposerAttachment {
  return {
    id,
    kind: "image",
    status: "pending",
    path: null,
    previewUrl,
  };
}

export function createTextAttachment(
  id: number,
  content: string,
): TextComposerAttachment {
  return {
    id,
    kind: "text",
    status: "ready",
    content,
  };
}

export function addAttachmentWithMarker(
  attachments: readonly ComposerAttachment[],
  text: string,
  cursor: number,
  attachment: ComposerAttachment,
): AttachmentMarkerState {
  const index = attachments.filter((a) => a.kind === attachment.kind).length + 1;
  const marker = insertMarker(text, attachment.kind, index, cursor);
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
  const attachment = attachments[index];
  const info = attachmentIndex(attachments, id);
  if (!info) {
    return {
      attachments: attachments.filter((a) => a.id !== id),
      text,
      removed: attachment,
      removedIndex: null,
    };
  }
  const dropped = [{ kind: info.kind, n: info.index, id }];
  return {
    attachments: attachments.filter((attachment) => attachment.id !== id),
    text: renumberSegment(
      text,
      chipSpansOf(text, attachments),
      dropped,
      0,
      text.length,
    ),
    removed: attachments[index],
    removedIndex: info.index,
  };
}

export function updateTextAttachmentContent(
  attachments: readonly ComposerAttachment[],
  text: string,
  id: number,
  content: string,
): AttachmentRemoval {
  const attachment = attachments.find((item) => item.id === id);
  if (!attachment || attachment.kind !== "text") {
    return {
      attachments: [...attachments],
      text,
      removed: null,
      removedIndex: null,
    };
  }
  if (content.trim().length === 0) {
    return removeAttachmentWithMarker(attachments, text, id);
  }
  return {
    attachments: attachments.map((item) =>
      item.id === id && item.kind === "text" ? { ...item, content } : item,
    ),
    text,
    removed: null,
    removedIndex: null,
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
  if (previous.kind !== "image") {
    return {
      attachments: [...attachments],
      previous: null,
    };
  }
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
  const chipSpans = chipSpansOf(text, attachments);
  for (const span of chipSpans) {
    if (from > span.start && from < span.end) from = span.start;
    if (to > span.start && to < span.end) to = span.end;
  }
  const dropped = chipSpans
    .filter((span) => span.start >= from && span.end <= to)
    .map((span) => ({ kind: span.kind, n: span.n, id: span.id }));
  const before = renumberSegment(text, chipSpans, dropped, 0, from);
  const after = renumberSegment(text, chipSpans, dropped, to, text.length);
  const droppedIds = new Set(dropped.map((span) => span.id));
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
  const info = attachmentIndex(attachments, id);
  if (!info) return null;
  return renumberSegment(
    text,
    chipSpansOf(text, attachments),
    [{ kind: info.kind, n: info.index, id }],
    0,
    Math.max(0, Math.min(offset, text.length)),
  ).length;
}

export function hasPendingAttachments(attachments: readonly ComposerAttachment[]): boolean {
  return attachments.some((attachment) => attachment.status === "pending");
}

export function readyAttachmentPaths(attachments: readonly ComposerAttachment[]): string[] {
  return attachments.flatMap((attachment) =>
    attachment.kind === "image" && attachment.status === "ready" && attachment.path
      ? [attachment.path]
      : [],
  );
}

export function expandTextAttachments(
  attachments: readonly ComposerAttachment[],
  text: string,
): string {
  const spans = chipSpansOf(text, attachments);
  const hasImages = attachments.some((attachment) => attachment.kind === "image");
  let out = "";
  let at = 0;
  for (const span of spans) {
    if (span.kind !== "text") continue;
    const attachment = attachments.find((a) => a.id === span.id);
    if (attachment?.kind !== "text") continue;
    out += text.slice(at, span.start);
    out += hasImages
      ? escapeImageMarkersInTextAttachment(attachment.content)
      : attachment.content;
    at = span.end;
  }
  return out + text.slice(at);
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
