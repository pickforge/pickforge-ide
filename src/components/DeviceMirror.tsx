// Device-mirror pane: live emulator/phone screen via scrcpy-server, decoded with
// WebCodecs onto a canvas, with tap/swipe input. Rust owns the server + sockets
// (mirror_commands.rs); this drives the decode + input (lib/scrcpy.ts).
import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { EmberButton, MonoEyebrow } from "./ui";
import { mirrorSupported, startMirror, type MirrorHandle, type MirrorStats } from "../lib/scrcpy";
import { remotePtyFor } from "../lib/remoteContext";
import { deviceLabel, resolveSelectedDevice } from "../stores/runLaunch";
import { workspace } from "../stores/workspace";

// eslint-disable-next-line max-lines-per-function -- TODO(#263): reduce legacy function complexity.
export function DeviceMirror() {
  let canvas!: HTMLCanvasElement;
  const [active, setActive] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [stats, setStats] = createSignal<MirrorStats | null>(null);
  let handle: MirrorHandle | null = null;
  let unlisten: UnlistenFn | undefined;
  let poll: ReturnType<typeof setInterval> | undefined;
  let epoch = 0;
  let down = false;

  const remote = () => remotePtyFor(workspace.activeRoot);
  const device = () => resolveSelectedDevice();
  // Mirror only attaches to an online device (a stopped AVD has no screen).
  const serial = () => {
    const d = device();
    return d && d.state === "running" ? d.serial : null;
  };

  const stop = async () => {
    epoch += 1;
    unlisten?.();
    unlisten = undefined;
    clearInterval(poll);
    poll = undefined;
    setStats(null);
    const h = handle;
    handle = null;
    setActive(false);
    await h?.stop();
  };

  const start = async () => {
    if (remote()) return;
    const s = serial();
    if (!s) {
      setError("Select a running device first.");
      return;
    }
    setError(null);
    setBusy(true);
    const startEpoch = ++epoch;
    try {
      const started = await startMirror(s, canvas);
      if (startEpoch !== epoch || remote()) {
        await started.stop();
        return;
      }
      handle = started;
      setActive(true);
      poll = setInterval(() => setStats(handle?.stats() ?? null), 700);
      const nextUnlisten = await listen<string>("mirror-disconnected", (e) => {
        if (e.payload === s) void stop();
      });
      if (startEpoch !== epoch || remote()) {
        nextUnlisten();
        if (handle === started) await stop();
        return;
      }
      unlisten = nextUnlisten;
    } catch (e) {
      setError(String(e));
      await stop();
    } finally {
      setBusy(false);
    }
  };

  createEffect(() => {
    if (!remote()) return;
    setError(null);
    void stop();
  });

  onCleanup(() => {
    epoch += 1;
    unlisten?.();
    clearInterval(poll);
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
        <Show when={!remote()}>
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
        </Show>
      </div>

      <Show
        when={!remote()}
        fallback={
          <div class="pf-rail-empty">Remote device mirroring is not available yet.</div>
        }
      >
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
      </Show>
      {/* The stats strip is reserved for the whole session (fixed-height, single
          line) so toggling a stat — e.g. "skipped N" — never reflows and resizes
          the mirror stage. */}
      <Show when={!remote() && active()}>
        <div class="pf-mirror-stats">
          <Show when={stats()}>
            {(s) => (
              <>
                <span>{s().renderer}</span>
                <span>avc {s().avc}</span>
                <span>
                  {s().width}×{s().height}
                </span>
                <span>frames {s().rendered}</span>
                <Show when={s().skipped > 0}>
                  <span>skipped {s().skipped}</span>
                </Show>
                <Show when={s().error}>
                  <span class="pf-mirror-stats-err">{s().error}</span>
                </Show>
              </>
            )}
          </Show>
        </div>
      </Show>
      <Show when={!remote() && error()}>
        <div class="pf-vm-error">{error()}</div>
      </Show>
    </div>
  );
}
