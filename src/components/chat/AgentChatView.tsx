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
  AGENTS,
  loadAgentEfforts,
  loadAgentModels,
  modelOption,
  nativeChatModel,
  setAgentEffort,
  setAgentModel,
} from "../../lib/agentModels";
import { loadAgentModes, setAgentMode } from "../../lib/agentModes";
import { startSwarm } from "../../stores/swarm";
import { loadAgentEngine } from "../../lib/chatDefaults";
import { ChatTimeline } from "./ChatTimeline";
import { Composer } from "./Composer";
import { ImageLightbox } from "./ImageLightbox";
import { ApprovalPrompt } from "./ApprovalPrompt";
import { ContextMeter } from "./ContextMeter";
import "./chat.css";

const REDUCED_MOTION =
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : null;

type ParsedSwarmCommand = {
  goal: string;
  count: number;
  model: string | null;
  providerPreference: "mixed" | "claudeCode" | "codex";
  mode: "scout" | "review";
};

function parseSwarmCommand(text: string): ParsedSwarmCommand | null {
  const trimmed = text.trim();
  if (!/^\/swarm(\s|$)/i.test(trimmed)) return null;
  const body = trimmed.replace(/^\/swarm\s*/i, "").trim();
  const countMatch =
    body.match(/\bswarm\s+(?:of\s+)?([1-5])\b/i) ??
    body.match(/\b([1-5])\s*(?:agents?|sub-agents?|workers?)\b/i);
  const count = Number(countMatch?.[1] ?? 3);
  const lower = body.toLowerCase();
  const providerPreference =
    lower.includes("codex") && !lower.includes("claude")
      ? "codex"
      : lower.includes("claude") && !lower.includes("codex")
        ? "claudeCode"
        : "mixed";
  const model =
    lower.includes("glm-5.2") || lower.includes("ollama")
      ? "glm-5.2:cloud"
      : lower.includes("opus") && lower.includes("4.8")
        ? "opus 4.8"
        : lower.includes("sonnet") && lower.includes("5")
          ? "sonnet 5"
          : lower.includes("gpt-5.5")
            ? "gpt-5.5"
            : null;
  return {
    goal: body || "Run a Pickforge swarm for this chat.",
    count,
    model,
    providerPreference,
    mode: lower.includes("review") ? "review" : "scout",
  };
}

export function AgentChatView(props: {
  chatId: string;
  projectRoot: string;
  provider: AgentProvider;
  model?: string | null;
}): JSX.Element {
  const state = () => agentChat(props.chatId);
  const provider = () => state()?.provider ?? props.provider;
  const model = () =>
    state()?.model ??
    props.model ??
    nativeChatModel(props.provider, loadAgentModels()[props.provider] ?? null);
  const effort = () => state()?.effort ?? null;
  const mode = () => state()?.mode ?? loadAgentModes()[provider()] ?? null;

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
      mode: loadAgentModes()[provider()] ?? null,
    });
  });

  // Switching providers abandons the session's context, so a chat that already
  // has content asks first instead of switching on a stray select change.
  const [pendingProvider, setPendingProvider] = createSignal<AgentProvider | null>(null);
  const providerLabel = (id: AgentProvider) =>
    AGENTS.find((agent) => agent.id === id)?.label ?? id;

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
      await startSwarm(props.projectRoot, swarm.goal, swarm);
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
      <ChatTimeline items={state()?.timeline ?? []} working={awaitingOutput()} />
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
          model={model()}
          effort={effort()}
          mode={mode()}
          turnActive={state()?.turnActive ?? false}
          supportsSteer={provider() === "codex"}
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
