// Host-platform detection for the custom window chrome. Tauri's webview has no
// reliable OS API at module scope, so we parse the user-agent (the OS markers
// are stable across the bundled WebKitGTK / WebView2 / WKWebView engines) and
// treat "no Tauri runtime" (plain browser / VRT) as "web". Cached: the platform
// never changes within a session.

export type HostPlatform = "macos" | "windows" | "linux" | "web";

let cached: HostPlatform | undefined;

/** True when running inside the Tauri runtime (vs a plain browser / VRT). */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** The host OS, or "web" outside Tauri. Cached for the session. */
export function hostPlatform(): HostPlatform {
  if (cached) return cached;
  if (!isTauri()) return (cached = "web");
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  if (/Macintosh|Mac OS X/.test(ua)) cached = "macos";
  else if (/Windows/.test(ua)) cached = "windows";
  else cached = "linux";
  return cached;
}
