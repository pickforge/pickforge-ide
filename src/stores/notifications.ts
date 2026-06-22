// Agent-attention notifications. An embedded agent signals it finished a task or
// needs input by ringing the terminal BEL (\x07) or emitting an OSC 9 / OSC 777
// desktop-notification escape. We flag the OWNING chat as "needs attention" (a
// dot in the rail), and — unless the user is already looking at that chat with
// the window focused — fire a desktop notification (Tauri notification plugin).
//
// Three pieces live here so the should-notify decision stays pure and testable:
//   1. a localStorage settings toggle (Settings → Notifications, default on);
//   2. reactive window-focus + active-chat tracking;
//   3. per-chat attention state + the `shouldNotify` gate.
import { createSignal } from "solid-js";
import { route } from "../router";
import { workspace } from "./workspace";

// ---- setting: notifications on/off (localStorage) ----
const KEY = "pickforge.notificationsEnabled";

function loadEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== "false"; // default on
  } catch {
    return true;
  }
}

const [enabled, setEnabledSignal] = createSignal<boolean>(loadEnabled());
/** Reactive: are desktop notifications enabled? (default on). */
export const notificationsEnabled = enabled;
export function setNotificationsEnabled(on: boolean) {
  setEnabledSignal(on);
  try {
    localStorage.setItem(KEY, on ? "true" : "false");
  } catch {
    /* private mode / no storage — keep the in-memory value */
  }
}

// ---- window focus ----
// App.tsx feeds the real window-focus state here; default true so a notification
// is never suppressed just because focus tracking hasn't reported yet.
const [focused, setFocusedSignal] = createSignal<boolean>(true);
/** Reactive: is the app window currently focused? (default true). */
export const windowFocused = focused;
export function setWindowFocused(isFocused: boolean) {
  setFocusedSignal(isFocused);
}

// ---- per-chat attention state ----
// chatIds the user hasn't looked at since their agent last signalled. Drives the
// rail dot (and the per-project rollup); cleared when the chat is focused/opened.
const [attention, setAttention] = createSignal<Set<string>>(new Set());
/** Reactive set of chat ids currently flagged "needs attention". */
export const attentionChats = attention;

/** Reactive: does this chat currently need attention? Call from JSX. */
export function chatNeedsAttention(chatId: string): boolean {
  return attention().has(chatId);
}

/** Reactive: how many of a project's chats need attention (rail rollup). */
export function projectAttentionCount(chatIds: string[]): number {
  const a = attention();
  let n = 0;
  for (const id of chatIds) if (a.has(id)) n++;
  return n;
}

function flagAttention(chatId: string) {
  setAttention((s) => (s.has(chatId) ? s : new Set(s).add(chatId)));
}

/** Clear a chat's attention flag (the user opened/focused it). */
export function clearChatAttention(chatId: string) {
  setAttention((s) => {
    if (!s.has(chatId)) return s;
    const next = new Set(s);
    next.delete(chatId);
    return next;
  });
}

// ---- should-notify decision (pure) ----
export interface NotifyContext {
  enabled: boolean;
  windowFocused: boolean;
  activeChatId: string | null;
  // The Workbench (where chats render) is the visible route. When the user is on
  // Settings/History/Runs the Workbench is mounted but hidden, so the active chat
  // is NOT actually on screen even if it's "active".
  workbenchVisible: boolean;
}

/** Whether `chatId` is genuinely on screen right now: the Workbench route is
 *  showing, the window is focused, and it's the active chat. */
function chatIsVisible(chatId: string, ctx: NotifyContext): boolean {
  return ctx.windowFocused && ctx.workbenchVisible && ctx.activeChatId === chatId;
}

/** Whether to fire a desktop notification for `chatId`'s attention signal.
 *  Never notify when notifications are off, and never for the chat the user can
 *  already see (Workbench visible + window focused + active chat). Pure —
 *  exported for unit testing. */
export function shouldNotify(chatId: string, ctx: NotifyContext): boolean {
  if (!ctx.enabled) return false;
  if (chatIsVisible(chatId, ctx)) return false;
  return true;
}

/** Build the live NotifyContext from app state. */
function currentNotifyContext(): NotifyContext {
  return {
    enabled: notificationsEnabled(),
    windowFocused: windowFocused(),
    activeChatId: workspace.activeChatId,
    workbenchVisible: route() === "workbench",
  };
}

// ---- debounce/coalesce ----
// Agents can ring the bell several times in a burst (e.g. a tool loop). We flag
// attention immediately (idempotent), but coalesce the DESKTOP notification: one
// per attention transition, suppressed while a chat is already flagged, plus a
// short cooldown so a rapid flag→clear→flag can't spam the OS.
const NOTIFY_COOLDOWN_MS = 4000;
const lastNotified = new Map<string, number>();

// ---- desktop notification (Tauri plugin) ----
// Permission is requested lazily on first use; cached so we ask the OS once.
let permission: "granted" | "denied" | "default" | null = null;

async function ensurePermission(): Promise<boolean> {
  try {
    const { isPermissionGranted, requestPermission } = await import(
      "@tauri-apps/plugin-notification"
    );
    if (permission === null) {
      permission = (await isPermissionGranted()) ? "granted" : "default";
    }
    if (permission === "granted") return true;
    permission = await requestPermission();
    return permission === "granted";
  } catch {
    // Not in a Tauri runtime (VRT / browser) — no desktop notifications.
    return false;
  }
}

async function fireDesktopNotification(title: string, body: string) {
  try {
    if (!(await ensurePermission())) return;
    const { sendNotification } = await import("@tauri-apps/plugin-notification");
    sendNotification({ title, body });
  } catch (err) {
    console.error("[pickforge] sendNotification failed", err);
  }
}

/** An agent in `chatId` signalled it finished / needs input (a terminal bell or
 *  an OSC 9/777 notification escape). Flags the chat for the rail and — unless
 *  the user is already viewing it focused — fires a coalesced desktop
 *  notification. `summary` is an optional short line (e.g. the agent's OSC title
 *  or an OSC 9 message); `projectName`/`chatName` build the notification title. */
export function signalChatAttention(
  chatId: string,
  opts: { projectName?: string; chatName?: string; summary?: string } = {},
) {
  const ctx = currentNotifyContext();

  // The user is already looking at this chat — nothing to surface. This requires
  // the Workbench to be the visible route; on Settings/History the chat is hidden
  // even when it's still "active", so we must still flag + notify.
  if (chatIsVisible(chatId, ctx)) return;

  // One notification per ATTENTION TRANSITION: a chat that's already flagged
  // (and not yet cleared by the user) won't fire again on a repeat bell.
  const alreadyFlagged = attention().has(chatId);
  flagAttention(chatId);
  if (alreadyFlagged) return;

  if (!shouldNotify(chatId, ctx)) return;

  // Cooldown backstop against a rapid clear→re-flag loop spamming the OS.
  const now = Date.now();
  const last = lastNotified.get(chatId) ?? 0;
  if (now - last < NOTIFY_COOLDOWN_MS) return;
  lastNotified.set(chatId, now);

  const name = opts.chatName?.trim() || "Chat";
  const title = opts.projectName?.trim()
    ? `${opts.projectName.trim()} · ${name}`
    : name;
  const body = opts.summary?.trim() || "Agent needs your attention";
  void fireDesktopNotification(title, body);
}
