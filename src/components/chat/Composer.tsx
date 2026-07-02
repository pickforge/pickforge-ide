import { type JSX, For, Show, createSignal } from "solid-js";
import { AGENTS, type AgentProfile } from "../../lib/agentModels";
import { type AgentProvider } from "../../lib/agentChat";
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
}): JSX.Element {
  const [text, setText] = createSignal("");
  let field!: HTMLTextAreaElement;

  const canSend = () => text().trim().length > 0 && !props.turnActive;

  const submit = () => {
    const value = text().trim();
    if (!value || props.turnActive) return;
    props.onSend(value);
    setText("");
    field.style.height = "auto";
  };

  const onKeyDown = (event: KeyboardEvent) => {
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
        <textarea
          ref={field}
          class="pf-chat-textarea"
          rows={1}
          placeholder="Message the agent…"
          value={text()}
          onInput={(e) => {
            setText(e.currentTarget.value);
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
            onClick={() => props.onInterrupt()}
          >
            Stop
          </button>
        </Show>
      </div>
    </div>
  );
}
