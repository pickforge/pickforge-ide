import { insertMarker, removeMarkerAndRenumber } from "./imageAnchors";

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
