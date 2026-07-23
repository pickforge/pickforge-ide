// Typed client for the Rust PTY commands. stdout streams over a raw-bytes
// Channel (Response on the Rust side → ArrayBuffer here); exit is a separate
// small JSON channel. Input/resize/kill are request/response invokes.
import { Channel, invoke } from "@tauri-apps/api/core";

export type PtyBytes = ArrayBuffer | Uint8Array | number[];

export interface RemotePty {
  host: string;
  remoteRoot: string;
  remoteProcessLeases: boolean;
}

export interface SpawnOptions {
  cwd?: string | null;
  projectRoot?: string | null;
  /** When set, run this command once (`$SHELL -c <command>`) instead of an
   *  interactive shell — the pty exits when the command does. */
  command?: string | null;
  /** Extra env merged on top of the login-shell env — the `PICKFORGE_*` vars
   *  (incl. `PICKFORGE_IPC_ENDPOINT`) that let an embedded agent discover the
   *  local MCP endpoint. */
  env?: Record<string, string> | null;
  remote?: RemotePty | null;
  rows: number;
  cols: number;
  onOutput: (data: PtyBytes) => void;
  onExit: (code: number | null) => void;
}

/** Spawn a pty — interactive `$SHELL`, or a one-shot `command`. Resolves to the
 *  session id. */
export async function ptySpawn(opts: SpawnOptions): Promise<number> {
  const onOutput = new Channel<PtyBytes>();
  onOutput.onmessage = opts.onOutput;
  const onExit = new Channel<number | null>();
  onExit.onmessage = opts.onExit;

  return invoke<number>("pty_spawn", {
    cwd: opts.cwd ?? null,
    projectRoot: opts.projectRoot ?? null,
    command: opts.command ?? null,
    env: opts.env ?? null,
    remote: opts.remote ?? null,
    rows: opts.rows,
    cols: opts.cols,
    onOutput,
    onExit,
  });
}

/** Which recovery backend a chat shell runs under. "dtach" survives pane-close +
 *  app-restart with the lightest footprint; "tmux" is a named session on
 *  PickForge's private tmux server (opt-in per chat). */
export type ChatBackend = "dtach" | "tmux" | "raw";

export interface ChatSpawnOptions {
  chatId: string;
  projectRoot: string;
  cwd?: string | null;
  env?: Record<string, string> | null;
  remote?: RemotePty | null;
  backend: ChatBackend;
  /** The session id already stored on the chat (preserved on a raw fallback). */
  sessionId?: string | null;
  rows: number;
  cols: number;
  onOutput: (data: PtyBytes) => void;
  onExit: (code: number | null) => void;
}

export interface ChatSpawnResult {
  ptyId: number;
  /** The backend actually used — "raw" means the requested one wasn't installed. */
  backend: ChatBackend;
  /** "<backend>:<name>" to persist on the chat, or null for a raw open. */
  sessionId: string | null;
  status: "created" | "attached";
  /** True when the requested backend was unavailable and we degraded to raw. */
  degraded: boolean;
}

/** Spawn (attach-or-create) a CHAT shell under its recovery backend, so a running
 *  agent survives the pane closing and the app restarting. Never the one-shot
 *  Debug-Console path (that stays `ptySpawn` with a command). */
export async function ptySpawnChat(opts: ChatSpawnOptions): Promise<ChatSpawnResult> {
  const onOutput = new Channel<PtyBytes>();
  onOutput.onmessage = opts.onOutput;
  const onExit = new Channel<number | null>();
  onExit.onmessage = opts.onExit;

  return invoke<ChatSpawnResult>("pty_spawn_chat", {
    chatId: opts.chatId,
    projectRoot: opts.projectRoot,
    cwd: opts.cwd ?? null,
    env: opts.env ?? null,
    remote: opts.remote ?? null,
    backend: opts.backend,
    sessionId: opts.sessionId ?? null,
    rows: opts.rows,
    cols: opts.cols,
    onOutput,
    onExit,
  });
}

/** Detach (don't kill) a session-backed chat pane on close: the dtach/tmux
 *  session and the agent shell inside it keep running for the next attach. */
export function ptyDetach(id: number): Promise<void> {
  return invoke("pty_detach", { id });
}

/** Destroy a chat's recovery session on chat delete (kills the tmux session /
 *  removes the dtach socket). `sessionId` is the stored "<backend>:<name>". */
export function ptyDestroyChatSession(sessionId: string): Promise<void> {
  return invoke("pty_destroy_chat_session", { sessionId });
}

// Chats whose terminal hosts are being unmounted as part of a DESTRUCTIVE delete
// (chat delete / project delete), not a routine close. A chat pane normally
// DETACHES on unmount so its dtach/tmux session survives; when the chat is being
// deleted that detach would strand a live shell (the socket/session is destroyed
// right after, leaving an unreachable orphan). Marking the chat here flips its
// panes to a full KILL on unmount so the shell dies with the chat.
const chatsMarkedForKill = new Set<string>();

/** Mark a chat so its terminal panes KILL (not detach) on the next unmount —
 *  call right before firing the delete that unmounts its host. */
export function markChatForKill(chatId: string) {
  chatsMarkedForKill.add(chatId);
}

/** Whether a chat's panes should kill (not detach) on unmount. */
export function isChatMarkedForKill(chatId: string): boolean {
  return chatsMarkedForKill.has(chatId);
}

/** Clear a chat's kill mark once its host has been torn down. */
export function clearChatKillMark(chatId: string) {
  chatsMarkedForKill.delete(chatId);
}

/** Send bytes (keystrokes / pasted text) to the shell. */
export function ptyWrite(id: number, data: Uint8Array): Promise<void> {
  return invoke("pty_write", { id, data: Array.from(data) });
}

/** Resize the pty. */
export function ptyResize(id: number, rows: number, cols: number): Promise<void> {
  return invoke("pty_resize", { id, rows, cols });
}

/** Kill the shell and drop the session. */
export function ptyKill(id: number): Promise<void> {
  return invoke("pty_kill", { id });
}

/** Linux graphical `sudo` (askpass) pre-flight status — pickforge#215.
 *  "available": a graphical session + a resolvable helper were both found —
 *    agents can run privileged commands via `sudo -A`.
 *  "noHelper": graphical session, but no helper resolved (user-set
 *    `SUDO_ASKPASS` wasn't executable, and nothing on the fixed probe list
 *    exists) — the actionable failure state from the locked v1 contract.
 *  "headless": no graphical session (SSH, bare TTY, headless CI).
 *  "unsupportedPlatform": macOS/Windows — out of scope for this release. */
export type AskpassStatus = "available" | "noHelper" | "headless" | "unsupportedPlatform";

// Cached for the renderer's lifetime, mirroring the Rust-side OnceLock: the
// capability is resolved once from the process's environment and never
// changes while the app is running.
let askpassStatusPromise: Promise<AskpassStatus> | null = null;

/** Query the Rust-resolved askpass capability. Safe to call from every pane —
 *  the underlying Rust call is itself a cached singleton, and this wrapper
 *  caches the in-flight/resolved promise too, so repeated calls never
 *  re-invoke IPC. */
export function getAskpassStatus(): Promise<AskpassStatus> {
  if (!askpassStatusPromise) {
    askpassStatusPromise = invoke<AskpassStatus>("pty_askpass_status");
  }
  return askpassStatusPromise;
}

/** The chat pane's askpass notice copy — `null` renders nothing. Only the two
 *  actionable failure states from the locked v1 contract get a notice;
 *  "available" (agents can already run `sudo -A`) and "unsupportedPlatform"
 *  (macOS/Windows — out of scope this release) stay silent. Pure so the exact
 *  copy strings and the "only these two states render" rule are both
 *  unit-testable without mounting `TerminalHost`. */
export function askpassNotice(status: AskpassStatus | null): string | null {
  if (status === "noHelper") return "no sudo helper — run sudo in a terminal";
  if (status === "headless") return "no graphical session — run sudo in a terminal";
  return null;
}

/** Normalise channel output into a Uint8Array regardless of the IPC encoding. */
export function toBytes(data: PtyBytes): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return Uint8Array.from(data);
}

// == pickforge#214: legacy (pre-#209) recoverable-session cleanup ==
//
// Sessions created by an older PickForge build live under paths this build no
// longer reattaches or sweeps — see `pty::sessions`'s module note (Rust side)
// for why. `listLegacySessions` is read-only and safe to call any time the
// panel is open; `stopLegacySession` acts on exactly ONE named artifact and
// must only ever be called with an id this module itself returned. There is
// no "stop everything" call — a caller wanting to stop several sessions must
// invoke this once per session the user explicitly selected.

export type LegacySessionKind = "dtach" | "tmux";

export interface LegacyDtachSession {
  name: string;
  /** Best-effort: a process is currently listening on this socket. */
  live: boolean;
}

export interface LegacyTmuxSession {
  name: string;
  /** Whether tmux currently reports a client attached. */
  attached: boolean;
}

export interface LegacySessionReport {
  dtach: LegacyDtachSession[];
  tmux: LegacyTmuxSession[];
}

/** Read-only detection of every legacy dtach/tmux artifact PickForge's
 *  runtime dir currently holds. Never mutates anything. */
export function listLegacySessions(): Promise<LegacySessionReport> {
  return invoke<LegacySessionReport>("list_legacy_sessions");
}

/** Stop exactly ONE legacy session the user selected from
 *  {@link listLegacySessions}'s result — never a sweep. */
export function stopLegacySession(kind: LegacySessionKind, name: string): Promise<void> {
  return invoke("stop_legacy_session", { kind, name });
}
