// The 3-pane workbench: projects/chats/files | terminals | inspector.
// Each chat owns its own terminal host (its own panes/shells). Visited hosts
// stay mounted (visibility toggled) so switching chats/projects never kills a
// running shell; a host is disposed only when its chat is deleted.
import { createEffect, createSignal, For, Match, onCleanup, onMount, Show, Switch } from "solid-js";
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
import { loadAgentModels } from "../../lib/agentModels";
import { ForgeEmptyState, PaneReveal } from "../../components/ui";
import { IconGrid, IconTerminal } from "../../components/icons";
import { detectBinaries } from "../../lib/process";
import { editorCommand } from "../../stores/fileOpenSettings";
import { openPathSystem } from "../../lib/opener";
import {
  binaryForItem,
  commandForItem,
  hotkeyMatches,
  quickLaunchItems,
  type QuickLaunchItem,
} from "../../stores/quickLaunch";
import { findChat, isChatDestroying, onChatDeleted, setChatSessionId, workspace } from "../../stores/workspace";
import { clearProjectOrchestra, removeChatFromOrchestra, selectedLanes } from "../../stores/orchestra";
import { chatBackend } from "../../stores/chatSessions";
import { clearChatActivity, graceChatUnseen, handlePaneClosed, REATTACH_REPLAY_GRACE_MS, recordChatAttention, recordChatOutput, setActiveChatForActivity, setStagedChatsForActivity } from "../../stores/chatActivity";
import { orchestraOpen, setOrchestraOpen, stagedChatIds } from "../../stores/orchestraStage";
import { isChatArchived } from "../../stores/chatArchive";
import { deleteTerminalHost, getTerminalHost, setTerminalHost } from "../../stores/terminalHosts";
import { ensureMcpRunning, mcpEnv } from "../../stores/mcp";
import {
  armChatAutoName,
  chatHadAgentSession,
  clearChatAgentSession,
  forgetChatAutoName,
  handleOscTitle,
  markChatSessionPane,
  maybeAutoNameChat,
  revokeAgentPane,
  transferAgentPaneOwnership,
} from "../../lib/chatAutoName";
import { route } from "../../router";
import { runConsole } from "../../stores/runConsole";
import { Tour } from "../../components/Tour";
import { startTour, tourSeen } from "../../stores/tour";
import "./workbench.css";

interface MountedHost {
  chatId: string;
  projectRoot: string;
}

export function WorkbenchScreen() {
  const [mounted, setMounted] = createSignal<MountedHost[]>([]);
  const [available, setAvailable] = createSignal<Record<string, boolean>>({});
  const [laneFocus, setLaneFocus] = createSignal<{ chatId: string; at: number } | null>(null);
  const [pendingOrchestraCleanup, setPendingOrchestraCleanup] = createSignal<MountedHost[]>([]);

  // Fire a quick-launch item into the active chat and run it. An AGENT launch
  // goes into the chat's PRIMARY, session-backed pane so the agent runs inside
  // the recoverable dtach/tmux session (surviving pane-close + app-restart) —
  // not a raw split pane that would kill it on close. We also arm that pane so
  // the agent's first message becomes the chat title (see chatAutoName). A
  // non-agent launch opens a fresh split pane so it never disturbs the primary.
  const launchItem = async (item: QuickLaunchItem) => {
    const chatId = workspace.activeChatId;
    if (!chatId) return;
    const root = findChat(chatId)?.projectRoot ?? workspace.activeRoot;
    if (item.agentId && root) await ensureMcpRunning(root);
    const text = commandForItem(item, item.agentId ? mcpEnv(root) : {});
    if (!text) return;
    const host = getTerminalHost(chatId);
    if (!host) return;
    const paneId = item.agentId ? host.runInPrimary(text) : host.openInNewPane(text);
    if (paneId && item.agentId) armChatAutoName(chatId, paneId);
  };

  // Open a file per the user's preference: a new editor pane (nvim/custom) or the
  // OS default editor.
  const openFileInActive = (path: string) => {
    const cmd = editorCommand(path);
    const host = getTerminalHost(workspace.activeChatId);
    // Editor-pane modes need a live terminal host; with none open, fall back to
    // the OS opener so the file still opens.
    if (cmd === null || !host) {
      void openPathSystem(path).catch((e) =>
        console.error("[pickforge] open_path failed", e),
      );
      return;
    }
    host.openInNewPane(cmd);
  };

  // Track which chats have a mount in flight so a re-run of this effect (e.g. a
  // second reactive read) never kicks off two binds / two mounts for one chat.
  const binding = new Set<string>();

  createEffect(() => {
    setActiveChatForActivity(workspace.activeChatId);
  });

  createEffect(() => {
    setStagedChatsForActivity(stagedChatIds());
  });

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

  // First-run coach-marks: start the first time the workbench is the visible
  // screen and the tour is unseen, after a beat so data-tour anchors exist to
  // measure via getBoundingClientRect.
  let tourKicked = false;
  createEffect(() => {
    if (tourKicked || tourSeen() || route() !== "workbench") return;
    tourKicked = true;
    setTimeout(() => {
      if (route() === "workbench" && !tourSeen()) startTour();
    }, 600);
  });

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

  // Mount a host the first time its chat becomes active; keep it after. AWAIT the
  // project's MCP endpoint before mounting, so the very first shell carries the
  // discovery env (PICKFORGE_IPC_ENDPOINT). `TerminalPane` reads `props.env` once
  // at spawn — and the font wait it spawns behind is often cached/instant — so a
  // fire-and-forget `mcp_start` could lose the race and spawn an agent shell with
  // no endpoint, undiscoverable until the user opened a fresh pane. `mcp_start` is
  // best-effort (it catches its own errors and always resolves), so awaiting it
  // never blocks the mount indefinitely; on failure we mount with empty env, the
  // same graceful degradation as before.
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

  onMount(() => {
    // Wire listeners + cleanup synchronously so they bind to this scope even if
    // the async detection below is still pending when the screen is disposed.

    // Tear down a chat's host (and shells) only when the chat is deleted.
    const offDelete = onChatDeleted(async (chatId) => {
      const chat = findChat(chatId);
      setMounted((m) => m.filter((h) => h.chatId !== chatId));
      clearChatActivity(chatId);
      forgetChatAutoName(chatId);
      deleteTerminalHost(chatId);
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
    const onKey = (e: KeyboardEvent) => {
      if (route() !== "workbench") return; // hotkeys only act on the workbench
      const t = e.target as HTMLElement | null;
      const inXterm = !!t?.closest?.(".xterm");
      const inField =
        !inXterm &&
        !!t?.closest?.(
          'input, textarea, select, [contenteditable]:not([contenteditable="false"])',
        );
      if (inField) return;
      for (const item of quickLaunchItems()) {
        if (hotkeyMatches(e, item.hotkey)) {
          e.preventDefault();
          e.stopPropagation();
          // Match the chip's disabled gate: a missing binary shouldn't fire.
          const bin = binaryForItem(item);
          if (bin && available()[bin] === false) return;
          void launchItem(item);
          return;
        }
      }
    };
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

  const renderPane = (pane: PaneId) => (
    <Switch>
      <Match when={pane === "projects"}><PaneShell pane="projects"><ProjectsPane /></PaneShell></Match>
      <Match when={pane === "files"}><PaneShell pane="files"><PaneReveal on={() => workspace.activeRoot}>{() => <FileExplorer onOpenFile={openFileInActive} />}</PaneReveal></PaneShell></Match>
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
            {(h) => {
              const chat = findChat(h.chatId);
              const provider = (chat?.agentId ?? "claudeCode") as "claudeCode" | "codex";
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
                      onSession: (info, paneId) => {
                        // Persist the resolved recovery id (narrow write). On a raw
                        // degrade with no id we leave the stored one alone.
                        if (info.sessionId) void setChatSessionId(h.chatId, info.sessionId);
                        // Fresh session: whatever agent flag the old one carried
                        // died with it. Clear BEFORE markChatSessionPane, which
                        // re-persists when a chip launch beat this spawn report.
                        if (!info.attached) clearChatAgentSession(h.chatId);
                        markChatSessionPane(h.chatId, paneId);
                        if (info.attached && chatHadAgentSession(h.chatId)) {
                          // The live session survived a restart/pane-close with an
                          // agent launched into it — re-mark the recovered pane so
                          // busy/attention still work, but let the re-attach screen
                          // replay pass without counting as fresh activity.
                          armChatAutoName(h.chatId, paneId);
                          graceChatUnseen(h.chatId, REATTACH_REPLAY_GRACE_MS);
                        }
                      },
                    };
                  })()}
                  onReady={(handle) => setTerminalHost(h.chatId, handle)}
                  onOutput={(chunk, paneId) => {
                    // An archived chat renders no indicator anywhere — never let
                    // its still-running shell drive activity or an orphan chime.
                    if (!isChatArchived(h.chatId)) recordChatOutput(h.chatId, paneId, chunk);
                  }}
                  onBell={(paneId) => {
                    if (!isChatArchived(h.chatId)) recordChatAttention(h.chatId, paneId);
                  }}
                  onNotification={(_, paneId) => {
                    if (!isChatArchived(h.chatId)) recordChatAttention(h.chatId, paneId);
                  }}
                  onPrimaryPaneRemount={(fromPaneId, toPaneId) => transferAgentPaneOwnership(h.chatId, fromPaneId, toPaneId)}
                  onPaneClosed={(paneId) => {
                    revokeAgentPane(h.chatId, paneId);
                    handlePaneClosed(h.chatId, paneId);
                  }}
                  onUserSubmit={(line, paneId) => maybeAutoNameChat(h.chatId, line, paneId)}
                  onTitle={(title, paneId) => handleOscTitle(h.chatId, paneId, title)}
                />
                  }
                >
                  <div class="pf-agent-slot">
                    <AgentChatView
                      chatId={h.chatId}
                      projectRoot={h.projectRoot}
                      provider={provider}
                      model={loadAgentModels()[provider] ?? null}
                    />
                  </div>
                </Show>
              </div>
              );
            }}
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

      <Tour />
    </div>
  );
}
