import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UpdateController, UpdateState } from "@pickforge/tauri-updater";

function fakeController(initial: UpdateState = { status: "idle" }) {
  let state = initial;
  const listeners = new Set<(s: UpdateState) => void>();
  const set = (next: UpdateState) => {
    state = next;
    for (const l of listeners) l(next);
  };
  const controller: UpdateController & {
    __set: (s: UpdateState) => void;
  } = {
    getState: () => state,
    start: vi.fn(async () => {}),
    check: vi.fn(async () => {}),
    install: vi.fn(async () => {}),
    retry: vi.fn(async () => {}),
    dismiss: vi.fn(),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    __set: set,
  };
  return controller;
}

async function loadStore() {
  vi.resetModules();
  return import("../../src/stores/studioUpdate");
}

describe("studioUpdate store — shared controller seam", () => {
  let store: Awaited<ReturnType<typeof loadStore>>;

  beforeEach(async () => {
    store = await loadStore();
  });

  it("adopts an injected controller and mirrors its state reactively", () => {
    const controller = fakeController({ status: "idle" });
    store.overrideSharedUpdateController(controller);

    expect(store.studioUpdateState()).toEqual({ status: "idle" });

    controller.__set({ status: "available", update: { version: "1.2.3" } });
    expect(store.studioUpdateState()).toEqual({
      status: "available",
      update: { version: "1.2.3" },
    });
  });

  it("startStudioUpdateCheck calls the shared controller's start()", () => {
    const controller = fakeController();
    store.overrideSharedUpdateController(controller);

    store.startStudioUpdateCheck();

    expect(controller.start).toHaveBeenCalledOnce();
    expect(controller.check).not.toHaveBeenCalled();
  });

  it("checkForStudioUpdate always performs a manual, non-silent check", () => {
    const controller = fakeController();
    store.overrideSharedUpdateController(controller);

    store.checkForStudioUpdate();

    expect(controller.check).toHaveBeenCalledExactlyOnceWith({ manual: true });
    expect(controller.start).not.toHaveBeenCalled();
  });

  it("activeUpdateController exposes the same controller instance driving state", () => {
    const controller = fakeController();
    store.overrideSharedUpdateController(controller);

    expect(store.activeUpdateController()).toBe(controller);
  });

  it("unsubscribes from a replaced controller so it stops driving state", () => {
    const first = fakeController({ status: "idle" });
    store.overrideSharedUpdateController(first);

    const second = fakeController({ status: "checking" });
    store.overrideSharedUpdateController(second);
    expect(store.studioUpdateState()).toEqual({ status: "checking" });

    first.__set({ status: "error", message: "stale", retry: "check" });
    expect(store.studioUpdateState()).toEqual({ status: "checking" });
  });

  it("resets to idle when the override is cleared", () => {
    const controller = fakeController({ status: "available", update: { version: "1.0.0" } });
    store.overrideSharedUpdateController(controller);
    expect(store.studioUpdateState().status).toBe("available");

    store.overrideSharedUpdateController(undefined);
    expect(store.studioUpdateState()).toEqual({ status: "idle" });
  });
});
