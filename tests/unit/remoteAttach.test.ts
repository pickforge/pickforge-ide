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
      expect(ctrl.test()).toEqual({ kind: "done", host: "box", health });

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

  it("pins the host captured at probe start through the result", () =>
    withCtrl(async (ctrl) => {
      const health = okHealth();
      let resolve!: (h: RemoteHostHealth) => void;
      healthMock.mockReturnValue(new Promise<RemoteHostHealth>((r) => (resolve = r)));
      // The panel would pass a live input value; the probe pins " box-a " -> "box-a"
      // at start, so an edit to box-b mid-flight cannot relabel the result.
      const pending = ctrl.runTest(" box-a ");
      expect(ctrl.test()).toEqual({ kind: "running", host: "box-a" });
      resolve(health);
      expect(await pending).toEqual({ host: "box-a", health });
      expect(ctrl.test()).toEqual({ kind: "done", host: "box-a", health });
    }));

  it("clearAttachError never knocks an in-flight attach out of busy", () =>
    withCtrl(async (ctrl) => {
      let resolve!: () => void;
      setMock.mockReturnValue(new Promise<void>((r) => (resolve = r)));
      const pending = ctrl.doAttach("box", "/remote/proj");
      expect(ctrl.attach().kind).toBe("busy");
      ctrl.clearAttachError();
      expect(ctrl.attach().kind).toBe("busy");
      resolve();
      expect(await pending).toBe(true);
      expect(ctrl.attach()).toEqual({ kind: "idle" });
    }));

  it("clearAttachError dismisses an inline error", () =>
    withCtrl(async (ctrl) => {
      setMock.mockRejectedValue("nope");
      await ctrl.doAttach("box", "/remote/proj");
      expect(ctrl.attach().kind).toBe("error");
      ctrl.clearAttachError();
      expect(ctrl.attach()).toEqual({ kind: "idle" });
    }));

  it("rejects re-entrant attach/detach while one is in flight", () =>
    withCtrl(async (ctrl) => {
      let resolve!: () => void;
      setMock.mockReturnValue(new Promise<void>((r) => (resolve = r)));
      const first = ctrl.doAttach("box", "/remote/proj");
      expect(await ctrl.doAttach("box", "/remote/proj")).toBe(false);
      expect(await ctrl.doDetach()).toBe(false);
      expect(setMock).toHaveBeenCalledTimes(1);
      expect(clearMock).not.toHaveBeenCalled();
      resolve();
      expect(await first).toBe(true);
    }));

  it("rejects a re-entrant test connection while one is running", () =>
    withCtrl(async (ctrl) => {
      let resolve!: (h: RemoteHostHealth) => void;
      healthMock.mockReturnValue(new Promise<RemoteHostHealth>((r) => (resolve = r)));
      const first = ctrl.runTest("box");
      expect(await ctrl.runTest("box")).toBeNull();
      expect(healthMock).toHaveBeenCalledTimes(1);
      resolve(okHealth());
      expect(await first).not.toBeNull();
    }));
});
