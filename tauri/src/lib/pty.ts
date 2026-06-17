// Typed client for the Rust PTY commands. Output streams over a Tauri Channel
// (ordered + fast); input/resize/kill are request/response invokes.
import { Channel, invoke } from "@tauri-apps/api/core";

export type PtyMessage =
  | { type: "output"; data: number[] | ArrayBuffer | Uint8Array }
  | { type: "exit"; data: number | null };

export interface SpawnOptions {
  cwd?: string | null;
  rows: number;
  cols: number;
  onMessage: (message: PtyMessage) => void;
}

/** Spawn `$SHELL` in a fresh pty. Resolves to the session id. */
export async function ptySpawn(opts: SpawnOptions): Promise<number> {
  const channel = new Channel<PtyMessage>();
  channel.onmessage = opts.onMessage;
  return invoke<number>("pty_spawn", {
    cwd: opts.cwd ?? null,
    rows: opts.rows,
    cols: opts.cols,
    onMessage: channel,
  });
}

/** Send bytes (keystrokes / pasted text) to the shell. */
export function ptyWrite(id: number, data: Uint8Array): Promise<void> {
  return invoke("pty_write", { id, data: Array.from(data) });
}

/** Resize the pty. */
export function ptyResize(id: number, rows: number, cols: number): Promise<void> {
  return invoke("pty_resize", { id, rows, cols });
}

/** Kill the shell and drop the session. */
export function ptyKill(id: number): Promise<void> {
  return invoke("pty_kill", { id });
}

/**
 * Normalise whatever the channel delivers for an `output` message into a
 * `Uint8Array`. Tauri may hand us an ArrayBuffer (raw IPC body), a number[]
 * (JSON-serialised bytes) or already a Uint8Array — handle all three so the
 * data path is correct regardless of the serializer.
 */
export function toBytes(data: number[] | ArrayBuffer | Uint8Array): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return Uint8Array.from(data);
}
