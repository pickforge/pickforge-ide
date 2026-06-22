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
import { findChat, setChatTitle } from "../stores/workspace";

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

// Flags that consume the following token as their value (so it isn't mistaken
// for the prompt when stripping a typed launch command).
const VALUE_FLAGS = /^(-m|--model|--cwd|-C|--profile|--config|-c)$/;

const MAX_TITLE = 48;

// chatId -> the pane id armed for auto-naming. Scoped to a pane so that, in a
// chat with split terminals, only the pane the agent launched in can supply the
// title — a submit in another split pane can't steal it.
const armed = new Map<string, string>();

// chatId -> the pane an agent is known to run in (the primary/session-backed pane
// a chip/hotkey launched into, or a pane where a recognised agent command was
// hand-typed). Unlike `armed`, this is NOT cleared once a title commits — it gates
// the OSC-title pipeline so only the agent's own pane can claim the chat name. A
// regular shell/editor/build in another split pane that sets OSC 2 can't rename.
const agentPane = new Map<string, string>();

/** Record the pane an agent runs in for a chat, so the OSC-title pipeline only
 *  adopts titles from it (and never from a non-agent split pane). */
function markAgentPane(chatId: string, paneId: string) {
  agentPane.set(chatId, paneId);
}

/** Whether `paneId` is the agent-owned pane for a chat — so a bell/notification
 *  from it counts as agent attention, but one from a plain shell or build in
 *  another split pane is ignored. Mirrors the OSC-title pane-ownership gate. */
export function isAgentPane(chatId: string, paneId: string): boolean {
  return agentPane.get(chatId) === paneId;
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

/** Mark a chat's title as user-owned so the OSC/first-message auto-namers leave
 *  it alone. The rename field calls this on a real manual rename. */
export function markChatTitleManual(chatId: string) {
  manual.add(chatId);
  autoNamed.delete(chatId);
  oscPaneOwner.delete(chatId);
  agentPane.delete(chatId);
}

/** True when an auto source may (re)write this chat's title: never once the user
 *  has renamed it, and otherwise only while it's the default or a name we set. */
function canAutoOwn(chatId: string): boolean {
  if (manual.has(chatId)) return false;
  const chat = findChat(chatId);
  if (!chat) return false;
  return isDefaultChatTitle(chat.title) || autoNamed.has(chatId);
}

// ---- OSC 2 terminal-title pipeline ----
// chatId -> the pane id that first emitted a usable OSC title. That pane owns
// the chat's title for the rest of the session; titles from any other split
// pane are ignored, so a second shell can't fight it for the name.
const oscPaneOwner = new Map<string, string>();
// chatId -> a pending debounce timer + the latest candidate title. The agent
// rewrites the title rapidly while it works; we commit only after it goes quiet.
interface OscPending {
  timer: ReturnType<typeof setTimeout>;
  title: string;
}
const oscPending = new Map<string, OscPending>();
const OSC_DEBOUNCE_MS = 1200;

/** Feed an OSC 2 title emitted by a chat pane's terminal. Filters noise, lets
 *  the first usable pane own the title, debounces, and commits on quiet — but
 *  only while the chat is still auto-owned (never over a manual rename). */
export function handleOscTitle(chatId: string, paneId: string, rawTitle: string) {
  if (!canAutoOwn(chatId)) return;

  // Only the agent-owned pane may name the chat. A regular shell command,
  // editor, or build script that sets an OSC 2 window title in another pane must
  // not claim the chat before any agent prompt exists — consistent with the
  // armed/first-message pane-ownership model.
  const agent = agentPane.get(chatId);
  if (agent === undefined || agent !== paneId) return;

  const title = cleanOscTitle(rawTitle);
  if (!title) return; // noise — empty, a prompt/cwd banner, the shell name, …

  // First usable pane to speak owns the title; ignore the others.
  const owner = oscPaneOwner.get(chatId);
  if (owner === undefined) oscPaneOwner.set(chatId, paneId);
  else if (owner !== paneId) return;

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

/** Arm a chat so its next submitted line in `paneId` is taken as the title
 *  (agent launched via a quick-launch chip/hotkey — we already know it's an
 *  agent). No-op once the chat has a real title or without a launched pane. */
export function armChatAutoName(
  chatId: string | null | undefined,
  paneId: string | null | undefined,
) {
  if (!chatId || !paneId) return;
  // The agent runs in this pane — let OSC titles from it (and only it) name the
  // chat, even if the chat already has a non-default title (the agent pane is the
  // title authority for this session).
  markAgentPane(chatId, paneId);
  const chat = findChat(chatId);
  if (chat && isDefaultChatTitle(chat.title)) armed.set(chatId, paneId);
}

/** Feed a line the user submitted (pressed Enter on) in a chat's terminal pane.
 *  If the chat still has the default title and is attributable to an agent,
 *  derive a title from the line and rename — once. */
export function maybeAutoNameChat(chatId: string, rawLine: string, paneId: string) {
  const chat = findChat(chatId);
  if (!chat || !isDefaultChatTitle(chat.title)) {
    armed.delete(chatId);
    return;
  }

  const line = rawLine.trim();
  if (!line) return; // ignore blank submits; stay armed

  const armedPane = armed.get(chatId);
  if (armedPane !== undefined) {
    // Only the pane that received the launch may supply the title; a submit in
    // any other split pane is ignored and the arming stands.
    if (armedPane !== paneId) return;
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
  autoNamed.add(chatId); // this module now owns the title (until a manual rename)
  // Persist via the narrow title update so a live `session_id` write (chat
  // recovery) the full-row `chat_upsert` would carry can't be clobbered.
  void setChatTitle(chatId, title);
  if (prefersReducedMotion() || from === title) return;
  setOverride(chatId, from); // mask the instant swap before the first frame
  animateRename(chatId, from, title);
}

/** If `line` starts with a known agent binary, return the prompt text after the
 *  command and its flags (empty string = bare launch). null if not an agent. */
function matchAgentLaunch(line: string): { prompt: string } | null {
  const tokens = line.split(/\s+/);
  const base = tokens[0].split(/[\\/]/).pop() ?? tokens[0];
  if (!AGENT_BINARIES.has(base)) return null;

  const rest: string[] = [];
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.startsWith("-")) {
      if (!t.includes("=") && VALUE_FLAGS.test(t)) i++; // skip the flag's value
      continue;
    }
    rest.push(t);
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
  if (!s.includes(" ") && (SHELL_BINARIES.has(lone) || AGENT_BINARIES.has(lone))) {
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
