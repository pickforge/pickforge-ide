import { createSignal } from "solid-js";
import { noteSettingsEdit } from "../lib/settingsSyncEdits";

export type VoiceOutputMode = "off" | "local";

export interface VoiceDictationSettings {
  micEnabled: boolean;
  pushToCommand: boolean;
  modelPath: string;
  /** Ember talk-back, off by default: "local" speaks safe/read-only command
   *  outcomes back via OS TTS, push-to-talk (voice-in -> voice-out only —
   *  typed commands never trigger speech regardless of this setting). */
  voiceOutput: VoiceOutputMode;
}

const STORE_KEY = "pickforge.voiceDictation";

const DEFAULT_SETTINGS: VoiceDictationSettings = {
  micEnabled: true,
  pushToCommand: false,
  modelPath: "",
  voiceOutput: "off",
};

function boolValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function voiceOutputValue(value: unknown, fallback: VoiceOutputMode): VoiceOutputMode {
  return value === "off" || value === "local" ? value : fallback;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalize(value: unknown): VoiceDictationSettings {
  const saved = record(value);
  return {
    micEnabled: boolValue(saved.micEnabled, DEFAULT_SETTINGS.micEnabled),
    pushToCommand: boolValue(saved.pushToCommand, DEFAULT_SETTINGS.pushToCommand),
    modelPath: typeof saved.modelPath === "string" ? saved.modelPath : DEFAULT_SETTINGS.modelPath,
    voiceOutput: voiceOutputValue(saved.voiceOutput, DEFAULT_SETTINGS.voiceOutput),
  };
}

export function loadVoiceDictationSettings(): VoiceDictationSettings {
  try {
    return normalize(JSON.parse(localStorage.getItem(STORE_KEY) ?? "{}"));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function persist(settings: VoiceDictationSettings) {
  localStorage.setItem(STORE_KEY, JSON.stringify(settings));
}

const [settings, setSettings] = createSignal(loadVoiceDictationSettings());
export const voiceDictationSettings = settings;

export function setVoiceMicEnabled(micEnabled: boolean) {
  setSettings((current) => {
    const next = { ...current, micEnabled };
    persist(next);
    return next;
  });
  noteSettingsEdit("operatorConfig");
}

export function setVoicePushToCommand(pushToCommand: boolean) {
  setSettings((current) => {
    const next = { ...current, pushToCommand };
    persist(next);
    return next;
  });
  noteSettingsEdit("operatorConfig");
}

export function setVoiceModelPath(modelPath: string) {
  setSettings((current) => {
    const next = { ...current, modelPath };
    persist(next);
    return next;
  });
}

export function voiceModelOverride(): string | null {
  const path = settings().modelPath.trim();
  return path.length > 0 ? path : null;
}

export function setVoiceOutput(voiceOutput: VoiceOutputMode) {
  setSettings((current) => {
    const next = { ...current, voiceOutput };
    persist(next);
    return next;
  });
  noteSettingsEdit("operatorConfig");
}

export function voiceOutputEnabled(): boolean {
  return settings().voiceOutput === "local";
}
