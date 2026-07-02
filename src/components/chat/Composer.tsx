import { type JSX, For, Show, createMemo, createSignal } from "solid-js";
import { AGENTS, type AgentProfile } from "../../lib/agentModels";
import { type AgentProvider } from "../../lib/agentChat";
import { type PromptTemplate, matchTemplates } from "../../lib/promptTemplates";
import "./chat.css";

const PROVIDERS = AGENTS.filter(
  (a): a is AgentProfile & { id: AgentProvider } =>
    a.id === "claudeCode" || a.id === "codex",
);

function modelsFor(provider: AgentProvider) {
  return AGENTS.find((a) => a.id === provider)?.models ?? [];
}

export function Composer(props: {
  provider: AgentProvider;
  model: string | null;
  turnActive: boolean;
  onSend: (text: string) => void;
  onInterrupt: () => void;
  onProviderChange?: (provider: AgentProvider) => void;
  onModelChange?: (model: string | null) => void;
  supportsSteer?: boolean;
  onSteer?: (text: string) => void;
  emberYielded?: boolean;
}): JSX.Element {
  const [text, setText] = createSignal("");
  const [dismissed, setDismissed] = createSignal(false);
  const [selected, setSelected] = createSignal(0);
  let field!: HTMLTextAreaElement;

  const steering = () => props.turnActive && !!props.supportsSteer && !!props.onSteer;
  const canSend = () => text().trim().length > 0 && (!props.turnActive || steering());
  const placeholder = () => (steering() ? "Steer the running turn…" : "Message the agent…");

  const templates = createMemo(() =>
    text().startsWith("/") ? matchTemplates(text()) : [],
  );
  const templatesOpen = () => !dismissed() && templates().length > 0;
  const firstLine = (body: string) => body.split("\n")[0];

  const insertTemplate = (template: PromptTemplate) => {
    setText(template.body);
    setDismissed(true);
    setSelected(0);
    field.focus();
    autosize();
  };

  const submit = () => {
    const value = text().trim();
    if (!value) return;
    if (props.turnActive) {
      if (!steering()) return;
      props.onSteer!(value);
    } else {
      props.onSend(value);
    }
    setText("");
    field.style.height = "auto";
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.isComposing) return;
    if (templatesOpen()) {
      const list = templates();
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
        const template = list[selected()] ?? list[0];
        if (template) insertTemplate(template);
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
          onChange={(e) =>
            props.onProviderChange?.(e.currentTarget.value as AgentProvider)
          }
        >
          <For each={PROVIDERS}>
            {(agent) => <option value={agent.id}>{agent.label}</option>}
          </For>
        </select>
        <select
          class="pf-chat-select"
          disabled={props.turnActive || modelsFor(props.provider).length === 0}
          value={props.model ?? ""}
          onChange={(e) =>
            props.onModelChange?.(e.currentTarget.value || null)
          }
        >
          <For each={modelsFor(props.provider)}>
            {(m) => <option value={m.id}>{m.label}</option>}
          </For>
        </select>
      </div>
      <div class="pf-chat-composer-input">
        <Show when={templatesOpen()}>
          <div class="pf-composer-templates" role="listbox">
            <For each={templates()}>
              {(template, i) => (
                <button
                  type="button"
                  class="pf-composer-template"
                  classList={{ "pf-composer-template--on": i() === selected() }}
                  role="option"
                  aria-selected={i() === selected()}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setSelected(i())}
                  onClick={() => insertTemplate(template)}
                >
                  <span class="pf-composer-template-label">{template.label}</span>
                  <span class="pf-composer-template-hint">{firstLine(template.body)}</span>
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
