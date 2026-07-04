// os_log stream client: parsed `xcrun simctl spawn <udid> log stream` events
// from the Rust relay (a Tauri Channel) for native-iOS runs, whose device logs
// don't reach the run PTY. Rust owns the log-stream child + parsing
// (ios_commands.rs). Sibling of logcat.ts.
import { Channel, invoke } from "@tauri-apps/api/core";

/** Severity of a parsed os_log line. Mirrors the Rust `OsLogLevel`
 *  (`#[serde(rename_all = "lowercase")]`). */
export type OsLogLevel = "debug" | "info" | "default" | "error" | "fault";

/** One parsed os_log event. Mirrors `OsLogEvent` in
 *  `crates/pickforge-core/src/ios/oslog.rs`
 *  (`#[serde(rename_all = "camelCase")]`). */
export interface OsLogEvent {
  timestamp: string;
  level: OsLogLevel;
  process: string;
  message: string;
}

/** Start streaming os_log events for `udid`; `onEvent` fires per parsed event.
 *  Replaces any existing stream for the simulator. */
export function startOslog(udid: string, onEvent: (event: OsLogEvent) => void): Promise<void> {
  const channel = new Channel<OsLogEvent>();
  channel.onmessage = onEvent;
  return invoke("oslog_start", { udid, onLine: channel });
}

/** Stop streaming os_log events for `udid` (kills the log-stream child). */
export function stopOslog(udid: string): Promise<void> {
  return invoke("oslog_stop", { udid });
}
