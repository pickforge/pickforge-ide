import { createSignal, Show } from "solid-js";
import { openExternalUrl } from "../lib/opener";
import { IconClose } from "./icons";
import { MonoEyebrow } from "./ui";
import "./RetirementNotice.css";

const DISMISSED_KEY = "pickforge.retirementNoticeDismissed.v0.2.1";
const SUCCESSOR_URL = "https://pickforge.dev";
const ARCHIVED_REPO_URL = "https://github.com/pickforge/pickforge-ide";

function wasDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === "true";
  } catch {
    return false;
  }
}

export function RetirementNotice() {
  const [visible, setVisible] = createSignal(!wasDismissed());

  const dismiss = () => {
    setVisible(false);
    try {
      localStorage.setItem(DISMISSED_KEY, "true");
    } catch {
      // The notice still dismisses for this process when storage is unavailable.
    }
  };

  const open = (url: string) => {
    void openExternalUrl(url).catch(() => {});
  };

  return (
    <Show when={visible()}>
      <aside class="pf-retirement" role="status" aria-label="PickForge retirement notice">
        <div class="pf-retirement-copy">
          <MonoEyebrow text="Product retired" tick />
          <span>
            PickForge IDE retired on September 3, 2026. Version 0.2.1 is the final release.
            It keeps working offline, but there will be no further updates.
          </span>
        </div>
        <div class="pf-retirement-actions">
          <button type="button" class="pf-retirement-link" onClick={() => open(SUCCESSOR_URL)}>
            Meet the new Pickforge
          </button>
          <button type="button" class="pf-retirement-link" onClick={() => open(ARCHIVED_REPO_URL)}>
            Archived repository
          </button>
          <button
            type="button"
            class="pf-retirement-dismiss"
            aria-label="Dismiss retirement notice"
            title="Dismiss"
            onClick={dismiss}
          >
            <IconClose size={13} />
          </button>
        </div>
      </aside>
    </Show>
  );
}
