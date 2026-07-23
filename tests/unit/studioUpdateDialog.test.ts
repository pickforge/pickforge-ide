// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render } from "solid-js/web";
import type { UpdateController } from "@pickforge/tauri-updater";
import { overrideSharedUpdateController } from "../../src/stores/studioUpdate";
import { StudioUpdateDialog } from "../../src/components/StudioUpdateDialog";

function fakeController(): UpdateController {
  return {
    getState: () => ({ status: "available", update: { version: "3.1.4" } }),
    start: async () => {},
    check: async () => {},
    install: async () => {},
    retry: async () => {},
    dismiss: () => {},
    subscribe: () => () => {},
  };
}

describe("StudioUpdateDialog", () => {
  it("mounts pickforge-update-dialog bound to the shared controller and app metadata", async () => {
    const controller = fakeController();
    overrideSharedUpdateController(controller);

    const root = document.createElement("div");
    document.body.append(root);
    const dispose = render(() => StudioUpdateDialog(), root);

    const element = root.querySelector("pickforge-update-dialog") as (HTMLElement & {
      controller?: UpdateController;
      metadata?: { productName: string; currentVersion: string };
    }) | null;

    expect(element).not.toBeNull();
    expect(element?.controller).toBe(controller);
    expect(element?.metadata?.productName).toBe("PickForge");

    dispose();
    expect(root.querySelector("pickforge-update-dialog")).toBeNull();

    overrideSharedUpdateController(undefined);
    root.remove();
  });
});
