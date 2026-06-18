// Reactive workspace state (projects + chats + active selection) backed by the
// SQLite Tauri commands.
import { createStore } from "solid-js/store";
import * as db from "../lib/db";

interface WorkspaceState {
  projects: db.Project[];
  activeRoot: string | null;
  chats: db.Chat[];
  activeChatId: string | null;
  loaded: boolean;
}

const [state, setState] = createStore<WorkspaceState>({
  projects: [],
  activeRoot: null,
  chats: [],
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

export async function loadWorkspace() {
  const projects = await db.projectsList(false);
  const active = state.activeRoot ?? projects[0]?.projectRoot ?? null;
  setState({ projects, activeRoot: active, loaded: true });
  if (active) await loadChats(active);
}

async function loadChats(root: string) {
  const chats = await db.chatsList(root);
  setState({ chats, activeChatId: chats[0]?.chatId ?? null });
}

export async function selectProject(root: string) {
  setState("activeRoot", root);
  await db.projectTouch(root, Date.now());
  await loadChats(root);
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
  await loadWorkspace();
}

export async function addChat(title: string, agentId: string) {
  const root = state.activeRoot;
  if (!root) return;
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
  await loadChats(root);
  setState("activeChatId", chatId);
}

export function selectChat(chatId: string | null) {
  setState("activeChatId", chatId);
}

/** Move `draggedId` to sit before `beforeId` (or to the end if null), persisting
 *  the new sort_order. Updates the store in place so the active chat is kept. */
export async function reorderChat(draggedId: string, beforeId: string | null) {
  const dragged = state.chats.find((c) => c.chatId === draggedId);
  if (!dragged || draggedId === beforeId) return;
  const rest = state.chats.filter((c) => c.chatId !== draggedId);
  const idx = beforeId ? rest.findIndex((c) => c.chatId === beforeId) : rest.length;
  rest.splice(idx < 0 ? rest.length : idx, 0, dragged);
  const next = rest.map((c, i) => ({ ...c, sortOrder: i }));
  setState("chats", next);
  for (const c of next) await db.chatUpsert(c);
}

export async function renameChat(chatId: string, title: string) {
  const t = title.trim();
  const c = state.chats.find((x) => x.chatId === chatId);
  if (!c || !t || t === c.title) return;
  await db.chatUpsert({ ...c, title: t });
  setState("chats", (x) => x.chatId === chatId, "title", t);
}

export async function deleteChat(chatId: string) {
  await db.chatDelete(chatId);
  chatDeletedListeners.forEach((fn) => fn(chatId));
  if (state.activeRoot) await loadChats(state.activeRoot);
}
