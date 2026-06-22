// Custom window controls for the frameless title bar: minimize, maximize/restore,
// close. Renders nothing outside Tauri (plain browser / VRT) so the web build and
// snapshots are unaffected. Every Tauri call is dynamically imported and guarded.
import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { hostPlatform } from "../lib/platform";
import "./WindowControls.css";

async function appWindow() {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow();
}

export function WindowControls() {
  // The web build (and Playwright VRT) has no window chrome — keep it identical
  // to today by rendering nothing.
  if (hostPlatform() === "web") return null;

  const [maximized, setMaximized] = createSignal(false);

  onMount(() => {
    let unlisten: (() => void) | undefined;
    void (async () => {
      try {
        const win = await appWindow();
        setMaximized(await win.isMaximized());
        unlisten = await win.onResized(async () => {
          try {
            setMaximized(await win.isMaximized());
          } catch {
            /* window closing */
          }
        });
      } catch {
        /* not in Tauri */
      }
    })();
    onCleanup(() => unlisten?.());
  });

  const minimize = () => void appWindow().then((w) => w.minimize()).catch(() => {});
  const toggleMax = () =>
    void appWindow().then((w) => w.toggleMaximize()).catch(() => {});
  const close = () => void appWindow().then((w) => w.close()).catch(() => {});

  return (
    <div class="pf-winctl" role="group" aria-label="Window controls">
      <button
        type="button"
        class="pf-winctl-btn"
        title="Minimize"
        aria-label="Minimize"
        onClick={minimize}
      >
        <CtlIcon kind="minimize" />
      </button>
      <button
        type="button"
        class="pf-winctl-btn"
        title={maximized() ? "Restore" : "Maximize"}
        aria-label={maximized() ? "Restore" : "Maximize"}
        onClick={toggleMax}
      >
        <CtlIcon kind={maximized() ? "restore" : "maximize"} />
      </button>
      <button
        type="button"
        class="pf-winctl-btn pf-winctl-btn--close"
        title="Close"
        aria-label="Close"
        onClick={close}
      >
        <CtlIcon kind="close" />
      </button>
    </div>
  );
}

function CtlIcon(props: { kind: "minimize" | "maximize" | "restore" | "close" }) {
  return (
    <svg
      class="pf-winctl-icon"
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      stroke-width="1.1"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <Show when={props.kind === "minimize"}>
        <path d="M1.5 5h7" />
      </Show>
      <Show when={props.kind === "maximize"}>
        <rect x="1.5" y="1.5" width="7" height="7" rx="0.6" />
      </Show>
      <Show when={props.kind === "restore"}>
        {/* two offset squares: a back panel and a front panel */}
        <path d="M3 3V1.6h5.4V7H7" />
        <rect x="1.5" y="3" width="5.5" height="5.5" rx="0.6" />
      </Show>
      <Show when={props.kind === "close"}>
        <path d="M1.8 1.8l6.4 6.4M8.2 1.8l-6.4 6.4" />
      </Show>
    </svg>
  );
}
