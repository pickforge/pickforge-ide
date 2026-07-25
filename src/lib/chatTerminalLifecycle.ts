// Coordinates ONE mounted chat's terminal-host lifecycle: session attach vs.
// reattach ordering, activity/attention tracking, title ownership, and
// deletion cleanup. Workbench used to choreograph these calls inline in its
// TerminalHost JSX props; that spread the ordering invariants (fresh vs.
// reattach, archived silencing, primary-promotion claim transfer, delete
// cleanup) across a large component and made them hard to test in isolation.
// This module owns that choreography instead — Workbench just wires one
// binding per mounted chat and disposes it when the chat is deleted.
import type { TerminalHostHandle } from "../components/TerminalHost";
import { setChatSessionId } from "../stores/workspace";
import { isChatArchived } from "../stores/chatArchive";
import { deleteTerminalHost, setTerminalHost } from "../stores/terminalHosts";
import { REATTACH_REPLAY_GRACE_MS, clearChatActivity, graceChatUnseen, handlePaneClosed, recordChatAttention, recordChatOutput, recordChatUserSubmit } from "../stores/chatActivity";
import {
  armChatAutoName,
  chatHadAgentSession,
  clearChatAgentSession,
  forgetChatAutoName,
  handleAgentPaneExited,
  handleOscTitle,
  markChatSessionPane,
  maybeAutoNameChat,
  revokeAgentPane,
  transferAgentPaneOwnership,
} from "./chatAutoName";

export interface ChatSessionInfo {
  sessionId: string | null;
  backend: string;
  degraded: boolean;
  attached: boolean;
}

/** The TerminalHost callback props for one chat, plus its teardown. Workbench
 *  spreads `binding` onto its `<TerminalHost>` element for the chat. */
export interface ChatTerminalHostBinding {
  onReady: (handle: TerminalHostHandle) => void;
  onSession: (info: ChatSessionInfo, paneId: string) => void;
  onOutput: (chunk: string, paneId: string) => void;
  onBell: (paneId: string) => void;
  onNotification: (message: string, paneId: string) => void;
  onPrimaryPaneRemount: (fromPaneId: string, toPaneId: string) => void;
  onPaneExited: (paneId: string) => void;
  onPaneClosed: (paneId: string) => void;
  onUserSubmit: (line: string, paneId: string) => void;
  onTitle: (title: string, paneId: string) => void;
  /** Clear this chat's registry handle, activity state, and session/title
   *  ownership. Called once, on chat deletion — never on a mere unmount, since
   *  visited hosts stay mounted (hidden) across chat/project switches. */
  dispose: () => void;
}

function createChatTerminalHostBinding(chatId: string): ChatTerminalHostBinding {
  return {
    onReady: (handle) => setTerminalHost(chatId, handle),

    // A pane's session/attach report resolves ASYNC, after the handle already
    // exists (see TerminalPane's onReady vs. its spawn promise) and possibly
    // after a chip/hotkey launch already armed the pane as an agent pane (a
    // launch fired right after mount, racing ahead of the spawn's report).
    //
    // FRESH (not attached): whatever agent flag a PRIOR session on this chat
    // carried died with it — clear the durable flag BEFORE re-deriving pane
    // ownership via markChatSessionPane, which re-persists it if a chip launch
    // already beat this report (a real agent IS running in the fresh pane).
    // Clearing after would wipe out that just-set flag instead of the stale one.
    //
    // REATTACH (attached, and a prior session left the durable flag set): mark
    // this pane as the chat's session pane FIRST (markChatSessionPane), THEN
    // arm auto-naming — armChatAutoName's persistence check reads the
    // session-pane mapping this same call establishes, and the replay grace
    // window must start covering output before the caller's next paint.
    onSession: (info, paneId) => {
      if (info.sessionId) void setChatSessionId(chatId, info.sessionId);
      if (!info.attached) clearChatAgentSession(chatId);
      markChatSessionPane(chatId, paneId);
      if (info.attached && chatHadAgentSession(chatId)) {
        armChatAutoName(chatId, paneId);
        graceChatUnseen(chatId, REATTACH_REPLAY_GRACE_MS);
      }
    },

    // An archived chat renders no indicator anywhere — never let its
    // still-running shell drive activity or an orphan chime.
    onOutput: (chunk, paneId) => {
      if (!isChatArchived(chatId)) recordChatOutput(chatId, paneId, chunk);
    },
    onBell: (paneId) => {
      if (!isChatArchived(chatId)) recordChatAttention(chatId, paneId);
    },
    onNotification: (_message, paneId) => {
      if (!isChatArchived(chatId)) recordChatAttention(chatId, paneId);
    },

    // The session-backed primary remounted under a fresh pane id (TerminalHost
    // promoted a survivor after the old primary was closed). Transfer the
    // surviving agent claim to the new pane id — this fires from TerminalHost
    // BEFORE it reports either the promoted survivor's old shell or the
    // original primary as closed, so the claim is never dropped in between.
    onPrimaryPaneRemount: (fromPaneId, toPaneId) => transferAgentPaneOwnership(chatId, fromPaneId, toPaneId),

    onPaneExited: (paneId) => handleAgentPaneExited(chatId, paneId),
    onPaneClosed: (paneId) => {
      revokeAgentPane(chatId, paneId);
      handlePaneClosed(chatId, paneId);
    },
    // A non-blank submit is the user acting (#331 review, finding 1): pty
    // chats have no turn-start event to hook the way structured agent chats
    // do (see chatActivity.ts's agentTurnStarted), so this is what resolves
    // a standing needs-you for them — a stray blank Enter does not.
    onUserSubmit: (line, paneId) => {
      maybeAutoNameChat(chatId, line, paneId);
      if (line.trim() && !isChatArchived(chatId)) recordChatUserSubmit(chatId);
    },
    onTitle: (title, paneId) => handleOscTitle(chatId, paneId, title),

    dispose: () => {
      clearChatActivity(chatId);
      forgetChatAutoName(chatId);
      deleteTerminalHost(chatId);
    },
  };
}

// One binding per mounted chat, created lazily and kept for the chat's mounted
// lifetime (visited hosts stay mounted/hidden across chat switches — see
// Workbench). Removed only on explicit chat deletion.
const bindings = new Map<string, ChatTerminalHostBinding>();

/** The stable callback binding for a chat's TerminalHost. Safe to call every
 *  render — returns the same binding object for a chat until it's disposed. */
export function chatTerminalHostBinding(chatId: string): ChatTerminalHostBinding {
  let binding = bindings.get(chatId);
  if (!binding) {
    binding = createChatTerminalHostBinding(chatId);
    bindings.set(chatId, binding);
  }
  return binding;
}

/** Tear a chat's terminal-host coordination state down: registry handle,
 *  activity (busy/attention), and session/title/agent-pane ownership. Call
 *  once, when the chat itself is deleted. */
export function disposeChatTerminalHostBinding(chatId: string) {
  const binding = bindings.get(chatId);
  if (!binding) return;
  bindings.delete(chatId);
  binding.dispose();
}
