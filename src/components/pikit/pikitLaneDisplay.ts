// Pure formatting/mapping helpers for PiKitLanesPanel, split out from the
// view (mirrors components/orchestra/diff.ts) so they're importable and
// testable without pulling in Solid JSX or the panel's CSS.
import type { PiKitLaneStatus, PiKitRunEntry } from "../../lib/process";

function finite(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function formatTokens(value: number): string {
  const amount = finite(value);
  if (amount < 1_000) return String(Math.round(amount));
  if (amount < 1_000_000) return `${(amount / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return `${(amount / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
}

export function formatDuration(ms: number | null | undefined): string {
  const seconds = Math.floor(finite(ms ?? 0) / 1_000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m${String(seconds % 60).padStart(2, "0")}s`;
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}m`;
}

export function formatCost(value: number): string {
  return `$${finite(value).toFixed(2)}`;
}

export function runStatusTone(entry: PiKitRunEntry): string {
  if (!entry.supported) return "var(--pf-text-low)";
  if (entry.orphaned) return "var(--pf-warning)";
  if (entry.status?.state === "ended") {
    return entry.status.ok === false ? "var(--pf-error)" : "var(--pf-connected)";
  }
  return "var(--pf-info)";
}

export function laneStatusTone(state: string): string {
  if (state === "done") return "var(--pf-connected)";
  if (state === "failed") return "var(--pf-error)";
  if (state === "abandoned") return "var(--pf-warning)";
  if (state === "running") return "var(--pf-info)";
  return "var(--pf-text-low)";
}

export function runLabel(entry: PiKitRunEntry): string {
  if (!entry.supported) return "unsupported pi-kit schema version";
  if (entry.orphaned) return "orphaned";
  return entry.status?.state ?? "unknown";
}

export function laneDetail(lane: PiKitLaneStatus): string {
  if (lane.abandonReason) return lane.abandonReason;
  if (lane.currentTool) return lane.currentTool;
  if (lane.lastStatus) return lane.lastStatus;
  return lane.state;
}

/** Why the abandon action is disabled for this lane (or the whole run when
 * `lane` is omitted), or `null` when it's actionable. */
export function abandonDisabledReason(entry: PiKitRunEntry, lane?: PiKitLaneStatus): string | null {
  if (!entry.supported) return "Unsupported pi-kit schema version — cannot request abandonment.";
  const status = entry.status;
  if (!status) return "Run status unavailable.";
  if (status.state === "ended") return "Run already ended.";
  if (entry.orphaned) {
    return "Owner process appears gone — nothing left to consume the request.";
  }
  if (lane && lane.state !== "queued" && lane.state !== "running") {
    return `Lane already ${lane.state}.`;
  }
  return null;
}
