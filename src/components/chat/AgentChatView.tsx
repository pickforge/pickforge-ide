import { type JSX, Show, createSignal, onMount } from "solid-js";
import {
  agentChat,
  ensureAgentChat,
  interruptAgentChat,
  sendAgentMessage,
} from "../../stores/agentChat";
import { type AgentProvider } from "../../lib/agentChat";
import { loadAgentModels, setAgentModel } from "../../lib/agentModels";
import { ChatTimeline } from "./ChatTimeline";
import { Composer } from "./Composer";
import "./chat.css";

export function AgentChatView(props: {
  chatId: string;
  projectRoot: string;
  provider: AgentProvider;
  model?: string | null;
}): JSX.Element {
  const [provider, setProvider] = createSignal<AgentProvider>(props.provider);
  const [model, setModel] = createSignal<string | null>(
    props.model ?? loadAgentModels()[props.provider] ?? null,
  );

  const state = () => agentChat(props.chatId);

  onMount(() => {
    void ensureAgentChat(props.chatId, props.projectRoot, provider(), model());
  });

  const onProviderChange = (next: AgentProvider) => {
    setProvider(next);
    setModel(loadAgentModels()[next] ?? null);
  };

  const onModelChange = (next: string | null) => {
    setModel(next);
    setAgentModel(provider(), next);
  };

  return (
    <div class="pf-chat-view">
      <ChatTimeline items={state()?.timeline ?? []} />
      <Show when={state()?.error}>
        {(message) => (
          <div class="pf-chat-error" role="alert">
            <span class="pf-chat-error-tag" aria-hidden="true">
              !
            </span>
            <span class="pf-chat-error-text">{message()}</span>
          </div>
        )}
      </Show>
      <Composer
        provider={provider()}
        model={model()}
        turnActive={state()?.turnActive ?? false}
        onSend={(text) => void sendAgentMessage(props.chatId, text)}
        onInterrupt={() => void interruptAgentChat(props.chatId)}
        onProviderChange={onProviderChange}
        onModelChange={onModelChange}
      />
    </div>
  );
}
