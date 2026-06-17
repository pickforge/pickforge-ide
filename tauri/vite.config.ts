import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

// @tauri-apps/cli sets TAURI_DEV_HOST when developing against a device.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [solid()],
  // Tauri expects a fixed port and owns the console output.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: "ws", host, port: 1421 }
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
    sourcemap: false,
  },
});
