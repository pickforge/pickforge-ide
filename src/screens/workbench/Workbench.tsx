// The 3-pane workbench: projects/chats/files | terminals | inspector.
// Each chat owns its own terminal host (its own panes/shells). Visited hosts
// stay mounted (visibility toggled) so switching chats/projects never kills a
// running shell; a host is disposed only when its chat is deleted.
import {
  createEffect,
  createSignal,
  For,
  Match,
  onCleanup,
  onMount,
  Show,
  Switch,
  untrack,
} from "solid-js";
import { ProjectsPane } from "./ProjectsPane";
import { FileExplorer } from "./FileExplorer";
import { InspectorPanel } from "./InspectorPanel";
import { SourceControl } from "./SourceControl";
import { DeviceMirror } from "../../components/DeviceMirror";
import { DebugConsole } from "./DebugConsole";
import { DockPanel, PaneShell } from "./Dock";
import { type PaneId } from "../../stores/workbenchLayout";
import { TerminalHost } from "../../components/TerminalHost";
import { AgentChatView } from "../../components/chat/AgentChatView";
import { OrchestraView } from "../../components/orchestra/OrchestraView";
import { disposeAgentChat } from "../../stores/agentChat";
import {
  ensureOmpNativeCompatibility,
  ensurePiNativeCompatibility,
  isOmpNativeCompatibilityPending,
  isPiNativeCompatibilityPending,
  loadAgentModels,
  ompNativeChatUnavailableReason,
  piNativeChatUnavailableReason,
} from "../../lib/agentModels";
import {
  normalizeAgentProvider,
  nativeChatUnavailableReason,
} from "../../lib/agentBackends";
import { ForgeEmptyState, PaneReveal } from "../../components/ui";
import { IconGrid, IconTerminal } from "../../components/icons";
import { detectBinaries } from "../../lib/process";
import {
  canLaunchAgentForMode,
  shouldUseLocalMcp,
} from "../../lib/remoteContext";
import {
  binaryForItem,
  commandForItem,
  hotkeyMatches,
  quickLaunchItems,
  type QuickLaunchItem,
} from "../../stores/quickLaunch";
import { findChat, isChatDestroying, onChatDeleted, workspace } from "../../stores/workspace";
import { clearProjectOrchestra, removeChatFromOrchestra, selectedLanes } from "../../stores/orchestra";
import { chatBackend } from "../../stores/chatSessions";
import { setActiveChatForActivity, setStagedChatsForActivity } from "../../stores/chatActivity";
import { orchestraOpen, setOrchestraOpen, stagedChatIds } from "../../stores/orchestraStage";
import {
  chatSpawnMode,
  launchAgentInPrimary,
  openFileInChat,
  runInSplit,
} from "../../stores/terminalHosts";
import { ensureMcpRunning, mcpEnv } from "../../stores/mcp";
import { chatTerminalHostBinding, disposeChatTerminalHostBinding } from "../../lib/chatTerminalLifecycle";
import { route } from "../../router";
import { runConsole } from "../../stores/runConsole";
import { flagEnabled } from "../../stores/flags";
import { notifyChangesReviewProjectChanged } from "../../stores/changes";
import { operatorDockOpen, toggleOperatorDock } from "../../stores/operatorDock";
import { OperatorDock } from "../../components/operator/OperatorDock";
import { Tour } from "../../components/Tour";
import { startTour, tourSeen } from "../../stores/tour";
import "./workbench.css";

interface MountedHost {
  chatId: string;
  projectRoot: string;
}

// The operator dock is modal: global quick-launch (and Mod+O) must not fire
// from inside it, and — since the workbench hotkey listener runs in the
// capture phase — must not steal keydowns the dock handles itself (Mod+M,
// Tab trap, Escape). This guard is the only thing keeping a user chip
// rebound to one of those keys from hijacking the dock. Also ignores keys
// typed into a real form field (but not the terminal).
function shouldIgnoreWorkbenchHotkey(e: KeyboardEvent): boolean {
  if (route() !== "workbench") return true; // hotkeys only act on the workbench
  const t = e.target as HTMLElement | null;
  if (t?.closest?.(".pf-op-dock")) return true;
  const inXterm = !!t?.closest?.(".xterm");
  const inField =
    !inXterm &&
    !!t?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"])');
  return inField;
}

/** Global quick-launch hotkeys (+ the Operator Mod+O toggle). Capture phase
 *  so they win over the shell. A factory (not a composable — no signals of
 *  its own) so `WorkbenchScreen`'s `onMount` can keep this cluster out of
 *  its own body. */
function createWorkbenchHotkeyHandler(
  available: () => Record<string, boolean>,
  launchItem: (item: QuickLaunchItem) => void,
): (e: KeyboardEvent) => void {
  return (e: KeyboardEvent) => {
    if (shouldIgnoreWorkbenchHotkey(e)) return;
    for (const item of quickLaunchItems()) {
      if (!hotkeyMatches(e, item.hotkey)) continue;
      e.preventDefault();
      e.stopPropagation();
      // Remote-side binary detection lands in PR 3; let the remote shell report it.
      const bin = binaryForItem(item);
      const mode = chatSpawnMode(workspace.activeChatId);
      if (mode === "local" && bin && available()[bin] === false) return;
      launchItem(item);
      return;
    }
    // Operator composer — behind the flag, after quick-launch so a user's own
    // Mod+O binding still wins. Mod+O is free among the default hotkeys.
    if (flagEnabled("operator") && hotkeyMatches(e, "Mod+O")) {
      e.preventDefault();
      e.stopPropagation();
      toggleOperatorDock();
    }
  };
}

// The native-agent-chat gate: null unless the resolved provider is native-
// chat capable AND (for omp/pi) its exact-version native compatibility probe
// hasn't flagged it unavailable.
function nativeChatGateProvider(
  provider: ReturnType<typeof normalizeAgentProvider>,
): ReturnType<typeof normalizeAgentProvider> {
  if (!provider) return null;
  if (provider === "omp" && ompNativeChatUnavailableReason()) return null;
  if (provider === "pi" && piNativeChatUnavailableReason()) return null;
  return provider;
}

// True while the omp/pi exact-version compatibility probe for this provider
// is still in flight (shown as a "switching…" notice rather than an error).
function isNativeChatCompatibilityPending(
  provider: ReturnType<typeof normalizeAgentProvider>,
): boolean {
  return (
    (provider === "omp" && isOmpNativeCompatibilityPending()) ||
    (provider === "pi" && isPiNativeCompatibilityPending())
  );
}

function nativeChatUnavailableMessage(
  provider: ReturnType<typeof normalizeAgentProvider>,
  agentId: string,
): string | null {
  if (provider === "omp") return ompNativeChatUnavailableReason();
  if (provider === "pi") return piNativeChatUnavailableReason();
  return nativeChatUnavailableReason(agentId) ?? "Native chat is unavailable";
}

function nativeChatSwitchingMessage(provider: ReturnType<typeof normalizeAgentProvider>): string | null {
  return provider === "omp" ? ompNativeChatUnavailableReason() : piNativeChatUnavailableReason();
}

/** One mounted chat's terminal-host or native-agent-chat slot, display-
 *  toggled (never unmounted) so switching chats never kills a running
 *  shell. A presentational component keyed on `host.chatId` by its `<For>`
 *  caller — `chat`/`agentId`/`provider` are derived once at mount, matching
 *  the original inline `<For>` callback's (non-reactive) behavior. */
function ChatHostSlot(props: { host: MountedHost }) {
  const h = props.host;
  const chat = findChat(h.chatId);
  const agentId = chat?.agentId ?? "";
  const provider = normalizeAgentProvider(agentId);
  return (
    <div
      class="pf-term-slot"
      style={{ display: workspace.activeChatId === h.chatId ? "block" : "none" }}
    >
      <Show
        when={chat?.kind === "agent"}
        fallback={
          <TerminalHost
            cwd={h.projectRoot}
            env={mcpEnv(h.projectRoot)}
            chatId={h.chatId}
            session={(() => {
              // Honor the chat's PERSISTED backend on reopen: derive the
              // backend from the stored session_id tag so a tmux-backed chat
              // never silently reopens as dtach (which would abandon the old
              // session and overwrite the handle).
              const storedSessionId = findChat(h.chatId)?.sessionId ?? null;
              return {
                projectRoot: h.projectRoot,
                sessionId: storedSessionId,
                backend: chatBackend(h.chatId, storedSessionId),
                onSession: chatTerminalHostBinding(h.chatId).onSession,
              };
            })()}
            onReady={chatTerminalHostBinding(h.chatId).onReady}
            onOutput={chatTerminalHostBinding(h.chatId).onOutput}
            onBell={chatTerminalHostBinding(h.chatId).onBell}
            onNotification={chatTerminalHostBinding(h.chatId).onNotification}
            onPrimaryPaneRemount={chatTerminalHostBinding(h.chatId).onPrimaryPaneRemount}
            onPaneExited={chatTerminalHostBinding(h.chatId).onPaneExited}
            onPaneClosed={chatTerminalHostBinding(h.chatId).onPaneClosed}
            onUserSubmit={chatTerminalHostBinding(h.chatId).onUserSubmit}
            onTitle={chatTerminalHostBinding(h.chatId).onTitle}
          />
        }
      >
        <Show
          when={nativeChatGateProvider(provider)}
          fallback={
            <Show
              when={isNativeChatCompatibilityPending(provider)}
              fallback={
                <div class="pf-chat-error" role="alert">
                  {nativeChatUnavailableMessage(provider, agentId)}
                </div>
              }
            >
              <div class="pf-chat-switch-notice" role="status" aria-live="polite" aria-busy="true">
                <span class="pf-chat-switch-notice-text">{nativeChatSwitchingMessage(provider)}</span>
              </div>
            </Show>
          }
        >
          {(nativeProvider) => (
            <div class="pf-agent-slot">
              <AgentChatView
                chatId={h.chatId}
                projectRoot={h.projectRoot}
                provider={nativeProvider()}
                model={loadAgentModels()[nativeProvider()] ?? null}
              />
            </div>
          )}
        </Show>
      </Show>
    </div>
  );
}

/** Clears an orchestra lane's row (or drops the whole project's orchestra
 *  state, if the project itself is gone) once its chat has fully finished
 *  tearing down. A composable, called synchronously from `WorkbenchScreen`'s
 *  own setup so its `createEffect` runs under the same reactive owner as if
 *  written inline. */
function useOrchestraCleanupSync(
  pendingOrchestraCleanup: () => MountedHost[],
  setPendingOrchestraCleanup: (fn: (items: MountedHost[]) => MountedHost[]) => void,
): void {
  createEffect(() => {
    const pending = pendingOrchestraCleanup();
    if (!pending.length) return;
    const ready = pending.filter((item) => !isChatDestroying(item.chatId));
    if (!ready.length) return;

    const readyIds = new Set(ready.map((item) => item.chatId));
    const projectRoots = new Set(workspace.projects.map((project) => project.projectRoot));
    const clearedRoots = new Set<string>();

    setPendingOrchestraCleanup((items) => items.filter((item) => !readyIds.has(item.chatId)));

    for (const item of ready) {
      if (!projectRoots.has(item.projectRoot)) {
        if (!clearedRoots.has(item.projectRoot)) {
          clearProjectOrchestra(item.projectRoot);
          clearedRoots.add(item.projectRoot);
        }
        continue;
      }
      if (findChat(item.chatId)) continue;
      void removeChatFromOrchestra(item.projectRoot, item.chatId).catch((error) =>
        console.error("[pickforge] removeChatFromOrchestra failed", error),
      );
    }
  });
}

// First-run coach-marks: start the first time the workbench is the visible
// screen and the tour is unseen, after a beat so data-tour anchors exist to
// measure via getBoundingClientRect. A composable, called synchronously from
// `WorkbenchScreen`'s own setup so its `createEffect` runs under the same
// reactive owner as if written inline.
function useWorkbenchTourKickoff(): void {
  let tourKicked = false;
  createEffect(() => {
    if (tourKicked || tourSeen() || route() !== "workbench") return;
    tourKicked = true;
    setTimeout(() => {
      if (route() === "workbench" && !tourSeen()) startTour();
    }, 600);
  });
}

/** When the orchestra view is (re)opened right after switching chats within
 *  the same project, focuses the lane for the chat just switched away from
 *  (if it's still a selected lane) instead of leaving the view on whatever
 *  lane it last showed. A composable, called synchronously from
 *  `WorkbenchScreen`'s own setup so its `createEffect` runs under the same
 *  reactive owner as if written inline. */
function useOrchestraLaneFocusSync(
  setLaneFocus: (v: { chatId: string; at: number } | null) => void,
): void {
  let prevChatId = workspace.activeChatId;
  let prevRoot = workspace.activeRoot;
  let prevOrchOpen = orchestraOpen();
  createEffect(() => {
    const id = workspace.activeChatId;
    const root = workspace.activeRoot;
    const open = orchestraOpen();
    const chatChanged = id !== prevChatId;
    const wasOpen = prevOrchOpen;
    const priorRoot = prevRoot;
    prevChatId = id;
    prevRoot = root;
    prevOrchOpen = open;
    if (!open || !wasOpen || !chatChanged || !id) return;
    const chat = findChat(id);
    if (!chat || chat.projectRoot !== priorRoot) return;
    if (selectedLanes(chat.projectRoot).includes(id)) {
      setLaneFocus({ chatId: id, at: Date.now() });
    } else {
      setOrchestraOpen(false);
    }
  });
}

/** #231 PR4's "project change" refresh trigger for the Changes review
 *  surface's working-tree scope: fires whenever the active project changes,
 *  for the app's lifetime, independent of whether the Source Control pane is
 *  currently mounted (a hidden/collapsed dock unmounts it). The store's own
 *  `notifyChangesReviewProjectChanged` is already scoped to a no-op unless
 *  its working-tree slice is CURRENTLY targeting that exact root, so this is
 *  cheap to call unconditionally on every root change rather than trying to
 *  track pane visibility here too. Gated behind the flag: with `changesReview`
 *  off, the store's working-tree target is never set, making this a
 *  guaranteed no-op — skip it rather than call it anyway. A composable,
 *  called synchronously from `WorkbenchScreen`'s own setup so its
 *  `createEffect` runs under the same reactive owner as if written inline. */
function useChangesReviewProjectSync(): void {
  createEffect(() => {
    const root = workspace.activeRoot;
    if (root && flagEnabled("changesReview")) notifyChangesReviewProjectChanged(root);
  });
}

/** Mounts a host the first time its chat becomes active, awaiting the
 *  project's MCP endpoint first so the very first shell carries the
 *  discovery env (see the call site's original comment for the race this
 *  avoids). A composable, called synchronously from `WorkbenchScreen`'s own
 *  setup so its `createEffect` runs under the same reactive owner as if
 *  written inline. */
function useChatHostMounting(
  mounted: () => MountedHost[],
  setMounted: (v: MountedHost[]) => void,
): void {
  // Track which chats have a mount in flight so a re-run of this effect (e.g. a
  // second reactive read) never kicks off two binds / two mounts for one chat.
  const binding = new Set<string>();

  createEffect(() => {
    const id = workspace.activeChatId;
    // Never remount a chat that's mid-teardown (delete or backend-migration): its
    // host was just removed but activeChatId/findChat can still point at the old
    // row until the store reconciles, and remounting here would resurrect a
    // just-deleted chat or reopen a migrating one with its stale session_id.
    if (!id || binding.has(id) || isChatDestroying(id) || mounted().some((m) => m.chatId === id)) return;
    const chat = findChat(id);
    if (!chat) return;
    binding.add(id);
    void ensureMcpRunning(chat.projectRoot).finally(() => {
      binding.delete(id);
      // Guard: the chat may have been deleted (or started teardown) while the
      // bind was in flight.
      if (!findChat(id) || isChatDestroying(id) || mounted().some((m) => m.chatId === id)) return;
      setMounted([...mounted(), { chatId: id, projectRoot: chat.projectRoot }]);
    });
  });
}

/** The screen's mount-time wiring: chat-deleted teardown, global quick-
 *  launch hotkeys, and the fire-and-forget binary-availability probe. A
 *  composable, called synchronously from `WorkbenchScreen`'s own setup so
 *  its `onMount`/`onCleanup` calls run under the same reactive owner as if
 *  written inline. */
function useWorkbenchLifecycle(
  available: () => Record<string, boolean>,
  setAvailable: (v: Record<string, boolean>) => void,
  setMounted: (fn: (m: MountedHost[]) => MountedHost[]) => void,
  setPendingOrchestraCleanup: (fn: (items: MountedHost[]) => MountedHost[]) => void,
  launchItem: (item: QuickLaunchItem) => void,
): void {
  onMount(() => {
    // Wire listeners + cleanup synchronously so they bind to this scope even if
    // the async detection below is still pending when the screen is disposed.

    // Tear down a chat's host (and shells) only when the chat is deleted.
    const offDelete = onChatDeleted(async (chatId) => {
      const chat = findChat(chatId);
      setMounted((m) => m.filter((h) => h.chatId !== chatId));
      disposeChatTerminalHostBinding(chatId);
      await disposeAgentChat(chatId);
      if (chat) {
        setPendingOrchestraCleanup((items) =>
          items.some((item) => item.chatId === chatId)
            ? items
            : [...items, { chatId, projectRoot: chat.projectRoot }],
        );
      }
    });

    // Global quick-launch hotkeys. Capture phase so they win over the shell;
    // ignored while typing in a real form field (but not in the terminal).
    const onKey = createWorkbenchHotkeyHandler(available, launchItem);
    window.addEventListener("keydown", onKey, true);

    onCleanup(() => {
      offDelete();
      window.removeEventListener("keydown", onKey, true);
    });

    // Binary availability for chip gating — async, fire-and-forget.
    void (async () => {
      const bins = [
        ...new Set(quickLaunchItems().map(binaryForItem).filter(Boolean) as string[]),
      ];
      if (!bins.length) return;
      try {
        const result = await detectBinaries(bins);
        const map: Record<string, boolean> = {};
        bins.forEach((b, i) => (map[b] = result[i]));
        setAvailable(map);
      } catch (err) {
        console.error("[pickforge] detect_binaries failed", err);
      }
    })();
  });
}

// Fire a quick-launch item into the active chat and run it. An AGENT launch
// goes into the chat's PRIMARY, session-backed pane so the agent runs inside
// the recoverable dtach/tmux session (surviving pane-close + app-restart) —
// not a raw split pane that would kill it on close. We also arm that pane so
// the agent's first message becomes the chat title (see chatAutoName). A
// non-agent launch opens a fresh split pane so it never disturbs the primary.
async function launchQuickLaunchItem(item: QuickLaunchItem): Promise<void> {
  const chatId = workspace.activeChatId;
  if (!chatId) return;
  const root = findChat(chatId)?.projectRoot ?? workspace.activeRoot;
  const mode = chatSpawnMode(chatId);
  if (mode === undefined) return; // no mounted host yet
  if (item.agentId && !canLaunchAgentForMode(mode)) return;
  const localMcp = !!item.agentId && shouldUseLocalMcp(mode);
  if (localMcp && root) await ensureMcpRunning(root);
  // Remote agent MCP wiring lands in PR 3; remote shells must not receive local paths.
  const text = commandForItem(item, localMcp ? mcpEnv(root) : {});
  if (!text) return;
  if (item.agentId) launchAgentInPrimary(chatId, text);
  else runInSplit(chatId, text);
}

// Open a file per the user's preference: a new editor pane (nvim/custom) or the
// OS default editor. Editor-pane modes need a live terminal host; with none
// open, openFileInChat falls back to the OS opener so the file still opens.
function openFileInActiveChat(path: string): void {
  const chatId = workspace.activeChatId;
  const projectRoot = chatId ? (findChat(chatId)?.projectRoot ?? workspace.activeRoot) : workspace.activeRoot;
  openFileInChat(chatId, path, projectRoot);
}

export function WorkbenchScreen() {
  const [mounted, setMounted] = createSignal<MountedHost[]>([]);
  const [available, setAvailable] = createSignal<Record<string, boolean>>({});
  const [laneFocus, setLaneFocus] = createSignal<{ chatId: string; at: number } | null>(null);
  const [pendingOrchestraCleanup, setPendingOrchestraCleanup] = createSignal<MountedHost[]>([]);

  // Trigger exact-version probes reactively. The availability reason itself
  // comes from the shared reactive registry used by every creation surface.
  createEffect(() => {
    if (flagEnabled("ompAgents")) void untrack(() => ensureOmpNativeCompatibility());
    void untrack(() => ensurePiNativeCompatibility());
  });

  createEffect(() => {
    setActiveChatForActivity(workspace.activeChatId);
  });

  createEffect(() => {
    setStagedChatsForActivity(stagedChatIds());
  });

  useOrchestraCleanupSync(pendingOrchestraCleanup, setPendingOrchestraCleanup);
  useWorkbenchTourKickoff();
  useOrchestraLaneFocusSync(setLaneFocus);
  useChangesReviewProjectSync();
  useChatHostMounting(mounted, setMounted);
  useWorkbenchLifecycle(
    available,
    setAvailable,
    setMounted,
    setPendingOrchestraCleanup,
    (item) => void launchQuickLaunchItem(item),
  );

  const renderPane = (pane: PaneId) => (
    <Switch>
      <Match when={pane === "projects"}><PaneShell pane="projects"><ProjectsPane /></PaneShell></Match>
      <Match when={pane === "files"}><PaneShell pane="files"><PaneReveal on={() => workspace.activeRoot}>{() => <FileExplorer onOpenFile={openFileInActiveChat} />}</PaneReveal></PaneShell></Match>
      <Match when={pane === "sourceControl"}><PaneShell pane="sourceControl"><PaneReveal on={() => workspace.activeRoot}>{() => <SourceControl />}</PaneReveal></PaneShell></Match>
      <Match when={pane === "inspector"}><PaneShell pane="inspector"><PaneReveal on={() => workspace.activeRoot}>{() => <InspectorPanel />}</PaneReveal></PaneShell></Match>
      <Match when={pane === "mirror"}><PaneShell pane="mirror"><DeviceMirror /></PaneShell></Match>
    </Switch>
  );

  return (
    <div class="pf-workbench-wrap">
      <div class="pf-workbench">
      <DockPanel dock="left" render={renderPane} />

      <main class="pf-workbench-center pf-reveal">
        <div class="pf-launch-bar">
          <button
            class="pf-orch-tab"
            data-tour="orchestra"
            classList={{ "pf-orch-tab--on": orchestraOpen() }}
            title="Toggle orchestration view"
            disabled={!workspace.activeRoot}
            onClick={() => setOrchestraOpen(!orchestraOpen())}
          >
            <IconGrid size={13} /> Orchestra
          </button>
        </div>

        <div class="pf-workbench-terminal" data-tour="chat">
          {/* All visited chats stay mounted; only the active one is shown. */}
          <div class="pf-term-mounts" classList={{ "pf-term-mounts--hidden": orchestraOpen() }}>
          <For each={mounted()}>
            {(h) => <ChatHostSlot host={h} />}
          </For>
          <Show when={workspace.loaded && !workspace.activeChatId}>
            <div class="pf-term-empty">
              <ForgeEmptyState
                glyph={<IconTerminal size={28} />}
                eyebrow="Terminal"
                title="No chat open"
                hint="Create or select a chat to open a shell in its project."
              />
            </div>
          </Show>
          </div>
          <Show when={orchestraOpen() && workspace.activeRoot}>
            <div class="pf-term-slot pf-orch-slot">
              <OrchestraView projectRoot={workspace.activeRoot!} focusChat={laneFocus()} />
            </div>
          </Show>
        </div>
      </main>

      <DockPanel dock="right" render={renderPane} />
      </div>

      {/* Always mounted so a run survives collapsing the panel / navigation;
          hidden (not unmounted) when closed. */}
      <div class="pf-dc-host" classList={{ "pf-dc-host--hidden": !runConsole.open() }}>
        <DebugConsole />
      </div>

      <Show when={operatorDockOpen()}>
        <OperatorDock />
      </Show>

      <Tour />
    </div>
  );
}
