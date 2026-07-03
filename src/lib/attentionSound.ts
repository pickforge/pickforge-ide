let audioContext: AudioContext | null = null;

type WebAudioWindow = Window & typeof globalThis & {
  webkitAudioContext?: typeof AudioContext;
};

function context(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AudioCtor = window.AudioContext ?? (window as WebAudioWindow).webkitAudioContext;
  if (!AudioCtor) return null;
  try {
    audioContext ??= new AudioCtor();
    return audioContext;
  } catch {
    return null;
  }
}

let activeRings = 0;
// The in-flight suspend() from the last chime's end — a new chime must wait for
// it to settle, or its oscillator lands in a context that then goes silent.
let parking: Promise<void> | null = null;

function ring(ctx: AudioContext) {
  const start = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(740, start);
  osc.frequency.exponentialRampToValueAtTime(988, start + 0.1);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(0.08, start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.24);
  osc.connect(gain);
  gain.connect(ctx.destination);
  activeRings++;
  osc.onended = () => {
    osc.disconnect();
    gain.disconnect();
    // Park the context between chimes — a running AudioContext keeps the OS
    // audio stream and its render thread alive for the app's lifetime.
    if (--activeRings === 0) {
      const parked: Promise<void> = ctx
        .suspend()
        .catch(() => undefined)
        .then(() => {
          if (parking === parked) parking = null;
        });
      parking = parked;
    }
  };
  osc.start(start);
  osc.stop(start + 0.26);
}

export function playAttentionSound() {
  const ctx = context();
  if (!ctx) return;
  const start = () => {
    if (ctx.state === "suspended") {
      void ctx.resume().then(() => ring(ctx)).catch(() => undefined);
      return;
    }
    try {
      ring(ctx);
    } catch {
      return;
    }
  };
  if (parking) void parking.then(start);
  else start();
}
