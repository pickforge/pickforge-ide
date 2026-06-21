import { defineConfig } from "vitest/config";

// Pure-logic unit tests (run-command builder, launch.json parser). No DOM and no
// Tauri runtime — the suite mocks `@tauri-apps/api/core`. Playwright VRT lives
// separately under tests/vrt and is run with `bun run vrt`.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
  },
});
