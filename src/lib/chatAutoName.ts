// One-time auto-naming of a default-titled chat from the first message the user
// sends to an agent. Agent-only: a chat is "armed" either by firing an agent
// quick-launch (chip/hotkey, which knows the agentId) or by typing a recognised
// agent command (`claude`, `codex`, …). Once armed, the next non-empty line the
// user submits becomes the title. Plain shell commands never rename the chat.
import { createSignal } from "solid-js";
import { AGENTS } from "./agentModels";
import { findChat, renameChat } from "../stores/workspace";

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

/** Arm a chat so its next submitted line in `paneId` is taken as the title
 *  (agent launched via a quick-launch chip/hotkey — we already know it's an
 *  agent). No-op once the chat has a real title or without a launched pane. */
export function armChatAutoName(
  chatId: string | null | undefined,
  paneId: string | null | undefined,
) {
  if (!chatId || !paneId) return;
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
  const title = toTitle(message);
  if (!title) return;
  const from = findChat(chatId)?.title ?? "";
  void renameChat(chatId, title); // persist immediately; the override masks it
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
