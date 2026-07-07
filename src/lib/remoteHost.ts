import { invoke } from "@tauri-apps/api/core";

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
  serveConfigured: boolean;
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
  defaultHttpsPort: number;
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

export const remoteTailscaleServeEnable = (
  host: string,
  port: number,
  httpsPort?: number,
) =>
  invoke<TailscaleStatus>("remote_tailscale_serve_enable", {
    host,
    port,
    httpsPort: httpsPort ?? null,
  });

export const remoteTailscaleServeDisable = (httpsPort?: number) =>
  invoke<TailscaleStatus>("remote_tailscale_serve_disable", {
    httpsPort: httpsPort ?? null,
  });

export const remoteTailscaleSshSet = (enabled: boolean) =>
  invoke<TailscaleStatus>("remote_tailscale_ssh_set", { enabled });
