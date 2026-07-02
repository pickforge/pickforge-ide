import { type JSX, Show, createMemo, createSignal, onMount } from "solid-js";
import {
  agentChat,
  approveAgentRequest,
  ensureAgentChat,
  interruptAgentChat,
  sendAgentMessage,
  steerAgentChat,
} from "../../stores/agentChat";
import { type AgentProvider } from "../../lib/agentChat";
import { loadAgentModels, setAgentModel } from "../../lib/agentModels";
import { loadAgentEngine } from "../../lib/chatDefaults";
import { ChatTimeline } from "./ChatTimeline";
import { Composer } from "./Composer";
import { ApprovalPrompt } from "./ApprovalPrompt";
import { ContextMeter } from "./ContextMeter";
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
  const approvals = createMemo(() => state()?.approvals ?? []);
  const hasApprovals = () => approvals().length > 0;

  onMount(() => {
    void ensureAgentChat(props.chatId, props.projectRoot, provider(), model(), {
      engine: loadAgentEngine(),
    });
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
      <Show when={hasApprovals()}>
        <ApprovalPrompt
          approvals={approvals()}
          onDecide={(approvalId, decision) =>
            void approveAgentRequest(props.chatId, approvalId, decision)
          }
        />
      </Show>
      <Show when={state()}>
        {(chat) => (
          <ContextMeter
            contextUsed={chat().contextUsed}
            contextWindow={chat().contextWindow}
            totals={chat().totals}
          />
        )}
      </Show>
      <Composer
        provider={provider()}
        model={model()}
        turnActive={state()?.turnActive ?? false}
        supportsSteer={provider() === "codex"}
        emberYielded={hasApprovals()}
        onSend={(text) => void sendAgentMessage(props.chatId, text)}
        onSteer={(text) => void steerAgentChat(props.chatId, text)}
        onInterrupt={() => void interruptAgentChat(props.chatId)}
        onProviderChange={onProviderChange}
        onModelChange={onModelChange}
      />
    </div>
  );
}
