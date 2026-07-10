import { createSignal } from "solid-js";
import type { RemotePty } from "../lib/pty";
import {
  onRemoteTunnelClosed,
  remoteTunnelClose,
  remoteTunnelOpen,
  type RemoteTunnel,
  type RemoteTunnelClosed,
  type RemoteTunnelUnlisten,
} from "../lib/remoteHost";
import * as vm from "../lib/vm";

const DEFAULT_URL = "ws://127.0.0.1:8181/ws";
const VM_STATUS_POLL_MS = 1_000;
const VM_RETRY_LIMIT = 3;

const [url, setUrl] = createSignal(DEFAULT_URL);
const [connected, setConnected] = createSignal(false);
const [error, setError] = createSignal<string | null>(null);

export const vmService = { url, connected, error };
export const setVmUrl = setUrl;

interface RemoteRunContext {
  remote: RemotePty;
  projectRoot: string;
  runId: string;
}

interface RemoteVmState extends RemoteRunContext {
  remoteWs: string;
  localWs: string;
  tunnel: RemoteTunnel | null;
  childReopenUsed: boolean;
}

let remoteVm: RemoteVmState | null = null;
let armedRemote: RemoteRunContext | null = null;
let watcher: ReturnType<typeof setInterval> | null = null;
let retryingConnection = false;
let connectionRetries = 0;
let tunnelEvents: Promise<void> | null = null;
let unlistenTunnelEvents: RemoteTunnelUnlisten | null = null;
let remoteConnectionGeneration = 0;
let remoteTransportWasLive = false;

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
  const generation = ++remoteConnectionGeneration;
  const state = remoteVm;
  remoteTransportWasLive = false;
  stopConnectionWatch();
  await vm.vmDisconnect().catch(() => {});
  if (generation !== remoteConnectionGeneration) return;
  setConnected(false);
  await closeRemoteTunnel(state);
  if (generation === remoteConnectionGeneration && remoteVm === state) remoteVm = null;
}

const VM_URL_RE = /((?:https?|wss?):\/\/(?:127\.0\.0\.1|localhost):\d+\/[A-Za-z0-9_=-]+(?:\/ws)?(?:\?[^\s]*)?)/;

export function vmHttpToWs(serviceUrl: string): string {
  const parsed = new URL(serviceUrl.trim());
  if (parsed.protocol === "http:") parsed.protocol = "ws:";
  if (parsed.protocol === "https:") parsed.protocol = "wss:";
  if (!parsed.pathname.endsWith("/ws")) {
    parsed.pathname = `${parsed.pathname.replace(/\/$/, "")}/ws`;
  }
  return parsed.toString();
}

export function detectVmUrl(text: string): string | null {
  const match = text.match(VM_URL_RE);
  return match ? vmHttpToWs(match[1]) : null;
}

export function rewriteVmServiceUrlForTunnel(remoteWs: string, localPort: number): string {
  const parsed = new URL(remoteWs);
  parsed.protocol = "ws:";
  parsed.hostname = "127.0.0.1";
  parsed.port = String(localPort);
  return parsed.toString();
}

function remoteVmPort(remoteWs: string): number {
  const port = Number(new URL(remoteWs).port);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("Remote VM service URL has no valid port");
  }
  return port;
}

let buf = "";
let armed = false;

export function armVmAutoConnect(context?: RemoteRunContext): void {
  remoteConnectionGeneration += 1;
  remoteTransportWasLive = false;
  armed = true;
  buf = "";
  armedRemote = context ?? null;
  connectionRetries = 0;
  if (context) void ensureTunnelEvents();
}

export function disarmVmAutoConnect(): void {
  remoteConnectionGeneration += 1;
  remoteTransportWasLive = false;
  armed = false;
  buf = "";
  armedRemote = null;
  if (remoteVm) void disconnectVm();
  else stopConnectionWatch();
}

export function ingestRunOutput(chunk: string): void {
  if (!armed) return;
  buf = (buf + chunk).slice(-4000);
  const ws = detectVmUrl(buf);
  if (!ws) return;
  armed = false;
  buf = "";
  const context = armedRemote;
  armedRemote = null;
  if (context) void connectRemoteVm(ws, context).catch(() => {});
  else void connectVm(ws).catch(() => {});
}

export function hasVmTransport(): boolean {
  return !!remoteVm?.tunnel;
}

export function hadVmTransport(): boolean {
  return remoteTransportWasLive;
}

export async function reattachVm(): Promise<void> {
  const state = remoteVm;
  if (!state) {
    setError("No remote VM service is available to reattach");
    return;
  }
  stopConnectionWatch();
  await vm.vmDisconnect().catch(() => {});
  setConnected(false);
  await closeRemoteTunnel(state);
  try {
    await connectRemoteVm(state.remoteWs, state);
  } catch (e) {
    setError(`Could not reattach to the remote VM service: ${String(e)}`);
  }
}

async function connectRemoteVm(remoteWs: string, context: RemoteRunContext): Promise<void> {
  const generation = remoteConnectionGeneration;
  await ensureTunnelEvents();
  if (generation !== remoteConnectionGeneration) return;
  const state: RemoteVmState = remoteVm && remoteVm.runId === context.runId
    ? remoteVm
    : {
      ...context,
      remoteWs,
      localWs: "",
      tunnel: null,
      childReopenUsed: false,
    };
  state.remoteWs = remoteWs;
  let tunnel: RemoteTunnel;
  try {
    tunnel = await remoteTunnelOpen(
      state.projectRoot,
      state.remote.host,
      remoteVmPort(remoteWs),
      state.runId,
    );
  } catch (e) {
    setConnected(false);
    setError(
      `ssh:${state.remote.host} unavailable; could not open the VM-service tunnel. ` +
      `Open the project's Remote panel and choose Test connection. ${String(e)}`,
    );
    throw e;
  }
  if (generation !== remoteConnectionGeneration) {
    await remoteTunnelClose(tunnel.tunnelId).catch(() => {});
    return;
  }
  state.tunnel = tunnel;
  remoteTransportWasLive = true;
  state.localWs = rewriteVmServiceUrlForTunnel(remoteWs, tunnel.localPort);
  remoteVm = state;
  try {
    await connectVm(state.localWs);
    if (generation !== remoteConnectionGeneration) {
      await vm.vmDisconnect().catch(() => {});
      setConnected(false);
      await closeRemoteTunnel(state);
      if (remoteVm === state) remoteVm = null;
      return;
    }
    connectionRetries = 0;
    startConnectionWatch();
  } catch (e) {
    await closeRemoteTunnel(state);
    throw e;
  }
}

async function closeRemoteTunnel(state: RemoteVmState | null): Promise<void> {
  const tunnel = state?.tunnel;
  if (!state || !tunnel) return;
  state.tunnel = null;
  await remoteTunnelClose(tunnel.tunnelId).catch(() => {});
}

async function ensureTunnelEvents(): Promise<void> {
  if (!tunnelEvents) {
    tunnelEvents = onRemoteTunnelClosed((closed) => {
      void handleTunnelClosed(closed);
    }).then((unlisten) => {
      unlistenTunnelEvents = unlisten;
    });
  }
  await tunnelEvents;
}

async function handleTunnelClosed(closed: RemoteTunnelClosed): Promise<void> {
  const state = remoteVm;
  if (!state || state.tunnel?.tunnelId !== closed.tunnelId) return;
  const generation = remoteConnectionGeneration;
  state.tunnel = null;
  stopConnectionWatch();
  await vm.vmDisconnect().catch(() => {});
  if (generation !== remoteConnectionGeneration) return;
  setConnected(false);
  if (state.childReopenUsed) {
    setError("Remote VM tunnel closed again; reconnect it from the run console");
    return;
  }
  state.childReopenUsed = true;
  try {
    await connectRemoteVm(state.remoteWs, state);
  } catch (e) {
    setError(`Remote VM tunnel closed and could not be reopened: ${String(e)}`);
  }
}

function startConnectionWatch(): void {
  stopConnectionWatch();
  watcher = setInterval(() => {
    void reconnectVmThroughTunnel();
  }, VM_STATUS_POLL_MS);
}

function stopConnectionWatch(): void {
  if (watcher !== null) clearInterval(watcher);
  watcher = null;
  retryingConnection = false;
}

async function reconnectVmThroughTunnel(): Promise<void> {
  const state = remoteVm;
  if (!state?.tunnel || retryingConnection) return;
  const active = await vm.vmStatus().catch(() => null);
  if (active) return;
  retryingConnection = true;
  try {
    await connectVm(state.localWs);
    connectionRetries = 0;
  } catch (e) {
    connectionRetries += 1;
    if (connectionRetries >= VM_RETRY_LIMIT) {
      stopConnectionWatch();
      await closeRemoteTunnel(state);
      setError(`Remote VM service connection was lost: ${String(e)}`);
    }
  } finally {
    retryingConnection = false;
  }
}

export function resetVmServiceForTest(): void {
  stopConnectionWatch();
  unlistenTunnelEvents?.();
  unlistenTunnelEvents = null;
  tunnelEvents = null;
  remoteVm = null;
  armedRemote = null;
  armed = false;
  buf = "";
  connectionRetries = 0;
  remoteConnectionGeneration += 1;
  remoteTransportWasLive = false;
  setUrl(DEFAULT_URL);
  setConnected(false);
  setError(null);
}
