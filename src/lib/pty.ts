// Typed client for the Rust PTY commands. stdout streams over a raw-bytes
// Channel (Response on the Rust side → ArrayBuffer here); exit is a separate
// small JSON channel. Input/resize/kill are request/response invokes.
import { Channel, invoke } from "@tauri-apps/api/core";

export type PtyBytes = ArrayBuffer | Uint8Array | number[];

export interface SpawnOptions {
  cwd?: string | null;
  /** When set, run this command once (`$SHELL -c <command>`) instead of an
   *  interactive shell — the pty exits when the command does. */
  command?: string | null;
  /** Extra env merged on top of the login-shell env — the `PICKFORGE_*` vars
   *  (incl. `PICKFORGE_IPC_ENDPOINT`) that let an embedded agent discover the
   *  local MCP endpoint. */
  env?: Record<string, string> | null;
  rows: number;
  cols: number;
  onOutput: (data: PtyBytes) => void;
  onExit: (code: number | null) => void;
}

/** Spawn a pty — interactive `$SHELL`, or a one-shot `command`. Resolves to the
 *  session id. */
export async function ptySpawn(opts: SpawnOptions): Promise<number> {
  const onOutput = new Channel<PtyBytes>();
  onOutput.onmessage = opts.onOutput;
  const onExit = new Channel<number | null>();
  onExit.onmessage = opts.onExit;

  return invoke<number>("pty_spawn", {
    cwd: opts.cwd ?? null,
    command: opts.command ?? null,
    env: opts.env ?? null,
    rows: opts.rows,
    cols: opts.cols,
    onOutput,
    onExit,
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

/** Normalise channel output into a Uint8Array regardless of the IPC encoding. */
export function toBytes(data: PtyBytes): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return Uint8Array.from(data);
}
