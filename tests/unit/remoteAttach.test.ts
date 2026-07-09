import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "solid-js";

// Mock the remoteHost.ts boundary — the controller reaches Tauri only through it.
const { setMock, clearMock, healthMock } = vi.hoisted(() => ({
  setMock: vi.fn(),
  clearMock: vi.fn(),
  healthMock: vi.fn(),
}));
vi.mock("../../src/lib/remoteHost", () => ({
  projectRemoteSet: (...a: unknown[]) => setMock(...a),
  projectRemoteClear: (...a: unknown[]) => clearMock(...a),
  remoteHostHealth: (...a: unknown[]) => healthMock(...a),
}));

import { createRemoteAttach } from "../../src/lib/remoteAttach";
import type { RemoteHostHealth } from "../../src/lib/remoteHost";

const okHealth = (): RemoteHostHealth => ({
  checkedAtMs: 0,
  tailnet: { state: "ok" },
  ssh: { state: "ok" },
  daemon: { state: "skipped" },
});

/** Run a controller test inside a reactive root, disposing when done. */
function withCtrl<T>(fn: (ctrl: ReturnType<typeof createRemoteAttach>) => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    createRoot((dispose) => {
      fn(createRemoteAttach(() => "/proj"))
        .then((v) => { dispose(); resolve(v); })
        .catch((e) => { dispose(); reject(e); });
    });
  });
}

describe("remoteAttach controller", () => {
  beforeEach(() => {
    setMock.mockReset();
    clearMock.mockReset();
    healthMock.mockReset();
  });

  it("attaches on success and clears busy", () =>
    withCtrl(async (ctrl) => {
      setMock.mockResolvedValue(undefined);
      const ok = await ctrl.doAttach("box", "/remote/proj");
      expect(ok).toBe(true);
      expect(setMock).toHaveBeenCalledWith("/proj", "box", "/remote/proj");
      expect(ctrl.attach()).toEqual({ kind: "idle" });
    }));

  it("surfaces the rejection message inline", () =>
    withCtrl(async (ctrl) => {
      setMock.mockRejectedValue("host is not on the tailnet");
      const ok = await ctrl.doAttach("1.2.3.4", "/remote/proj");
      expect(ok).toBe(false);
      expect(ctrl.attach()).toEqual({ kind: "error", message: "host is not on the tailnet" });
    }));

  it("validates inputs without calling the backend", () =>
    withCtrl(async (ctrl) => {
      const ok = await ctrl.doAttach("  ", "/remote/proj");
      expect(ok).toBe(false);
      expect(setMock).not.toHaveBeenCalled();
      expect(ctrl.attach().kind).toBe("error");
    }));

  it("detaches on success", () =>
    withCtrl(async (ctrl) => {
      clearMock.mockResolvedValue(undefined);
      const ok = await ctrl.doDetach();
      expect(ok).toBe(true);
      expect(clearMock).toHaveBeenCalledWith("/proj");
      expect(ctrl.attach()).toEqual({ kind: "idle" });
    }));

  it("renders the test-connection result states", () =>
    withCtrl(async (ctrl) => {
      const health = okHealth();
      healthMock.mockResolvedValue(health);
      await ctrl.runTest("box");
      expect(ctrl.test()).toEqual({ kind: "done", health });

      healthMock.mockRejectedValue("ssh refused");
      await ctrl.runTest("box");
      expect(ctrl.test()).toEqual({ kind: "error", message: "ssh refused" });
    }));

  it("guards an empty host in test connection", () =>
    withCtrl(async (ctrl) => {
      await ctrl.runTest("   ");
      expect(healthMock).not.toHaveBeenCalled();
      expect(ctrl.test().kind).toBe("error");
    }));
});
