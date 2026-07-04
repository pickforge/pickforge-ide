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
import { convertFileSrc } from "@tauri-apps/api/core";
import { AGENTS, type AgentProfile, modelOption } from "../../lib/agentModels";
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
import { defaultMode, isDangerMode, modeOptions } from "../../lib/agentModes";
import {
  type ComposerAttachment,
  addAttachmentWithMarker,
  createPendingAttachment,
  decidePreparingState,
  hasPendingAttachments,
  readyAttachmentPaths,
  removeAttachmentWithMarker,
  resolveAttachment,
} from "../../lib/composerAttachments";
import { type PromptTemplate, matchTemplates } from "../../lib/promptTemplates";
import { filePathsFromUriList, registerPathDropTarget } from "../../lib/terminalDrop";
import { Dropdown, type DropdownOption } from "../Dropdown";
import { IconClaude, IconForgeFlame, IconIngot, IconOpenAI, IconShield } from "../icons";
import { Spinner } from "../ui";
import { openLightbox } from "./ImageLightbox";
import "./chat.css";

const PROVIDERS = AGENTS.filter(
  (a): a is AgentProfile & { id: AgentProvider } =>
    a.id === "claudeCode" || a.id === "codex",
);

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

function modelsFor(provider: AgentProvider) {
  return AGENTS.find((a) => a.id === provider)?.models ?? [];
}

type Suggestion =
  | { kind: "template"; template: PromptTemplate }
  | { kind: "skill"; skill: AgentSkill };

export function Composer(props: {
  provider: AgentProvider;
  model: string | null;
  effort?: string | null;
  mode?: string | null;
  turnActive: boolean;
  onSend: (text: string, images?: string[]) => void | Promise<void>;
  onInterrupt: () => void;
  onProviderChange?: (provider: AgentProvider) => void;
  onModelChange?: (model: string | null) => void;
  onEffortChange?: (effort: string) => void;
  onModeChange?: (mode: string) => void;
  supportsSteer?: boolean;
  onSteer?: (text: string) => void | Promise<void>;
  emberYielded?: boolean;
  meter?: JSX.Element;
}): JSX.Element {
  const [text, setText] = createSignal("");
  const [dismissed, setDismissed] = createSignal(false);
  const [selected, setSelected] = createSignal(0);
  const [skills, setSkills] = createSignal<AgentSkill[]>([]);
  const [attachments, setAttachments] = createSignal<ComposerAttachment[]>([]);
  const [pasteError, setPasteError] = createSignal<string | null>(null);
  const [dropHover, setDropHover] = createSignal(false);
  const [preparing, setPreparing] = createSignal(false);
  const [prepareFailed, setPrepareFailed] = createSignal(false);
  let root!: HTMLDivElement;
  let field!: HTMLTextAreaElement;
  let pasteErrorTimer: ReturnType<typeof setTimeout> | undefined;
  let pasteGeneration = 0;
  let droppedPasteGeneration: number | null = null;
  let nextAttachmentId = 1;

  const showPasteError = (message: string, autoClearMs?: number) => {
    if (pasteErrorTimer) clearTimeout(pasteErrorTimer);
    setPasteError(message);
    if (autoClearMs) {
      pasteErrorTimer = setTimeout(() => setPasteError(null), autoClearMs);
    }
  };

  const revokeObjectPreview = (previewUrl: string | null) => {
    if (previewUrl?.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
  };

  const revokePendingPreview = (attachment: ComposerAttachment | null) => {
    if (attachment?.status === "pending") revokeObjectPreview(attachment.previewUrl);
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
    const resolved =
      props.provider === "codex" ? (codexEffortOverride() ?? fallback) : fallback;
    return resolved && effortOptions().includes(resolved) ? resolved : null;
  };
  const providerDropdownOptions = (): DropdownOption[] =>
    PROVIDERS.map((agent) => ({
      value: agent.id,
      label: agent.label,
      icon: () =>
        agent.id === "claudeCode" ? <IconClaude size={13} /> : <IconOpenAI size={13} />,
    }));

  const modelDropdownOptions = (): DropdownOption[] =>
    modelsFor(props.provider).map((m) => ({
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
    if (props.provider === "codex") ensureCodexEffortOverride();
  });

  const steering = () => props.turnActive && !!props.supportsSteer && !!props.onSteer;
  const canSend = () => {
    if (props.turnActive) return steering() && text().trim().length > 0;
    return text().trim().length > 0 || attachments().length > 0;
  };
  const placeholder = () => (steering() ? "Steer the running turn…" : "Message the agent…");

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
  const suggestionsOpen = () => !dismissed() && suggestions().length > 0;
  const firstLine = (body: string) => body.split("\n")[0];

  const suggestionText = (item: Suggestion) =>
    item.kind === "template"
      ? item.template.label
      : `${item.skill.trigger}${item.skill.name}`;
  const suggestionHint = (item: Suggestion) =>
    item.kind === "template" ? firstLine(item.template.body) : item.skill.description;

  const insert = (item: Suggestion) => {
    if (item.kind === "template") {
      setText(item.template.body);
    } else {
      setText(`${item.skill.trigger}${item.skill.name} `);
    }
    setDismissed(true);
    setSelected(0);
    field.focus();
    autosize();
  };

  type MarkerAnchor = { generation: number; at: number | null };
  const pinMarkerAnchor = (): MarkerAnchor => ({
    generation: pasteGeneration,
    at: document.activeElement === field ? (field.selectionStart ?? null) : null,
  });

  const addPendingImage = (previewUrl: string | null, anchor?: MarkerAnchor) => {
    const attachment = createPendingAttachment(nextAttachmentId++, previewUrl);
    const focused = document.activeElement === field;
    const value = text();
    const pinned = anchor && anchor.generation === pasteGeneration ? anchor.at : null;
    const cursor =
      pinned ?? (focused ? (field.selectionStart ?? value.length) : value.length);
    const result = addAttachmentWithMarker(attachments(), value, cursor, attachment);
    setAttachments(result.attachments);
    if (pinned !== null && anchor) anchor.at = result.cursor;
    setText(result.text);
    if (focused) {
      field.selectionStart = result.cursor;
      field.selectionEnd = result.cursor;
    }
    autosize();
    return attachment;
  };

  const removeImage = (id: number, focus = true) => {
    const result = removeAttachmentWithMarker(attachments(), text(), id);
    if (!result.removed) return false;
    revokePendingPreview(result.removed);
    setAttachments(result.attachments);
    setText(result.text);
    if (focus) field.focus();
    autosize();
    return true;
  };

  const hasAttachment = (id: number) =>
    attachments().some((attachment) => attachment.id === id);

  const discardStaleImage = (id: number, generation: number) => {
    if (!hasAttachment(id)) return true;
    if (generation === pasteGeneration) return false;
    removeImage(id, false);
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
  };

  const failImage = (id: number, generation: number, error: unknown) => {
    if (!hasAttachment(id)) return;
    if (generation !== pasteGeneration) {
      discardStaleImage(id, generation);
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    const wasPreparing = preparing();
    let removed = false;
    batch(() => {
      removed = removeImage(id, false);
      if (removed && wasPreparing) setPrepareFailed(true);
    });
    if (!removed || message === "clipboard has no image") return;
    showPasteError(message);
  };

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
            const message = error instanceof Error ? error.message : String(error);
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
            const insert = paths.length > 0 ? paths.join(" ") : text;
            const start = field.selectionStart ?? field.value.length;
            const end = field.selectionEnd ?? start;
            setText(`${field.value.slice(0, start)}${insert}${field.value.slice(end)}`);
            autosize();
          })
          .catch((error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);
            if (message === "clipboard has no text") return;
            showPasteError(message);
          });
        return;
      }
      if (fileItems > 0 || data.types.length > 0) return;
      event.preventDefault();
      if (props.turnActive) {
        showPasteError("Images can't be attached while a turn is running", 4000);
        return;
      }
      const generation = pasteGeneration;
      const attachment = addPendingImage(null, anchor);
      void agentStashClipboardImage()
        .then((path) => resolveImage(attachment.id, generation, path))
        .catch((error) => failImage(attachment.id, generation, error));
      return;
    }
    event.preventDefault();
    if (props.turnActive) {
      showPasteError("Images can't be attached while a turn is running", 4000);
      return;
    }
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
    if (props.turnActive) {
      showPasteError("Images can't be attached while a turn is running", 4000);
      return;
    }
    const files = paths.filter((path) => acceptedPathExt(path));
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

  const dispatchSend = () => {
    const savedText = text();
    const value = savedText.trim();
    const savedAttachments = [...attachments()];
    const savedImages = readyAttachmentPaths(savedAttachments);
    if (!value && savedImages.length === 0) return;
    if (hasPendingAttachments(savedAttachments)) return;
    if (props.turnActive) {
      if (!steering() || !value) return;
      pasteGeneration += 1;
      droppedPasteGeneration = null;
      const result = props.onSteer!(value);
      setText("");
      field.style.height = "auto";
      void Promise.resolve(result).catch(() => {
        if (text().trim().length === 0 && attachments().length === 0) {
          setText(savedText);
          autosize();
        }
      });
      return;
    }

    pasteGeneration += 1;
    droppedPasteGeneration = null;
    const result = props.onSend(value, savedImages.length > 0 ? savedImages : undefined);
    setText("");
    setAttachments([]);
    field.style.height = "auto";
    void Promise.resolve(result).catch(() => {
      if (text().trim().length === 0 && attachments().length === 0) {
        setText(savedText);
        setAttachments(savedAttachments);
        autosize();
      }
    });
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
  });

  const submit = () => {
    if (preparing()) return;
    if (!props.turnActive && hasPendingAttachments(attachments())) {
      setPrepareFailed(false);
      setPreparing(true);
      return;
    }
    dispatchSend();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.isComposing) return;
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
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  function autosize() {
    field.style.height = "auto";
    field.style.height = `${Math.min(field.scrollHeight, 200)}px`;
  }

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
          disabled={props.turnActive}
          value={props.provider}
          onChange={(value) => props.onProviderChange?.(value as AgentProvider)}
          options={providerDropdownOptions()}
        />
        <Dropdown
          class="pf-chat-dd"
          up
          disabled={props.turnActive || modelsFor(props.provider).length === 0}
          value={props.model ?? ""}
          onChange={(value) => props.onModelChange?.(value || null)}
          options={modelDropdownOptions()}
        />
        <Show when={effortOptions().length > 0}>
          <Dropdown
            class="pf-chat-dd"
            up
            disabled={props.turnActive}
            value={props.effort && props.effort !== defaultEffort() ? props.effort : ""}
            title={
              props.provider === "claudeCode"
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
            disabled={props.turnActive}
            value={modeValue()}
            title={
              props.provider === "claudeCode" ? "Permission mode" : "Sandbox & approvals"
            }
            onChange={(value) => props.onModeChange?.(value)}
            options={modeDropdownOptions()}
          />
        </Show>
        <Show when={props.meter}>
          <div class="pf-chat-composer-meter">{props.meter}</div>
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
            {(attachment, i) => {
              const canPreview = () =>
                attachment.status === "ready" && attachment.previewUrl !== null;
              const openPreview = () => {
                if (canPreview() && attachment.previewUrl) openLightbox(attachment.previewUrl);
              };
              return (
                <div
                  class="pf-chat-attachment"
                  classList={{
                    "pf-chat-attachment--pending": attachment.status === "pending",
                  }}
                >
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
                        aria-label={canPreview() ? `Preview image ${i() + 1}` : undefined}
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
                        label={`Preparing image ${i() + 1}`}
                      />
                    </span>
                  </Show>
                  <span class="pf-chat-attachment-index" aria-hidden="true">
                    {i() + 1}
                  </span>
                  <button
                    type="button"
                    class="pf-chat-attachment-remove"
                    aria-label="Remove image"
                    onClick={() => removeImage(attachment.id)}
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
        <textarea
          ref={field}
          class="pf-chat-textarea"
          rows={1}
          placeholder={placeholder()}
          value={text()}
          onInput={(e) => {
            setText(e.currentTarget.value);
            setDismissed(false);
            setSelected(0);
            autosize();
          }}
          onPaste={onPaste}
          onKeyDown={onKeyDown}
        />
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
    </div>
  );
}
