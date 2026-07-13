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
  setAgentChatMode,
  setAgentChatModel,
  steerAgentChat,
  switchAgentChatProvider,
} from "../../stores/agentChat";
import { type AgentProvider } from "../../lib/agentChat";
import {
  agentBackendDescriptor,
  backendCapabilityReason,
  supportsBackendCapability,
} from "../../lib/agentBackends";
import {
  loadAgentEfforts,
  loadAgentModels,
  modelOption,
  nativeChatModel,
  setAgentEffort,
  setAgentModel,
} from "../../lib/agentModels";
import { loadAgentModes, setAgentMode } from "../../lib/agentModes";
import { startSwarm, swarmRuns } from "../../stores/swarm";
import { loadAgentEngine } from "../../lib/chatDefaults";
import { parseSwarmCommand } from "../../lib/swarmCommand";
import { ChatTimeline } from "./ChatTimeline";
import { SwarmRunCard } from "./SwarmRunCard";
import { Composer } from "./Composer";
import { ImageLightbox } from "./ImageLightbox";
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
  const configuredEngine = loadAgentEngine();
  const state = () => agentChat(props.chatId);
  const engine = () => state()?.engine ?? configuredEngine;
  const provider = () => state()?.provider ?? props.provider;
  const model = () =>
    state()?.model ??
    props.model ??
    nativeChatModel(props.provider, loadAgentModels()[props.provider] ?? null);
  const effort = () => state()?.effort ?? null;
  const mode = () => state()?.mode ?? loadAgentModes()[provider()] ?? null;

  const approvalsSupported = () =>
    supportsBackendCapability(provider(), "approvalEvents", "nativeChat", engine());
  const approvals = createMemo(() => (approvalsSupported() ? (state()?.approvals ?? []) : []));
  const hasApprovals = () => approvals().length > 0;
  const visibleSwarms = createMemo(() =>
    swarmRuns()
      .filter((run) => run.projectRoot === props.projectRoot && run.originChatId === props.chatId)
      .slice(0, 3),
  );

  const showNotice = () => state()?.providerSwitched ?? false;
  const remoteHost = () => state()?.remoteHost ?? null;

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
      engine: configuredEngine,
      effort: loadAgentEfforts()[provider()] ?? null,
      mode: loadAgentModes()[provider()] ?? null,
    });
  });

  // Switching providers abandons the session's context, so a chat that already
  // has content asks first instead of switching on a stray select change.
  const [pendingProvider, setPendingProvider] = createSignal<AgentProvider | null>(null);
  const providerLabel = (id: AgentProvider) => agentBackendDescriptor(id).label;

  const doSwitch = (next: AgentProvider) => {
    const nextModel = nativeChatModel(next, loadAgentModels()[next] ?? null);
    const nextEffort = loadAgentEfforts()[next] ?? null;
    const nextMode = loadAgentModes()[next] ?? null;
    void switchAgentChatProvider(props.chatId, next, nextModel, nextEffort, nextMode).catch(
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

  const onModeChange = (next: string) => {
    setAgentMode(provider(), next);
    setAgentChatMode(props.chatId, next);
  };

  const onSend = async (text: string, images?: string[]) => {
    const swarm = parseSwarmCommand(text);
    if (swarm) {
      await startSwarm(props.projectRoot, swarm.goal, { ...swarm, originChatId: props.chatId });
      return;
    }
    await sendAgentMessage(props.chatId, text, images);
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

  // The turn is running but nothing is streaming yet (or between tool calls):
  // show the working row instantly instead of a silent, frozen timeline.
  const awaitingOutput = () => {
    const chat = state();
    if (!chat?.turnActive) return false;
    const last = chat.timeline[chat.timeline.length - 1];
    if (!last) return true;
    return !((last.type === "assistantText" || last.type === "thinking") && last.streaming);
  };

  return (
    <div class="pf-chat-view">
      <ImageLightbox />
      <ChatTimeline
        items={state()?.timeline ?? []}
        working={awaitingOutput()}
        chatId={props.chatId}
      />
      <Show when={visibleSwarms().length > 0}>
        <div class="pf-chat-swarm-dock">
          <SwarmRunCard runs={visibleSwarms()} />
        </div>
      </Show>
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
      <Show when={remoteHost()}>
        {(host) => (
          <div class="pf-chat-switch-notice" role="status">
            <span class="pf-chat-switch-notice-text">
              Running remotely via ssh on {host()} — streaming responses
            </span>
          </div>
        )}
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
        <Composer
          meter={
            <Show when={state()}>
              {(chat) => (
                <ContextMeter
                  contextUsed={chat().contextUsed}
                  contextWindow={chat().contextWindow}
                  totals={chat().totals}
                />
              )}
            </Show>
          }
          provider={provider()}
          engine={engine()}
          model={model()}
          effort={effort()}
          mode={mode()}
          turnActive={state()?.turnActive ?? false}
          supportsImages={supportsBackendCapability(provider(), "imageInput", "nativeChat", engine())}
          imageUnavailableReason={
            backendCapabilityReason(provider(), "imageInput", "nativeChat", engine()) ?? undefined
          }
          supportsSteer={supportsBackendCapability(provider(), "steerTurn", "nativeChat", engine())}
          steerUnavailableReason={
            backendCapabilityReason(provider(), "steerTurn", "nativeChat", engine()) ?? undefined
          }
          emberYielded={hasApprovals()}
          onSend={onSend}
          onSteer={(text) => steerAgentChat(props.chatId, text)}
          onInterrupt={() => void interruptAgentChat(props.chatId)}
          onProviderChange={onProviderChange}
          onModelChange={onModelChange}
          onEffortChange={onEffortChange}
          onModeChange={onModeChange}
        />
      </div>
    </div>
  );
}
