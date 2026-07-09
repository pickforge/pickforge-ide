// Operator composer dock state: open/close, the command → dispatch flow, and the
// last-result view. Parsing/dispatch policy lives in operatorParser + operator;
// this store drives the state machine so OperatorDock stays presentational.
import { createSignal } from "solid-js";
import { parseCommand } from "../lib/operatorParser";
import { routeCommand } from "../lib/operatorRouter";
import { dispatchIntent, type DispatchResult } from "./operator";
import { flagEnabled } from "./flags";
import { operatorAuditList, type OperatorAuditRow } from "../lib/db";
import type { OperatorIntent } from "../lib/operatorIntent";
import { onRouteChange } from "../router";

export type DockView =
  | { kind: "idle" }
  | { kind: "needsRouter"; reason: string }
  | { kind: "validationError"; reason: string }
  | {
    kind: "preview";
    intent: OperatorIntent;
    summary: string;
    inputText: string;
    confidence?: number;
  }
  | { kind: "result"; result: DispatchResult };

const RECENT_LIMIT = 5;

const [open, setOpen] = createSignal(false);
export const operatorDockOpen = open;

const [input, setInput] = createSignal("");
export const operatorInput = input;
export function setOperatorInput(value: string) {
  if (value !== input() && view().kind !== "idle") setView({ kind: "idle" });
  setInput(value);
}

const [view, setView] = createSignal<DockView>({ kind: "idle" });
export const operatorView = view;

let requestEpoch = 0;

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
  requestEpoch++;
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

// The dock is a workbench surface but portals to the document root, and the
// workbench stays mounted (display:none) on other routes — close it whenever
// the route leaves the workbench so it can't float over another screen.
onRouteChange((r) => {
  if (r !== "workbench" && open()) closeOperatorDock();
});

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
  if (parsed.kind === "validationError") {
    setView({ kind: "validationError", reason: parsed.reason });
    return;
  }
  if (parsed.kind === "needsRouter") {
    const epoch = ++requestEpoch;
    setBusy(true);
    setView({ kind: "needsRouter", reason: "routing…" });
    try {
      const routed = await routeCommand(text);
      if (epoch !== requestEpoch) return;
      switch (routed.kind) {
        case "proposal":
          await submitIntent(
            routed.intent,
            text,
            epoch,
            routed.confidence < 1 ? routed.confidence : undefined,
          );
          return;
        case "unclear":
          setView({ kind: "needsRouter", reason: routed.reason });
          return;
        case "error":
          setView({ kind: "needsRouter", reason: routed.message });
          return;
        case "unconfigured":
          setView({
            kind: "needsRouter",
            reason: "Operator router is off. Choose a backend in Settings.",
          });
          return;
      }
    } finally {
      if (epoch === requestEpoch) setBusy(false);
      void refreshRecent();
    }
    return;
  }

  const epoch = ++requestEpoch;
  setBusy(true);
  try {
    await submitIntent(parsed.intent, text, epoch);
  } finally {
    if (epoch === requestEpoch) setBusy(false);
    void refreshRecent();
  }
}

export async function confirmOperatorPreview(): Promise<void> {
  if (busy()) return;
  const current = view();
  if (current.kind !== "preview") return;

  const epoch = ++requestEpoch;
  setBusy(true);
  try {
    const result = await dispatchIntent(current.intent, {
      confirmed: true,
      inputText: current.inputText,
    });
    if (epoch === requestEpoch) applyResult(result);
  } finally {
    if (epoch === requestEpoch) setBusy(false);
    void refreshRecent();
  }
}

export function cancelOperatorPreview() {
  if (busy()) return;
  if (view().kind === "preview") setView({ kind: "idle" });
}

function applyResult(result: DispatchResult) {
  setView({ kind: "result", result });
  if (result.status === "done") setInput("");
}

async function submitIntent(
  intent: OperatorIntent,
  text: string,
  epoch: number,
  confidence?: number,
) {
  const result = await dispatchIntent(intent, { inputText: text });
  if (epoch !== requestEpoch) return;
  if (result.status === "needsConfirmation") {
    setView({
      kind: "preview",
      intent,
      summary: result.summary,
      inputText: text,
      confidence,
    });
  } else {
    applyResult(result);
  }
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
