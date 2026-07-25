import {
  type JSX,
  For,
  Show,
  batch,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";
import { Portal } from "solid-js/web";
import { convertFileSrc } from "@tauri-apps/api/core";
import { errorText } from "../../lib/errors";
import { hostPlatform } from "../../lib/platform";
import { flagEnabled } from "../../stores/flags";
import {
  type AgentProfile,
  discoverAgentCli,
  modelOption,
  nativeAgentProfiles,
  profileWithDiscoveredModels,
} from "../../lib/agentModels";
import {
  type AgentProvider,
  type AgentSkill,
  agentClipboardFilePaths,
  agentClipboardText,
  agentSkillsList,
  agentStashClipboardImage,
  agentStashImage,
  agentStashImageFromPath,
  codexConfigDefaultEffort,
} from "../../lib/agentChat";
import {
  agentBackendDescriptor,
  isNativeAgentProvider,
  type AgentEngine,
} from "../../lib/agentBackends";
import { defaultMode, isDangerMode, modeOptions } from "../../lib/agentModes";
import {
  type ComposerAttachment,
  type TextComposerAttachment,
  addAttachmentWithMarker,
  attachmentMarkerText,
  createPendingAttachment,
  createTextAttachment,
  decidePreparingState,
  escapeImageMarkersInTextAttachment,
  expandTextAttachments,
  hasPendingAttachments,
  offsetAfterRemoval,
  readyAttachmentPaths,
  removeAttachmentWithMarker,
  replaceRangeWithText,
  resolveAttachment,
  updateTextAttachmentContent,
} from "../../lib/composerAttachments";
import {
  CHIP_ATTR,
  CHIP_KIND_ATTR,
  type ComposerChipKind,
  type ComposerChipModel,
  adjacentChipId,
  caretOffset,
  chipIdsInOrder,
  chipStartOffset,
  deleteTargetsFillerTail,
  renderComposer,
  selectionOffsets,
  serializeComposer,
  setCaretAtOffset,
} from "../../lib/composerChips";
import { scrollCaretIntoView } from "../../lib/composerCaretScroll";
import { type PromptTemplate, matchTemplates } from "../../lib/promptTemplates";
import { filePathsFromUriList, registerPathDropTarget } from "../../lib/terminalDrop";
import { Dropdown, type DropdownOption } from "../Dropdown";
import {
  IconClaude,
  IconClose,
  IconForgeFlame,
  IconIngot,
  IconOmp,
  IconOpenAI,
  IconPi,
  IconShield,
} from "../icons";
import { Spinner } from "../ui";
import { openLightbox } from "./ImageLightbox";
import "./chat.css";

const PROVIDER_ICON: Record<AgentProvider, () => JSX.Element> = {
  claudeCode: () => <IconClaude size={13} />,
  codex: () => <IconOpenAI size={13} />,
  omp: () => <IconOmp size={13} />,
  pi: () => <IconPi size={13} />,
};

const EFFORT_LABELS: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "X-High",
  max: "Max",
};

// Forge heat per effort level — drives the flame icon's solid core.
const EFFORT_HEAT: Record<string, number> = {
  low: 0.15,
  medium: 0.4,
  high: 0.6,
  xhigh: 0.8,
  max: 1,
};

// A ~/.codex/config.toml `model_reasoning_effort` override beats the model's
// own default for turns sent without an explicit effort. Fetched once.
const [codexEffortOverride, setCodexEffortOverride] = createSignal<string | null>(null);
let codexEffortOverrideRequested = false;
function ensureCodexEffortOverride() {
  if (codexEffortOverrideRequested) return;
  codexEffortOverrideRequested = true;
  void codexConfigDefaultEffort()
    .then((value) => setCodexEffortOverride(value?.trim() || null))
    .catch(() => undefined);
}

const skillsCache = new Map<AgentProvider, AgentSkill[]>();
const skillsInflight = new Map<AgentProvider, Promise<AgentSkill[]>>();

function loadSkills(provider: AgentProvider): Promise<AgentSkill[]> {
  const cached = skillsCache.get(provider);
  if (cached) return Promise.resolve(cached);
  const inflight = skillsInflight.get(provider);
  if (inflight) return inflight;
  const promise = agentSkillsList(provider)
    .then((list) => {
      skillsCache.set(provider, list);
      skillsInflight.delete(provider);
      return list;
    })
    .catch(() => {
      skillsInflight.delete(provider);
      return [] as AgentSkill[];
    });
  skillsInflight.set(provider, promise);
  return promise;
}

const ACCEPTED_MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};
const ACCEPTED_PATH_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp"]);
const LONG_TEXT_ATTACHMENT_CHARS = 2000;

function acceptedPathExt(path: string): string | null {
  const name = path.split(/[\\/]/).pop() ?? path;
  const dot = name.lastIndexOf(".");
  if (dot < 0) return null;
  const ext = name.slice(dot + 1).toLowerCase();
  return ACCEPTED_PATH_EXT.has(ext) ? ext : null;
}

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("unreadable"));
        return;
      }
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error("unreadable"));
    reader.readAsDataURL(file);
  });
}

function modelsFor(profiles: AgentProfile[], provider: AgentProvider) {
  return profiles
    .find((agent) => agent.id === provider)
    ?.models.filter((model) => !model.terminalOnly) ?? [];
}

type Suggestion =
  | { kind: "template"; template: PromptTemplate }
  | { kind: "skill"; skill: AgentSkill };

// Composer is the app's primary chat input: ~25 signals/refs (attachments, paste state, text
// preview, drag-drop, provider/model/effort/mode, suggestions) shared across dozens of event
// handlers and closures in one function body. Splitting it into composables/child components (the
// pattern used elsewhere in this pass) would need most of that state threaded across the new
// boundaries, and unlike every other component touched in this pass, it has zero test coverage of
// its own behavior (composerAttachments.test.ts and composerChips.test.ts only cover its pure
// helper libs, not this component) to verify a deeper split against. As the primary input surface,
// a regression here has outsized user-facing impact, so a large low-confidence refactor isn't
// forced — a real design change (e.g. a proper state-machine split), not extraction effort.
// eslint-disable-next-line complexity, max-lines-per-function -- TODO(#263): see comment above.
export function Composer(props: {
  provider: AgentProvider;
  engine: AgentEngine;
  model: string | null;
  effort?: string | null;
  mode?: string | null;
  turnActive: boolean;
  supportsImages: boolean;
  imageUnavailableReason?: string;
  onSend: (text: string, images?: string[]) => void | Promise<void>;
  onQueue?: (text: string, images?: string[]) => void | Promise<void>;
  onInterrupt: () => void;
  onProviderChange?: (provider: AgentProvider) => void;
  onModelChange?: (model: string | null) => void;
  onEffortChange?: (effort: string) => void;
  onModeChange?: (mode: string) => void;
  supportsSteer?: boolean;
  steerUnavailableReason?: string;
  onSteer?: (text: string) => void | Promise<void>;
  emberYielded?: boolean;
  meter?: JSX.Element;
  editorRef?: (element: HTMLDivElement) => void;
}): JSX.Element {
  const [text, setText] = createSignal("");
  const [piModels, setPiModels] = createSignal<AgentProfile["models"]>([]);
  const [ompModels, setOmpModels] = createSignal<AgentProfile["models"]>([]);
  const providers = createMemo(() =>
    nativeAgentProfiles().map((profile) => {
      if (profile.id === "pi") return profileWithDiscoveredModels(profile, piModels());
      if (profile.id === "omp") return profileWithDiscoveredModels(profile, ompModels());
      return profile;
    })
  );
  onMount(() => {
    void discoverAgentCli("pi")
      .then((diagnostic) => setPiModels(diagnostic.models))
      .catch(() => undefined);
    void discoverAgentCli("omp")
      .then((diagnostic) => setOmpModels(diagnostic.models))
      .catch(() => undefined);
  });
  const [dismissed, setDismissed] = createSignal(false);
  const [selected, setSelected] = createSignal(0);
  const [skills, setSkills] = createSignal<AgentSkill[]>([]);
  const [attachments, setAttachments] = createSignal<ComposerAttachment[]>([]);
  const [pasteError, setPasteError] = createSignal<string | null>(null);
  const [textPreviewId, setTextPreviewId] = createSignal<number | null>(null);
  const [textPreviewDraft, setTextPreviewDraft] = createSignal("");
  const [textPreviewEditing, setTextPreviewEditing] = createSignal(false);
  const [dropHover, setDropHover] = createSignal(false);
  const [preparing, setPreparing] = createSignal(false);
  const [prepareFailed, setPrepareFailed] = createSignal(false);
  let root!: HTMLDivElement;
  let field!: HTMLDivElement;
  let textPreviewArea: HTMLTextAreaElement | undefined;
  let textPreviewRestoreFocus: HTMLElement | null = null;
  let pasteErrorTimer: ReturnType<typeof setTimeout> | undefined;
  let refocusAfterPrepare = false;
  let pasteGeneration = 0;
  let droppedPasteGeneration: number | null = null;
  let nextAttachmentId = 1;
  let composing = false;

  const attachmentModels = (): ComposerChipModel[] =>
    attachments().map((attachment) => ({ id: attachment.id, kind: attachment.kind }));

  const attachmentNumber = (attachment: ComposerAttachment) =>
    attachments()
      .filter((a) => a.kind === attachment.kind)
      .findIndex((a) => a.id === attachment.id) + 1;

  const textPreviewAttachment = createMemo<TextComposerAttachment | null>(() => {
    const id = textPreviewId();
    return (
      (attachments().find(
        (a) => a.id === id && a.kind === "text",
      ) as TextComposerAttachment | undefined) ?? null
    );
  });

  const textStats = (content: string) => {
    let lines = content.length === 0 ? 0 : 1;
    for (let i = 0; i < content.length; i += 1) {
      const code = content.charCodeAt(i);
      if (code === 10) {
        lines += 1;
      } else if (code === 13) {
        lines += 1;
        if (content.charCodeAt(i + 1) === 10) i += 1;
      }
    }
    return { chars: content.length, lines };
  };

  const textSummary = (content: string) => {
    const compact = content.replace(/\s+/g, " ").trim();
    return compact.length > 80 ? `${compact.slice(0, 80)}…` : compact || "Empty text";
  };

  const openTextPreview = (id: number) => {
    const attachment = attachments().find((a) => a.id === id && a.kind === "text");
    if (!attachment || attachment.kind !== "text") return;
    textPreviewRestoreFocus = (document.activeElement as HTMLElement | null) ?? null;
    setTextPreviewId(id);
    setTextPreviewDraft(attachment.content);
    setTextPreviewEditing(false);
    queueMicrotask(() => textPreviewArea?.focus());
  };

  const closeTextPreview = () => {
    setTextPreviewId(null);
    setTextPreviewDraft("");
    setTextPreviewEditing(false);
    const restore = textPreviewRestoreFocus;
    textPreviewRestoreFocus = null;
    queueMicrotask(() => restore?.focus?.());
  };

  createEffect(() => {
    if (textPreviewId() !== null && !textPreviewAttachment()) closeTextPreview();
  });

  const buildImageGlyph = (doc: Document): HTMLElement => {
    const glyph = doc.createElement("span");
    glyph.className = "pf-chat-chip-glyph";
    return glyph;
  };

  const buildTextGlyph = (doc: Document): HTMLElement => {
    const glyph = doc.createElement("span");
    glyph.className = "pf-chat-chip-text-glyph";
    for (let i = 0; i < 3; i++) glyph.appendChild(doc.createElement("span"));
    return glyph;
  };

  const buildChipVisual = (
    attachment: ComposerAttachment | undefined,
    _index: number,
  ): HTMLElement => {
    const doc = field.ownerDocument;
    const wrap = doc.createElement("span");
    wrap.className = "pf-chat-chip-visual";
    wrap.setAttribute("aria-hidden", "true");
    if (attachment?.kind === "text") {
      wrap.appendChild(buildTextGlyph(doc));
    } else if (attachment?.status === "pending") {
      const spinner = doc.createElement("span");
      spinner.className = "pf-spinner pf-chat-chip-spinner";
      wrap.appendChild(spinner);
    } else if (attachment?.previewUrl) {
      const img = doc.createElement("img");
      img.className = "pf-chat-chip-thumb";
      img.src = attachment.previewUrl;
      img.alt = "";
      img.addEventListener("error", () => wrap.replaceChildren(buildImageGlyph(doc)));
      wrap.appendChild(img);
    } else {
      wrap.appendChild(buildImageGlyph(doc));
    }
    return wrap;
  };

  const chipAriaLabel = (kind: ComposerChipKind, index: number, pending: boolean) => {
    const label = kind === "text" ? "Text" : "Image";
    return pending
      ? `${label} ${index}, preparing — press Backspace to remove`
      : `${label} ${index} — press Backspace to remove`;
  };

  const buildChip = (id: number, kind: ComposerChipKind, index: number): HTMLElement => {
    const doc = field.ownerDocument;
    const attachment = attachments().find((a) => a.id === id);
    const pending = attachment?.kind === "image" && attachment.status === "pending";
    const chip = doc.createElement("span");
    chip.className = "pf-chat-chip";
    chip.classList.toggle("pf-chat-chip--text", kind === "text");
    chip.classList.toggle("pf-chat-chip--pending", pending);
    chip.setAttribute("contenteditable", "false");
    chip.setAttribute(CHIP_ATTR, String(id));
    chip.setAttribute(CHIP_KIND_ATTR, kind);
    chip.setAttribute("role", "button");
    chip.setAttribute("aria-label", chipAriaLabel(kind, index, pending));
    if (kind === "text") {
      chip.tabIndex = 0;
      chip.addEventListener("click", (e) => {
        e.preventDefault();
        openTextPreview(id);
      });
      chip.addEventListener("keydown", (e) => {
        if (e.key === "Backspace" || e.key === "Delete") {
          e.preventDefault();
          removeAttachmentInPlace(id);
          return;
        }
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        openTextPreview(id);
      });
    }

    chip.appendChild(buildChipVisual(attachment, index));

    const label = doc.createElement("span");
    label.className = "pf-chat-chip-label";
    label.textContent = `${kind === "text" ? "Text" : "Image"} #${index}`;
    chip.appendChild(label);

    const remove = doc.createElement("button");
    remove.type = "button";
    remove.className = "pf-chat-chip-remove";
    remove.setAttribute("contenteditable", "false");
    remove.setAttribute("aria-label", `Remove ${kind} ${index}`);
    remove.tabIndex = -1;
    remove.textContent = "✕";
    remove.addEventListener("mousedown", (e) => e.preventDefault());
    remove.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      removeAttachmentInPlace(id);
    });
    chip.appendChild(remove);

    return chip;
  };

  const renderEditor = () => {
    renderComposer(field, text(), attachmentModels(), buildChip);
  };

  // Targeted swap of a single chip's leading visual (pending spinner → thumbnail)
  // without a full re-render, so a background stash resolving never disturbs the
  // caret or an in-progress edit.
  const refreshChip = (id: number) => {
    const chip = field.querySelector<HTMLElement>(`[${CHIP_ATTR}="${id}"]`);
    if (!chip) return;
    const attachment = attachments().find((a) => a.id === id);
    if (!attachment) return;
    const index = attachmentNumber(attachment);
    const pending = attachment.kind === "image" && attachment.status === "pending";
    chip.classList.toggle("pf-chat-chip--pending", pending);
    chip.setAttribute("aria-label", chipAriaLabel(attachment.kind, index, pending));
    chip.querySelector(".pf-chat-chip-visual")?.replaceWith(buildChipVisual(attachment, index));
  };

  const placeCaret = (offset: number) => {
    if (document.activeElement === field) {
      setCaretAtOffset(field, offset, attachmentModels());
      // A scripted selection change does not scroll the caret into view the way
      // typing does, and the editor is capped at 200px — without this, a draft
      // past the cap keeps growing below the fold (#352).
      scrollCaretIntoView(field);
    }
  };

  const showPasteError = (message: string, autoClearMs?: number) => {
    if (pasteErrorTimer) clearTimeout(pasteErrorTimer);
    setPasteError(message);
    if (autoClearMs) {
      pasteErrorTimer = setTimeout(() => setPasteError(null), autoClearMs);
    }
  };

  const clearPasteError = () => {
    if (pasteErrorTimer) clearTimeout(pasteErrorTimer);
    pasteErrorTimer = undefined;
    setPasteError(null);
  };

  const revokeObjectPreview = (previewUrl: string | null) => {
    if (previewUrl?.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
  };

  const revokePendingPreview = (attachment: ComposerAttachment | null) => {
    if (attachment?.kind === "image" && attachment.status === "pending") {
      revokeObjectPreview(attachment.previewUrl);
    }
  };

  onCleanup(() => {
    if (pasteErrorTimer) clearTimeout(pasteErrorTimer);
    for (const attachment of attachments()) revokePendingPreview(attachment);
  });

  createEffect(() => {
    const provider = props.provider;
    setSkills(skillsCache.get(provider) ?? []);
    void loadSkills(provider).then((list) => {
      if (props.provider === provider) setSkills(list);
    });
  });

  const effortOptions = () => modelOption(props.provider, props.model)?.efforts ?? [];
  // The default level is folded into its own option ("High (default)") rather
  // than a separate Default entry; picking it sends no explicit effort.
  const defaultEffort = () => {
    const fallback = modelOption(props.provider, props.model)?.defaultEffort;
    const source = agentBackendDescriptor(props.provider).effortDefaultSource;
    const resolved = source === "codexConfig" ? (codexEffortOverride() ?? fallback) : fallback;
    return resolved && effortOptions().includes(resolved) ? resolved : null;
  };
  const providerDropdownOptions = (): DropdownOption[] =>
    nativeAgentProfiles().map((agent) => ({
      value: agent.id,
      label: agent.label,
      icon: PROVIDER_ICON[agent.id],
    }));

  const modelDropdownOptions = (): DropdownOption[] =>
    modelsFor(providers(), props.provider).map((m) => ({
      value: m.id,
      label: m.label,
      icon: () => <IconIngot size={13} />,
    }));

  const effortDropdownOptions = (): DropdownOption[] => {
    const options = effortOptions().map((level) => ({
      value: level === defaultEffort() ? "" : level,
      label:
        level === defaultEffort()
          ? `${EFFORT_LABELS[level] ?? level} (default)`
          : (EFFORT_LABELS[level] ?? level),
      icon: () => <IconForgeFlame size={13} level={EFFORT_HEAT[level] ?? 0.4} />,
    }));
    if (!defaultEffort()) {
      options.unshift({
        value: "",
        label: "Default",
        icon: () => <IconForgeFlame size={13} level={0.4} />,
      });
    }
    return options;
  };

  const modeValue = () => props.mode ?? defaultMode(props.provider);
  const modeDropdownOptions = (): DropdownOption[] =>
    modeOptions(props.provider).map((m) => ({
      value: m.id,
      label: m.label,
      icon: () => <IconShield size={13} />,
    }));

  createEffect(() => {
    if (agentBackendDescriptor(props.provider).effortDefaultSource === "codexConfig") {
      ensureCodexEffortOverride();
    }
  });

  const queueing = () => props.turnActive && flagEnabled("messageQueue");
  const steerAvailable = () => props.turnActive && !!props.supportsSteer && !!props.onSteer;
  const steering = () => !queueing() && steerAvailable();
  const isMac = () => hostPlatform() === "macos";
  const steerShortcutLabel = () => (isMac() ? "⌘⏎" : "Ctrl⏎");
  const steerAriaShortcut = () => (isMac() ? "Meta+Enter" : "Control+Enter");
  const isSteerShortcut = (event: KeyboardEvent) => {
    if (event.key !== "Enter" || event.shiftKey || event.altKey) return false;
    return isMac()
      ? event.metaKey && !event.ctrlKey
      : event.ctrlKey && !event.metaKey;
  };
  const canSend = () => {
    if (queueing()) return text().trim().length > 0 || attachments().length > 0;
    if (props.turnActive) return steering() && text().trim().length > 0;
    return text().trim().length > 0 || attachments().length > 0;
  };
  const placeholder = () => {
    if (queueing()) {
      const steerHint = props.supportsSteer ? ` · ${steerShortcutLabel()} steers…` : "";
      return `Queue the next message…${steerHint}`;
    }
    return steering() ? "Steer the running turn…" : "Message the agent…";
  };

  const suggestions = createMemo<Suggestion[]>(() => {
    const value = text();
    const trigger = value[0];
    if (trigger !== "/" && trigger !== "$") return [];
    const query = value.slice(1).toLowerCase();
    const items: Suggestion[] = [];
    if (trigger === "/") {
      for (const template of matchTemplates(value)) items.push({ kind: "template", template });
    }
    for (const skill of skills()) {
      if (skill.trigger !== trigger) continue;
      if (query && !skill.name.toLowerCase().includes(query)) continue;
      items.push({ kind: "skill", skill });
    }
    return items;
  });
  const suggestionsOpen = () => !preparing() && !dismissed() && suggestions().length > 0;
  const firstLine = (body: string) => body.split("\n")[0];

  const suggestionText = (item: Suggestion) =>
    item.kind === "template"
      ? item.template.label
      : `${item.skill.trigger}${item.skill.name}`;
  const suggestionHint = (item: Suggestion) =>
    item.kind === "template" ? firstLine(item.template.body) : item.skill.description;

  const insert = (item: Suggestion) => {
    const body =
      item.kind === "template"
        ? item.template.body
        : `${item.skill.trigger}${item.skill.name} `;
    // Staged attachments survive the draft replacement: their markers re-anchor
    // at the head so the caret still lands at the end of the inserted body.
    const currentAttachments = attachments();
    const markers = currentAttachments
      .map((attachment) => attachmentMarkerText(currentAttachments, attachment.id))
      .filter((marker): marker is string => marker !== null)
      .join(" ");
    setText(markers ? `${markers} ${body}` : body);
    setDismissed(true);
    setSelected(0);
    field.focus();
    renderEditor();
    placeCaret(text().length);
  };

  type MarkerAnchor = { generation: number; at: number | null; end: number | null };
  const pinMarkerAnchor = (): MarkerAnchor => {
    const range =
      document.activeElement === field ? selectionOffsets(field, attachmentModels()) : null;
    return {
      generation: pasteGeneration,
      at: range?.start ?? null,
      end: range?.end ?? range?.start ?? null,
    };
  };

  const insertionRange = (value: string, anchor?: MarkerAnchor) => {
    if (anchor && anchor.generation === pasteGeneration && anchor.at !== null) {
      const start = Math.max(0, Math.min(anchor.at, value.length));
      const end = Math.max(0, Math.min(anchor.end ?? anchor.at, value.length));
      return { start: Math.min(start, end), end: Math.max(start, end), anchored: true };
    }
    const range =
      document.activeElement === field ? selectionOffsets(field, attachmentModels()) : null;
    const start = range?.start ?? value.length;
    const end = range?.end ?? start;
    return { start, end, anchored: false };
  };

  const addPendingImage = (previewUrl: string | null, anchor?: MarkerAnchor) => {
    const attachment = createPendingAttachment(nextAttachmentId++, previewUrl);
    const focused = document.activeElement === field;
    const value = text();
    const pinned = anchor && anchor.generation === pasteGeneration ? anchor.at : null;
    const cursor =
      pinned ?? (focused ? (caretOffset(field, attachmentModels()) ?? value.length) : value.length);
    const result = addAttachmentWithMarker(attachments(), value, cursor, attachment);
    setAttachments(result.attachments);
    if (pinned !== null && anchor) {
      anchor.at = result.cursor;
      anchor.end = result.cursor;
    }
    setText(result.text);
    renderEditor();
    if (focused) placeCaret(result.cursor);
    return attachment;
  };

  const removeAttachment = (id: number, focus = true, caretAt?: number) => {
    const result = removeAttachmentWithMarker(attachments(), text(), id);
    if (!result.removed) return false;
    revokePendingPreview(result.removed);
    setAttachments(result.attachments);
    setText(result.text);
    renderEditor();
    if (focus) {
      field.focus();
      placeCaret(caretAt ?? text().length);
    }
    return true;
  };

  // Delete a chip in place: the caret stays where the chip stood instead of
  // jumping to the end of the message.
  const removeAttachmentInPlace = (id: number) => {
    if (preparing()) return;
    const at = chipStartOffset(field, id, attachmentModels());
    removeAttachment(id, true, at ?? undefined);
  };

  // Remove an attachment out from under the user (stash failure, stale
  // generation) without losing their caret: map the current offset through the
  // same marker-removal renumbering the text goes through.
  const removeAttachmentKeepingCaret = (id: number) => {
    const at = document.activeElement === field ? caretOffset(field, attachmentModels()) : null;
    if (at === null) return removeAttachment(id, false);
    const caret = offsetAfterRemoval(attachments(), text(), id, at);
    if (caret === null) return false;
    return removeAttachment(id, true, caret);
  };

  const insertPlainText = (chunk: string, anchor?: MarkerAnchor) => {
    if (!chunk) return;
    // A submit with pending images froze the draft; a late async paste
    // completion (native clipboard reads resolve after Send) must not mutate
    // what is about to dispatch.
    if (preparing()) return;
    const value = text();
    const range = insertionRange(value, anchor);
    // The chip invariant: replacing a range that covers a chip must also drop
    // its attachment (and renumber the rest), or the orphaned image would still
    // be sent while no chip shows it.
    const result = replaceRangeWithText(attachments(), value, range.start, range.end, chunk);
    for (const dropped of result.removed) revokePendingPreview(dropped);
    if (range.anchored && anchor) {
      anchor.at = result.cursor;
      anchor.end = result.cursor;
    }
    batch(() => {
      setAttachments(result.attachments);
      setText(result.text);
    });
    renderEditor();
    placeCaret(result.cursor);
  };

  const addTextAttachment = (content: string, anchor?: MarkerAnchor) => {
    if (content.trim().length === 0 || preparing()) return;
    const attachment = createTextAttachment(nextAttachmentId++, content);
    const value = text();
    const range = insertionRange(value, anchor);
    const replaced = replaceRangeWithText(attachments(), value, range.start, range.end, "");
    for (const dropped of replaced.removed) revokePendingPreview(dropped);
    const result = addAttachmentWithMarker(
      replaced.attachments,
      replaced.text,
      replaced.cursor,
      attachment,
    );
    batch(() => {
      setAttachments(result.attachments);
      setText(result.text);
    });
    if (range.anchored && anchor) {
      anchor.at = result.cursor;
      anchor.end = result.cursor;
    }
    renderEditor();
    placeCaret(result.cursor);
    clearPasteError();
  };

  const insertPastedText = (chunk: string, anchor?: MarkerAnchor) => {
    if (chunk.length >= LONG_TEXT_ATTACHMENT_CHARS) {
      addTextAttachment(chunk, anchor);
      return;
    }
    insertPlainText(chunk, anchor);
  };

  const updateTextPreview = () => {
    const attachment = textPreviewAttachment();
    if (!attachment) return;
    const content = textPreviewDraft();
    const result = updateTextAttachmentContent(attachments(), text(), attachment.id, content);
    setAttachments(result.attachments);
    if (result.removed) {
      setText(result.text);
      renderEditor();
      textPreviewRestoreFocus = field;
      closeTextPreview();
      return;
    }
    setTextPreviewEditing(false);
  };

  const selectTextPreview = () => {
    textPreviewArea?.focus();
    textPreviewArea?.select();
  };

  const copyTextPreview = () => {
    const content = textPreviewDraft();
    if (!navigator.clipboard?.writeText) {
      selectTextPreview();
      showPasteError("Clipboard copy is unavailable", 4000);
      return;
    }
    void navigator.clipboard.writeText(content).catch(() => {
      showPasteError("Couldn't copy text", 4000);
    });
  };

  const pasteTextPreview = () => {
    const attachment = textPreviewAttachment();
    if (!attachment) return;
    const marker = attachmentMarkerText(attachments(), attachment.id);
    const at = chipStartOffset(field, attachment.id, attachmentModels());
    if (marker === null || at === null) return;
    const draft = textPreviewDraft();
    const chunk = attachments().some((item) => item.kind === "image")
      ? escapeImageMarkersInTextAttachment(draft)
      : draft;
    const result = replaceRangeWithText(
      attachments(),
      text(),
      at,
      at + marker.length,
      chunk,
    );
    for (const dropped of result.removed) revokePendingPreview(dropped);
    batch(() => {
      setAttachments(result.attachments);
      setText(result.text);
    });
    closeTextPreview();
    renderEditor();
    field.focus();
    placeCaret(result.cursor);
  };

  const hasAttachment = (id: number) =>
    attachments().some((attachment) => attachment.id === id);

  const discardStaleImage = (id: number, generation: number) => {
    if (!hasAttachment(id)) return true;
    if (generation === pasteGeneration) return false;
    removeAttachmentKeepingCaret(id);
    if (droppedPasteGeneration !== generation) {
      droppedPasteGeneration = generation;
      showPasteError("Image discarded because send already started", 4000);
    }
    return true;
  };

  const resolveImage = (id: number, generation: number, path: string) => {
    if (discardStaleImage(id, generation)) return;
    const result = resolveAttachment(attachments(), id, path, convertFileSrc(path));
    if (!result.previous) return;
    revokePendingPreview(result.previous);
    setAttachments(result.attachments);
    refreshChip(id);
  };

  const failImage = (id: number, generation: number, error: unknown) => {
    if (!hasAttachment(id)) return;
    if (generation !== pasteGeneration) {
      discardStaleImage(id, generation);
      return;
    }
    const message = errorText(error);
    const wasPreparing = preparing();
    let removed = false;
    batch(() => {
      removed = removeAttachmentKeepingCaret(id);
      if (removed && wasPreparing) setPrepareFailed(true);
    });
    if (!removed || message === "clipboard has no image") return;
    showPasteError(message);
  };

  const rejectUnsupportedImages = () => {
    if (props.supportsImages) return false;
    showPasteError(
      props.imageUnavailableReason ?? "Image input is unavailable for this backend",
      4000,
    );
    return true;
  };

  const attachNativeClipboardImage = (generation: number, anchor: MarkerAnchor) => {
    if (generation !== pasteGeneration || preparing()) return;
    if (props.turnActive && !queueing()) {
      showPasteError("Images can't be attached while a turn is running", 4000);
      return;
    }
    if (rejectUnsupportedImages()) return;
    clearPasteError();
    const attachment = addPendingImage(null, anchor);
    void agentStashClipboardImage()
      .then((path) => resolveImage(attachment.id, generation, path))
      .catch((error) => failImage(attachment.id, generation, error));
  };

  const pasteNativeClipboard = (anchor: MarkerAnchor) => {
    const generation = pasteGeneration;
    void agentClipboardText()
      .then((plain) => {
        if (generation !== pasteGeneration) return;
        const value = typeof plain === "string" ? plain : "";
        if (value.length > 0) {
          insertPastedText(value, anchor);
          return;
        }
        attachNativeClipboardImage(generation, anchor);
      })
      .catch((error: unknown) => {
        const message = errorText(error);
        if (message !== "clipboard has no text") {
          showPasteError(message);
          return;
        }
        attachNativeClipboardImage(generation, anchor);
      });
  };

  // Same justification as the component-level suppression above: closes over Composer's shared
  // attachment/preparing state.
  // eslint-disable-next-line complexity -- TODO(#263): see comment above.
  const onPaste = (event: ClipboardEvent) => {
    const data = event.clipboardData;
    if (!data) return;
    const anchor = pinMarkerAnchor();
    const files: { file: File; ext: string }[] = [];
    let fileItems = 0;
    let unsupported = 0;
    for (const item of Array.from(data.items)) {
      if (item.kind !== "file") continue;
      fileItems += 1;
      if (!item.type.startsWith("image/")) continue;
      const ext = ACCEPTED_MIME_EXT[item.type];
      if (!ext) {
        unsupported += 1;
        continue;
      }
      const file = item.getAsFile();
      if (file) files.push({ file, ext });
    }
    if (files.length === 0 && unsupported === 0) {
      // Copying a file in a file manager puts a text/uri-list on the clipboard
      // (no image data) — route image URIs through the drop path or the paste
      // lands as a bare file:// string in the textarea.
      const uriPaths = filePathsFromUriList(data.getData("text/uri-list"));
      if (uriPaths.some((path) => acceptedPathExt(path))) {
        event.preventDefault();
        onPathDrop(uriPaths, pasteGeneration, anchor);
        return;
      }
      // WebKitGTK advertises text/uri-list but getData returns "" — the URIs
      // are only reachable through a native clipboard read. The file list is
      // read as such first (uri-list clipboards may carry no text flavor);
      // the generation is pinned at paste time so a send racing the read
      // can't inherit images.
      if (uriPaths.length === 0 && data.types.includes("text/uri-list")) {
        event.preventDefault();
        const generation = pasteGeneration;
        const readTextFlavor = () =>
          agentClipboardText().then((text) => ({
            paths: filePathsFromUriList(text),
            text,
          }));
        void agentClipboardFilePaths()
          .then((paths: string[]) =>
            // A non-file uri-list (e.g. a copied link) yields an empty file
            // list — the text flavor still holds the paste payload.
            paths.length > 0 ? { paths, text: paths.join(" ") } : readTextFlavor(),
          )
          .catch((error: unknown) => {
            const message = errorText(error);
            if (message !== "clipboard has no files") throw error;
            return readTextFlavor();
          })
          .then(({ paths, text }: { paths: string[]; text: string }) => {
            if (paths.some((path) => acceptedPathExt(path))) {
              onPathDrop(paths, generation, anchor);
              return;
            }
            // Not an image copy — restore the default paste the intercept ate,
            // unless a send already consumed this composer state.
            if (generation !== pasteGeneration) return;
            insertPastedText(paths.length > 0 ? paths.join(" ") : text, anchor);
          })
          .catch((error: unknown) => {
            const message = errorText(error);
            if (message === "clipboard has no text") return;
            showPasteError(message);
          });
        return;
      }
      if (fileItems > 0 || data.types.length > 0) {
        // Non-image content: keep the composer plain-text (the textarea it
        // replaced never accepted rich markup) by inserting the text flavor
        // ourselves instead of letting contenteditable smuggle in HTML. A
        // clipboard with no text flavor at all (HTML-only fragment) pastes
        // nothing rather than markup the serializer can't represent; a
        // non-image uri-list still pastes its decoded paths.
        event.preventDefault();
        const plain = data.getData("text/plain");
        if (plain) insertPastedText(plain);
        else if (uriPaths.length > 0) insertPastedText(uriPaths.join(" "));
        return;
      }
      event.preventDefault();
      pasteNativeClipboard(anchor);
      return;
    }
    event.preventDefault();
    if (props.turnActive && !queueing()) {
      showPasteError("Images can't be attached while a turn is running", 4000);
      return;
    }
    if (rejectUnsupportedImages()) return;
    if (files.length > 0) clearPasteError();
    if (unsupported > 0) {
      showPasteError("Unsupported image type — use PNG, JPEG, GIF, or WebP");
    }
    const generation = pasteGeneration;
    for (const { file, ext } of files) {
      const attachment = addPendingImage(URL.createObjectURL(file), anchor);
      void readBase64(file)
        .then((base64) => agentStashImage(base64, ext))
        .then((path) => resolveImage(attachment.id, generation, path))
        .catch((error) => failImage(attachment.id, generation, error));
    }
  };

  const onPathDrop = (paths: string[], atGeneration?: number, anchor?: MarkerAnchor) => {
    // A direct OS drop is its own ingress event; paste fallbacks arrive with
    // the generation and anchor already pinned by onPaste.
    const markerAnchor = anchor ?? pinMarkerAnchor();
    if (preparing()) return;
    if (props.turnActive && !queueing()) {
      showPasteError("Images can't be attached while a turn is running", 4000);
      return;
    }
    if (rejectUnsupportedImages()) return;
    const files = paths.filter((path) => acceptedPathExt(path));
    if (files.length > 0) clearPasteError();
    if (files.length !== paths.length) {
      showPasteError("Unsupported image type — use PNG, JPEG, GIF, or WebP");
    }
    if (files.length === 0) return;
    const generation = atGeneration ?? pasteGeneration;
    if (generation !== pasteGeneration) return;
    for (const path of files) {
      const attachment = addPendingImage(null, markerAnchor);
      void agentStashImageFromPath(path)
        .then((stashedPath) => resolveImage(attachment.id, generation, stashedPath))
        .catch((error) => failImage(attachment.id, generation, error));
    }
  };

  onMount(() => {
    // Accept drops over the whole chat surface, not just the composer strip —
    // people drag onto the conversation, and a target that small reads as
    // "drag-and-drop doesn't work".
    const unregister = registerPathDropTarget({
      el: (root.closest(".pf-chat-view") as HTMLElement | null) ?? root,
      onPaths: onPathDrop,
      setHover: setDropHover,
    });
    onCleanup(unregister);
  });

  const clearDispatchedDraft = (
    result: void | Promise<void>,
    savedText: string,
    savedAttachments: ComposerAttachment[],
  ) => {
    setText("");
    setAttachments([]);
    renderEditor();
    void Promise.resolve(result).catch(() => {
      if (text().trim().length === 0 && attachments().length === 0) {
        setText(savedText);
        setAttachments(savedAttachments);
        renderEditor();
      }
    });
  };

  const dispatchSteer = () => {
    const savedText = text();
    const savedAttachments = [...attachments()];
    const value = expandTextAttachments(savedAttachments, savedText).trim();
    if (!steerAvailable() || !value || hasPendingAttachments(savedAttachments)) return;
    // A steer carries text only. Images became pastable mid-turn along with
    // queueing, so dispatching one here would clear the draft and silently
    // destroy an attachment the user had already staged.
    if (readyAttachmentPaths(savedAttachments).length > 0) {
      showPasteError("Steering can't carry images — queue the message instead", 4000);
      return;
    }
    pasteGeneration += 1;
    droppedPasteGeneration = null;
    clearDispatchedDraft(props.onSteer!(value), savedText, savedAttachments);
  };

  const dispatchSend = () => {
    const savedText = text();
    const savedAttachments = [...attachments()];
    const value = expandTextAttachments(savedAttachments, savedText).trim();
    const savedImages = readyAttachmentPaths(savedAttachments);
    if (!value && savedImages.length === 0) return;
    if (hasPendingAttachments(savedAttachments)) return;
    if (props.turnActive) {
      if (queueing()) {
        if (!props.onQueue || (!value && savedImages.length === 0)) return;
        pasteGeneration += 1;
        droppedPasteGeneration = null;
        clearDispatchedDraft(
          props.onQueue(value, savedImages.length > 0 ? savedImages : undefined),
          savedText,
          savedAttachments,
        );
        return;
      }
      if (!steering() || !value) return;
      pasteGeneration += 1;
      droppedPasteGeneration = null;
      clearDispatchedDraft(props.onSteer!(value), savedText, savedAttachments);
      return;
    }

    pasteGeneration += 1;
    droppedPasteGeneration = null;
    clearDispatchedDraft(
      props.onSend(value, savedImages.length > 0 ? savedImages : undefined),
      savedText,
      savedAttachments,
    );
  };

  createEffect(() => {
    if (!preparing()) return;
    const decision = decidePreparingState({
      attachments: attachments(),
      failed: prepareFailed(),
      hasContent: text().trim().length > 0,
    });
    if (decision === "wait") return;
    setPreparing(false);
    setPrepareFailed(false);
    if (decision === "dispatch") dispatchSend();
    if (refocusAfterPrepare) {
      refocusAfterPrepare = false;
      // The field only becomes editable again once its contenteditable
      // attribute re-renders; focus after that flush.
      queueMicrotask(() => {
        field.focus();
        placeCaret(text().length);
      });
    }
  });

  const submit = () => {
    if (preparing()) return;
    if ((!props.turnActive || queueing()) && hasPendingAttachments(attachments())) {
      // The message dispatches when the stash resolves; freeze the composer
      // (non-editable field, ingress guards) so what was submitted is what
      // sends — edits made meanwhile must not leak into this message.
      refocusAfterPrepare = document.activeElement === field;
      setPrepareFailed(false);
      setPreparing(true);
      return;
    }
    dispatchSend();
  };

  // Same justification as the component-level suppression above: closes over Composer's shared
  // suggestions/attachment/text-preview state.
  // eslint-disable-next-line complexity -- TODO(#263): see comment above.
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented) return;
    if (event.isComposing) return;
    if (queueing() && isSteerShortcut(event)) {
      event.preventDefault();
      if (steerAvailable()) dispatchSteer();
      return;
    }
    if (suggestionsOpen()) {
      const list = suggestions();
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelected((i) => (i + 1) % list.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelected((i) => (i - 1 + list.length) % list.length);
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        const item = list[selected()] ?? list[0];
        if (item) insert(item);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setDismissed(true);
        return;
      }
    }
    // Whole-chip deletion: one Backspace/Delete adjacent to a chip removes it via
    // the model (which renumbers the rest), independent of the engine's own
    // atomic-deletion behavior — so the DOM and the text string never drift.
    if (event.key === "Backspace" || event.key === "Delete") {
      const chipId = adjacentChipId(field, event.key === "Backspace" ? "before" : "after");
      if (chipId !== null) {
        event.preventDefault();
        removeAttachmentInPlace(chipId);
        return;
      }
      if (event.key === "Delete" && deleteTargetsFillerTail(field)) {
        event.preventDefault();
        return;
      }
    }
    if (event.key === "Enter" && event.shiftKey) {
      event.preventDefault();
      insertPlainText("\n");
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      submit();
    }
  };

  // DOM → string on user edits. Skipped while an IME composition is active; the
  // final compositionend re-runs it. The fast path (chips unchanged) just
  // re-serializes; when the user deletes/reorders chips by editing, the model is
  // reconciled to the surviving chips and the editor re-rendered to renumber.
  const onInput = () => {
    if (composing) return;
    const modelIds = attachmentModels();
    const present = chipIdsInOrder(field);
    const same =
      present.length === modelIds.length && present.every((id, i) => id === modelIds[i].id);
    if (!same) {
      const survivors = new Set(present);
      const byId = new Map(attachments().map((a) => [a.id, a]));
      for (const attachment of attachments()) {
        if (!survivors.has(attachment.id)) revokePendingPreview(attachment);
      }
      const kept = present
        .map((id) => byId.get(id))
        .filter((a): a is ComposerAttachment => a !== undefined);
      const keptModels = kept.map((a) => ({ id: a.id, kind: a.kind }));
      const emptied = kept.length === 0 && field.textContent === "";
      const value = emptied ? "" : serializeComposer(field, keptModels);
      const caret = emptied ? 0 : (selectionOffsets(field, keptModels)?.start ?? value.length);
      batch(() => {
        setAttachments(kept);
        setText(value);
      });
      renderEditor();
      placeCaret(caret);
      setDismissed(false);
      setSelected(0);
      return;
    }
    let value = serializeComposer(field, modelIds);
    // Restore the :empty placeholder once the editor is logically empty (WebKit
    // may leave a filler <br>, and deleting a trailing chip can leave its caret
    // filler behind).
    if (present.length === 0 && (value === "" || field.textContent === "")) {
      if (field.childNodes.length) field.replaceChildren();
      value = "";
    }
    setText(value);
    setDismissed(false);
    setSelected(0);
  };

  return (
    <div
      ref={root}
      class="pf-chat-composer"
      classList={{ "pf-chat-composer--drop": dropHover() }}
    >
      <div class="pf-chat-composer-pickers">
        <Dropdown
          class="pf-chat-dd"
          up
          disabled={props.turnActive || preparing()}
          value={props.provider}
          onChange={(value) => {
            if (isNativeAgentProvider(value)) props.onProviderChange?.(value);
          }}
          options={providerDropdownOptions()}
        />
        <Dropdown
          class="pf-chat-dd"
          up
          disabled={
            props.turnActive
            || preparing()
            || modelsFor(providers(), props.provider).length === 0
          }
          value={props.model ?? ""}
          onChange={(value) => props.onModelChange?.(value || null)}
          options={modelDropdownOptions()}
        />
        <Show when={effortOptions().length > 0}>
          <Dropdown
            class="pf-chat-dd"
            up
            disabled={props.turnActive || preparing()}
            value={props.effort && props.effort !== defaultEffort() ? props.effort : ""}
            title={
              agentBackendDescriptor(props.provider).controls.effort[props.engine] === "newSession"
                ? "Effort applies to new sessions"
                : undefined
            }
            onChange={(value) => props.onEffortChange?.(value)}
            options={effortDropdownOptions()}
          />
        </Show>
        <Show when={modeDropdownOptions().length > 0}>
          <Dropdown
            class={isDangerMode(props.provider, modeValue()) ? "pf-chat-dd pf-chat-dd--warn" : "pf-chat-dd"}
            up
            disabled={props.turnActive || preparing()}
            value={modeValue()}
            title={agentBackendDescriptor(props.provider).modeControlLabel}
            onChange={(value) => props.onModeChange?.(value)}
            options={modeDropdownOptions()}
          />
        </Show>
      </div>
      <Show when={pasteError()}>
        {(message) => (
          <div class="pf-chat-paste-error" role="status">
            {message()}
          </div>
        )}
      </Show>
      <Show when={attachments().length > 0}>
        <div class="pf-chat-attachments">
          <For each={attachments()}>
            {(attachment) => {
              const number = () => attachmentNumber(attachment);
              const canPreview = () =>
                attachment.kind === "image" &&
                attachment.status === "ready" &&
                attachment.previewUrl !== null;
              const openPreview = () => {
                if (attachment.kind === "image" && canPreview() && attachment.previewUrl) {
                  openLightbox(attachment.previewUrl);
                }
              };
              return (
                <div
                  class="pf-chat-attachment"
                  classList={{
                    "pf-chat-attachment--pending":
                      attachment.kind === "image" && attachment.status === "pending",
                    "pf-chat-attachment--text": attachment.kind === "text",
                  }}
                >
                  {attachment.kind === "text" ? (
                    <button
                      type="button"
                      class="pf-chat-attachment-text"
                      aria-label={`Preview text ${number()}`}
                      onClick={() => openTextPreview(attachment.id)}
                    >
                      <span class="pf-chat-attachment-text-label">Text #{number()}</span>
                      <span class="pf-chat-attachment-text-meta">
                        {textStats(attachment.content).chars} chars ·{" "}
                        {textStats(attachment.content).lines} lines
                      </span>
                      <span class="pf-chat-attachment-text-snippet">
                        {textSummary(attachment.content)}
                      </span>
                    </button>
                  ) : (
                    <>
                      <Show
                        when={attachment.previewUrl}
                        fallback={
                          <span class="pf-chat-attachment-placeholder" aria-hidden="true">
                            <span class="pf-chat-attachment-glyph" />
                          </span>
                        }
                      >
                        {(src) => (
                          <img
                            class="pf-chat-attachment-img"
                            src={src()}
                            alt=""
                            role={canPreview() ? "button" : undefined}
                            tabIndex={canPreview() ? 0 : undefined}
                            aria-label={canPreview() ? `Preview image ${number()}` : undefined}
                            onClick={openPreview}
                            onKeyDown={(e) => {
                              if (!canPreview()) return;
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                openPreview();
                              }
                            }}
                            onError={(e) => {
                              e.currentTarget.style.visibility = "hidden";
                            }}
                          />
                        )}
                      </Show>
                      <Show when={attachment.status === "pending"}>
                        <span class="pf-chat-attachment-progress">
                          <Spinner
                            class="pf-chat-attachment-spinner"
                            label={`Preparing image ${number()}`}
                          />
                        </span>
                      </Show>
                    </>
                  )}
                  <span class="pf-chat-attachment-index" aria-hidden="true">
                    {attachment.kind === "text" ? `T${number()}` : number()}
                  </span>
                  <button
                    type="button"
                    class="pf-chat-attachment-remove"
                    aria-label={`Remove ${attachment.kind}`}
                    disabled={preparing()}
                    onClick={() => removeAttachment(attachment.id)}
                  >
                    ✕
                  </button>
                </div>
              );
            }}
          </For>
        </div>
      </Show>
      <div class="pf-chat-composer-input">
        <Show when={suggestionsOpen()}>
          <div class="pf-composer-templates" role="listbox">
            <For each={suggestions()}>
              {(item, i) => (
                <button
                  type="button"
                  class="pf-composer-template"
                  classList={{ "pf-composer-template--on": i() === selected() }}
                  role="option"
                  aria-selected={i() === selected()}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setSelected(i())}
                  onClick={() => insert(item)}
                >
                  <span class="pf-composer-template-row">
                    <span class="pf-composer-template-label">{suggestionText(item)}</span>
                    <span class="pf-composer-template-kind">
                      {item.kind === "template" ? "Template" : "Skill"}
                    </span>
                  </span>
                  <span class="pf-composer-template-hint">{suggestionHint(item)}</span>
                </button>
              )}
            </For>
          </div>
        </Show>
        {/* The frame (border, radius, fill) lives on this wrapper, not on the
          * editor, so the context/cost readout can sit inside it as a bottom
          * gutter without overlapping the editor's own scrolling content. */}
        <div
          class="pf-chat-field"
          onMouseDown={(event) => {
            // The frame is wider than the editor now (it also holds the meter
            // gutter), and a text field you can click without getting a caret
            // reads as broken. Route clicks that land on the frame itself — the
            // gutter, the readout, the padding — into the editor instead of
            // letting them blur it. Non-primary buttons are left alone so the
            // context menu and X11 middle-click paste keep their defaults.
            if (event.button !== 0) return;
            if (preparing() || field.contains(event.target as Node)) return;
            event.preventDefault();
            // Suppressing the default already preserved focus and any existing
            // selection, so only an unfocused editor needs placing — otherwise a
            // click on the readout mid-draft would collapse the caret to the end.
            if (document.activeElement === field) return;
            field.focus();
            placeCaret(text().length);
          }}
        >
          <div
            ref={(element) => {
              field = element;
              props.editorRef?.(element);
            }}
            class="pf-chat-textarea pf-chat-editor"
            role="textbox"
            aria-multiline="true"
            aria-label={placeholder()}
            data-placeholder={placeholder()}
            title={
              props.turnActive && !props.supportsSteer ? props.steerUnavailableReason : undefined
            }
            aria-description={
              props.turnActive && !props.supportsSteer ? props.steerUnavailableReason : undefined
            }
            aria-keyshortcuts={
              queueing() && props.supportsSteer ? steerAriaShortcut() : undefined
            }
            contentEditable={!preparing()}
            spellcheck={true}
            onInput={onInput}
            onPaste={onPaste}
            onKeyDown={onKeyDown}
            onCompositionStart={() => {
              composing = true;
            }}
            onCompositionEnd={() => {
              composing = false;
              onInput();
            }}
          />
          {props.meter}
        </div>
        <Show
          when={props.turnActive}
          fallback={
            <button
              type="button"
              class="pf-chat-send"
              classList={{ "pf-chat-send--yield": props.emberYielded }}
              disabled={preparing() || !canSend()}
              aria-label={preparing() ? "Preparing images" : "Send"}
              onClick={submit}
            >
              <Show when={preparing()} fallback="Send">
                <Spinner class="pf-chat-send-spinner" label="Preparing images" />
              </Show>
            </button>
          }
        >
          <button
            type="button"
            class="pf-chat-send pf-chat-send--stop"
            classList={{ "pf-chat-send--yield": props.emberYielded }}
            onClick={() => props.onInterrupt()}
          >
            Stop
          </button>
        </Show>
      </div>
      <Show when={textPreviewAttachment()}>
        {(attachment) => (
          <Portal>
            <div
              class="pf-text-preview"
              role="dialog"
              aria-modal="true"
              aria-label="Text preview"
              onClick={closeTextPreview}
              onKeyDown={(e) => {
                if (e.key === "Escape") closeTextPreview();
              }}
            >
              <div class="pf-text-preview-panel" onClick={(e) => e.stopPropagation()}>
                <div class="pf-text-preview-head">
                  <div>
                    <div class="pf-text-preview-title">
                      Text #{attachmentNumber(attachment())}
                    </div>
                    <div class="pf-text-preview-meta">
                      {textStats(textPreviewDraft()).chars} chars ·{" "}
                      {textStats(textPreviewDraft()).lines} lines
                    </div>
                  </div>
                  <button
                    type="button"
                    class="pf-text-preview-close"
                    aria-label="Close text preview"
                    onClick={closeTextPreview}
                  >
                    <IconClose size={18} />
                  </button>
                </div>
                <textarea
                  ref={textPreviewArea}
                  class="pf-text-preview-area"
                  value={textPreviewDraft()}
                  readOnly={!textPreviewEditing()}
                  spellcheck={true}
                  onInput={(e) => setTextPreviewDraft(e.currentTarget.value)}
                />
                <div class="pf-text-preview-actions">
                  <button type="button" onClick={selectTextPreview}>
                    Select
                  </button>
                  <button type="button" onClick={copyTextPreview}>
                    Copy
                  </button>
                  <button type="button" disabled={preparing()} onClick={pasteTextPreview}>
                    Paste
                  </button>
                  <Show
                    when={textPreviewEditing()}
                    fallback={
                      <button
                        type="button"
                        disabled={preparing()}
                        onClick={() => {
                          setTextPreviewDraft(attachment().content);
                          setTextPreviewEditing(true);
                          queueMicrotask(() => textPreviewArea?.focus());
                        }}
                      >
                        Edit
                      </button>
                    }
                  >
                    <button type="button" disabled={preparing()} onClick={updateTextPreview}>
                      Update
                    </button>
                  </Show>
                </div>
              </div>
            </div>
          </Portal>
        )}
      </Show>
    </div>
  );
}
