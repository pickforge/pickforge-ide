import { describe, expect, it } from "vitest";
import type { UpdateState } from "@pickforge/tauri-updater";
import {
  activeUpdateInfo,
  isStudioUpdateBusy,
  studioUpdateErrorMessage,
  studioUpdateLabel,
} from "../../src/lib/studioUpdateView";

describe("activeUpdateInfo — badge flag gating", () => {
  it("reads the legacy store when the flag is off, ignoring studio state", () => {
    const info = activeUpdateInfo(
      false,
      { status: "available", update: { version: "9.9.9" } },
      { version: "1.2.3" },
    );
    expect(info).toEqual({ version: "1.2.3" });
  });

  it("reads the shared controller when the flag is on, ignoring the legacy store", () => {
    const info = activeUpdateInfo(
      true,
      { status: "available", update: { version: "9.9.9" } },
      { version: "1.2.3" },
    );
    expect(info).toEqual({ version: "9.9.9" });
  });

  it("is undefined when the flag is on but the shared controller has no update", () => {
    expect(activeUpdateInfo(true, { status: "idle" }, { version: "1.2.3" })).toBeUndefined();
    expect(activeUpdateInfo(true, { status: "checking" }, { version: "1.2.3" })).toBeUndefined();
  });

  it("surfaces an update carried through a dismissed state (badge still available)", () => {
    const info = activeUpdateInfo(
      true,
      { status: "dismissed", update: { version: "2.0.0" } },
      null,
    );
    expect(info).toEqual({ version: "2.0.0" });
  });
});

describe("studioUpdateLabel", () => {
  const cases: [UpdateState, string][] = [
    [{ status: "idle" }, "Check for the latest release"],
    [{ status: "checking" }, "Checking…"],
    [{ status: "available", update: { version: "1.4.0" } }, "Version 1.4.0 available"],
    [
      {
        status: "downloading",
        update: { version: "1.4.0" },
        progress: { downloaded: 0, contentLength: null, percent: null },
      },
      "Downloading update…",
    ],
    [{ status: "installing", update: { version: "1.4.0" } }, "Installing update…"],
    [{ status: "restarting" }, "Restarting…"],
    [{ status: "error", message: "network down", retry: "check" }, "Update check failed"],
    [{ status: "dismissed", update: { version: "1.4.0" } }, "Version 1.4.0 available"],
    [{ status: "dismissed" }, "You're up to date"],
  ];

  for (const [state, expected] of cases) {
    it(`labels "${state.status}" as "${expected}"`, () => {
      expect(studioUpdateLabel(state)).toBe(expected);
    });
  }
});

describe("isStudioUpdateBusy", () => {
  it("is busy while checking, downloading, installing, or restarting", () => {
    expect(isStudioUpdateBusy({ status: "checking" })).toBe(true);
    expect(
      isStudioUpdateBusy({
        status: "downloading",
        update: { version: "1.0.0" },
        progress: { downloaded: 0, contentLength: null, percent: null },
      }),
    ).toBe(true);
    expect(isStudioUpdateBusy({ status: "installing", update: { version: "1.0.0" } })).toBe(true);
    expect(isStudioUpdateBusy({ status: "restarting" })).toBe(true);
  });

  it("is not busy while idle, available, dismissed, or errored", () => {
    expect(isStudioUpdateBusy({ status: "idle" })).toBe(false);
    expect(isStudioUpdateBusy({ status: "available", update: { version: "1.0.0" } })).toBe(false);
    expect(isStudioUpdateBusy({ status: "dismissed" })).toBe(false);
    expect(isStudioUpdateBusy({ status: "error", message: "x", retry: "check" })).toBe(false);
  });
});

describe("studioUpdateErrorMessage", () => {
  it("returns the message only in the error state", () => {
    expect(
      studioUpdateErrorMessage({ status: "error", message: "boom", retry: "install" }),
    ).toBe("boom");
    expect(studioUpdateErrorMessage({ status: "idle" })).toBeUndefined();
    expect(studioUpdateErrorMessage({ status: "available", update: { version: "1.0.0" } }))
      .toBeUndefined();
  });
});
