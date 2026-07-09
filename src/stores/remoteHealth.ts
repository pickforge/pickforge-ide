// Shared, ref-counted poller for remote-host health. One interval polls each
// DISTINCT bound host (never an unbound one), dedupes in-flight probes per host,
// caches the last result, and backs off to a slow cadence after consecutive
// failures so a dead host never spams SSH. Mirrors the deviceList precedent: the
// projects pane is the lifecycle owner via useRemoteHealth().
import { createStore, produce } from "solid-js/store";
import { onCleanup, onMount } from "solid-js";
import { remoteHostHealth, type ProbeState, type RemoteHostHealth } from "../lib/remoteHost";
import { flagEnabled } from "./flags";
import { workspace } from "./workspace";
import type { Project } from "../lib/db";

const POLL_MS = 30_000;
const BACKOFF_MS = 120_000;
const FAIL_THRESHOLD = 2;

export type HealthStatus = "unknown" | "ok" | "warning";

interface HostEntry {
  health: RemoteHostHealth | null;
  failures: number;
  lastAttemptMs: number;
}

const [entries, setEntries] = createStore<Record<string, HostEntry>>({});
const inFlight = new Map<string, Promise<RemoteHostHealth | null>>();

const probeOk = (p: ProbeState): boolean => p.state === "ok";
const fullyOk = (h: RemoteHostHealth): boolean => probeOk(h.tailnet) && probeOk(h.ssh);

/** Cached health for a host, or null if never probed. Reactive. */
export function healthOf(host: string): RemoteHostHealth | null {
  return entries[host]?.health ?? null;
}

/** Reactive status for a badge: unknown before any probe, ok when tailnet+ssh
 *  are both ok (daemon is informational), warning otherwise. */
export function healthStatus(host: string): HealthStatus {
  const h = entries[host]?.health;
  if (!h) return "unknown";
  return fullyOk(h) ? "ok" : "warning";
}

/** Record a probe result into the cache (shared by the poller and a manual test
 *  connection), resetting the failure count on a fully-ok result. */
export function recordHealth(host: string, health: RemoteHostHealth): void {
  setEntries(host, (prev) => ({
    health,
    failures: fullyOk(health) ? 0 : (prev?.failures ?? 0) + 1,
    lastAttemptMs: Date.now(),
  }));
}

function recordFailure(host: string): void {
  setEntries(host, (prev) => ({
    health: prev?.health ?? null,
    failures: (prev?.failures ?? 0) + 1,
    lastAttemptMs: Date.now(),
  }));
}

/** Probe a host, updating the cache + backoff state. Overlapping calls share the
 *  one in-flight probe. Resolves to the health, or null when the probe threw. */
export function refreshHost(host: string): Promise<RemoteHostHealth | null> {
  const existing = inFlight.get(host);
  if (existing) return existing;
  const promise = (async () => {
    try {
      const health = await remoteHostHealth(host);
      recordHealth(host, health);
      return health;
    } catch {
      recordFailure(host);
      return null;
    } finally {
      inFlight.delete(host);
    }
  })();
  inFlight.set(host, promise);
  return promise;
}

function cadence(host: string): number {
  const e = entries[host];
  return e && e.failures >= FAIL_THRESHOLD ? BACKOFF_MS : POLL_MS;
}

/** Whether a host is due for another probe under its current cadence. */
export function isDue(host: string, now = Date.now()): boolean {
  const e = entries[host];
  if (!e) return true;
  return now - e.lastAttemptMs >= cadence(host);
}

/** Distinct bound hosts from a project list (dedupes a host shared by projects). */
export function distinctHosts(projects: Pick<Project, "remoteHost">[]): string[] {
  const seen = new Set<string>();
  for (const p of projects) {
    if (p.remoteHost) seen.add(p.remoteHost);
  }
  return [...seen];
}

/** Probe every due host in the list once (distinct). */
export async function pollHosts(hosts: string[]): Promise<void> {
  const distinct = [...new Set(hosts)];
  await Promise.all(distinct.filter((h) => isDue(h)).map((h) => refreshHost(h)));
}

/** Clear all cached state — test isolation only. */
export function resetRemoteHealth(): void {
  setEntries(produce((s) => {
    for (const k of Object.keys(s)) delete s[k];
  }));
  inFlight.clear();
}

function tick() {
  if (typeof document !== "undefined" && document.hidden) return;
  if (!flagEnabled("remoteProjects")) return;
  void pollHosts(distinctHosts(workspace.projects));
}

let subscribers = 0;
let timer: ReturnType<typeof setInterval> | undefined;

function start() {
  tick();
  timer = setInterval(tick, POLL_MS);
}

function stop() {
  if (timer !== undefined) {
    clearInterval(timer);
    timer = undefined;
  }
}

/** Subscribe a view to the shared poller for its lifetime. Starts on the first
 *  subscriber, stops when the last unmounts. */
export function useRemoteHealth(): void {
  onMount(() => {
    if (subscribers++ === 0) start();
  });
  onCleanup(() => {
    if (--subscribers === 0) stop();
  });
}

// ---- formatters (shared by the panel rows + badge tooltip) ----
export function probeText(p: ProbeState): string {
  if (p.state === "ok") return "ok";
  if (p.state === "skipped") return "skipped";
  return `failed: ${p.reason}`;
}

export function healthSummary(h: RemoteHostHealth): string {
  return `tailnet ${probeText(h.tailnet)} · ssh ${probeText(h.ssh)} · daemon ${probeText(h.daemon)}`;
}

export function relTime(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
