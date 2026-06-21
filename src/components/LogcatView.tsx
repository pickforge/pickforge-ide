// Device-log (logcat) view for React Native / native-Android runs, whose device
// logs don't reach the run PTY. Read-only, mono, console-styled — the textual
// sibling of the Debug Console. Rust streams parsed lines (logcat_commands.rs);
// this buffers them (capped, drop-oldest), colours by level, and follows the
// tail unless the user scrolls up. Starts on an online selected device, stops on
// device-disconnect / unmount.
import { createEffect, createSignal, For, on, onCleanup, Show } from "solid-js";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { MonoEyebrow } from "./ui";
import { startLogcat, stopLogcat, type LogEvent } from "../lib/logcat";
import { deviceLabel, resolveSelectedDevice } from "../stores/runLaunch";

const MAX_LINES = 5000;

interface BufferedLine extends LogEvent {
  id: number;
}

export function LogcatView() {
  let scroller!: HTMLDivElement;
  const [lines, setLines] = createSignal<BufferedLine[]>([]);
  const [active, setActive] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [follow, setFollow] = createSignal(true);
  let unlisten: UnlistenFn | undefined;
  let seq = 0;
  let streaming: string | null = null; // the serial we're streaming, if any

  const device = () => resolveSelectedDevice();
  // Logcat only attaches to an online device (a stopped AVD has no log stream).
  const serial = () => {
    const d = device();
    return d && d.state === "running" ? d.serial : null;
  };

  const scrollToTail = () => {
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  };

  // Follow the tail as lines arrive, unless the user scrolled up.
  createEffect(on(lines, () => follow() && queueMicrotask(scrollToTail)));

  const onScroll = () => {
    const nearBottom =
      scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 24;
    setFollow(nearBottom);
  };

  const append = (event: LogEvent) => {
    setLines((prev) => {
      const next = prev.length >= MAX_LINES ? prev.slice(prev.length - MAX_LINES + 1) : prev.slice();
      next.push({ ...event, id: seq++ });
      return next;
    });
  };

  const stop = async () => {
    unlisten?.();
    unlisten = undefined;
    setActive(false);
    const s = streaming;
    streaming = null;
    if (s) await stopLogcat(s).catch(() => {});
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
      await startLogcat(s, append);
      streaming = s;
      setActive(true);
      setFollow(true);
      unlisten = await listen<string>("logcat-disconnected", (e) => {
        if (e.payload === s) void stop();
      });
    } catch (e) {
      setError(String(e));
      await stop();
    } finally {
      setBusy(false);
    }
  };

  const clear = () => {
    setLines([]);
    setFollow(true);
  };

  onCleanup(() => {
    unlisten?.();
    if (streaming) void stopLogcat(streaming).catch(() => {});
  });

  return (
    <div class="pf-logcat">
      <div class="pf-logcat-head">
        <MonoEyebrow text="Device logs" />
        <span class="pf-logcat-spacer" />
        <button
          class="pf-logcat-toggle"
          classList={{ "pf-logcat-toggle--on": follow() }}
          title={follow() ? "Following the tail — click to pause" : "Paused — click to follow the tail"}
          disabled={!active()}
          onClick={() => {
            const next = !follow();
            setFollow(next);
            if (next) scrollToTail();
          }}
        >
          follow
        </button>
        <button
          class="pf-text-btn"
          title="Clear device logs"
          disabled={lines().length === 0}
          onClick={clear}
        >
          Clear
        </button>
        <Show
          when={active()}
          fallback={
            <button
              class="pf-text-btn"
              title="Stream device logs"
              disabled={busy() || !serial()}
              onClick={() => void start()}
            >
              {busy() ? "Starting…" : "Start"}
            </button>
          }
        >
          <button class="pf-text-btn" onClick={() => void stop()}>
            Stop
          </button>
        </Show>
      </div>

      <div class="pf-logcat-body" ref={scroller} onScroll={onScroll}>
        <Show
          when={lines().length > 0}
          fallback={
            <div class="pf-logcat-empty">
              {serial()
                ? active()
                  ? "Waiting for device log output…"
                  : `Start to stream logs from ${deviceLabel(device()!)}`
                : "Select a running device to stream its logs."}
            </div>
          }
        >
          <For each={lines()}>
            {(l) => <div class={`pf-logcat-line pf-logcat-line--${l.level}`}>{l.line}</div>}
          </For>
        </Show>
      </div>

      <Show when={error()}>
        <div class="pf-vm-error">{error()}</div>
      </Show>
    </div>
  );
}
