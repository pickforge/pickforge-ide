// Operator composer dock state: open/close, the command → dispatch flow, and the
// last-result view. Parsing/dispatch policy lives in operatorParser + operator;
// this store drives the state machine so OperatorDock stays presentational.
import { createSignal } from "solid-js";
import { parseCommand } from "../lib/operatorParser";
import { routeCommand, type RouteOutcome } from "../lib/operatorRouter";
import {
  discardWidgetSelection,
  dispatchIntent,
  selectWidgetCandidate,
  type DispatchResult,
  type WidgetSelectionCandidate,
} from "./operator";
import { flagEnabled } from "./flags";
import { creditBalanceCents, refreshCreditBalance } from "./credits";
import { operatorAuditList, operatorAuditUpdate, type OperatorAuditRow } from "../lib/db";
import { errorText } from "../lib/errors";
import { riskTier, type OperatorIntent, type OperatorProvenance } from "../lib/operatorIntent";
import { spokenForm } from "../lib/spokenForm";
import { navigateSettingsSection, onRouteChange } from "../router";
import { speakReply } from "./voiceDock";
import { voiceOutputEnabled } from "./voiceSettings";

export interface HostedRouteMeta {
  costCents: number;
  balanceCents: number | null;
}

export type DockView =
  | { kind: "idle" }
  | { kind: "needsRouter"; reason: string }
  | { kind: "needsCredits"; balance: number }
  | { kind: "validationError"; reason: string }
  | {
    kind: "preview";
    intent: OperatorIntent;
    summary: string;
    inputText: string;
    confidence?: number;
    auditId: string;
    candidates?: WidgetSelectionCandidate[];
  }
  | { kind: "result"; result: DispatchResult };

type PreviewDockView = Extract<DockView, { kind: "preview" }>;

const RECENT_LIMIT = 5;

const [open, setOpen] = createSignal(false);
export const operatorDockOpen = open;

const [input, setInput] = createSignal("");
export const operatorInput = input;

// Tracks whether the current input text is mic-originated — the loop gate
// for Ember talk-back (voice-in -> voice-out only; typed commands stay
// silent). Any typed edit through `setOperatorInput` reverts it to "typed";
// only voiceDock landing a final dictation transcript marks it "voice".
const [inputOrigin, setInputOrigin] = createSignal<OperatorProvenance>("typed");

export function setOperatorInput(value: string) {
  if (value !== input() && view().kind !== "idle") resetView();
  setInput(value);
  setInputOrigin("typed");
}

/** Called only by voiceDock landing a final dictation transcript. */
export function setOperatorInputFromVoice(value: string) {
  if (value !== input() && view().kind !== "idle") resetView();
  setInput(value);
  setInputOrigin("voice");
}

const [view, setView] = createSignal<DockView>({ kind: "idle" });
export const operatorView = view;

const [routeMeta, setRouteMeta] = createSignal<HostedRouteMeta | null>(null);
export const operatorRouteMeta = routeMeta;

export function openBuyCredits() {
  closeOperatorDock();
  navigateSettingsSection("account");
}

function billedCost(routed: RouteOutcome): number | undefined {
  return routed.kind === "proposal" || routed.kind === "unclear" || routed.kind === "error"
    ? routed.costCents
    : undefined;
}

let requestEpoch = 0;

const [recent, setRecent] = createSignal<OperatorAuditRow[]>([]);
export const operatorRecent = recent;

const [busy, setBusy] = createSignal(false);
export const operatorBusy = busy;

const settledPreviewAudits = new Set<string>();

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
  setInputOrigin("typed");
  setRouteMeta(null);
  resetView();
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

/** Routes free-text through the hosted router, reconciles billing, and
 * dispatches the routed outcome (proposal/needsCredits/unclear/error/
 * unconfigured). Billing is reconciled BEFORE the epoch guard: a hosted
 * route that completed server-side already charged, so the balance must
 * refresh even if the dock was closed mid-flight — only the dropped UI is
 * gated on the epoch. */
async function submitViaRouter(text: string, provenance: OperatorProvenance): Promise<void> {
  const epoch = ++requestEpoch;
  setBusy(true);
  setRouteMeta(null);
  setView({ kind: "needsRouter", reason: "routing…" });
  try {
    const routed = await routeCommand(text, provenance);
    const cost = billedCost(routed);
    if (cost !== undefined) await refreshCreditBalance();
    if (epoch !== requestEpoch) return;
    if (cost !== undefined) {
      setRouteMeta({ costCents: cost, balanceCents: creditBalanceCents() });
    }
    switch (routed.kind) {
      case "proposal":
        await submitIntent(
          routed.intent,
          text,
          epoch,
          routed.confidence < 1 ? routed.confidence : undefined,
        );
        return;
      case "needsCredits":
        setView({ kind: "needsCredits", balance: routed.balance });
        speakIfEligible(provenance, spokenForm(routed));
        return;
      case "unclear":
        setView({ kind: "needsRouter", reason: routed.reason });
        speakIfEligible(provenance, spokenForm(routed));
        return;
      case "error":
        setView({ kind: "needsRouter", reason: routed.message });
        speakIfEligible(provenance, spokenForm(routed));
        return;
      case "unconfigured":
        setView({
          kind: "needsRouter",
          reason: "Operator router is off. Choose a backend in Settings.",
        });
        speakIfEligible(provenance, spokenForm(routed));
        return;
    }
  } finally {
    if (epoch === requestEpoch) setBusy(false);
    void refreshRecent();
  }
}

export async function submitOperatorCommand(): Promise<void> {
  if (busy()) return;
  const text = input().trim();
  const provenance = inputOrigin();
  // Consumed here: a later re-submit of leftover text (e.g. hitting Enter
  // again on an "unclear" result) is a fresh, typed action unless voiceDock
  // lands another transcript first.
  setInputOrigin("typed");
  const parsed = parseCommand(text, provenance);
  if (parsed.kind === "empty") return;
  if (parsed.kind === "validationError") {
    setView({ kind: "validationError", reason: parsed.reason });
    return;
  }
  if (parsed.kind === "needsRouter") {
    await submitViaRouter(text, provenance);
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
  if (current.candidates) return;

  const auditId = current.auditId;
  const epoch = ++requestEpoch;
  setBusy(true);
  try {
    const result = await dispatchIntent(current.intent, {
      confirmed: true,
      inputText: current.inputText,
      reuseAuditId: auditId,
    });
    if (epoch === requestEpoch) applyResult(result);
  } finally {
    if (epoch === requestEpoch) setBusy(false);
    void refreshRecent();
  }
}

export async function cancelOperatorPreview(): Promise<void> {
  if (busy()) return;
  const current = takePreview();
  if (!current) return;
  await settlePreviewAuditNow(current.auditId, "denied", "dismissed");
}

export function candidateIndexForKey(
  key: string,
  candidates: WidgetSelectionCandidate[],
): number | null {
  if (!/^[1-3]$/.test(key)) return null;
  return candidates[Number(key) - 1]?.index ?? null;
}

export async function pickOperatorWidgetCandidate(index: number): Promise<void> {
  if (busy()) return;
  const current = view();
  if (current.kind !== "preview" || !current.candidates) return;
  if (!current.candidates.some((candidate) => candidate.index === index)) return;

  const epoch = ++requestEpoch;
  setBusy(true);
  try {
    let result: DispatchResult;
    try {
      result = await selectWidgetCandidate(current.auditId, index);
    } catch (error) {
      result = {
        status: "failed",
        message: errorText(error),
      };
    }
    await settlePreviewAuditNow(
      current.auditId,
      candidateAuditStatus(result),
      candidateResultText(result),
    );
    if (epoch === requestEpoch) applyResult(result);
  } finally {
    if (epoch === requestEpoch) setBusy(false);
    void refreshRecent();
  }
}

function resetView() {
  setRouteMeta(null);
  if (!dismissPreview()) setView({ kind: "idle" });
}

function dismissPreview(): boolean {
  if (busy()) return false;
  const current = takePreview();
  if (!current) return false;
  settlePreviewAudit(current.auditId, "denied", "dismissed");
  return true;
}

function takePreview(): PreviewDockView | null {
  const current = view();
  if (current.kind !== "preview") return null;
  setView({ kind: "idle" });
  setRouteMeta(null);
  if (current.candidates) discardWidgetSelection(current.auditId);
  return current;
}

function candidateAuditStatus(result: DispatchResult): OperatorAuditRow["status"] {
  switch (result.status) {
    case "done":
      return "done";
    case "noop":
      return "noop";
    case "denied":
      return "denied";
    case "failed":
    case "unsupported":
      return "failed";
    case "needsConfirmation":
      return "needs_confirmation";
  }
}

function candidateResultText(result: DispatchResult): string {
  return "summary" in result ? result.summary : result.message;
}

function settlePreviewAudit(
  auditId: string,
  status: OperatorAuditRow["status"],
  result: string,
): void {
  if (!claimPreviewAudit(auditId)) return;
  void updatePreviewAudit(auditId, status, result);
}

async function settlePreviewAuditNow(
  auditId: string,
  status: OperatorAuditRow["status"],
  result: string,
): Promise<void> {
  if (!claimPreviewAudit(auditId)) return;
  await updatePreviewAudit(auditId, status, result);
}

function claimPreviewAudit(auditId: string): boolean {
  if (settledPreviewAudits.has(auditId)) return false;
  settledPreviewAudits.add(auditId);
  return true;
}

async function updatePreviewAudit(
  auditId: string,
  status: OperatorAuditRow["status"],
  result: string,
): Promise<void> {
  try {
    await operatorAuditUpdate(auditId, status, result);
  } catch (error) {
    console.warn("[pickforge] operator audit update failed", error);
  } finally {
    await refreshRecent();
  }
}

function applyResult(result: DispatchResult) {
  setView({ kind: "result", result });
  if (result.status === "done") setInput("");
}

/** Ember talk-back's loop gate: speaks `text` only for a mic-originated
 *  command, only when the voiceOutput setting is on. The safe-action gate
 *  (risk tier 0 only) already happened inside `spokenForm` — `text` is null
 *  for anything that shouldn't be spoken at all. */
function speakIfEligible(provenance: OperatorProvenance, text: string | null): void {
  if (!text || provenance !== "voice" || !voiceOutputEnabled()) return;
  void speakReply(text);
}

async function submitIntent(
  intent: OperatorIntent,
  text: string,
  epoch: number,
  confidence?: number,
) {
  const result = await dispatchIntent(intent, { inputText: text });
  if (epoch !== requestEpoch) {
    if (result.status === "needsConfirmation") {
      discardWidgetSelection(result.auditId);
      settlePreviewAudit(result.auditId, "denied", "dismissed");
    }
    return;
  }
  if (result.status === "needsConfirmation") {
    // Confirmation always stays on-screen — safe action or not, this is
    // never spoken; only a directly-dispatched terminal result is eligible.
    setView({
      kind: "preview",
      intent,
      summary: result.summary,
      inputText: text,
      confidence,
      auditId: result.auditId,
      candidates: result.candidates,
    });
  } else {
    applyResult(result);
    speakIfEligible(
      intent.provenance,
      spokenForm({ kind: "dispatch", result, riskTier: riskTier(intent.action) }),
    );
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
