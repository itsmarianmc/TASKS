import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  use: { baseURL: process.env.E2E_BASE_URL || "http://127.0.0.1:3000", channel: process.env.PLAYWRIGHT_CHANNEL, serviceWorkers: "block", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" } },
  ],
  webServer: process.env.E2E_BASE_URL ? undefined : { command: "npm run dev", url: "http://127.0.0.1:3000", reuseExistingServer: !process.env.CI },
});
