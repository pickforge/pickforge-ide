// App version, resolved from Tauri at runtime (falls back to the bundled
// package version in a plain browser / VRT mock).
import { createSignal } from "solid-js";

const [version, setVersion] = createSignal("0.1.0");
/** Reactive app version string (no leading "v"). */
export const appVersion = version;

let loaded = false;
export async function loadAppVersion(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const { getVersion } = await import("@tauri-apps/api/app");
    const v = await getVersion();
    if (v) setVersion(v);
  } catch {
    // not in Tauri — keep the default.
  }
}
