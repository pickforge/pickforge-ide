// Dictation state for the operator dock: idle → recording → finalizing →
// done/error. Wires the local voice pipeline (src/lib/voice) to the composer —
// partials stream into a live preview, the final transcript lands in the
// operator input, and errors surface quietly. Everything here rides the
// operator flag via the dock that mounts it.
import { createSignal } from "solid-js";
import {
  cancelVoice,
  startVoice,
  stopVoice,
  voiceStatus,
  type VoiceEvent,
  type VoiceStatus,
} from "../lib/voice";
import { setOperatorInput, submitOperatorCommand } from "./operatorDock";
import { voiceDictationSettings, voiceModelOverride } from "./voiceSettings";

export type VoiceDockPhase = "idle" | "recording" | "finalizing" | "error";

const [phase, setPhase] = createSignal<VoiceDockPhase>("idle");
export const voiceDockPhase = phase;

const [preview, setPreview] = createSignal("");
export const voiceDockPreview = preview;

const [error, setError] = createSignal<string | null>(null);
export const voiceDockError = error;

const [availability, setAvailability] = createSignal<VoiceStatus | null>(null);
export const voiceAvailability = availability;

export const voiceDockActive = () => phase() === "recording" || phase() === "finalizing";

// A busy operator (submitting/confirming) blocks STARTING a recording, but
// never locks out STOPPING one that is already live — otherwise the mic goes
// dead while pw-record keeps rolling.
export function micBusyLocked(operatorBusy: boolean): boolean {
  return operatorBusy && !voiceDockActive();
}

// A session in flight; the epoch supersedes stale channel events and pending
// awaits when the user cancels/restarts, and `finalized` makes the final land
// exactly once (stop() returns the transcript *and* emits a final event).
let sessionId: string | null = null;
let epoch = 0;
let finalized = false;
// Synchronous start latch: the phase only flips to "recording" after the
// status check resolves, so without it two quick toggles could both pass the
// guard and spawn concurrent voice sessions. Set before any await, cleared
// when the start settles.
let starting = false;

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "dictation failed";
}

function unavailableMessage(status: VoiceStatus): string {
  if (status.error) return status.error;
  if (status.missing.length > 0) return `dictation needs ${status.missing.join(", ")}`;
  return "dictation is unavailable";
}

export async function refreshVoiceStatus(): Promise<VoiceStatus | null> {
  try {
    const status = await voiceStatus(voiceModelOverride());
    setAvailability(status);
    return status;
  } catch (error) {
    const status: VoiceStatus = {
      available: false,
      missing: [],
      modelPath: null,
      error: errorText(error),
    };
    setAvailability(status);
    return status;
  }
}

export async function startDictation(): Promise<void> {
  if (starting || voiceDockActive()) return;
  starting = true;
  // Claim the epoch before the first await so a dock reset during the status
  // check (or the startVoice call) supersedes this start instead of letting a
  // late-resolving session record into a closed dock.
  const mine = ++epoch;
  try {
    setError(null);
    const model = voiceModelOverride();
    const status = await refreshVoiceStatus();
    if (mine !== epoch) return;
    if (!status?.available) {
      setPhase("error");
      setError(status ? unavailableMessage(status) : "dictation is unavailable");
      return;
    }

    finalized = false;
    sessionId = null;
    setPreview("");
    setPhase("recording");
    try {
      const id = await startVoice(onVoiceEvent(mine), { modelPathOverride: model });
      // Superseded (reset/restart) or already settled (an error event beat the
      // resolve): never adopt the dead session's id — cancel it instead so a
      // later stop can't act on it.
      if (mine !== epoch || finalized) {
        void cancelVoice(id).catch(() => {});
        return;
      }
      sessionId = id;
    } catch (error) {
      applyError(errorText(error), mine);
    }
  } finally {
    starting = false;
  }
}

export async function stopDictation(): Promise<void> {
  if (phase() !== "recording" || !sessionId) return;
  const id = sessionId;
  const mine = epoch;
  setPhase("finalizing");
  try {
    const text = await stopVoice(id);
    applyFinal(text, mine);
  } catch (error) {
    applyError(errorText(error), mine);
  }
}

export async function cancelDictation(): Promise<void> {
  if (!voiceDockActive()) return;
  setError(null);
  const id = teardown();
  if (id) {
    try {
      await cancelVoice(id);
    } catch {
      // Cancellation is best-effort; the session is already abandoned here.
    }
  }
}

export function toggleDictation(): void {
  if (starting) return;
  const current = phase();
  if (current === "recording") {
    void stopDictation();
    return;
  }
  if (current === "finalizing") return;
  void startDictation();
}

// Abandon any in-flight session and reset to idle. Called when the dock closes.
export function resetVoiceDock(): void {
  const id = teardown();
  setError(null);
  if (id) void cancelVoice(id).catch(() => {});
}

function teardown(): string | null {
  const id = sessionId;
  epoch++;
  finalized = true;
  sessionId = null;
  setPreview("");
  setPhase("idle");
  return id;
}

function onVoiceEvent(mine: number) {
  return (event: VoiceEvent) => {
    if (mine !== epoch) return;
    switch (event.kind) {
      case "partial":
        // Partial text is the cumulative transcript so far, so it replaces the
        // preview rather than appending (appending would duplicate).
        if (event.text != null) setPreview(event.text);
        break;
      case "final":
        if (event.text != null) applyFinal(event.text, mine);
        break;
      case "error": {
        // Unsolicited backend error (e.g. a segment transcription failure):
        // besides surfacing it quietly, cancel the session so its registry
        // entry doesn't linger unreachable — no stop/cancel would settle it.
        const id = mine === epoch && !finalized ? sessionId : null;
        applyError(event.text ?? "dictation failed", mine);
        if (id) void cancelVoice(id).catch(() => {});
        break;
      }
      case "level":
        break;
    }
  };
}

function applyFinal(text: string, mine: number): void {
  if (mine !== epoch || finalized) return;
  finalized = true;
  sessionId = null;
  setPreview("");
  setPhase("idle");
  const trimmed = text.trim();
  if (!trimmed) return;
  setOperatorInput(trimmed);
  if (voiceDictationSettings().pushToCommand) void submitOperatorCommand();
}

function applyError(message: string, mine: number): void {
  if (mine !== epoch || finalized) return;
  finalized = true;
  sessionId = null;
  setPreview("");
  setPhase("error");
  setError(message);
}
