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
    command: "npm run dev",
    url: "http://localhost:1420",
    reuseExistingServer: !process.env.CI,
    env: { VITE_PICKFORGE_VRT: "1" },
  },
  use: {
    baseURL: "http://localhost:1420",
    viewport: { width: 1280, height: 820 },
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
