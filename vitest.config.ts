import { defineConfig } from "vitest/config";
import solid from "vite-plugin-solid";

// Unit tests default to the node environment and mock Tauri IPC. Focused Solid
// component tests opt into jsdom per file; Playwright VRT lives separately
// under tests/vrt and is run with `bun run vrt`.
export default defineConfig({
  plugins: [solid()],
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/lib/tauriMock.ts"],
      thresholds: {
        branches: 41,
        functions: 21,
        lines: 37,
        statements: 32,
      },
    },
  },
});
