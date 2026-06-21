// Device-mirror pane: live emulator/phone screen via scrcpy-server, decoded with
// WebCodecs onto a canvas, with tap/swipe input. Rust owns the server + sockets
// (mirror_commands.rs); this drives the decode + input (lib/scrcpy.ts).
import { createSignal, onCleanup, Show } from "solid-js";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { EmberButton, MonoEyebrow } from "./ui";
import { mirrorSupported, startMirror, type MirrorHandle } from "../lib/scrcpy";
import { deviceLabel, resolveSelectedDevice } from "../stores/runLaunch";

export function DeviceMirror() {
  let canvas!: HTMLCanvasElement;
  const [active, setActive] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  let handle: MirrorHandle | null = null;
  let unlisten: UnlistenFn | undefined;
  let down = false;

  const device = () => resolveSelectedDevice();
  // Mirror only attaches to an online device (a stopped AVD has no screen).
  const serial = () => {
    const d = device();
    return d && d.state === "running" ? d.serial : null;
  };

  const stop = async () => {
    unlisten?.();
    unlisten = undefined;
    const h = handle;
    handle = null;
    setActive(false);
    await h?.stop();
  };

  const start = async () => {
    const s = serial();
    if (!s) {
      setError("Select a running device first.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      handle = await startMirror(s, canvas);
      setActive(true);
      unlisten = await listen<string>("mirror-disconnected", (e) => {
        if (e.payload === s) void stop();
      });
    } catch (e) {
      setError(String(e));
      await stop();
    } finally {
      setBusy(false);
    }
  };

  onCleanup(() => {
    unlisten?.();
    void handle?.stop();
  });

  const ratio = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };
  const onDown = (e: PointerEvent) => {
    if (!handle) return;
    down = true;
    canvas.setPointerCapture(e.pointerId);
    const { x, y } = ratio(e);
    handle.touch("down", x, y);
  };
  const onMove = (e: PointerEvent) => {
    if (!handle || !down) return;
    const { x, y } = ratio(e);
    handle.touch("move", x, y);
  };
  const onUp = (e: PointerEvent) => {
    if (!handle || !down) return;
    down = false;
    const { x, y } = ratio(e);
    handle.touch("up", x, y);
  };

  return (
    <div class="pf-mirror">
      <div class="pf-rail-head">
        <MonoEyebrow text="Device mirror" />
        <Show
          when={active()}
          fallback={
            <EmberButton
              label={busy() ? "Starting…" : "Start"}
              disabled={busy() || !serial()}
              onClick={() => void start()}
            />
          }
        >
          <button class="pf-text-btn" onClick={() => void stop()}>
            Stop
          </button>
        </Show>
      </div>

      <Show
        when={mirrorSupported()}
        fallback={
          <div class="pf-rail-empty">
            WebCodecs (H.264 VideoDecoder) isn't available in this webview, so the mirror can't decode here.
          </div>
        }
      >
        <div class="pf-mirror-stage">
          <canvas
            ref={canvas}
            class="pf-mirror-canvas"
            classList={{ "pf-mirror-canvas--live": active() }}
            onpointerdown={onDown}
            onpointermove={onMove}
            onpointerup={onUp}
            onpointercancel={onUp}
          />
          <Show when={!active() && !error()}>
            <div class="pf-rail-empty pf-mirror-hint">
              {serial() ? `Start to mirror ${deviceLabel(device()!)}` : "Select a running device"}
            </div>
          </Show>
        </div>
      </Show>
      <Show when={error()}>
        <div class="pf-vm-error">{error()}</div>
      </Show>
    </div>
  );
}
