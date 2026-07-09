// Operator composer dock state: open/close, the command → dispatch flow, and the
// last-result view. Parsing/dispatch policy lives in operatorParser + operator;
// this store drives the state machine so OperatorDock stays presentational.
import { createSignal } from "solid-js";
import { parseCommand } from "../lib/operatorParser";
import { dispatchIntent, type DispatchResult } from "./operator";
import { flagEnabled } from "./flags";
import { operatorAuditList, type OperatorAuditRow } from "../lib/db";
import type { OperatorIntent } from "../lib/operatorIntent";

export type DockView =
  | { kind: "idle" }
  | { kind: "needsRouter"; reason: string }
  | { kind: "preview"; intent: OperatorIntent; summary: string; inputText: string }
  | { kind: "result"; result: DispatchResult };

const RECENT_LIMIT = 5;

const [open, setOpen] = createSignal(false);
export const operatorDockOpen = open;

const [input, setInput] = createSignal("");
export const operatorInput = input;
export function setOperatorInput(value: string) {
  setInput(value);
}

const [view, setView] = createSignal<DockView>({ kind: "idle" });
export const operatorView = view;

const [recent, setRecent] = createSignal<OperatorAuditRow[]>([]);
export const operatorRecent = recent;

const [busy, setBusy] = createSignal(false);
export const operatorBusy = busy;

export function openOperatorDock(): boolean {
  if (!flagEnabled("operator")) return false;
  setOpen(true);
  void refreshRecent();
  return true;
}

export function closeOperatorDock() {
  setOpen(false);
  setInput("");
  setView({ kind: "idle" });
  setBusy(false);
}

export function toggleOperatorDock(): boolean {
  if (open()) {
    closeOperatorDock();
    return false;
  }
  return openOperatorDock();
}

export function dismissOperatorResult() {
  setView({ kind: "idle" });
}

export async function refreshRecent(): Promise<void> {
  try {
    const rows = await operatorAuditList(RECENT_LIMIT);
    setRecent(rows.slice(0, RECENT_LIMIT));
  } catch {
    // Recent activity is advisory; a read failure keeps the last snapshot.
  }
}

export async function submitOperatorCommand(): Promise<void> {
  if (busy()) return;
  const text = input().trim();
  const parsed = parseCommand(text);
  if (parsed.kind === "empty") return;
  if (parsed.kind === "needsRouter") {
    setView({ kind: "needsRouter", reason: parsed.reason });
    return;
  }

  setBusy(true);
  try {
    const result = await dispatchIntent(parsed.intent, { inputText: text });
    if (result.status === "needsConfirmation") {
      setView({
        kind: "preview",
        intent: parsed.intent,
        summary: result.summary,
        inputText: text,
      });
    } else {
      applyResult(result);
    }
  } finally {
    setBusy(false);
    void refreshRecent();
  }
}

export async function confirmOperatorPreview(): Promise<void> {
  if (busy()) return;
  const current = view();
  if (current.kind !== "preview") return;

  setBusy(true);
  try {
    const result = await dispatchIntent(current.intent, {
      confirmed: true,
      inputText: current.inputText,
    });
    applyResult(result);
  } finally {
    setBusy(false);
    void refreshRecent();
  }
}

export function cancelOperatorPreview() {
  if (view().kind === "preview") setView({ kind: "idle" });
}

function applyResult(result: DispatchResult) {
  setView({ kind: "result", result });
  if (result.status === "done") setInput("");
}

export function relativeTime(then: number, now = Date.now()): string {
  const diff = Math.max(0, now - then);
  const sec = Math.round(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}
