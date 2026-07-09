import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The store transitively imports the workspace store, whose deps read
// localStorage at module load — stub it for the node test environment.
const { healthMock } = vi.hoisted(() => {
  const storage = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (key: string) => (storage.has(key) ? storage.get(key)! : null),
    setItem: (key: string, value: string) => void storage.set(key, value),
    removeItem: (key: string) => void storage.delete(key),
    clear: () => storage.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage;
  return { healthMock: vi.fn() };
});
// The poller reaches Tauri only through src/lib/remoteHost (remoteHostHealth).
// Mock that boundary so we can drive probe results and assert dedupe / backoff.
vi.mock("../../src/lib/remoteHost", () => ({
  remoteHostHealth: (host: string) => healthMock(host),
}));

import {
  distinctHosts,
  healthOf,
  healthStatus,
  healthSummary,
  isDue,
  pollHosts,
  probeText,
  recordHealth,
  refreshHost,
  relTime,
  resetRemoteHealth,
} from "../../src/stores/remoteHealth";
import type { RemoteHostHealth } from "../../src/lib/remoteHost";

const okHealth = (): RemoteHostHealth => ({
  checkedAtMs: Date.now(),
  tailnet: { state: "ok" },
  ssh: { state: "ok" },
  daemon: { state: "ok" },
});
const badHealth = (): RemoteHostHealth => ({
  checkedAtMs: Date.now(),
  tailnet: { state: "failed", reason: "not on tailnet" },
  ssh: { state: "skipped" },
  daemon: { state: "skipped" },
});

describe("remoteHealth poller", () => {
  beforeEach(() => {
    resetRemoteHealth();
    healthMock.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("distinctHosts", () => {
    it("dedupes a host shared across projects and drops unbound ones", () => {
      const hosts = distinctHosts([
        { remoteHost: "box" },
        { remoteHost: "box" },
        { remoteHost: null },
        { remoteHost: "other" },
      ]);
      expect(hosts).toEqual(["box", "other"]);
    });
  });

  describe("pollHosts", () => {
    it("probes each distinct host exactly once", async () => {
      healthMock.mockResolvedValue(okHealth());
      await pollHosts(["a", "a", "b"]);
      expect(healthMock).toHaveBeenCalledTimes(2);
      expect(healthMock).toHaveBeenCalledWith("a");
      expect(healthMock).toHaveBeenCalledWith("b");
    });

    it("skips a host that is not yet due", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(0);
      healthMock.mockResolvedValue(okHealth());
      await pollHosts(["a"]);
      expect(healthMock).toHaveBeenCalledTimes(1);
      // Same tick: not due again (30s cadence), so no second probe.
      vi.setSystemTime(1_000);
      await pollHosts(["a"]);
      expect(healthMock).toHaveBeenCalledTimes(1);
      // Past the 30s cadence: due again.
      vi.setSystemTime(31_000);
      await pollHosts(["a"]);
      expect(healthMock).toHaveBeenCalledTimes(2);
    });
  });

  describe("refreshHost dedupe", () => {
    it("shares one in-flight probe across overlapping calls", async () => {
      let resolve!: (h: RemoteHostHealth) => void;
      healthMock.mockReturnValue(new Promise<RemoteHostHealth>((r) => (resolve = r)));
      const p1 = refreshHost("a");
      const p2 = refreshHost("a");
      expect(healthMock).toHaveBeenCalledTimes(1);
      resolve(okHealth());
      await Promise.all([p1, p2]);
    });
  });

  describe("cache reads", () => {
    it("reflects the last probe result", async () => {
      healthMock.mockResolvedValue(okHealth());
      await refreshHost("a");
      expect(healthStatus("a")).toBe("ok");
      expect(healthOf("a")).not.toBeNull();
    });

    it("is warning when tailnet/ssh are not both ok", async () => {
      healthMock.mockResolvedValue(badHealth());
      await refreshHost("a");
      expect(healthStatus("a")).toBe("warning");
    });

    it("is unknown before any probe", () => {
      expect(healthStatus("never")).toBe("unknown");
      expect(healthOf("never")).toBeNull();
    });
  });

  describe("backoff after consecutive failures", () => {
    it("drops to the 2-minute cadence so a dead host stops spamming ssh", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(0);
      healthMock.mockResolvedValue(badHealth());
      await refreshHost("dead"); // failure 1
      await refreshHost("dead"); // failure 2 -> backoff engaged
      // 31s later a healthy host would be due, but this one is backed off.
      expect(isDue("dead", 31_000)).toBe(false);
      // Only past the 2-minute backoff window does it become due again.
      expect(isDue("dead", 120_000)).toBe(true);
    });

    it("resets to the fast cadence once a probe is fully ok again", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(0);
      healthMock.mockResolvedValue(badHealth());
      await refreshHost("flap");
      await refreshHost("flap"); // backed off
      expect(isDue("flap", 31_000)).toBe(false);
      recordHealth("flap", okHealth()); // recovery
      expect(isDue("flap", 31_000)).toBe(true);
    });
  });

  describe("formatters", () => {
    it("renders each probe state", () => {
      expect(probeText({ state: "ok" })).toBe("ok");
      expect(probeText({ state: "skipped" })).toBe("skipped");
      expect(probeText({ state: "failed", reason: "no route" })).toBe("failed: no route");
    });
    it("summarizes the three probes", () => {
      expect(healthSummary(okHealth())).toBe("tailnet ok · ssh ok · daemon ok");
    });
    it("formats relative time", () => {
      expect(relTime(1_000, 1_000)).toBe("just now");
      expect(relTime(0, 20_000)).toBe("20s ago");
      expect(relTime(0, 120_000)).toBe("2m ago");
      expect(relTime(0, 2 * 3_600_000)).toBe("2h ago");
    });
  });
});
