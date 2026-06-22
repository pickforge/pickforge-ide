// Reactive workspace state (projects + chats + active selection) backed by the
// SQLite Tauri commands. Chats are bucketed per project (chatsByRoot) so the
// projects tree can show each project's chats as children, loaded lazily the
// first time a project is selected or its branch is expanded.
import { createStore, produce } from "solid-js/store";
import * as db from "../lib/db";
import { ptyDestroyChatSession } from "../lib/pty";
import { isChatArchived } from "./chatArchive";

/** First non-archived chat id in a list, or null. The projects tree hides
 *  archived chats, so the active chat must never be one of them. */
function firstVisibleChat(chats: db.Chat[]): string | null {
  return chats.find((c) => !isChatArchived(c.chatId))?.chatId ?? null;
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
const chatDeletedListeners = new Set<(chatId: string) => void>();
export function onChatDeleted(fn: (chatId: string) => void): () => void {
  chatDeletedListeners.add(fn);
  return () => chatDeletedListeners.delete(fn);
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

const loadingRoots = new Set<string>();

async function fetchChats(root: string): Promise<db.Chat[]> {
  const chats = await db.chatsList(root);
  setState("chatsByRoot", root, chats);
  return chats;
}

/** Load a project's chats once; safe to call on every expand/render. */
export async function ensureChatsLoaded(root: string) {
  if (state.chatsByRoot[root] || loadingRoots.has(root)) return;
  loadingRoots.add(root);
  try {
    await fetchChats(root);
  } finally {
    loadingRoots.delete(root);
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
        before.forEach((c) => chatDeletedListeners.forEach((fn) => fn(c.chatId)));
        setState("chatsByRoot", produce((m) => { delete m[root]; }));
        continue;
      }
      const after = await db.chatsList(root);
      setState("chatsByRoot", root, after);
      const afterIds = new Set(after.map((c) => c.chatId));
      before.forEach((c) => {
        if (!afterIds.has(c.chatId)) chatDeletedListeners.forEach((fn) => fn(c.chatId));
      });
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
  await db.projectUpsert({
    projectRoot: root,
    displayName,
    createdAt: now,
    lastOpenedAt: now,
    sortOrder: 0,
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

export async function deleteProject(root: string) {
  // The DB cascade-deletes this project's chat rows, but the workbench keeps
  // visited chat terminal hosts mounted until told a chat is gone — so notify
  // for each before deleting, or their shells leak.
  const chats = await db.chatsList(root);
  await db.projectDelete(root);
  chats.forEach((c) => chatDeletedListeners.forEach((fn) => fn(c.chatId)));
  if (state.activeRoot === root) setState("activeRoot", null);
  // Remove the bucket entirely; leaving an `undefined` value here makes
  // findChat() call .find on it and throw on the next chat operation.
  setState("chatsByRoot", produce((m) => { delete m[root]; }));
  await loadWorkspace();
}

export async function addChat(title: string, agentId: string, root = state.activeRoot) {
  if (!root) return;
  setState("activeRoot", root);
  const now = Date.now();
  const chatId = `chat-${now}`;
  await db.chatUpsert({
    chatId,
    projectRoot: root,
    title,
    agentId,
    skillId: null,
    sessionId: null,
    labelsJson: null,
    status: null,
    taskBriefText: null,
    createdAt: now,
    lastActivityAt: now,
    sortOrder: 0,
  });
  await fetchChats(root);
  setState("activeChatId", chatId);
}

export function selectChat(chatId: string | null) {
  if (chatId) {
    const chat = findChat(chatId);
    if (chat) setState("activeRoot", chat.projectRoot);
  }
  setState("activeChatId", chatId);
}

/** Move `draggedId` to sit before `beforeId` (or to the end if null) within its
 *  project, persisting the new sort_order. Updates the store in place. */
export async function reorderChat(draggedId: string, beforeId: string | null) {
  const dragged = findChat(draggedId);
  if (!dragged || draggedId === beforeId) return;
  const root = dragged.projectRoot;
  const rest = chatsFor(root).filter((c) => c.chatId !== draggedId);
  const idx = beforeId ? rest.findIndex((c) => c.chatId === beforeId) : rest.length;
  rest.splice(idx < 0 ? rest.length : idx, 0, dragged);
  const next = rest.map((c, i) => ({ ...c, sortOrder: i }));
  setState("chatsByRoot", root, next);
  for (const c of next) await db.chatUpsert(c);
}

export async function renameChat(chatId: string, title: string) {
  const t = title.trim();
  const c = findChat(chatId);
  if (!c || !t || t === c.title) return;
  await db.chatUpsert({ ...c, title: t });
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

export async function deleteChat(chatId: string) {
  const chat = findChat(chatId);
  const root = chat?.projectRoot ?? state.activeRoot;
  // Tear down the chat's recovery session (kill the tmux session / remove the
  // dtach socket) before the row goes — otherwise it would linger orphaned.
  // Best-effort: a failure here must not block deleting the chat.
  if (chat?.sessionId) {
    await ptyDestroyChatSession(chat.sessionId).catch((e) =>
      console.error("[pickforge] pty_destroy_chat_session failed", e),
    );
  }
  await db.chatDelete(chatId);
  chatDeletedListeners.forEach((fn) => fn(chatId));
  let remaining: db.Chat[] = [];
  if (root) remaining = await fetchChats(root);
  if (state.activeChatId === chatId) {
    setState("activeChatId", firstVisibleChat(remaining));
  }
}
