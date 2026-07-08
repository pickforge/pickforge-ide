import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

const DEFAULT_DEV_PORT = 1420;

function parsePort(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const port = Number.parseInt(value, 10);
  return Number.isFinite(port) && port > 0 ? port : fallback;
}

const port = parsePort(process.env.PICKFORGE_DEV_PORT, DEFAULT_DEV_PORT);
const hmrPort = parsePort(process.env.PICKFORGE_HMR_PORT, port + 1);

// @tauri-apps/cli sets TAURI_DEV_HOST when developing against a device.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [solid()],
  // Tauri expects a fixed port and owns the console output.
  clearScreen: false,
  server: {
    port,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: "ws", host, port: hmrPort }
      : undefined,
    watch: {
      // src-tauri is watched by the Rust side, not Vite.
      ignored: ["**/src-tauri/**"],
    },
  },
  // Produce a build that works inside the webview (no module preload polyfill
  // surprises under WebKitGTK).
  build: {
    target: "es2021",
    minify: "esbuild",
    sourcemap: true,
  },
});
