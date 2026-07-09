import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VoiceEvent, VoiceStatus } from "../../src/lib/voice";

const deps = vi.hoisted(() => ({
  startVoice: vi.fn(),
  stopVoice: vi.fn(),
  cancelVoice: vi.fn(),
  voiceStatus: vi.fn(),
  setOperatorInput: vi.fn(),
  submitOperatorCommand: vi.fn(),
  settings: { micEnabled: true, pushToCommand: false, modelPath: "" },
}));

vi.mock("../../src/lib/voice", () => ({
  startVoice: deps.startVoice,
  stopVoice: deps.stopVoice,
  cancelVoice: deps.cancelVoice,
  voiceStatus: deps.voiceStatus,
}));
vi.mock("../../src/stores/operatorDock", () => ({
  setOperatorInput: deps.setOperatorInput,
  submitOperatorCommand: deps.submitOperatorCommand,
}));
vi.mock("../../src/stores/voiceSettings", () => ({
  voiceDictationSettings: () => deps.settings,
  voiceModelOverride: () => {
    const path = deps.settings.modelPath.trim();
    return path.length > 0 ? path : null;
  },
}));

const AVAILABLE: VoiceStatus = {
  available: true,
  missing: [],
  modelPath: "/models/ggml-base.bin",
  error: null,
};

function partial(text: string, sessionId = "sess-1"): VoiceEvent {
  return { kind: "partial", sessionId, text, level: null };
}
function final(text: string, sessionId = "sess-1"): VoiceEvent {
  return { kind: "final", sessionId, text, level: null };
}
function errorEvent(text: string, sessionId = "sess-1"): VoiceEvent {
  return { kind: "error", sessionId, text, level: null };
}

let emit: (event: VoiceEvent) => void = () => {};

function captureSink(sessionId = "sess-1") {
  deps.startVoice.mockImplementation((onEvent: (event: VoiceEvent) => void) => {
    emit = onEvent;
    return Promise.resolve(sessionId);
  });
}

async function loadStore() {
  vi.resetModules();
  return import("../../src/stores/voiceDock");
}

async function flushAsync() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  deps.startVoice.mockReset();
  deps.stopVoice.mockReset();
  deps.cancelVoice.mockReset().mockResolvedValue(undefined);
  deps.voiceStatus.mockReset().mockResolvedValue(AVAILABLE);
  deps.setOperatorInput.mockReset();
  deps.submitOperatorCommand.mockReset();
  deps.settings = { micEnabled: true, pushToCommand: false, modelPath: "" };
  emit = () => {};
});

describe("voiceDock store", () => {
  it("starts a single session when two starts race the status check", async () => {
    captureSink();
    let resolveStatus!: (status: VoiceStatus) => void;
    deps.voiceStatus.mockReturnValue(
      new Promise<VoiceStatus>((resolve) => {
        resolveStatus = resolve;
      }),
    );
    const s = await loadStore();

    const first = s.startDictation();
    const second = s.startDictation();
    resolveStatus(AVAILABLE);
    await first;
    await second;

    expect(deps.startVoice).toHaveBeenCalledOnce();
    expect(s.voiceDockPhase()).toBe("recording");
  });

  it("treats a rapid double toggle as a single start, and a toggle mid-start as a noop", async () => {
    captureSink();
    let resolveStatus!: (status: VoiceStatus) => void;
    deps.voiceStatus.mockReturnValue(
      new Promise<VoiceStatus>((resolve) => {
        resolveStatus = resolve;
      }),
    );
    const s = await loadStore();

    s.toggleDictation();
    s.toggleDictation();
    await flushAsync();
    expect(s.voiceDockPhase()).toBe("idle");

    resolveStatus(AVAILABLE);
    await flushAsync();

    expect(deps.startVoice).toHaveBeenCalledOnce();
    expect(deps.stopVoice).not.toHaveBeenCalled();
    expect(s.voiceDockPhase()).toBe("recording");
  });

  it("runs the full flow: partials replace the preview, final lands in the input", async () => {
    captureSink();
    deps.stopVoice.mockResolvedValue("hello world");
    const s = await loadStore();

    await s.startDictation();
    expect(s.voiceDockPhase()).toBe("recording");
    expect(deps.startVoice).toHaveBeenCalledWith(expect.any(Function), {
      modelPathOverride: null,
    });

    emit(partial("hello"));
    expect(s.voiceDockPreview()).toBe("hello");
    emit(partial("hello world"));
    expect(s.voiceDockPreview()).toBe("hello world");

    await s.stopDictation();

    expect(deps.stopVoice).toHaveBeenCalledWith("sess-1");
    expect(deps.setOperatorInput).toHaveBeenCalledExactlyOnceWith("hello world");
    expect(deps.submitOperatorCommand).not.toHaveBeenCalled();
    expect(s.voiceDockPhase()).toBe("idle");
    expect(s.voiceDockPreview()).toBe("");
  });

  it("applies the final exactly once when stop() and the final event both deliver it", async () => {
    captureSink();
    deps.stopVoice.mockImplementation(async () => {
      emit(final("done text"));
      return "done text";
    });
    const s = await loadStore();

    await s.startDictation();
    await s.stopDictation();

    expect(deps.setOperatorInput).toHaveBeenCalledExactlyOnceWith("done text");
  });

  it("passes the configured model override to status and start", async () => {
    captureSink();
    deps.settings.modelPath = "  /custom/model.bin  ";
    const s = await loadStore();

    await s.startDictation();

    expect(deps.voiceStatus).toHaveBeenCalledWith("/custom/model.bin");
    expect(deps.startVoice).toHaveBeenCalledWith(expect.any(Function), {
      modelPathOverride: "/custom/model.bin",
    });
  });

  it("cancel mid-recording clears the preview, cancels the session, and never touches the input", async () => {
    captureSink();
    const s = await loadStore();

    await s.startDictation();
    emit(partial("half a sentence"));
    expect(s.voiceDockPreview()).toBe("half a sentence");

    await s.cancelDictation();

    expect(deps.cancelVoice).toHaveBeenCalledWith("sess-1");
    expect(s.voiceDockPhase()).toBe("idle");
    expect(s.voiceDockPreview()).toBe("");
    expect(deps.setOperatorInput).not.toHaveBeenCalled();

    // A late final event after cancel must be ignored.
    emit(final("stale transcript"));
    expect(deps.setOperatorInput).not.toHaveBeenCalled();
  });

  it("surfaces an error event quietly without touching the input", async () => {
    captureSink();
    const s = await loadStore();

    await s.startDictation();
    emit(errorEvent("whisper-cli crashed"));

    expect(s.voiceDockPhase()).toBe("error");
    expect(s.voiceDockError()).toBe("whisper-cli crashed");
    expect(s.voiceDockPreview()).toBe("");
    expect(deps.setOperatorInput).not.toHaveBeenCalled();
  });

  it("surfaces a rejected stop() as an error", async () => {
    captureSink();
    deps.stopVoice.mockRejectedValue(new Error("pipeline failed"));
    const s = await loadStore();

    await s.startDictation();
    await s.stopDictation();

    expect(s.voiceDockPhase()).toBe("error");
    expect(s.voiceDockError()).toBe("pipeline failed");
    expect(deps.setOperatorInput).not.toHaveBeenCalled();
  });

  it("auto-submits the composer on final when push-to-command is enabled", async () => {
    captureSink();
    deps.settings.pushToCommand = true;
    deps.stopVoice.mockResolvedValue("open project app");
    const s = await loadStore();

    await s.startDictation();
    await s.stopDictation();

    expect(deps.setOperatorInput).toHaveBeenCalledExactlyOnceWith("open project app");
    expect(deps.submitOperatorCommand).toHaveBeenCalledOnce();
  });

  it("does not submit or set the input when the final transcript is empty", async () => {
    captureSink();
    deps.settings.pushToCommand = true;
    deps.stopVoice.mockResolvedValue("   ");
    const s = await loadStore();

    await s.startDictation();
    await s.stopDictation();

    expect(deps.setOperatorInput).not.toHaveBeenCalled();
    expect(deps.submitOperatorCommand).not.toHaveBeenCalled();
    expect(s.voiceDockPhase()).toBe("idle");
  });

  it("short-circuits into an error when dictation is unavailable", async () => {
    deps.voiceStatus.mockResolvedValue({
      available: false,
      missing: ["whisper-cli", "model"],
      modelPath: null,
      error: null,
    } satisfies VoiceStatus);
    const s = await loadStore();

    await s.startDictation();

    expect(s.voiceDockPhase()).toBe("error");
    expect(s.voiceDockError()).toContain("whisper-cli");
    expect(s.voiceDockError()).toContain("model");
    expect(deps.startVoice).not.toHaveBeenCalled();
  });

  it("toggles start then stop, and ignores toggles while finalizing", async () => {
    captureSink();
    let resolveStop!: (text: string) => void;
    deps.stopVoice.mockReturnValue(
      new Promise<string>((resolve) => {
        resolveStop = resolve;
      }),
    );
    const s = await loadStore();

    s.toggleDictation();
    await flushAsync();
    expect(s.voiceDockPhase()).toBe("recording");

    s.toggleDictation();
    await flushAsync();
    expect(s.voiceDockPhase()).toBe("finalizing");

    // A toggle mid-finalize must not spawn a second session.
    s.toggleDictation();
    await flushAsync();
    expect(deps.startVoice).toHaveBeenCalledOnce();

    resolveStop("captured");
    await flushAsync();
    expect(deps.setOperatorInput).toHaveBeenCalledExactlyOnceWith("captured");
    expect(s.voiceDockPhase()).toBe("idle");
  });

  it("refreshVoiceStatus records availability and normalizes a thrown error", async () => {
    deps.voiceStatus.mockRejectedValue(new Error("ipc down"));
    const s = await loadStore();

    const status = await s.refreshVoiceStatus();

    expect(status).toEqual({
      available: false,
      missing: [],
      modelPath: null,
      error: "ipc down",
    });
    expect(s.voiceAvailability()?.available).toBe(false);
  });
});
