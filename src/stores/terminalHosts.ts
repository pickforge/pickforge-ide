// Shared registry of mounted chat terminal hosts, plus the ONE chat-command
// intent seam every feature caller uses to act on a chat's terminal(s).
//
// Before this module owned intent, callers (Workbench, the widget/CDP/a11y
// inspectors, Ask AI) each pulled a raw TerminalHostHandle out of the registry
// and separately decided placement (primary vs. split), local/remote routing,
// and auto-name attribution — logic that had to stay in sync across five
// call sites. Chat components must not call TerminalHostHandle methods
// directly (issue #220 PR 4): they express what they want — launch this agent
// (recoverable primary), run this editor command (a fresh split, with local/
// remote resolution and an OS-opener fallback), launch this agent against a
// local capture file (inspector "send to AI") — and this module owns
// selection, placement, and attribution together.
import type { PaneSpawnOptions, TerminalHostHandle } from "../components/TerminalHost";
import { type PaneSpawnMode, remotePathFor } from "../lib/remoteContext";
import { armChatAutoName } from "../lib/chatAutoName";
import { openPathSystem } from "../lib/opener";
import { editorCommand } from "./fileOpenSettings";
import { noteFileOpened } from "./forgeContext";

const hosts = new Map<string, TerminalHostHandle>();

export function setTerminalHost(chatId: string, handle: TerminalHostHandle) {
  hosts.set(chatId, handle);
}

export function deleteTerminalHost(chatId: string) {
  hosts.delete(chatId);
}

export function getTerminalHost(chatId: string | null | undefined): TerminalHostHandle | undefined {
  return chatId ? hosts.get(chatId) : undefined;
}

/** Whether a chat has a mounted terminal host to receive commands. */
export function hasTerminalHost(chatId: string | null | undefined): boolean {
  return !!getTerminalHost(chatId);
}

/** The chat's current PRIMARY spawn mode, or undefined when the chat has no
 *  mounted host yet. A read for gating decisions (agent availability,
 *  local-MCP eligibility) — never a command. */
export function chatSpawnMode(chatId: string | null | undefined): PaneSpawnMode | undefined {
  return getTerminalHost(chatId)?.primarySpawnMode();
}

/** Launch an AGENT command (a quick-launch chip/hotkey) into the chat's
 *  recoverable, session-backed PRIMARY pane and attribute it for auto-naming
 *  exactly once. Returns the primary pane id, or null when the chat has no
 *  mounted host yet — a pending/unavailable host is never attributed. */
export function launchAgentInPrimary(chatId: string, command: string): string | null {
  const host = getTerminalHost(chatId);
  if (!host) return null;
  const paneId = host.runInPrimary(command);
  if (paneId) armChatAutoName(chatId, paneId);
  return paneId;
}

/** Run a non-agent command in a fresh split pane — never the recoverable
 *  primary, never attributed to an agent. Returns null when the chat has no
 *  mounted host yet. */
export function runInSplit(chatId: string, command: string): string | null {
  return getTerminalHost(chatId)?.openInNewPane(command) ?? null;
}

/** Launch an AGENT command into a fresh split pane (never the recoverable
 *  primary — this is a dedicated one-off review pane, not the chat's main
 *  session) and attribute it for auto-naming exactly once. `forceLocal` pins
 *  the pane to local execution regardless of the chat's remote binding — the
 *  inspectors' "send to AI" flows attach a capture file the agent can only
 *  read on this machine. Returns null when the chat has no mounted host yet. */
export function launchAgentInSplit(
  chatId: string,
  command: string,
  options?: { forceLocal?: boolean },
): string | null {
  const host = getTerminalHost(chatId);
  if (!host) return null;
  const spawnOptions: PaneSpawnOptions | undefined = options?.forceLocal ? { forceLocal: true } : undefined;
  const paneId = host.openInNewPane(command, spawnOptions);
  if (paneId) armChatAutoName(chatId, paneId);
  return paneId;
}

/** Open a file for editing: resolves the chat's local/remote routing, types
 *  the configured editor command into a fresh split pane (never the primary),
 *  and falls back to the OS opener when no host is mounted or the file-open
 *  setting is "system". Non-agent — never attributed. */
export function openFileInChat(
  chatId: string | null | undefined,
  path: string,
  projectRoot: string | null | undefined,
): void {
  // Path only, never contents — feeds the "last opened file" field the
  // forge-context writer reports when the (default-off) `pikitContext` flag
  // is on (#299). Cheap to call unconditionally; the writer itself decides
  // whether the flag gates an actual write.
  if (projectRoot) noteFileOpened(projectRoot, path);
  const host = getTerminalHost(chatId);
  if (!host) {
    void openPathSystem(path).catch((e) => console.error("[pickforge] open_path failed", e));
    return;
  }
  const remote = host.primaryRemotePty();
  const remotePath = remote ? remotePathFor(path, projectRoot, remote.remoteRoot) : null;
  const cmd = editorCommand(remotePath ?? path);
  if (cmd === null) {
    void openPathSystem(path).catch((e) => console.error("[pickforge] open_path failed", e));
    return;
  }
  host.openInNewPane(cmd, remotePath ? { remote } : { forceLocal: true });
}
