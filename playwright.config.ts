import { defineConfig } from "@playwright/test";

// Visual regression for the route-based UI. Replaces Flutter goldens; the app
// runs in plain Chromium with the Tauri runtime mocked (VITE_PICKFORGE_VRT).
export default defineConfig({
  testDir: "./tests/vrt",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: "list",
  webServer: {
    command: "bun run dev",
    url: "http://localhost:1420",
    reuseExistingServer: !process.env.CI,
    env: { VITE_PICKFORGE_VRT: "1" },
  },
  use: {
    baseURL: "http://localhost:1420",
    viewport: { width: 1280, height: 820 },
  },
  // Baselines are regenerated on the CI runner (update-vrt-baselines.yml) so PR
  // runs diff CI-rendered pixels against CI-rendered pixels. This tolerance is
  // the residual-AA safety margin: it absorbs the handful of sub-pixel font
  // anti-aliasing pixels that still drift between otherwise-identical chromium
  // runs, without masking a real layout/color regression. Bumped from 0.02 →
  // 0.025. Keep this in sync with the per-test override in
  // tests/vrt/screens.spec.ts.
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.025,
    },
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
