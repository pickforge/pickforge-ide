// Reactive workspace state (projects + chats + active selection) backed by the
// SQLite Tauri commands. Chats are bucketed per project (chatsByRoot) so the
// projects tree can show each project's chats as children, loaded lazily the
// first time a project is selected or its branch is expanded.
import { createSignal } from "solid-js";
import { createStore, produce } from "solid-js/store";
import * as db from "../lib/db";
import { isPrimaryChat } from "../lib/chatLabels";
import { clearChatKillMark, markChatForKill, ptyDestroyChatSession } from "../lib/pty";
import { isChatArchived } from "./chatArchive";
import { setChatTmux } from "./chatSessions";

/** First non-archived chat id in a list, or null. The projects tree hides
 *  archived chats, so the active chat must never be one of them. */
function firstVisibleChat(chats: db.Chat[]): string | null {
  return chats.find((c) => !isChatArchived(c.chatId) && isPrimaryChat(c))?.chatId ?? null;
}

interface WorkspaceState {
  projects: db.Project[];
  activeRoot: string | null;
  chatsByRoot: Record<string, db.Chat[]>;
  activeChatId: string | null;
  loaded: boolean;
}

const [state, setState] = createStore<WorkspaceState>({
  projects: [],
  activeRoot: null,
  chatsByRoot: {},
  activeChatId: null,
  loaded: false,
});

export const workspace = state;

// Chat-deletion notifier so the workbench can dispose that chat's terminal host
// (and its shells). Visited chat hosts are kept mounted across project/chat
// switches, so they can only be torn down on an explicit delete.
type ChatDeletedListener = (chatId: string) => void | Promise<void>;

const chatDeletedListeners = new Set<ChatDeletedListener>();
export function onChatDeleted(fn: ChatDeletedListener): () => void {
  chatDeletedListeners.add(fn);
  return () => chatDeletedListeners.delete(fn);
}

async function notifyChatDeleted(chatId: string) {
  await Promise.all([...chatDeletedListeners].map((fn) => fn(chatId)));
}

// Chats mid-teardown (delete or backend-migration): the host is removed up front
// but `activeChatId`/`findChat` still point at the old row until the surrounding
// awaits finish. The Workbench mount effect must NOT recreate the host in that
// window — it could resurrect a just-deleted chat or reopen a migrating one with
// its stale stored session_id. `isChatDestroying` gates that remount. REACTIVE:
// reading it subscribes the mount effect, so CLEARING the mark (migration done)
// re-runs the effect and lets the host remount under the new backend.
const [destroying, setDestroying] = createSignal<Set<string>>(new Set());
function markDestroying(chatId: string) {
  setDestroying((s) => (s.has(chatId) ? s : new Set(s).add(chatId)));
}
function unmarkDestroying(chatId: string) {
  setDestroying((s) => {
    if (!s.has(chatId)) return s;
    const next = new Set(s);
    next.delete(chatId);
    return next;
  });
}
export function isChatDestroying(chatId: string): boolean {
  return destroying().has(chatId);
}

export function activeProject(): db.Project | null {
  return state.projects.find((p) => p.projectRoot === state.activeRoot) ?? null;
}

/** A project's chats (empty array until its branch has been loaded). */
export function chatsFor(root: string): db.Chat[] {
  return state.chatsByRoot[root] ?? [];
}

/** Find a loaded chat by id across all projects. */
export function findChat(chatId: string): db.Chat | undefined {
  for (const root of Object.keys(state.chatsByRoot)) {
    const hit = state.chatsByRoot[root].find((c) => c.chatId === chatId);
    if (hit) return hit;
  }
  return undefined;
}

const loadingRoots = new Map<string, Promise<db.Chat[]>>();

async function fetchChats(root: string): Promise<db.Chat[]> {
  const chats = await db.chatsList(root);
  setState("chatsByRoot", root, chats);
  return chats;
}

/** Load a project's chats once; safe to call on every expand/render. */
export async function ensureChatsLoaded(root: string) {
  if (state.chatsByRoot[root]) return;
  const pending = loadingRoots.get(root);
  if (pending) {
    await pending;
    return;
  }
  const promise = fetchChats(root);
  loadingRoots.set(root, promise);
  try {
    await promise;
  } finally {
    if (loadingRoots.get(root) === promise) loadingRoots.delete(root);
  }
}

export async function loadWorkspace() {
  const projects = await db.projectsList(false);
  const active = state.activeRoot ?? projects[0]?.projectRoot ?? null;
  setState({ projects, activeRoot: active, loaded: true });
  if (active) {
    const chats = await fetchChats(active);
    // Keep the current chat only if it still belongs to the active project and
    // isn't archived — otherwise it dangles (e.g. after archiving/deleting the
    // project it came from) and the terminal area goes blank.
    const keep =
      state.activeChatId != null &&
      chats.some((c) => c.chatId === state.activeChatId) &&
      !isChatArchived(state.activeChatId);
    setState("activeChatId", keep ? state.activeChatId : firstVisibleChat(chats));
  } else {
    setState("activeChatId", null);
  }
}

let refreshing = false;
/** Re-read everything that lives in the shared DB (`~/.pickforge/pickforge.db`):
 *  the project list and every already-loaded project's chats. Lets a second
 *  running instance's writes (e.g. dev alongside release) surface here instead of
 *  going stale. Fires the chat-deletion notifiers for chats another instance
 *  removed so their terminal hosts are torn down, and reconciles the active
 *  project/chat if they vanished. Idempotent; wired to window focus. */
export async function refreshFromDb() {
  if (!state.loaded || refreshing) return;
  refreshing = true;
  try {
    const projects = await db.projectsList(false);
    setState("projects", projects);
    const liveRoots = new Set(projects.map((p) => p.projectRoot));

    for (const root of Object.keys(state.chatsByRoot)) {
      const before = state.chatsByRoot[root] ?? [];
      if (!liveRoots.has(root)) {
        // Project gone in another instance: KILL each chat's pane + destroy its
        // recovery session (the row is gone, so detaching would strand it).
        for (const c of before) await destroyExternallyDeletedChat(c.chatId, c.sessionId);
        setState("chatsByRoot", produce((m) => { delete m[root]; }));
        continue;
      }
      const after = await db.chatsList(root);
      setState("chatsByRoot", root, after);
      const afterIds = new Set(after.map((c) => c.chatId));
      for (const c of before) {
        // Chat removed in another instance: same destructive teardown.
        if (!afterIds.has(c.chatId)) await destroyExternallyDeletedChat(c.chatId, c.sessionId);
      }
    }

    if (state.activeRoot != null && !liveRoots.has(state.activeRoot)) {
      const nextRoot = projects[0]?.projectRoot ?? null;
      setState("activeRoot", nextRoot);
      // Load the fallback project's chats before picking one — its bucket may
      // never have been opened in this window, and reading an empty bucket would
      // strand the UI on "no chat open".
      const chats = nextRoot
        ? state.chatsByRoot[nextRoot] ?? (await fetchChats(nextRoot))
        : [];
      setState("activeChatId", nextRoot ? firstVisibleChat(chats) : null);
    } else if (state.activeRoot) {
      const chats = chatsFor(state.activeRoot);
      const keep =
        state.activeChatId != null &&
        chats.some((c) => c.chatId === state.activeChatId) &&
        !isChatArchived(state.activeChatId);
      if (!keep) setState("activeChatId", firstVisibleChat(chats));
    }
  } finally {
    refreshing = false;
  }
}

export async function selectProject(root: string) {
  setState("activeRoot", root);
  await db.projectTouch(root, Date.now());
  const chats = await fetchChats(root);
  setState("activeChatId", firstVisibleChat(chats));
}

export async function addProject(root: string, displayName: string) {
  const now = Date.now();
  // Land new projects at the end of the current order so they don't jump ahead
  // of an explicit user reordering (all-zero sort_order falls back to recency).
  const sortOrder = state.projects.reduce((m, p) => Math.max(m, p.sortOrder + 1), 0);
  await db.projectUpsert({
    projectRoot: root,
    displayName,
    createdAt: now,
    lastOpenedAt: now,
    sortOrder,
    archivedAt: null,
  });
  await loadWorkspace();
  await selectProject(root);
}

export async function archiveProject(root: string) {
  await db.projectSetArchived(root, Date.now());
  if (state.activeRoot === root) setState("activeRoot", null);
  await loadWorkspace();
}

export async function renameProject(root: string, displayName: string) {
  const name = displayName.trim();
  const p = state.projects.find((x) => x.projectRoot === root);
  if (!p || !name || name === p.displayName) return;
  await db.projectUpsert({ ...p, displayName: name });
  setState("projects", (x) => x.projectRoot === root, "displayName", name);
}

/** DESTRUCTIVELY tear a chat down (delete, not close): mark it so its mounted
 *  panes KILL (not detach) on unmount, await the deletion notifiers (which unmount
 *  the host — killing the live PTY + its process group), THEN destroy the stored
 *  dtach/tmux session so nothing lingers. Order matters: killing the mounted pane
 *  first means we never detach-then-destroy (which would strand a live shell);
 *  destroying after means the socket/session is gone for good. Best-effort on the
 *  destroy — a failure there must not block the delete. */
async function destroyChat(chatId: string, sessionId: string | null) {
  markChatForKill(chatId);
  // Block the Workbench from remounting this host while the active chat / store
  // still point at the old row (cleared by the caller once it has reconciled
  // state — see deleteChat/migrateChatBackend/deleteProject).
  markDestroying(chatId);
  // Unmount the host now (synchronous) so its panes hit the kill teardown while
  // the mark is set, BEFORE we destroy the session/socket below.
  await notifyChatDeleted(chatId);
  if (sessionId) {
    await ptyDestroyChatSession(sessionId).catch((e) =>
      console.error("[pickforge] pty_destroy_chat_session failed", e),
    );
  }
  clearChatKillMark(chatId);
}

/** Tear down a chat another running instance already removed from the shared DB:
 *  the row is GONE, so its mounted pane must KILL (not detach) and its recovery
 *  session must be destroyed — otherwise the session keeps running after its DB
 *  row disappeared. Same destructive order as destroyChat, but it doesn't gate
 *  remounting (refreshFromDb removes the chat from the store in the same pass, so
 *  findChat already returns undefined and the host can't remount). */
async function destroyExternallyDeletedChat(chatId: string, sessionId: string | null) {
  markChatForKill(chatId);
  await notifyChatDeleted(chatId);
  if (sessionId) {
    await ptyDestroyChatSession(sessionId).catch((e) =>
      console.error("[pickforge] pty_destroy_chat_session failed", e),
    );
  }
  clearChatKillMark(chatId);
}

export async function deleteProject(root: string) {
  // The DB cascade-deletes this project's chat rows, but the workbench keeps
  // visited chat terminal hosts mounted until told a chat is gone — and each
  // chat's dtach/tmux session would outlive its project. So for every chat:
  // kill any mounted pane and destroy its recovery session BEFORE the row goes.
  const chats = await db.chatsList(root);
  await Promise.all(chats.map((c) => destroyChat(c.chatId, c.sessionId)));
  await db.projectDelete(root);
  if (state.activeRoot === root) setState("activeRoot", null);
  // Remove the bucket entirely; leaving an `undefined` value here makes
  // findChat() call .find on it and throw on the next chat operation.
  setState("chatsByRoot", produce((m) => { delete m[root]; }));
  await loadWorkspace();
  // State reconciled — let the remount gate go (these chats are gone now).
  chats.forEach((c) => unmarkDestroying(c.chatId));
}

export async function addChat(
  title: string,
  agentId: string,
  root = state.activeRoot,
  kind = "terminal",
  options: { activate?: boolean; labelsJson?: string | null } = {},
): Promise<string | undefined> {
  if (!root) return undefined;
  const activate = options.activate !== false;
  if (activate) setState("activeRoot", root);
  const now = Date.now();
  const chatId = `chat-${now}`;
  await db.chatUpsert({
    chatId,
    projectRoot: root,
    title,
    kind,
    agentId,
    skillId: null,
    sessionId: null,
    labelsJson: options.labelsJson ?? null,
    status: null,
    taskBriefText: null,
    createdAt: now,
    lastActivityAt: now,
    sortOrder: 0,
  });
  await fetchChats(root);
  if (activate) setState("activeChatId", chatId);
  return chatId;
}

export function selectChat(chatId: string | null) {
  if (chatId) {
    const chat = findChat(chatId);
    if (chat) setState("activeRoot", chat.projectRoot);
  }
  setState("activeChatId", chatId);
}

/** Splice `dragged` to sit before `beforeId` (or at the end when null) within
 *  `list`, returning the reordered array — or null when it's a no-op (the item
 *  is already in that slot). Shared by chat and project reordering. */
function spliceBefore<T>(
  list: T[],
  dragged: T,
  beforeId: string | null,
  idOf: (item: T) => string,
): T[] | null {
  const rest = list.filter((item) => idOf(item) !== idOf(dragged));
  const idx = beforeId ? rest.findIndex((item) => idOf(item) === beforeId) : rest.length;
  const next = [...rest];
  next.splice(idx < 0 ? rest.length : idx, 0, dragged);
  const changed = next.some((item, i) => list[i] === undefined || idOf(item) !== idOf(list[i]));
  return changed ? next : null;
}

/** Move `draggedId` to sit before `beforeId` (or to the end if null) within its
 *  project, persisting the new sort_order. Updates the store in place. */
export async function reorderChat(draggedId: string, beforeId: string | null) {
  const dragged = findChat(draggedId);
  if (!dragged || draggedId === beforeId) return;
  const root = dragged.projectRoot;
  const reordered = spliceBefore(chatsFor(root), dragged, beforeId, (c) => c.chatId);
  if (!reordered) return;
  const next = reordered.map((c, i) => ({ ...c, sortOrder: i }));
  setState("chatsByRoot", root, next);
  // Persist ONLY sort_order (narrow write) — a full-row chat_upsert would carry
  // each chat's in-store sessionId and could clobber a recovery handle that a
  // concurrent narrow session_id write just persisted.
  for (const c of next) await db.updateChatSortOrder(c.chatId, c.sortOrder);
}

/** Move `draggedRoot` to sit before `beforeRoot` (or to the end if null) within
 *  the project list, persisting the new sort_order. Updates the store in place.
 *  Projects share a single global order (groups are a separate, view-only
 *  concern), so this reorders the whole `workspace.projects` array. */
export async function reorderProject(draggedRoot: string, beforeRoot: string | null) {
  if (draggedRoot === beforeRoot) return;
  const dragged = state.projects.find((p) => p.projectRoot === draggedRoot);
  if (!dragged) return;
  const reordered = spliceBefore(state.projects, dragged, beforeRoot, (p) => p.projectRoot);
  if (!reordered) return;
  const next = reordered.map((p, i) => ({ ...p, sortOrder: i }));
  setState("projects", next);
  // Narrow sort_order write — never a full project_upsert (it would re-stamp
  // last_opened_at/display_name and could clobber a concurrent rename/touch).
  for (const p of next) await db.updateProjectSortOrder(p.projectRoot, p.sortOrder);
}

export async function renameChat(chatId: string, title: string) {
  const t = title.trim();
  const c = findChat(chatId);
  if (!c || !t || t === c.title) return;
  // Narrow title write — same reason as reorder: never clobber a live session_id.
  await db.updateChatTitle(chatId, t);
  setState("chatsByRoot", c.projectRoot, (list) =>
    list.map((x) => (x.chatId === chatId ? { ...x, title: t } : x)),
  );
}

/** Set a chat's title via the NARROW title write (won't clobber a live
 *  session_id), updating the store in place. The auto-name flow uses this — it
 *  can fire while a session_id is being persisted, so the two must not race. */
export async function setChatTitle(chatId: string, title: string) {
  const t = title.trim();
  const c = findChat(chatId);
  if (!c || !t || t === c.title) return;
  await db.updateChatTitle(chatId, t);
  setState("chatsByRoot", c.projectRoot, (list) =>
    list.map((x) => (x.chatId === chatId ? { ...x, title: t } : x)),
  );
}

export async function setChatAgent(chatId: string, agentId: string, kind = "agent") {
  const c = findChat(chatId);
  if (!c || (c.agentId === agentId && c.kind === kind)) return;
  const next = { ...c, agentId, kind };
  await db.chatUpsert(next);
  setState("chatsByRoot", c.projectRoot, (list) =>
    list.map((x) => (x.chatId === chatId ? next : x)),
  );
}

/** Persist a chat's recovery `session_id` (dtach socket / tmux name, with a
 *  backend tag), updating the store in place via the narrow write. Null clears
 *  it (e.g. when the backend degraded to a raw shell we LEAVE it; the caller
 *  decides). */
export async function setChatSessionId(chatId: string, sessionId: string | null) {
  const c = findChat(chatId);
  if (!c || c.sessionId === sessionId) return;
  await db.updateChatSessionId(chatId, sessionId);
  setState("chatsByRoot", c.projectRoot, (list) =>
    list.map((x) => (x.chatId === chatId ? { ...x, sessionId } : x)),
  );
}

/** EXPLICIT user migration of a chat to a different recovery backend (the
 *  dtach⇄tmux menu toggle). Because the chat is otherwise reopened with whatever
 *  backend its stored handle is tagged with, switching means we must first
 *  DESTROY the old session and CLEAR the handle — otherwise the toggle would
 *  never take effect (and the old session would linger). Tears down any mounted
 *  pane (kill, not detach), destroys the old session/socket, clears the stored
 *  handle, then flips the per-chat tmux opt-in so the next open spawns a fresh
 *  session under the new backend. */
export async function migrateChatBackend(chatId: string, toTmux: boolean) {
  const chat = findChat(chatId);
  if (!chat) return;
  await destroyChat(chatId, chat.sessionId);
  await setChatSessionId(chatId, null);
  setChatTmux(chatId, toTmux);
  // The stored session_id is cleared and the backend opt-in flipped — it's now
  // safe for the host to remount (it'll spawn a fresh session under the new
  // backend rather than reopening the destroyed one). Clearing the reactive gate
  // re-runs the Workbench mount effect, so the host comes back under the new
  // backend without waiting on another store change.
  unmarkDestroying(chatId);
}

export async function deleteChat(chatId: string) {
  const chat = findChat(chatId);
  const root = chat?.projectRoot ?? state.activeRoot;
  // KILL any mounted pane (so a live agent shell dies with the chat instead of
  // being detached and stranded), THEN destroy the dtach/tmux session/socket so
  // nothing lingers orphaned. Never detach on a delete.
  await destroyChat(chatId, chat?.sessionId ?? null);
  await db.chatDelete(chatId);
  let remaining: db.Chat[] = [];
  if (root) remaining = await fetchChats(root);
  if (state.activeChatId === chatId) {
    setState("activeChatId", firstVisibleChat(remaining));
  }
  // Row gone + active chat moved off it — the remount gate can release.
  unmarkDestroying(chatId);
}
