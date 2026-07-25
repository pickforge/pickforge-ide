// Device-log view for runs whose device logs don't reach the run PTY: React
// Native / native-Android (`adb logcat`) and native-iOS (`os_log`). Read-only,
// mono, console-styled — the textual sibling of the Debug Console. Rust streams
// parsed events (logcat_commands.rs / ios_commands.rs); this buffers them
// (capped, drop-oldest), colours by level, and follows the tail unless the user
// scrolls up. Starts on an online selected device, stops on
// device-disconnect / unmount. The `source` prop selects which stream client
// and disconnect event to wire; everything else is shared.
import { createEffect, createSignal, For, on, onCleanup, Show } from "solid-js";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { MonoEyebrow } from "./ui";
import { IconClear, IconPlay, IconStop } from "./icons";
import { startLogcat, stopLogcat, type LogEvent } from "../lib/logcat";
import { startOslog, stopOslog, type OsLogEvent } from "../lib/oslog";
import { deviceLabel, resolveSelectedDevice } from "../stores/runLaunch";
import { pushMcpLogs } from "../stores/mcp";

const MAX_LINES = 5000;
// Log lines can arrive far faster than one-per-frame (adb logcat during app
// startup easily bursts hundreds/sec); appending straight to the signal would
// mean one IPC push (MCP ring) plus one reactive re-render per line. Instead
// we buffer incoming lines and flush them together on a short timer or once
// the buffer gets large, preserving arrival order either way.
const FLUSH_MS = 75;
const FLUSH_MAX_LINES = 200;

type LogViewSource = "logcat" | "oslog";
/** The console CSS only styles warning/error; everything else reads as the base
 *  (info) colour. */
type LineLevel = "info" | "warning" | "error";

/** A stream-agnostic line: the console never sees the raw logcat/os_log shapes. */
interface NormalizedLine {
  text: string;
  level: LineLevel;
}
interface BufferedLine extends NormalizedLine {
  id: number;
}

/** os_log levels have no "warning" tier: fault reads as error, everything else
 *  (debug / info / default) reads as info — matching the spec's level map. */
function oslogLevel(level: OsLogEvent["level"]): LineLevel {
  return level === "error" || level === "fault" ? "error" : "info";
}

/** Per-source wiring: the disconnect event to listen for, and how to start/stop
 *  the stream while normalizing each event into a `NormalizedLine`. */
interface StreamWiring {
  disconnectEvent: string;
  start(id: string, onLine: (line: NormalizedLine) => void): Promise<void>;
  stop(id: string): Promise<void>;
}

const STREAMS: Record<LogViewSource, StreamWiring> = {
  logcat: {
    disconnectEvent: "logcat-disconnected",
    start: (serial, onLine) =>
      startLogcat(serial, (e: LogEvent) => onLine({ text: e.line, level: e.level })),
    stop: (serial) => stopLogcat(serial),
  },
  oslog: {
    disconnectEvent: "oslog-disconnected",
    start: (udid, onLine) =>
      // The process is the role tag os_log plays for logcat: lead with it.
      startOslog(udid, (e: OsLogEvent) =>
        onLine({ text: `${e.process}  ${e.message}`, level: oslogLevel(e.level) }),
      ),
    stop: (udid) => stopOslog(udid),
  },
};

/** The pending-line ring buffer: log lines can arrive far faster than one per
 * frame (adb logcat during app startup easily bursts hundreds/sec), so
 * incoming lines are buffered and flushed together on a short timer or once
 * the buffer gets large — one signal update, one MCP push, in arrival order
 * — instead of one of each per line, while preserving the drop-oldest cap.
 * A composable, called synchronously from `LogcatView`'s own setup so its
 * `onCleanup` runs under the same reactive owner as if written inline. */
function createLogBuffer() {
  const [lines, setLines] = createSignal<BufferedLine[]>([]);
  let seq = 0;
  let pending: NormalizedLine[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | undefined;

  const cancelScheduledFlush = () => {
    if (flushTimer === undefined) return;
    clearTimeout(flushTimer);
    flushTimer = undefined;
  };

  const flush = () => {
    if (pending.length === 0) return;
    const batch = pending;
    pending = [];
    setLines((prev) => {
      const next = prev.concat(batch.map((line) => ({ ...line, id: seq++ })));
      return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
    });
    // Feed the device log into the MCP run-log ring too, so `get_run_logs` is
    // useful for RN / native-Android / native-iOS runs — whose app logs live
    // here, not in the run PTY that the Debug Console taps. Best effort (no-op
    // until the endpoint is up).
    pushMcpLogs(batch.map((line) => line.text));
  };

  const append = (line: NormalizedLine) => {
    pending.push(line);
    if (pending.length >= FLUSH_MAX_LINES) {
      cancelScheduledFlush();
      flush();
      return;
    }
    if (flushTimer === undefined) {
      flushTimer = setTimeout(() => {
        flushTimer = undefined;
        flush();
      }, FLUSH_MS);
    }
  };

  const clear = () => {
    cancelScheduledFlush();
    pending = [];
    setLines([]);
  };

  onCleanup(cancelScheduledFlush);

  return { lines, append, clear, flushPending: () => { cancelScheduledFlush(); flush(); } };
}

/** The stream start/stop lifecycle. A composable, called synchronously from
 * `LogcatView`'s own setup so its `onCleanup` runs under the same reactive
 * owner as if written inline. `onStarted` fires right after `active` flips
 * true (matching the original's inline `setFollow(true)` at that point),
 * and `flushPending` runs before the stop IPC call so no buffered lines are
 * lost. */
function createDeviceLogStream(
  wiring: () => StreamWiring,
  serial: () => string | null,
  onLine: (line: NormalizedLine) => void,
  flushPending: () => void,
  onStarted: () => void,
) {
  const [active, setActive] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  let unlisten: UnlistenFn | undefined;
  let streaming: string | null = null; // the serial we're streaming, if any

  const stop = async () => {
    unlisten?.();
    unlisten = undefined;
    setActive(false);
    const s = streaming;
    streaming = null;
    flushPending();
    if (s) await wiring().stop(s).catch(() => {});
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
      await wiring().start(s, onLine);
      streaming = s;
      setActive(true);
      onStarted();
      unlisten = await listen<string>(wiring().disconnectEvent, (e) => {
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
    if (streaming) void wiring().stop(streaming).catch(() => {});
  });

  return { active, busy, error, start, stop };
}

function LogcatHeader(props: {
  follow: () => boolean;
  onToggleFollow: () => void;
  active: () => boolean;
  busy: () => boolean;
  serial: () => string | null;
  linesCount: () => number;
  onClear: () => void;
  onStart: () => void;
  onStop: () => void;
}) {
  return (
    <div class="pf-logcat-head">
      <MonoEyebrow text="Device logs" />
      <span class="pf-logcat-spacer" />
      <button
        class="pf-logcat-toggle"
        classList={{ "pf-logcat-toggle--on": props.follow() }}
        title={props.follow() ? "Following the tail — click to pause" : "Paused — click to follow the tail"}
        disabled={!props.active()}
        onClick={props.onToggleFollow}
      >
        follow
      </button>
      <button
        class="pf-dc-btn"
        title="Clear device logs"
        disabled={props.linesCount() === 0}
        onClick={props.onClear}
      >
        <IconClear size={13} />
      </button>
      <Show
        when={props.active()}
        fallback={
          <button
            class="pf-dc-btn"
            title="Stream device logs"
            disabled={props.busy() || !props.serial()}
            onClick={props.onStart}
          >
            <IconPlay size={12} />
          </button>
        }
      >
        <button class="pf-dc-btn pf-dc-btn--stop" title="Stop streaming device logs" onClick={props.onStop}>
          <IconStop size={12} />
        </button>
      </Show>
    </div>
  );
}

export function LogcatView(props: { source?: LogViewSource }) {
  const wiring = () => STREAMS[props.source ?? "logcat"];
  let scroller!: HTMLDivElement;
  const [follow, setFollow] = createSignal(true);

  const device = () => resolveSelectedDevice();
  // Logcat only attaches to an online device (a stopped AVD has no log stream).
  const serial = () => {
    const d = device();
    return d && d.state === "running" ? d.serial : null;
  };

  const buffer = createLogBuffer();
  const { active, busy, error, start, stop } = createDeviceLogStream(
    wiring,
    serial,
    buffer.append,
    buffer.flushPending,
    () => setFollow(true),
  );
  const lines = buffer.lines;

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

  const clear = () => {
    buffer.clear();
    setFollow(true);
  };

  return (
    <div class="pf-logcat">
      <LogcatHeader
        follow={follow}
        onToggleFollow={() => {
          const next = !follow();
          setFollow(next);
          if (next) scrollToTail();
        }}
        active={active}
        busy={busy}
        serial={serial}
        linesCount={() => lines().length}
        onClear={clear}
        onStart={() => void start()}
        onStop={() => void stop()}
      />

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
            {(l) => <div class={`pf-logcat-line pf-logcat-line--${l.level}`}>{l.text}</div>}
          </For>
        </Show>
      </div>

      <Show when={error()}>
        <div class="pf-vm-error">{error()}</div>
      </Show>
    </div>
  );
}
