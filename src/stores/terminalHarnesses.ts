import { type Accessor, createEffect, createSignal, onCleanup } from "solid-js";
import { createStore, produce } from "solid-js/store";
import {
  ptyForegroundHarnesses,
  type TerminalHarnessId,
} from "../lib/pty";

const POLL_MS = 2_000;
const KNOWN_HARNESSES = new Set<TerminalHarnessId>([
  "claudeCode",
  "codex",
  "pi",
  "omp",
]);

interface HarnessEntry {
  harness: TerminalHarnessId;
  misses: number;
}

const [harnesses, setHarnesses] = createStore<Record<string, HarnessEntry>>({});
const chatSessions = new Map<string, Set<number>>();
let subscribers = 0;
let timer: ReturnType<typeof setInterval> | undefined;
let inFlight = false;
let generation = 0;
const [sessionRevision, setSessionRevision] = createSignal(0);

function clearHarnesses(): void {
  setHarnesses(produce((state) => {
    for (const sessionId of Object.keys(state)) delete state[sessionId];
  }));
}

function normalizeReport(report: Record<string, TerminalHarnessId>): Map<string, TerminalHarnessId> {
  if (!report || typeof report !== "object" || Array.isArray(report)) {
    throw new Error("invalid PTY harness report");
  }
  const normalized = new Map<string, TerminalHarnessId>();
  for (const [sessionId, harness] of Object.entries(report)) {
    if (KNOWN_HARNESSES.has(harness)) normalized.set(sessionId, harness);
  }
  return normalized;
}

function applyReport(report: Record<string, TerminalHarnessId>): void {
  const detected = normalizeReport(report);
  setHarnesses(produce((state) => {
    for (const [sessionId, harness] of detected) {
      state[sessionId] = { harness, misses: 0 };
    }
    for (const sessionId of Object.keys(state)) {
      if (detected.has(sessionId)) continue;
      if (state[sessionId].misses >= 1) delete state[sessionId];
      else state[sessionId].misses += 1;
    }
  }));
}

async function poll(): Promise<void> {
  if (inFlight || subscribers === 0) return;
  inFlight = true;
  const currentGeneration = generation;
  try {
    const report = await ptyForegroundHarnesses();
    if (subscribers > 0 && generation === currentGeneration) applyReport(report);
  } catch {
    // Keep the last successful evidence on an IPC/introspection failure.
  } finally {
    inFlight = false;
  }
}

function startPolling(): void {
  if (timer !== undefined) return;
  generation += 1;
  void poll();
  timer = setInterval(() => void poll(), POLL_MS);
}

function stopPolling(): void {
  generation += 1;
  if (timer !== undefined) {
    clearInterval(timer);
    timer = undefined;
  }
  clearHarnesses();
}

function subscribe(): void {
  if (subscribers++ === 0) startPolling();
}

function unsubscribe(): void {
  if (subscribers > 0 && --subscribers === 0) stopPolling();
}

/** Bind a visible chat to the numeric PTY session returned by pty_spawn_chat. */
export function registerTerminalSession(chatId: string, sessionId: number): void {
  let sessions = chatSessions.get(chatId);
  if (!sessions) {
    sessions = new Set<number>();
    chatSessions.set(chatId, sessions);
  }
  sessions.add(sessionId);
  setSessionRevision((revision) => revision + 1);
}

export function unregisterTerminalSession(chatId: string, sessionId: number): void {
  const sessions = chatSessions.get(chatId);
  if (!sessions) return;
  sessions.delete(sessionId);
  if (sessions.size === 0) chatSessions.delete(chatId);
  if (![...chatSessions.values()].some((ids) => ids.has(sessionId))) {
    setHarnesses(produce((state) => {
      delete state[sessionId.toString()];
    }));
  }
  setSessionRevision((revision) => revision + 1);
}

/** Reactive harness lookup by numeric live PTY session id. */
export function harnessFor(sessionId: number | null | undefined): TerminalHarnessId | null {
  if (sessionId == null) return null;
  return harnesses[sessionId.toString()]?.harness ?? null;
}

/** Reactive harness lookup for any currently mounted pane in a terminal chat. */
export function harnessForChat(chatId: string): TerminalHarnessId | null {
  sessionRevision();
  const sessions = chatSessions.get(chatId);
  if (!sessions) return null;
  for (const sessionId of sessions) {
    const harness = harnessFor(sessionId);
    if (harness) return harness;
  }
  return null;
}

/** Poll only while the owning view has at least one visible terminal chat. */
export function useTerminalHarnessPolling(active: Accessor<boolean>): void {
  let subscribed = false;
  createEffect(() => {
    const shouldSubscribe = active();
    if (shouldSubscribe && !subscribed) {
      subscribe();
      subscribed = true;
    } else if (!shouldSubscribe && subscribed) {
      unsubscribe();
      subscribed = false;
    }
  });
  onCleanup(() => {
    if (subscribed) unsubscribe();
  });
}
