import {
  type JSX,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";
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
import {
  AGENTS,
  loadAgentEfforts,
  loadAgentModels,
  modelOption,
  setAgentEffort,
  setAgentModel,
} from "../../lib/agentModels";
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
      effort: loadAgentEfforts()[provider()] ?? null,
    });
  });

  // Switching providers abandons the session's context, so a chat that already
  // has content asks first instead of switching on a stray select change.
  const [pendingProvider, setPendingProvider] = createSignal<AgentProvider | null>(null);
  const providerLabel = (id: AgentProvider) =>
    AGENTS.find((agent) => agent.id === id)?.label ?? id;

  const doSwitch = (next: AgentProvider) => {
    const nextModel = loadAgentModels()[next] ?? null;
    const nextEffort = loadAgentEfforts()[next] ?? null;
    void switchAgentChatProvider(props.chatId, next, nextModel, nextEffort).catch(
      () => undefined,
    );
  };

  const onProviderChange = (next: AgentProvider) => {
    const chat = state();
    if (chat?.turnActive || next === provider()) return;
    // Until the persisted history has loaded, an empty timeline proves nothing
    // — err on the side of confirming rather than silently dropping context.
    const mayHaveContext = (chat?.timeline.length ?? 0) > 0 || !chat?.historyLoaded;
    if (mayHaveContext) {
      setPendingProvider(next);
      return;
    }
    doSwitch(next);
  };

  createEffect(() => {
    if (state()?.turnActive) setPendingProvider(null);
  });

  const onModelChange = (next: string | null) => {
    setAgentModel(provider(), next);
    setAgentChatModel(props.chatId, next);
  };

  const onEffortChange = (next: string) => {
    setAgentEffort(provider(), next);
    setAgentChatEffort(props.chatId, next);
  };

  // A model/provider change can leave a selected effort the new model does not
  // accept — drop THIS CHAT back to the default without touching the persisted
  // per-provider preference (inspecting another model must not erase it).
  createEffect(() => {
    const current = effort();
    if (!current) return;
    const supported = modelOption(provider(), model())?.efforts ?? [];
    if (!supported.includes(current)) setAgentChatEffort(props.chatId, "");
  });

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
      <Show when={pendingProvider()}>
        {(next) => (
          <div
            class="pf-chat-switch-confirm"
            role="group"
            aria-label="Confirm provider switch"
          >
            <span class="pf-chat-switch-notice-text">
              Switch to {providerLabel(next())}? A new session starts — this chat's
              context does not carry over.
            </span>
            <div class="pf-chat-switch-confirm-actions">
              <button
                type="button"
                class="pf-approval-btn"
                onClick={() => {
                  const target = next();
                  setPendingProvider(null);
                  doSwitch(target);
                }}
              >
                Switch
              </button>
              <button
                type="button"
                class="pf-approval-btn pf-approval-btn--quiet"
                onClick={() => setPendingProvider(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
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
