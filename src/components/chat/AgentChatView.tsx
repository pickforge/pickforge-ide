import { type JSX, Show, createEffect, createMemo, onCleanup, onMount } from "solid-js";
import {
  agentChat,
  approveAgentRequest,
  clearProviderSwitched,
  ensureAgentChat,
  interruptAgentChat,
  sendAgentMessage,
  setAgentChatEffort,
  setAgentChatModel,
  steerAgentChat,
  switchAgentChatProvider,
} from "../../stores/agentChat";
import { type AgentProvider } from "../../lib/agentChat";
import { loadAgentModels, setAgentModel } from "../../lib/agentModels";
import { loadAgentEngine } from "../../lib/chatDefaults";
import { ChatTimeline } from "./ChatTimeline";
import { Composer } from "./Composer";
import { ApprovalPrompt } from "./ApprovalPrompt";
import { ContextMeter } from "./ContextMeter";
import "./chat.css";

const REDUCED_MOTION =
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : null;

export function AgentChatView(props: {
  chatId: string;
  projectRoot: string;
  provider: AgentProvider;
  model?: string | null;
}): JSX.Element {
  const state = () => agentChat(props.chatId);
  const provider = () => state()?.provider ?? props.provider;
  const model = () =>
    state()?.model ?? props.model ?? loadAgentModels()[props.provider] ?? null;
  const effort = () => state()?.effort ?? null;

  const approvals = createMemo(() => state()?.approvals ?? []);
  const hasApprovals = () => approvals().length > 0;

  const showNotice = () => state()?.providerSwitched ?? false;

  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  createEffect(() => {
    if (state()?.providerSwitched) {
      if (noticeTimer) clearTimeout(noticeTimer);
      if (!REDUCED_MOTION?.matches) {
        noticeTimer = setTimeout(() => clearProviderSwitched(props.chatId), 6000);
      }
    }
  });
  onCleanup(() => {
    if (noticeTimer) clearTimeout(noticeTimer);
  });

  onMount(() => {
    void ensureAgentChat(props.chatId, props.projectRoot, provider(), model(), {
      engine: loadAgentEngine(),
    });
  });

  const onProviderChange = (next: AgentProvider) => {
    if (state()?.turnActive || next === provider()) return;
    const nextModel = loadAgentModels()[next] ?? null;
    void switchAgentChatProvider(props.chatId, next, nextModel).catch(() => undefined);
  };

  const onModelChange = (next: string | null) => {
    setAgentModel(provider(), next);
    setAgentChatModel(props.chatId, next);
  };

  const onEffortChange = (next: string) => {
    setAgentChatEffort(props.chatId, next);
  };

  return (
    <div class="pf-chat-view">
      <ChatTimeline items={state()?.timeline ?? []} />
      <Show when={showNotice()}>
        <div class="pf-chat-switch-notice" role="status">
          <span class="pf-chat-switch-notice-text">
            Provider switched — new session, context does not carry over
          </span>
          <button
            type="button"
            class="pf-chat-switch-notice-dismiss"
            aria-label="Dismiss"
            onClick={() => clearProviderSwitched(props.chatId)}
          >
            ✕
          </button>
        </div>
      </Show>
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
      <div class="pf-chat-footer">
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
          effort={effort()}
          turnActive={state()?.turnActive ?? false}
          supportsSteer={provider() === "codex"}
          emberYielded={hasApprovals()}
          onSend={(text, images) => void sendAgentMessage(props.chatId, text, images)}
          onSteer={(text) => void steerAgentChat(props.chatId, text)}
          onInterrupt={() => void interruptAgentChat(props.chatId)}
          onProviderChange={onProviderChange}
          onModelChange={onModelChange}
          onEffortChange={onEffortChange}
        />
      </div>
    </div>
  );
}
