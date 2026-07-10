import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type RemoteListener =
  | { kind: "disabled" }
  | { kind: "loopback"; host: string; port: number };

export interface PairingCode {
  code: string;
  createdAtMs: number;
  expiresAtMs: number;
  usedAtMs: number | null;
}

export interface RemoteClientSummary {
  clientId: string;
  clientName: string;
  issuedAtMs: number;
  lastSeenAtMs: number | null;
  revokedAtMs: number | null;
}

export interface TailscaleStatus {
  available: boolean;
  binaryPath: string | null;
  version: string | null;
  backendState: string | null;
  online: boolean | null;
  hostName: string | null;
  dnsName: string | null;
  tailscaleIps: string[];
  sshCapable: boolean;
  sshEnabled: boolean | null;
  error: string | null;
}

export interface RemoteHostOverview {
  running: boolean;
  listener: RemoteListener;
  localUrl: string | null;
  authPath: string;
  pairingCodes: PairingCode[];
  clients: RemoteClientSummary[];
  tailscale: TailscaleStatus;
  defaultHost: string;
  defaultPort: number;
}

export type ProbeState =
  | { state: "ok" }
  | { state: "failed"; reason: string }
  | { state: "skipped" };

export interface RemoteHostHealth {
  checkedAtMs: number;
  tailnet: ProbeState;
  ssh: ProbeState;
  daemon: ProbeState;
}

export const remoteHostStatus = () =>
  invoke<RemoteHostOverview>("remote_host_status");

export const remoteHostStart = (host: string, port: number) =>
  invoke<RemoteHostOverview>("remote_host_start", { host, port });

export const remoteHostStop = () =>
  invoke<RemoteHostOverview>("remote_host_stop");

export const remoteHostIssuePairingCode = (ttlMs?: number) =>
  invoke<PairingCode>("remote_host_issue_pairing_code", { ttlMs: ttlMs ?? null });

export const remoteHostRevokeClient = (clientId: string) =>
  invoke<void>("remote_host_revoke_client", { clientId });

export const remoteTailscaleSshSet = (enabled: boolean) =>
  invoke<TailscaleStatus>("remote_tailscale_ssh_set", { enabled });

export const projectRemoteSet = (
  projectRoot: string,
  host: string,
  remoteRoot: string,
) => invoke<void>("project_remote_set", { projectRoot, host, remoteRoot });

export const projectRemoteClear = (projectRoot: string) =>
  invoke<void>("project_remote_clear", { projectRoot });

export const remoteHostHealth = (host: string) =>
  invoke<RemoteHostHealth>("remote_host_health", { host });

export const remoteNearestPubspec = (host: string, start: string) =>
  invoke<string | null>("remote_nearest_pubspec", { host, start });

export const remoteDetectBinaries = (host: string, names: string[]) =>
  invoke<boolean[]>("remote_detect_binaries", { host, names });

export interface RemoteTunnel {
  tunnelId: string;
  localPort: number;
}

export interface RemoteTunnelClosed {
  tunnelId: string;
  host: string;
  localPort: number;
  runId: string;
  exitCode: number | null;
}

export const remoteTunnelOpen = (
  projectRoot: string,
  host: string,
  remotePort: number,
  runId: string,
) => invoke<RemoteTunnel>("remote_tunnel_open", { projectRoot, host, remotePort, runId });

export const remoteTunnelClose = (tunnelId: string) =>
  invoke<void>("remote_tunnel_close", { tunnelId });

export const onRemoteTunnelClosed = (callback: (tunnel: RemoteTunnelClosed) => void) =>
  listen<RemoteTunnelClosed>("remote-tunnel-closed", (event) => callback(event.payload));

export type RemoteTunnelUnlisten = UnlistenFn;
