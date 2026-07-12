// Auto-naming of a default-titled chat. Two sources, in priority order:
//
//   1. The agent's OSC 2 terminal title — a short live summary the agent emits
//      (e.g. Claude/Codex set the window title to what they're working on). The
//      first chat pane to emit a usable title owns the chat's name; the title is
//      debounced (commit on quiet) and noise-filtered (a prompt/cwd/`user@host`
//      banner is never a title). It REPLACES a message-derived auto-name.
//   2. The first message the user submits to an agent — the fallback when no OSC
//      title ever arrives. Agent-only: a chat is "armed" either by firing an
//      agent quick-launch (chip/hotkey, which knows the agentId) or by typing a
//      recognised agent command (`claude`, `codex`, …). Plain shell commands
//      never rename the chat.
//
// Either source only ever writes while the title is still "auto-owned" (the
// default, or a title this module set). A manual rename locks the title — see
// markChatTitleManual, which the rename field calls — so neither source can ever
// clobber a name the user typed.
import { createSignal } from "solid-js";
import { AGENTS } from "./agentModels";
import { findChat, resumeAutomaticChatTitles, setChatTitle } from "../stores/workspace";
import { flagEnabled } from "../stores/flags";

/** Title a freshly-created chat carries until it earns a real name. */
export const DEFAULT_CHAT_TITLE = "New chat";

export function isDefaultChatTitle(title: string): boolean {
  return title.trim() === DEFAULT_CHAT_TITLE;
}

// Agent CLI binaries we recognise when a launch is typed by hand. The configured
// agents, plus a few common ones the chips don't cover yet.
const AGENT_BINARIES = new Set<string>([
  ...AGENTS.map((a) => a.binary),
  "pi",
  "factory",
  "droid",
  "aider",
  "amp",
]);

function isAgentBinary(binary: string): boolean {
  return AGENT_BINARIES.has(binary)
    || (binary === "omp" && flagEnabled("ompPiAgents"));
}

// OMP's string-valued launch flags come from its installed primary source
// (`src/cli/flag-tables.ts`). Profile/bootstrap and installed extension flags
// are included too: their values can contain credentials, session identities,
// cache keys, or private paths and must never become persisted chat titles.
// `--flag=value` is discarded as one token by the parser below.
const VALUE_FLAGS = /^(-m|--model|--cwd|-C|--profile|--config|-c)$/;
const OMP_VALUE_FLAGS: Record<string, true> = {
  "--cwd": true,
  "-C": true,
  "--config": true,
  "--mode": true,
  "--fork": true,
  "--provider": true,
  "--model": true,
  "-m": true,
  "--smol": true,
  "--slow": true,
  "--plan": true,
  "--max-time": true,
  "--api-key": true,
  "--system-prompt": true,
  "--append-system-prompt": true,
  "--provider-session-id": true,
  "--prompt-cache-key": true,
  "--session-dir": true,
  "--models": true,
  "--tools": true,
  "--thinking": true,
  "--export": true,
  "--hook": true,
  "--extension": true,
  "-e": true,
  "--plugin-dir": true,
  "--skills": true,
  "--approval-mode": true,
  "--profile": true,
  "--alias": true,
  "--mcp-config": true,
};
const OMP_OPTIONAL_VALUE_FLAGS: Record<string, true> = {
  "--resume": true,
  "-r": true,
  "--session": true,
};
const PI_VALUE_FLAGS: Record<string, true> = {
  "--provider": true,
  "--model": true,
  "-m": true,
  "--api-key": true,
  "--system-prompt": true,
  "--append-system-prompt": true,
  "--profile": true,
  "--config": true,
  "--mcp-config": true,
  "--cwd": true,
  "-C": true,
  "--mode": true,
  "--session": true,
  "--session-id": true,
  "--fork": true,
  "--session-dir": true,
  "--name": true,
  "-n": true,
  "--models": true,
  "--tools": true,
  "-t": true,
  "--exclude-tools": true,
  "-xt": true,
  "--thinking": true,
  "--extension": true,
  "-e": true,
  "--skill": true,
  "--prompt-template": true,
  "--theme": true,
  "--export": true,
  "--list-models": true,
};

const MAX_TITLE = 48;
const AGENT_CHAT_MAX_TITLE = 42;
const GENERIC_AGENT_CHAT_TEXT = new Set([
  "hi",
  "hello",
  "hey",
  "yo",
  "ok",
  "okay",
  "thanks",
  "thank you",
  "help",
  "please help",
  "can you help",
  "can you help me",
  "plan",
  "planning",
  "working",
  "thinking",
  "processing",
  "done",
  "completed",
  "ready",
  "task",
  "new chat",
]);

// chatId -> the pane id armed for auto-naming. Scoped to a pane so that, in a
// chat with split terminals, only the pane the agent launched in can supply the
// title — a submit in another split pane can't steal it.
const armed = new Map<string, string>();

// chatId -> panes known to be running agents (the primary/session-backed pane
// a chip/hotkey launched into, or panes where recognised agent commands were
// hand-typed). This is activity ownership (busy glow / attention): it is not
// cleared by title commits or manual renames, and multiple agent panes may
// coexist. TITLE authority is single-slot — see titleAuthority below.
const agentPanes = new Map<string, Set<string>>();

// chatId -> the pane of the MOST RECENT agent launch. Only this pane's OSC
// titles may name the chat (last launch wins), so a stale agent left in a split
// can't keep renaming after a newer launch takes over.
const titleAuthority = new Map<string, string>();

// chatId -> its session-backed (primary) pane. Lets markAgentPane persist the
// "an agent ran in this chat's recoverable session" flag, which re-marks the
// pane after an app restart re-attaches the still-running session.
const sessionPane = new Map<string, string>();

const agentSessionKey = (chatId: string) => `pickforge.chatAgentSession.${chatId}`;

function persistChatAgentSession(chatId: string) {
  try {
    localStorage.setItem(agentSessionKey(chatId), "1");
  } catch {
    /* storage unavailable (tests) — restart re-marking degrades gracefully */
  }
}

export function clearChatAgentSession(chatId: string) {
  try {
    localStorage.removeItem(agentSessionKey(chatId));
  } catch {
    /* storage unavailable */
  }
}

/** Whether an agent was launched into this chat's recoverable session — decides
 *  re-marking the primary pane when a restart re-attaches the live session. */
export function chatHadAgentSession(chatId: string): boolean {
  try {
    return localStorage.getItem(agentSessionKey(chatId)) === "1";
  } catch {
    return false;
  }
}

/** Record which pane is the chat's session-backed primary (from the pane's
 *  spawn/attach report), so agent launches into it persist across restarts.
 *  A chip launch can beat the spawn report — persist retroactively then. */
export function markChatSessionPane(chatId: string, paneId: string) {
  sessionPane.set(chatId, paneId);
  if (isAgentPane(chatId, paneId)) persistChatAgentSession(chatId);
}

function markAgentPane(chatId: string, paneId: string) {
  let panes = agentPanes.get(chatId);
  if (!panes) {
    panes = new Set<string>();
    agentPanes.set(chatId, panes);
  }
  panes.add(paneId);
  titleAuthority.set(chatId, paneId);
  if (sessionPane.get(chatId) === paneId) persistChatAgentSession(chatId);
}

export function isAgentPane(chatId: string, paneId: string): boolean {
  return agentPanes.get(chatId)?.has(paneId) ?? false;
}

export function hasAgentPane(chatId: string): boolean {
  return (agentPanes.get(chatId)?.size ?? 0) > 0;
}

/** A pane left the split tree: drop its in-memory claims. Closing a detached
 *  session pane does not prove the recoverable process ended, so its persisted
 *  session marker is intentionally retained here. */
export function revokeAgentPane(chatId: string, paneId: string) {
  const panes = agentPanes.get(chatId);
  if (panes?.delete(paneId) && panes.size === 0) agentPanes.delete(chatId);
  if (armed.get(chatId) === paneId) armed.delete(chatId);
  revokeTitleAuthority(chatId, paneId);
}

/** A PTY/session process emitted its lifecycle exit. This is authoritative even
 *  when no shell OSC title was emitted, and clears durable reattach ownership. */
export function handleAgentPaneExited(chatId: string, paneId: string) {
  revokeAgentPane(chatId, paneId);
  if (sessionPane.get(chatId) !== paneId) return;
  sessionPane.delete(chatId);
  clearChatAgentSession(chatId);
}

/** The chat was deleted: drop all of its naming/ownership state, including the
 *  persisted agent-session flag and any pending OSC-title commit. */
export function forgetChatAutoName(chatId: string) {
  agentPanes.delete(chatId);
  titleAuthority.delete(chatId);
  sessionPane.delete(chatId);
  armed.delete(chatId);
  manual.delete(chatId);
  autoNamed.delete(chatId);
  dynamicMeaningfulTurns.delete(chatId);
  const pending = oscPending.get(chatId);
  if (pending) {
    clearTimeout(pending.timer);
    oscPending.delete(chatId);
  }
  clearChatAgentSession(chatId);
}

export function transferAgentPaneOwnership(
  chatId: string | null | undefined,
  fromPaneId: string | null | undefined,
  toPaneId: string | null | undefined,
) {
  if (!chatId || !fromPaneId || !toPaneId || fromPaneId === toPaneId) return;
  if (sessionPane.get(chatId) === fromPaneId) sessionPane.set(chatId, toPaneId);
  const panes = agentPanes.get(chatId);
  if (!panes?.delete(fromPaneId)) return;
  panes.add(toPaneId);
  if (armed.get(chatId) === fromPaneId) armed.set(chatId, toPaneId);
  if (titleAuthority.get(chatId) === fromPaneId) titleAuthority.set(chatId, toPaneId);
}

// ---- title ownership ----
// A chat the user has manually renamed: locked, so no auto source may overwrite
// it. Tracked for this session; a non-default title loaded from a previous run
// is also treated as locked (see canAutoOwn) — we can't tell a prior auto-name
// from a manual one, so we err toward never clobbering the user.
const manual = new Set<string>();
// Chats this module has auto-named in THIS session. Once we own a chat's title
// (via OSC or the first message) we may keep refining it from the SAME owner,
// even though it's no longer the default — but only until a manual rename.
const autoNamed = new Set<string>();
// Terminal chats have no durable structured turn history to recount. While the
// feature is enabled, track meaningful completed submissions for this run so
// local refreshes happen at 1, 4, 7, …; provider OSC signals remain independent.
const dynamicMeaningfulTurns = new Map<string, number>();

/** Mark a chat's title as user-owned so the OSC/first-message auto-namers leave
 *  it alone. The rename field calls this on a real manual rename. */
export function markChatTitleManual(chatId: string) {
  manual.add(chatId);
  armed.delete(chatId);
  autoNamed.delete(chatId);
}

export function chatTitleSourceForPolicy(chat: {
  title: string;
  titleSource?: "default" | "auto" | "user";
  titleUpdatedAt?: number;
}): "default" | "auto" | "user" {
  if (chat.titleSource === "auto") return "auto";
  if (chat.titleSource === "default") {
    return chat.title === DEFAULT_CHAT_TITLE ? "default" : "user";
  }
  // Older pre-flag rows can carry legacy user/0 metadata. Only the exact
  // untouched sentinel is adoptable; non-default (including whitespace-altered)
  // legacy titles remain conservatively locked.
  if (
    chat.title === DEFAULT_CHAT_TITLE &&
    (chat.titleSource == null || chat.titleUpdatedAt === 0)
  ) {
    return "default";
  }
  return "user";
}

/** True when an auto source may (re)write this chat's title. The flagged path
 * reads durable ownership; the legacy path keeps the existing session-local
 * behavior exactly as before. */
export function canAutoOwn(chatId: string): boolean {
  if (manual.has(chatId)) return false;
  const chat = findChat(chatId);
  if (!chat) return false;
  if (flagEnabled("dynamicChatTitles")) {
    return chatTitleSourceForPolicy(chat) !== "user";
  }
  return isDefaultChatTitle(chat.title) || autoNamed.has(chatId);
}

/** Unlock a persisted manual title without changing its current text. */
export async function resumeChatTitleAuto(chatId: string) {
  if (!flagEnabled("dynamicChatTitles")) return;
  await resumeAutomaticChatTitles(chatId);
  manual.delete(chatId);
  autoNamed.add(chatId);
}

// ---- OSC 2 terminal-title pipeline ----
// chatId -> a pending debounce timer + the latest candidate title. The agent
// rewrites the title rapidly while it works; we commit only after it goes quiet.
interface OscPending {
  timer: ReturnType<typeof setTimeout>;
  title: string;
}
const oscPending = new Map<string, OscPending>();
const OSC_DEBOUNCE_MS = 1200;

function revokeTitleAuthority(chatId: string, paneId: string) {
  if (titleAuthority.get(chatId) !== paneId) return;
  titleAuthority.delete(chatId);
  if (armed.get(chatId) === paneId) armed.delete(chatId);
  const pending = oscPending.get(chatId);
  if (pending) {
    clearTimeout(pending.timer);
    oscPending.delete(chatId);
  }
}

function isShellLifecycleTitle(rawTitle: string): boolean {
  const title = rawTitle.trim().toLowerCase();
  return (
    SHELL_BINARIES.has(title) ||
    /[$%#>]\s*$/.test(title) ||
    /^[\w.-]+@[\w.-]+(?::.*)?$/.test(title)
  );
}

/** Feed an OSC 2 title emitted by a chat pane's terminal. Filters noise, lets
 *  the first usable pane own the title, debounces, and commits on quiet — but
 *  only while the chat is still auto-owned (never over a manual rename). */
export function handleOscTitle(chatId: string, paneId: string, rawTitle: string) {
  if (titleAuthority.get(chatId) === paneId && isShellLifecycleTitle(rawTitle)) {
    revokeTitleAuthority(chatId, paneId);
    return;
  }
  if (!canAutoOwn(chatId)) return;

  // Only the most recent agent launch's pane may name the chat (last launch
  // wins). A regular shell command, editor, or build script that sets an OSC 2
  // window title in another pane can't claim the name, and a stale agent left
  // in a split can't fight a newer launch for it.
  if (titleAuthority.get(chatId) !== paneId) return;

  const title = cleanOscTitle(rawTitle);
  if (!title || (flagEnabled("dynamicChatTitles") && isTrivialAgentChatTitle(title))) return;

  const existing = oscPending.get(chatId);
  if (existing) clearTimeout(existing.timer);
  const timer = setTimeout(() => {
    oscPending.delete(chatId);
    if (!canAutoOwn(chatId)) return; // a manual rename may have landed mid-wait
    autoNamed.add(chatId);
    commit(chatId, title);
  }, OSC_DEBOUNCE_MS);
  oscPending.set(chatId, { timer, title });
}

/** Mark `paneId` as agent-owned and, for a default-titled chat, arm its next
 *  submitted line as the title (agent launched via a quick-launch chip/hotkey). */
export function armChatAutoName(
  chatId: string | null | undefined,
  paneId: string | null | undefined,
) {
  if (!chatId || !paneId) return;
  // The agent runs in this pane. OSC titles from agent-owned panes may name the
  // chat while title ownership still allows it.
  markAgentPane(chatId, paneId);
  const chat = findChat(chatId);
  if (chat && isDefaultChatTitle(chat.title)) armed.set(chatId, paneId);
}

/** Feed a line the user submitted (pressed Enter on) in a chat's terminal pane.
 *  If the chat still has the default title and is attributable to an agent,
 *  derive a title from the line and rename — once. */
export function maybeAutoNameChat(chatId: string, rawLine: string, paneId: string) {
  const chat = findChat(chatId);
  if (!chat) return;

  const line = rawLine.trim();
  if (!line) return; // ignore blank submits; stay armed

  if (flagEnabled("dynamicChatTitles")) {
    maybeRefreshDynamicTerminalTitle(chatId, line, paneId);
    return;
  }

  if (!isDefaultChatTitle(chat.title)) {
    armed.delete(chatId);
    if (matchAgentLaunch(line)) markAgentPane(chatId, paneId);
    return;
  }

  const armedPane = armed.get(chatId);
  if (armedPane !== undefined) {
    // Only the pane that received the launch may supply the title; a submit in
    // any other split pane leaves the arming intact — but a hand-typed agent
    // launch there still claims ACTIVITY ownership so its glow/attention work.
    if (armedPane !== paneId) {
      if (matchAgentLaunch(line)) markAgentPane(chatId, paneId);
      return;
    }
    armed.delete(chatId);
    commit(chatId, line);
    return;
  }

  // Not armed by a chip — is this a hand-typed agent launch in this pane?
  const launch = matchAgentLaunch(line);
  if (!launch) return; // agent-only scope: plain shell commands don't rename

  // This pane now runs an agent — let its OSC titles name the chat.
  markAgentPane(chatId, paneId);
  if (launch.prompt) commit(chatId, launch.prompt); // `claude fix the bug`
  else armed.set(chatId, paneId); // bare `claude` — wait for the in-TUI prompt
}

function maybeRefreshDynamicTerminalTitle(chatId: string, line: string, paneId: string) {
  const launch = matchAgentLaunch(line);
  const armedPane = armed.get(chatId);
  let taskText = "";

  if (armedPane !== undefined) {
    if (armedPane !== paneId) {
      if (launch) markAgentPane(chatId, paneId);
      return;
    }
    armed.delete(chatId);
    taskText = line;
  } else if (launch) {
    markAgentPane(chatId, paneId);
    if (!launch.prompt) {
      armed.set(chatId, paneId);
      return;
    }
    taskText = launch.prompt;
  } else if (titleAuthority.get(chatId) === paneId) {
    taskText = line;
  } else {
    return;
  }

  const title = deriveMeaningfulUserTitle(taskText);
  if (!title || !canAutoOwn(chatId)) return;
  const completed = (dynamicMeaningfulTurns.get(chatId) ?? 0) + 1;
  dynamicMeaningfulTurns.set(chatId, completed);
  if (completed === 1 || (completed - 1) % 3 === 0) commit(chatId, title);
}

// Transient display title per chat while the auto-name types itself in. The
// projects pane reads this (chatTitleOverride) and shows it instead of the real
// title until the animation clears the entry.
const [overrides, setOverrides] = createSignal<Record<string, string>>({});

/** The mid-animation display title for a chat, or undefined to show the real
 *  one. Reactive — call from JSX. */
export function chatTitleOverride(chatId: string): string | undefined {
  return overrides()[chatId];
}

const DELETE_MS = 22;
const TYPE_MS = 45;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );
}

function setOverride(chatId: string, text: string | null) {
  setOverrides((o) => {
    if (text === null) {
      const next = { ...o };
      delete next[chatId];
      return next;
    }
    return { ...o, [chatId]: text };
  });
}

// Backspace the old title to empty, then type the new one in, char by char.
function animateRename(chatId: string, from: string, to: string) {
  const frames: { text: string; delay: number }[] = [];
  for (let i = from.length - 1; i >= 0; i--) frames.push({ text: from.slice(0, i), delay: DELETE_MS });
  for (let i = 1; i <= to.length; i++) frames.push({ text: to.slice(0, i), delay: TYPE_MS });
  let idx = 0;
  const step = () => {
    if (idx >= frames.length) {
      setOverride(chatId, null); // done — fall back to the real (renamed) title
      return;
    }
    const f = frames[idx++];
    setOverride(chatId, f.text);
    setTimeout(step, f.delay);
  };
  step();
}

function commit(chatId: string, message: string) {
  if (!canAutoOwn(chatId)) return; // never write over a manual rename
  const title = toTitle(message);
  if (!title) return;
  const from = findChat(chatId)?.title ?? "";
  if (
    flagEnabled("dynamicChatTitles") &&
    (isTrivialAgentChatTitle(title) || normalizeTitle(title) === normalizeTitle(from))
  ) {
    return;
  }
  const dynamic = flagEnabled("dynamicChatTitles");
  if (!dynamic) autoNamed.add(chatId); // preserve legacy immediate session ownership
  // Persist via the narrow title update so a live `session_id` write (chat
  // recovery) the full-row `chat_upsert` would carry can't be clobbered.
  void setChatTitle(chatId, title).then((applied) => {
    if (!applied) return;
    autoNamed.add(chatId);
    if (prefersReducedMotion() || from === title) return;
    setOverride(chatId, from);
    animateRename(chatId, from, title);
  });
}

function shellWords(line: string): string[] {
  const words: string[] = [];
  let word = "";
  let quote: "'" | "\"" | null = null;
  let escaped = false;
  let started = false;

  const finish = () => {
    if (started) words.push(word);
    word = "";
    started = false;
  };

  for (const char of line) {
    if (escaped) {
      word += char;
      escaped = false;
      started = true;
    } else if (quote) {
      if (char === quote) quote = null;
      else if (quote === "\"" && char === "\\") escaped = true;
      else word += char;
      started = true;
    } else if (char === "'" || char === "\"") {
      quote = char;
      started = true;
    } else if (char === "\\") {
      escaped = true;
      started = true;
    } else if (char === "\n" || char === "\r") {
      finish();
      break;
    } else if (char === "#" && !started) {
      break;
    } else if (char === "<" || char === ">") {
      // An adjacent decimal prefix is the shell's IO number (`2>`, `10<`),
      // not prompt text.
      if (/^\d+$/.test(word)) {
        word = "";
        started = false;
      }
      finish();
      break;
    } else if (";&|()".includes(char)) {
      finish();
      break;
    } else if (/\s/.test(char)) {
      finish();
    } else {
      word += char;
      started = true;
    }
  }
  if (escaped) word += "\\";
  finish();
  return words;
}

/** If `line` starts with a known agent binary, return the prompt text after the
 *  command and its flags (empty string = bare launch). null if not an agent. */
function matchAgentLaunch(line: string): { prompt: string } | null {
  const tokens = shellWords(line);
  const first = tokens[0];
  if (!first) return null;
  const base = first.split(/[\\/]/).pop() ?? first;
  if (!isAgentBinary(base)) return null;

  const rest: string[] = [];
  const valueFlags =
    base === "omp"
      ? OMP_VALUE_FLAGS
      : base === "pi"
        ? PI_VALUE_FLAGS
        : null;
  const optionalValueFlags = base === "omp" ? OMP_OPTIONAL_VALUE_FLAGS : null;
  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === "--") {
      rest.push(...tokens.slice(i + 1));
      break;
    }
    if (token.startsWith("-")) {
      const equals = token.indexOf("=");
      const flag = equals === -1 ? token : token.slice(0, equals);
      const consumesValue = valueFlags
        ? (valueFlags[flag] ?? false)
        : VALUE_FLAGS.test(flag);
      if (equals === -1 && consumesValue) {
        i++;
      } else if (
        equals === -1
        && optionalValueFlags?.[flag]
        && tokens[i + 1] !== undefined
        && !tokens[i + 1].startsWith("-")
      ) {
        i++;
      }
      continue;
    }
    rest.push(token);
  }
  return { prompt: rest.join(" ") };
}

// Shell/agent binaries whose bare name a terminal often sets as its title — not
// a summary worth showing. Folded against the agent binaries we already know.
const SHELL_BINARIES = new Set<string>([
  "sh", "bash", "zsh", "fish", "dash", "ksh", "tcsh", "csh", "pwsh", "nu",
  "xonsh", "elvish",
]);

/** Validate + tidy an OSC 2 terminal title into a chat title, or "" if the title
 *  is noise we should ignore. Noise = empty/whitespace, control-only, a
 *  `user@host`/bare-hostname/FQDN banner, a path or cwd, a prompt-ending line
 *  (`$`/`%`/`#`/`>`), or the bare name of a shell/agent binary. Exported for
 *  unit testing — keep it pure. */
export function cleanOscTitle(raw: string): string {
  if (typeof raw !== "string") return "";
  // Strip C0/C1 control chars (some shells wrap the title in them) then trim.
  // eslint-disable-next-line no-control-regex
  const s = raw.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim();
  if (!s) return ""; // empty / whitespace / control-only

  // A prompt line the shell parks in the title: ends in a shell prompt sigil.
  if (/[$%#>]\s*$/.test(s)) return "";

  // `user@host` or `user@host:~/path` (the classic xterm default title), and a
  // bare hostname / FQDN (`devbox`, `devbox.local`, `host.example.com`).
  if (/^[\w.-]+@[\w.-]+(?::.*)?$/.test(s)) return "";
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(s) && !s.includes(" ")) return "";

  // A path or cwd: absolute (`/x/y`), home-relative (`~/x`), Windows (`C:\…`),
  // or a single no-space token that's clearly a directory (`~`, contains a
  // slash). Never a useful summary.
  if (/^(~|\/|[a-zA-Z]:[\\/]|\.{1,2}\/)/.test(s)) return "";
  if (!s.includes(" ") && /[\\/]/.test(s)) return "";

  // The bare name of the shell or an agent binary (`zsh`, `claude`, `codex`).
  const lone = s.toLowerCase();
  if (!s.includes(" ") && (SHELL_BINARIES.has(lone) || isAgentBinary(lone))) {
    return "";
  }

  return toTitle(s);
}

/** Turn a raw message into a tidy chat title: unquoted, single-spaced, capped on
 *  a word boundary, first letter capitalised. */
function toTitle(raw: string): string {
  let s = raw
    .replace(/^['"`]+/, "")
    .replace(/['"`]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return "";
  if (s.length > MAX_TITLE) {
    const cut = s.slice(0, MAX_TITLE);
    const onWord = cut.replace(/\s+\S*$/, "");
    s = `${(onWord.length >= 12 ? onWord : cut).trim()}…`;
  }
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function deriveAgentChatTitle(firstUserText: string, firstAssistantText?: string): string {
  const userTitle = cleanAgentChatTitleSource(firstUserText);
  const assistantTitle = cleanAgentChatTitleSource(firstAssistantText ?? "");
  const source = isTrivialAgentChatTitle(userTitle) && assistantTitle ? assistantTitle : userTitle;
  return formatAgentChatTitle(source);
}

/** User-owned text only: greetings/filler never become titles and assistant
 * output is deliberately excluded from the flagged policy. */
export function deriveMeaningfulUserTitle(userText: string): string {
  const source = cleanAgentChatTitleSource(userText);
  return isTrivialAgentChatTitle(source) ? "" : formatAgentChatTitle(source);
}

export interface DynamicAgentTitleInput {
  currentTitle: string;
  titleSource: "default" | "auto" | "user";
  completedUserTexts: readonly string[];
  providerTitle?: string | null;
}

/** Decide a native-chat refresh at a stable completed-turn boundary. Provider
 * plan/title metadata wins; local text refreshes on meaningful turns 1, 4, 7… */
export function selectDynamicAgentTitle(input: DynamicAgentTitleInput): string {
  if (input.titleSource === "user") return "";

  const current = normalizeTitle(input.currentTitle);
  const provider = deriveMeaningfulUserTitle(input.providerTitle ?? "");
  if (provider && normalizeTitle(provider) !== current) return provider;

  const meaningful = input.completedUserTexts
    .map(deriveMeaningfulUserTitle)
    .filter((title) => title.length > 0);
  const count = meaningful.length;
  if (count === 0 || (count !== 1 && (count - 1) % 3 !== 0)) return "";
  const candidate = meaningful[count - 1];
  return normalizeTitle(candidate) === current ? "" : candidate;
}

function normalizeTitle(title: string): string {
  return title.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

function cleanAgentChatTitleSource(raw: string): string {
  return raw
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/https?:\/\/\S+|www\.\S+/gi, " ")
    .split(/\n+/)
    .map((line) =>
      line
        .replace(/^\s{0,3}>\s?/, "")
        .replace(/^\s{0,3}#{1,6}\s+/, "")
        .replace(/^\s*[-*+]\s+/, "")
        .replace(/^\s*\d+[.)]\s+/, "")
        .replace(/^\s*\[[ xX]\]\s+/, ""),
    )
    .join(" ")
    .replace(/[*_~]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["'`“”‘’]+/, "")
    .replace(/["'`“”‘’]+$/, "")
    .trim();
}

function isTrivialAgentChatTitle(title: string): boolean {
  const normalized = title.toLowerCase().replace(/[.!?]+$/g, "").trim();
  return normalized.length <= 2 || GENERIC_AGENT_CHAT_TEXT.has(normalized);
}

function formatAgentChatTitle(raw: string): string {
  let s = raw.trim();
  if (!s) return "";
  if (s.length > AGENT_CHAT_MAX_TITLE) {
    const cut = s.slice(0, AGENT_CHAT_MAX_TITLE);
    const onWord = /\S/.test(s.charAt(AGENT_CHAT_MAX_TITLE))
      ? cut.replace(/\s+\S*$/, "").trim()
      : cut.trim();
    s = `${(onWord.length >= 12 ? onWord : cut).trim()}…`;
  }
  return s.charAt(0).toUpperCase() + s.slice(1);
}
