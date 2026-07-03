import { type JSX, For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { convertFileSrc } from "@tauri-apps/api/core";
import { AGENTS, type AgentProfile, modelOption } from "../../lib/agentModels";
import {
  type AgentProvider,
  type AgentSkill,
  agentSkillsList,
  agentStashImage,
  codexConfigDefaultEffort,
} from "../../lib/agentChat";
import { type PromptTemplate, matchTemplates } from "../../lib/promptTemplates";
import { IconForgeFlame, IconIngot } from "../icons";
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
  turnActive: boolean;
  onSend: (text: string, images?: string[]) => void;
  onInterrupt: () => void;
  onProviderChange?: (provider: AgentProvider) => void;
  onModelChange?: (model: string | null) => void;
  onEffortChange?: (effort: string) => void;
  supportsSteer?: boolean;
  onSteer?: (text: string) => void;
  emberYielded?: boolean;
}): JSX.Element {
  const [text, setText] = createSignal("");
  const [dismissed, setDismissed] = createSignal(false);
  const [selected, setSelected] = createSignal(0);
  const [skills, setSkills] = createSignal<AgentSkill[]>([]);
  const [images, setImages] = createSignal<string[]>([]);
  const [pasteError, setPasteError] = createSignal<string | null>(null);
  let field!: HTMLTextAreaElement;
  let pasteErrorTimer: ReturnType<typeof setTimeout> | undefined;

  const showPasteError = (message: string, autoClearMs?: number) => {
    if (pasteErrorTimer) clearTimeout(pasteErrorTimer);
    setPasteError(message);
    if (autoClearMs) {
      pasteErrorTimer = setTimeout(() => setPasteError(null), autoClearMs);
    }
  };

  onCleanup(() => {
    if (pasteErrorTimer) clearTimeout(pasteErrorTimer);
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
  const effectiveEffort = () =>
    props.effort && effortOptions().includes(props.effort)
      ? props.effort
      : defaultEffort();
  const forgeHeat = () => EFFORT_HEAT[effectiveEffort() ?? ""] ?? 0.4;

  createEffect(() => {
    if (props.provider === "codex") ensureCodexEffortOverride();
  });

  const steering = () => props.turnActive && !!props.supportsSteer && !!props.onSteer;
  const canSend = () => {
    if (props.turnActive) return steering() && text().trim().length > 0;
    return text().trim().length > 0 || images().length > 0;
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

  const removeImage = (path: string) => {
    setImages((cur) => cur.filter((item) => item !== path));
    field.focus();
  };

  const onPaste = (event: ClipboardEvent) => {
    const data = event.clipboardData;
    if (!data) return;
    const files: { file: File; ext: string }[] = [];
    let unsupported = 0;
    for (const item of Array.from(data.items)) {
      if (item.kind !== "file" || !item.type.startsWith("image/")) continue;
      const ext = ACCEPTED_MIME_EXT[item.type];
      if (!ext) {
        unsupported += 1;
        continue;
      }
      const file = item.getAsFile();
      if (file) files.push({ file, ext });
    }
    if (files.length === 0 && unsupported === 0) return;
    event.preventDefault();
    if (props.turnActive) {
      showPasteError("Images can't be attached while a turn is running", 4000);
      return;
    }
    if (unsupported > 0) {
      showPasteError("Unsupported image type — use PNG, JPEG, GIF, or WebP");
    }
    for (const { file, ext } of files) {
      void readBase64(file)
        .then((base64) => agentStashImage(base64, ext))
        .then((path) => {
          setImages((cur) => [...cur, path]);
          if (pasteErrorTimer) clearTimeout(pasteErrorTimer);
          setPasteError(null);
        })
        .catch((error) => {
          showPasteError(error instanceof Error ? error.message : String(error));
        });
    }
  };

  const submit = () => {
    const value = text().trim();
    const pending = images();
    if (!value && pending.length === 0) return;
    if (props.turnActive) {
      if (!steering() || !value) return;
      props.onSteer!(value);
    } else {
      props.onSend(value, pending.length > 0 ? pending : undefined);
    }
    setText("");
    setImages([]);
    field.style.height = "auto";
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

  const autosize = () => {
    field.style.height = "auto";
    field.style.height = `${Math.min(field.scrollHeight, 200)}px`;
  };

  return (
    <div class="pf-chat-composer">
      <div class="pf-chat-composer-pickers">
        <select
          class="pf-chat-select"
          disabled={props.turnActive}
          value={props.provider}
          onChange={(e) => {
            const next = e.currentTarget.value as AgentProvider;
            // The switch may need confirmation (or be rejected): snap the
            // select back now; an accepted switch updates props.provider.
            e.currentTarget.value = props.provider;
            props.onProviderChange?.(next);
          }}
        >
          <For each={PROVIDERS}>
            {(agent) => <option value={agent.id}>{agent.label}</option>}
          </For>
        </select>
        <span class="pf-chat-picker">
          <IconIngot size={13} class="pf-chat-picker-icon" />
          <select
            class="pf-chat-select pf-chat-select--icon"
            disabled={props.turnActive || modelsFor(props.provider).length === 0}
            value={props.model ?? ""}
            title={
              props.provider === "claudeCode"
                ? "Model applies to new sessions"
                : undefined
            }
            onChange={(e) =>
              props.onModelChange?.(e.currentTarget.value || null)
            }
          >
            <For each={modelsFor(props.provider)}>
              {(m) => <option value={m.id}>{m.label}</option>}
            </For>
          </select>
        </span>
        <Show when={effortOptions().length > 0}>
          <span class="pf-chat-picker">
            <IconForgeFlame size={13} level={forgeHeat()} class="pf-chat-picker-icon" />
            <select
              class="pf-chat-select pf-chat-select--icon"
              disabled={props.turnActive}
              value={props.effort && props.effort !== defaultEffort() ? props.effort : ""}
              title={
                props.provider === "claudeCode"
                  ? "Effort applies to new sessions"
                  : undefined
              }
              onChange={(e) => props.onEffortChange?.(e.currentTarget.value)}
            >
              <Show when={!defaultEffort()}>
                <option value="">Default</option>
              </Show>
              <For each={effortOptions()}>
                {(level) =>
                  level === defaultEffort() ? (
                    <option value="">{`${EFFORT_LABELS[level] ?? level} (default)`}</option>
                  ) : (
                    <option value={level}>{EFFORT_LABELS[level] ?? level}</option>
                  )
                }
              </For>
            </select>
          </span>
        </Show>
      </div>
      <Show when={pasteError()}>
        {(message) => (
          <div class="pf-chat-paste-error" role="status">
            {message()}
          </div>
        )}
      </Show>
      <Show when={images().length > 0}>
        <div class="pf-chat-attachments">
          <For each={images()}>
            {(path) => (
              <div class="pf-chat-attachment">
                <img
                  class="pf-chat-attachment-img"
                  src={convertFileSrc(path)}
                  alt=""
                  onError={(e) => {
                    e.currentTarget.style.visibility = "hidden";
                  }}
                />
                <button
                  type="button"
                  class="pf-chat-attachment-remove"
                  aria-label="Remove image"
                  onClick={() => removeImage(path)}
                >
                  ✕
                </button>
              </div>
            )}
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
              disabled={!canSend()}
              onClick={submit}
            >
              Send
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
