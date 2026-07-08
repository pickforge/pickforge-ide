// Custom window controls for the frameless title bar: minimize, maximize/restore,
// close. Renders nothing outside Tauri (plain browser / VRT) so the web build and
// snapshots are unaffected. Every Tauri call is dynamically imported and guarded.
import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { hostPlatform } from "../lib/platform";

const MAXIMIZED_CHECK_DELAY_MS = 120;

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
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    let checking = false;
    void (async () => {
      try {
        const win = await appWindow();
        const readMaximized = async () => {
          if (disposed || checking) return;
          checking = true;
          try {
            setMaximized(await win.isMaximized());
          } catch {
            /* window closing */
          } finally {
            checking = false;
          }
        };
        const scheduleRead = () => {
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => {
            timer = undefined;
            void readMaximized();
          }, MAXIMIZED_CHECK_DELAY_MS);
        };

        await readMaximized();
        const off = await win.onResized(scheduleRead);
        if (disposed) off();
        else unlisten = off;
      } catch {
        /* not in Tauri */
      }
    })();
    onCleanup(() => {
      disposed = true;
      if (timer) clearTimeout(timer);
      unlisten?.();
    });
  });

  const minimize = () => void appWindow().then((w) => w.minimize()).catch(() => {});
  const toggleMax = () =>
    void appWindow()
      .then(async (w) => {
        await w.toggleMaximize();
        setMaximized(await w.isMaximized());
      })
      .catch(() => {});
  const close = () => void appWindow().then((w) => w.close()).catch(() => {});

  const Minimize = () => (
    <button
      type="button"
      class="pf-winctl-btn"
      title="Minimize"
      aria-label="Minimize"
      onClick={minimize}
    >
      <CtlIcon kind="minimize" />
    </button>
  );
  const Maximize = () => (
    <button
      type="button"
      class="pf-winctl-btn"
      title={maximized() ? "Restore" : "Maximize"}
      aria-label={maximized() ? "Restore" : "Maximize"}
      onClick={toggleMax}
    >
      <CtlIcon kind={maximized() ? "restore" : "maximize"} />
    </button>
  );
  const Close = () => (
    <button
      type="button"
      class="pf-winctl-btn pf-winctl-btn--close"
      title="Close"
      aria-label="Close"
      onClick={close}
    >
      <CtlIcon kind="close" />
    </button>
  );

  // macOS renders controls on the LEFT and follows the traffic-light action
  // order close → minimize → maximize (left→right). Windows/Linux render on the
  // right with minimize → maximize → close.
  const isMac = hostPlatform() === "macos";

  return (
    <div class="pf-winctl" role="group" aria-label="Window controls">
      <Show when={isMac} fallback={<><Minimize /><Maximize /><Close /></>}>
        <Close />
        <Minimize />
        <Maximize />
      </Show>
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
