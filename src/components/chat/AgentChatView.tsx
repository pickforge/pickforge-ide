import {
  type JSX,
  Show,
  createEffect,
  createMemo,
  createResource,
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
  retryAgentChatConnection,
  sendAgentMessage,
  setAgentChatEffort,
  setAgentChatMode,
  setAgentChatModel,
  steerAgentChat,
  switchAgentChatProvider,
  type AgentApproval,
  type AgentChatState,
} from "../../stores/agentChat";
import { type AgentApprovalDecision, type AgentProvider } from "../../lib/agentChat";
import type { SwarmRunSnapshot } from "../../lib/mcp";
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
import { ChatTimeline, type ChangesReceiptSource } from "./ChatTimeline";
import { changesListTurnChangeSets, type ChangeSet } from "../../lib/changes";
import { flagEnabled } from "../../stores/flags";
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

/** The "retry connection" affordance for a dead OMP/Pi session: tracks a
 * monotonic attempt counter (reset on chat/provider identity change or a
 * provider switch) so a stale retry can never mark a newer session
 * recovered. A composable, called synchronously from `AgentChatView`'s own
 * setup so its `createEffect` runs under the same reactive owner as if
 * written inline. `onRecovered` fires once recovery is confirmed (the
 * caller focuses its status element). */
function createConnectionRecovery(
  chatId: () => string,
  provider: () => AgentProvider,
  state: () => AgentChatState | undefined,
  onRecovered: () => void,
) {
  const [retryingConnection, setRetryingConnection] = createSignal(false);
  const [connectionRecovered, setConnectionRecovered] = createSignal(false);
  let recoveryAttempt = 0;
  let recoveryIdentity = `${chatId()}:${provider()}`;

  createEffect(() => {
    const identity = `${chatId()}:${provider()}`;
    if (identity !== recoveryIdentity) {
      recoveryIdentity = identity;
      recoveryAttempt += 1;
      setRetryingConnection(false);
      setConnectionRecovered(false);
    }
    if (!state()?.sessionId || state()?.error) setConnectionRecovered(false);
  });

  const canRetryConnection = () => {
    const chat = state();
    return !!chat?.error && (chat.provider === "omp" || chat.provider === "pi");
  };

  const retryConnection = async () => {
    const chat = state();
    if (!chat || retryingConnection() || !canRetryConnection()) return;
    const attempt = ++recoveryAttempt;
    const retryProvider = chat.provider;
    const retryChatId = chatId();
    setConnectionRecovered(false);
    setRetryingConnection(true);
    try {
      await retryAgentChatConnection(retryChatId);
      const current = state();
      if (
        attempt === recoveryAttempt
        && chatId() === retryChatId
        && current?.provider === retryProvider
        && current.sessionId
        && !current.error
      ) {
        setConnectionRecovered(true);
        queueMicrotask(onRecovered);
      }
    } catch {
      // retryAgentChatConnection records the actionable connection error in the store.
    } finally {
      if (attempt === recoveryAttempt) setRetryingConnection(false);
    }
  };

  // Switching providers abandons the in-flight recovery — a stale retry must
  // not later mark the new session "recovered".
  const resetOnProviderSwitch = () => {
    recoveryAttempt += 1;
    setRetryingConnection(false);
    setConnectionRecovered(false);
  };

  return {
    retryingConnection,
    connectionRecovered,
    canRetryConnection,
    retryConnection,
    resetOnProviderSwitch,
  };
}

function ProviderSwitchConfirm(props: {
  next: AgentProvider;
  label: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div class="pf-chat-switch-confirm" role="group" aria-label="Confirm provider switch">
      <span class="pf-chat-switch-notice-text">
        Switch to {props.label}? A new session starts — this chat's context does not carry over.
      </span>
      <div class="pf-chat-switch-confirm-actions">
        <button type="button" class="pf-approval-btn" onClick={props.onConfirm}>
          Switch
        </button>
        <button
          type="button"
          class="pf-approval-btn pf-approval-btn--quiet"
          onClick={props.onCancel}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function ChatErrorBanner(props: {
  message: string;
  canRetry: () => boolean;
  retrying: () => boolean;
  onRetry: () => void;
}) {
  return (
    <div class="pf-chat-error" role="alert">
      <span class="pf-chat-error-tag" aria-hidden="true">
        !
      </span>
      <span class="pf-chat-error-text">{props.message}</span>
      <Show when={props.canRetry()}>
        <button
          type="button"
          class="pf-approval-btn pf-approval-btn--quiet"
          disabled={props.retrying()}
          aria-busy={props.retrying()}
          onClick={props.onRetry}
        >
          {props.retrying() ? "Retrying…" : "Retry connection"}
        </button>
      </Show>
    </div>
  );
}

function ChatViewNotices(props: {
  chatId: string;
  visibleSwarmsCount: () => number;
  visibleSwarms: () => SwarmRunSnapshot[];
  showNotice: () => boolean;
  remoteHost: () => string | null;
  pendingProvider: () => AgentProvider | null;
  providerLabel: (id: AgentProvider) => string;
  onConfirmSwitch: (next: AgentProvider) => void;
  onCancelSwitch: () => void;
  error: () => string | undefined | null;
  canRetryConnection: () => boolean;
  retryingConnection: () => boolean;
  onRetryConnection: () => void;
  showConnectionRecovered: () => boolean;
  recoveryStatusRef: (el: HTMLDivElement) => void;
  hasApprovals: () => boolean;
  approvals: () => AgentApproval[];
  onDecideApproval: (approvalId: string, decision: AgentApprovalDecision) => void;
}) {
  return (
    <>
      <Show when={props.visibleSwarmsCount() > 0}>
        <div class="pf-chat-swarm-dock">
          <SwarmRunCard runs={props.visibleSwarms()} />
        </div>
      </Show>
      <Show when={props.showNotice()}>
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
      <Show when={props.remoteHost()}>
        {(host) => (
          <div class="pf-chat-switch-notice" role="status">
            <span class="pf-chat-switch-notice-text">
              Running remotely via ssh on {host()} — streaming responses
            </span>
          </div>
        )}
      </Show>
      <Show when={props.pendingProvider()}>
        {(next) => (
          <ProviderSwitchConfirm
            next={next()}
            label={props.providerLabel(next())}
            onConfirm={() => props.onConfirmSwitch(next())}
            onCancel={props.onCancelSwitch}
          />
        )}
      </Show>
      <Show when={props.error()}>
        {(message) => (
          <ChatErrorBanner
            message={message()}
            canRetry={props.canRetryConnection}
            retrying={props.retryingConnection}
            onRetry={props.onRetryConnection}
          />
        )}
      </Show>
      <Show when={props.showConnectionRecovered()}>
        <div
          class="pf-chat-switch-notice"
          role="status"
          tabIndex={-1}
          ref={props.recoveryStatusRef}
        >
          <span class="pf-chat-switch-notice-text">Connection restored</span>
        </div>
      </Show>
      <Show when={props.hasApprovals()}>
        <ApprovalPrompt approvals={props.approvals()} onDecide={props.onDecideApproval} />
      </Show>
    </>
  );
}

/** Auto-dismisses the "provider switched" notice after 6s (skipped under
 * reduced motion), re-arming whenever `providerSwitched()` flips true. A
 * composable, called synchronously from setup so its `createEffect`/
 * `onCleanup` run under the same reactive owner as if written inline. */
function createProviderSwitchNoticeTimer(chatId: () => string, providerSwitched: () => boolean) {
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  createEffect(() => {
    if (providerSwitched()) {
      if (noticeTimer) clearTimeout(noticeTimer);
      if (!REDUCED_MOTION?.matches) {
        noticeTimer = setTimeout(() => clearProviderSwitched(chatId()), 6000);
      }
    }
  });
  onCleanup(() => {
    if (noticeTimer) clearTimeout(noticeTimer);
  });
}

/** Switching providers abandons the session's context, so a chat that
 * already has content asks first (via `pendingProvider`) instead of
 * switching on a stray select change. A composable, called synchronously
 * from setup so its `createEffect` runs under the same reactive owner as
 * if written inline. */
function createProviderSwitching(
  chatId: () => string,
  provider: () => AgentProvider,
  state: () => AgentChatState | undefined,
  resetOnProviderSwitch: () => void,
) {
  const [pendingProvider, setPendingProvider] = createSignal<AgentProvider | null>(null);

  const doSwitch = (next: AgentProvider) => {
    resetOnProviderSwitch();
    const nextModel = nativeChatModel(next, loadAgentModels()[next] ?? null);
    const nextEffort = loadAgentEfforts()[next] ?? null;
    const nextMode = loadAgentModes()[next] ?? null;
    void switchAgentChatProvider(chatId(), next, nextModel, nextEffort, nextMode).catch(
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

  return { pendingProvider, setPendingProvider, doSwitch, onProviderChange };
}

/** The composer plus its context meter, wired to backend capability checks.
 * A presentational child component — narrows `AgentChatView`'s JSX by
 * grouping the composer's dozen-odd props (all accessors, so reactivity is
 * preserved) behind one call. */
function ComposerFooter(props: {
  chatId: string;
  state: () => AgentChatState | undefined;
  provider: () => AgentProvider;
  engine: () => ReturnType<typeof loadAgentEngine>;
  model: () => string | null;
  effort: () => string | null;
  mode: () => string | null;
  hasApprovals: () => boolean;
  onSend: (text: string, images?: string[]) => Promise<void>;
  onProviderChange: (next: AgentProvider) => void;
  onModelChange: (next: string | null) => void;
  onEffortChange: (next: string) => void;
  onModeChange: (next: string) => void;
}): JSX.Element {
  return (
    <div class="pf-chat-footer">
      <Composer
        meter={
          <Show when={props.state()}>
            {(chat) => (
              <ContextMeter
                contextUsed={chat().contextUsed}
                contextWindow={chat().contextWindow}
                totals={chat().totals}
              />
            )}
          </Show>
        }
        provider={props.provider()}
        engine={props.engine()}
        model={props.model()}
        effort={props.effort()}
        mode={props.mode()}
        turnActive={props.state()?.turnActive ?? false}
        supportsImages={supportsBackendCapability(
          props.provider(),
          "imageInput",
          "nativeChat",
          props.engine(),
        )}
        imageUnavailableReason={
          backendCapabilityReason(props.provider(), "imageInput", "nativeChat", props.engine()) ??
          undefined
        }
        supportsSteer={supportsBackendCapability(
          props.provider(),
          "steerTurn",
          "nativeChat",
          props.engine(),
        )}
        steerUnavailableReason={
          backendCapabilityReason(props.provider(), "steerTurn", "nativeChat", props.engine()) ??
          undefined
        }
        emberYielded={props.hasApprovals()}
        onSend={props.onSend}
        onSteer={(text) => steerAgentChat(props.chatId, text)}
        onInterrupt={() => void interruptAgentChat(props.chatId)}
        onProviderChange={props.onProviderChange}
        onModelChange={props.onModelChange}
        onEffortChange={props.onEffortChange}
        onModeChange={props.onModeChange}
      />
    </div>
  );
}

/** Persists a provider-preference change to both the per-provider default
 * and this chat's live session. Plain handlers, no Solid reactivity of its
 * own — grouped only to keep the three near-identical bodies out of the
 * component. */
function createModelPrefsHandlers(chatId: () => string, provider: () => AgentProvider) {
  return {
    onModelChange: (next: string | null) => {
      setAgentModel(provider(), next);
      setAgentChatModel(chatId(), next);
    },
    onEffortChange: (next: string) => {
      setAgentEffort(provider(), next);
      setAgentChatEffort(chatId(), next);
    },
    onModeChange: (next: string) => {
      setAgentMode(provider(), next);
      setAgentChatMode(chatId(), next);
    },
  };
}

/** A model/provider change can leave a selected effort the new model does
 * not accept — drops THIS CHAT back to the default without touching the
 * persisted per-provider preference (inspecting another model must not
 * erase it). A composable, called synchronously from setup so its
 * `createEffect` runs under the same reactive owner as if written inline. */
function createEffortAutoReset(
  chatId: () => string,
  provider: () => AgentProvider,
  model: () => string | null,
  effort: () => string | null,
) {
  createEffect(() => {
    const current = effort();
    if (!current) return;
    const supported = modelOption(provider(), model())?.efforts ?? [];
    if (!supported.includes(current)) setAgentChatEffort(chatId(), "");
  });
}

// The turn is running but nothing is streaming yet (or between tool calls):
// show the working row instantly instead of a silent, frozen timeline.
function isAwaitingOutput(chat: AgentChatState | undefined): boolean {
  if (!chat?.turnActive) return false;
  const last = chat.timeline[chat.timeline.length - 1];
  if (!last) return true;
  return !((last.type === "assistantText" || last.type === "thinking") && last.streaming);
}

/** #231 PR3: the chat receipt's data source. `changes_list_turn_change_sets`
 * re-decodes the chat's whole persisted timeline, so it's fetched ONCE per
 * chat here (not once per receipt) and resolved by turn ordinal — see
 * `AgentTimelineItem`'s `fileChange.ordinal` doc comment for why that
 * ordinal lines up 1:1 with this array's order. Refetches when a turn with
 * file changes closes (the completed-receipt count changing is the signal);
 * `chatId`/`state()?.historyLoaded` guard against firing before there's a
 * real target and against redundant identical fetches from unrelated
 * reactive churn. A composable, called synchronously from setup so its
 * `createMemo`/`createResource` run under the same reactive owner as if
 * written inline. */
function createChangesReceiptSource(
  props: { chatId: string; projectRoot: string },
  state: () => AgentChatState | undefined,
): ChangesReceiptSource {
  const completedChangesReceiptCount = createMemo(
    () =>
      (state()?.timeline ?? []).filter((item) => item.type === "fileChange" && item.turnComplete)
        .length,
  );
  // Flag off (#231 `changesReview`, default off): the source stays null
  // forever, so this resource never fetches -- no `changes_list_turn_change_sets`
  // call happens at all, matching the "no receipt, no fetch" gating contract.
  const [changesReceiptSets] = createResource(
    () =>
      flagEnabled("changesReview") && state()?.historyLoaded
        ? `${props.chatId}::${props.projectRoot}::${completedChangesReceiptCount()}`
        : null,
    () => changesListTurnChangeSets(props.chatId, props.projectRoot),
  );
  return {
    // A resource's call accessor RE-THROWS a stored fetch error (Solid's
    // Suspense/ErrorBoundary contract) — this reads it via `.latest` instead,
    // which never throws, so a failed fetch degrades the receipt to its
    // "error" status instead of taking down the whole chat view.
    changeSetAt: (ordinal: number): ChangeSet | undefined => changesReceiptSets.latest?.[ordinal],
    loading: () => changesReceiptSets.loading,
    error: () => changesReceiptSets.error !== undefined,
  };
}

async function sendOrStartSwarm(
  chatId: string,
  projectRoot: string,
  text: string,
  images: string[] | undefined,
): Promise<void> {
  const swarm = parseSwarmCommand(text);
  if (swarm) {
    await startSwarm(projectRoot, swarm.goal, { ...swarm, originChatId: chatId });
    return;
  }
  await sendAgentMessage(chatId, text, images);
}

/** The chat's live-vs-configured field derivations: once a session state
 * exists it wins, falling back to `props`/the persisted per-provider
 * defaults until then. Plain accessors, grouped only to keep this block out
 * of the component body. */
function createChatDerivedFields(
  props: { chatId: string; projectRoot: string; provider: AgentProvider; model?: string | null },
  state: () => AgentChatState | undefined,
) {
  const configuredEngine = loadAgentEngine();
  const engine = () => state()?.engine ?? configuredEngine;
  const provider = () => state()?.provider ?? props.provider;
  const model = () =>
    state()?.model ??
    props.model ??
    nativeChatModel(props.provider, loadAgentModels()[props.provider] ?? null);
  const effort = () => state()?.effort ?? null;
  const mode = () => state()?.mode ?? loadAgentModes()[provider()] ?? null;
  return { configuredEngine, engine, provider, model, effort, mode };
}

/** The approval prompts visible for this chat (gated on backend support) and
 * the swarm runs this chat originated, capped to the 3 most recent. A
 * composable, called synchronously from setup so its `createMemo`s run under
 * the same reactive owner as if written inline. */
function createApprovalsAndSwarms(
  props: { chatId: string; projectRoot: string },
  state: () => AgentChatState | undefined,
  provider: () => AgentProvider,
  engine: () => ReturnType<typeof loadAgentEngine>,
) {
  const approvals = createMemo(() =>
    supportsBackendCapability(provider(), "approvalEvents", "nativeChat", engine())
      ? (state()?.approvals ?? [])
      : [],
  );
  const hasApprovals = () => approvals().length > 0;
  const visibleSwarms = createMemo(() =>
    swarmRuns()
      .filter((run) => run.projectRoot === props.projectRoot && run.originChatId === props.chatId)
      .slice(0, 3),
  );
  return { approvals, hasApprovals, visibleSwarms };
}

/** Kicks off the session on mount (idempotent — see `ensureAgentChat`),
 * seeded with the persisted per-provider effort/mode. A composable, called
 * synchronously from setup so its `onMount` runs under the same reactive
 * owner as if written inline. */
function useEnsureAgentChatOnMount(
  props: { chatId: string; projectRoot: string },
  provider: () => AgentProvider,
  model: () => string | null,
  configuredEngine: ReturnType<typeof loadAgentEngine>,
) {
  onMount(() => {
    void ensureAgentChat(props.chatId, props.projectRoot, provider(), model(), {
      engine: configuredEngine,
      effort: loadAgentEfforts()[provider()] ?? null,
      mode: loadAgentModes()[provider()] ?? null,
    }).catch(() => undefined);
  });
}

export function AgentChatView(props: {
  chatId: string;
  projectRoot: string;
  provider: AgentProvider;
  model?: string | null;
}): JSX.Element {
  const state = () => agentChat(props.chatId);
  const { configuredEngine, engine, provider, model, effort, mode } = createChatDerivedFields(
    props,
    state,
  );

  const { approvals, hasApprovals, visibleSwarms } = createApprovalsAndSwarms(
    props,
    state,
    provider,
    engine,
  );

  const showNotice = () => state()?.providerSwitched ?? false;
  const remoteHost = () => state()?.remoteHost ?? null;

  createProviderSwitchNoticeTimer(() => props.chatId, showNotice);
  useEnsureAgentChatOnMount(props, provider, model, configuredEngine);

  let recoveryStatusEl: HTMLDivElement | undefined;
  const {
    retryingConnection,
    connectionRecovered,
    canRetryConnection,
    retryConnection,
    resetOnProviderSwitch,
  } = createConnectionRecovery(
    () => props.chatId,
    provider,
    state,
    () => recoveryStatusEl?.focus(),
  );
  const { pendingProvider, setPendingProvider, doSwitch, onProviderChange } =
    createProviderSwitching(() => props.chatId, provider, state, resetOnProviderSwitch);
  const providerLabel = (id: AgentProvider) => agentBackendDescriptor(id).label;
  const { onModelChange, onEffortChange, onModeChange } = createModelPrefsHandlers(
    () => props.chatId,
    provider,
  );
  const onSend = (text: string, images?: string[]) =>
    sendOrStartSwarm(props.chatId, props.projectRoot, text, images);

  createEffortAutoReset(() => props.chatId, provider, model, effort);
  const changesReceipts = createChangesReceiptSource(props, state);

  return (
    <div class="pf-chat-view">
      <ImageLightbox />
      <ChatTimeline
        items={state()?.timeline ?? []}
        working={isAwaitingOutput(state())}
        chatId={props.chatId}
        projectRoot={props.projectRoot}
        changesReceipts={changesReceipts}
      />
      <ChatViewNotices
        chatId={props.chatId}
        visibleSwarmsCount={() => visibleSwarms().length}
        visibleSwarms={visibleSwarms}
        showNotice={showNotice}
        remoteHost={remoteHost}
        pendingProvider={pendingProvider}
        providerLabel={providerLabel}
        onConfirmSwitch={(next) => {
          setPendingProvider(null);
          doSwitch(next);
        }}
        onCancelSwitch={() => setPendingProvider(null)}
        error={() => state()?.error}
        canRetryConnection={canRetryConnection}
        retryingConnection={retryingConnection}
        onRetryConnection={() => void retryConnection()}
        showConnectionRecovered={() => connectionRecovered() && !!state()?.sessionId && !state()?.error}
        recoveryStatusRef={(el) => (recoveryStatusEl = el)}
        hasApprovals={hasApprovals}
        approvals={approvals}
        onDecideApproval={(approvalId, decision) =>
          void approveAgentRequest(props.chatId, approvalId, decision)
        }
      />
      <ComposerFooter
        chatId={props.chatId}
        state={state}
        provider={provider}
        engine={engine}
        model={model}
        effort={effort}
        mode={mode}
        hasApprovals={hasApprovals}
        onSend={onSend}
        onProviderChange={onProviderChange}
        onModelChange={onModelChange}
        onEffortChange={onEffortChange}
        onModeChange={onModeChange}
      />
    </div>
  );
}
