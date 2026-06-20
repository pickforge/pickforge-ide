// Flutter VM service connection, shared between the Inspector (manual connect +
// status) and the Debug Console (auto-connect from `flutter run` output). When a
// run prints "A Dart VM Service … is available at: http://127.0.0.1:PORT/TOKEN/"
// we convert it to the WebSocket endpoint and connect automatically, so the
// inspector/widget tree works without the user pasting a URL.
import { createSignal } from "solid-js";
import * as vm from "../lib/vm";

const DEFAULT_URL = "ws://127.0.0.1:8181/ws";

const [url, setUrl] = createSignal(DEFAULT_URL);
const [connected, setConnected] = createSignal(false);
const [error, setError] = createSignal<string | null>(null);

/** Reactive VM-service state for views. */
export const vmService = { url, connected, error };
export const setVmUrl = setUrl;

export async function connectVm(target?: string): Promise<void> {
  const u = (target ?? url()).trim();
  if (!u) return;
  setError(null);
  try {
    await vm.vmConnect(u);
    setUrl(u);
    setConnected(true);
  } catch (e) {
    setError(String(e));
    setConnected(false);
    throw e;
  }
}

export async function disconnectVm(): Promise<void> {
  await vm.vmDisconnect().catch(() => {});
  setConnected(false);
}

/** First http(s) URL with a real token path (not the DevTools `:9100?uri=` base,
 *  which has none). The embedded `uri=…` copy has the same token path, so even
 *  matching that yields the correct VM service URL. */
const VM_URL_RE = /(https?:\/\/(?:127\.0\.0\.1|localhost):\d+\/[A-Za-z0-9_=-]+\/)/;

/** Convert a Dart VM Service http URL to its WebSocket endpoint. */
export function vmHttpToWs(httpUrl: string): string {
  return httpUrl.trim().replace(/^http/, "ws") + "ws"; // URL already ends in "/"
}

/** The VM service WebSocket URL from a blob of run output, or null. */
export function detectVmUrl(text: string): string | null {
  const m = text.match(VM_URL_RE);
  return m ? vmHttpToWs(m[1]) : null;
}

let buf = "";
let armed = false;

/** Begin watching a fresh run's output for the VM service URL (call on launch). */
export function armVmAutoConnect(): void {
  armed = true;
  buf = "";
}

/** Stop watching (call when the run stops). */
export function disarmVmAutoConnect(): void {
  armed = false;
  buf = "";
}

/** Feed a chunk of run output; auto-connect to the first VM service URL seen. */
export function ingestRunOutput(chunk: string): void {
  if (!armed) return;
  // Keep a rolling tail — the URL line can straddle two chunks.
  buf = (buf + chunk).slice(-4000);
  const ws = detectVmUrl(buf);
  if (!ws) return;
  armed = false; // connect once per run
  buf = "";
  void connectVm(ws).catch(() => {});
}
