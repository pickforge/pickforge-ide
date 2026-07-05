import { defineConfig } from "vitest/config";

// Pure-logic unit tests (run-command builder, launch.json parser). No DOM and no
// Tauri runtime — the suite mocks `@tauri-apps/api/core`. Playwright VRT lives
// separately under tests/vrt and is run with `bun run vrt`.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/lib/tauriMock.ts"],
      thresholds: {
        branches: 26,
        functions: 16,
        lines: 23,
        statements: 23,
      },
    },
  },
});
