// Mounts the shared `pickforge-update-dialog` Web Component
// (@pickforge/tauri-updater, pickforge/pickforge-platform#36) bound to the
// same controller the titlebar badge and Settings "check for updates" action
// drive. Only rendered when the studioUpdateDialog flag is on (see App.tsx).
import { createEffect, onCleanup, onMount } from "solid-js";
import {
  definePickforgeUpdaterElement,
  type PickforgeUpdateDialogElement,
} from "@pickforge/tauri-updater";
import { activeUpdateController } from "../stores/studioUpdate";
import { appVersion } from "../lib/appInfo";

definePickforgeUpdaterElement();

export function StudioUpdateDialog() {
  let containerRef: HTMLDivElement | undefined;
  let element: PickforgeUpdateDialogElement | undefined;
  // The element re-renders its footer buttons (destroying + recreating them)
  // on every `.metadata`/`.controller` assignment, which would silently steal
  // focus back off "Update & restart" after the initial open. Guard against
  // redundant assignments — including the effect's own first synchronous run
  // right after onMount sets the same value — so metadata is only reapplied
  // when the version actually changes.
  let appliedVersion: string | undefined;

  function applyMetadata(version: string) {
    if (!element || appliedVersion === version) return;
    appliedVersion = version;
    element.metadata = { productName: "PickForge", currentVersion: version, productMark: "PF" };
  }

  onMount(() => {
    element = document.createElement("pickforge-update-dialog") as PickforgeUpdateDialogElement;
    // Append before wiring metadata/controller: the element's render path
    // calls dialog.showModal(), which throws while still detached from the
    // document.
    containerRef?.append(element);
    applyMetadata(appVersion());
    element.controller = activeUpdateController();
  });

  createEffect(() => {
    applyMetadata(appVersion());
  });

  onCleanup(() => {
    element?.remove();
  });

  return <div class="pf-update-dialog-host" ref={containerRef} />;
}
