import { createSignal } from "solid-js";

export interface VoiceDictationSettings {
  micEnabled: boolean;
  pushToCommand: boolean;
  modelPath: string;
}

const STORE_KEY = "pickforge.voiceDictation";

const DEFAULT_SETTINGS: VoiceDictationSettings = {
  micEnabled: true,
  pushToCommand: false,
  modelPath: "",
};

function boolValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
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
}

export function setVoicePushToCommand(pushToCommand: boolean) {
  setSettings((current) => {
    const next = { ...current, pushToCommand };
    persist(next);
    return next;
  });
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
