import { Channel, invoke } from "@tauri-apps/api/core";

export type VoiceEvent =
  | {
      kind: "partial" | "final" | "error";
      sessionId: string;
      text: string;
      level: null;
    }
  | {
      kind: "level";
      sessionId: string;
      text: null;
      level: number;
    };

export type VoiceMissingDependency = "pw-record" | "whisper-cli" | "model";

export interface VoiceStatus {
  available: boolean;
  missing: VoiceMissingDependency[];
  modelPath: string | null;
  error: string | null;
}

export interface StartVoiceOptions {
  language?: string | null;
  modelPathOverride?: string | null;
}

export function startVoice(
  onEvent: (event: VoiceEvent) => void,
  options: StartVoiceOptions = {},
): Promise<string> {
  const channel = new Channel<VoiceEvent>();
  channel.onmessage = onEvent;
  return invoke<string>("voice_start", {
    language: options.language ?? null,
    modelPathOverride: options.modelPathOverride ?? null,
    onEvent: channel,
  });
}

export function stopVoice(sessionId: string): Promise<string> {
  return invoke<string>("voice_stop", { sessionId });
}

export function cancelVoice(sessionId: string): Promise<void> {
  return invoke("voice_cancel", { sessionId });
}

export function voiceStatus(modelPathOverride?: string | null): Promise<VoiceStatus> {
  return invoke<VoiceStatus>("voice_status", {
    modelPathOverride: modelPathOverride ?? null,
  });
}

// Ember talk-back: a sibling channel to VoiceEvent above, not a widened
// variant of it — dictation's partial/final/error/level events and speech's
// started/finished/error events are unrelated concerns that happen to share
// the same Channel<T> + session-id plumbing idiom.
export type SpeakEvent =
  | { kind: "started" | "finished"; sessionId: string; message: null }
  | { kind: "error"; sessionId: string; message: string };

export function speakVoice(
  text: string,
  onEvent: (event: SpeakEvent) => void,
): Promise<string> {
  const channel = new Channel<SpeakEvent>();
  channel.onmessage = onEvent;
  return invoke<string>("voice_speak", { text, onEvent: channel });
}

export function cancelSpeak(sessionId: string): Promise<void> {
  return invoke("voice_speak_cancel", { sessionId });
}
