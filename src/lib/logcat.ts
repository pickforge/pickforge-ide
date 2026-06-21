// Device-log (logcat) client: parsed `adb logcat` lines from the Rust relay (a
// Tauri Channel) for React Native / native-Android runs, whose device logs don't
// reach the run PTY. Rust owns the `adb logcat` child + parsing (logcat_commands.rs).
import { Channel, invoke } from "@tauri-apps/api/core";

/** Severity of a parsed log line. Mirrors the Rust `LogLevel`
 *  (`#[serde(rename_all = "lowercase")]`). */
export type LogLevel = "info" | "warning" | "error";

/** One parsed logcat line. Mirrors `LogEvent` in
 *  `crates/pickforge-core/src/android/logcat.rs`
 *  (`#[serde(rename_all = "camelCase")]`). */
export interface LogEvent {
  line: string;
  level: LogLevel;
  source: string;
}

/** Start streaming device logs for `serial`; `onLine` fires per parsed line.
 *  Replaces any existing stream for the serial. */
export function startLogcat(serial: string, onLine: (event: LogEvent) => void): Promise<void> {
  const channel = new Channel<LogEvent>();
  channel.onmessage = onLine;
  return invoke("logcat_start", { serial, onLine: channel });
}

/** Stop streaming device logs for `serial` (kills the adb logcat child). */
export function stopLogcat(serial: string): Promise<void> {
  return invoke("logcat_stop", { serial });
}
