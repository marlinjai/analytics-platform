import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "mobile",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
      },
    },
    {
      name: "tablet",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 768, height: 1024 },
      },
    },
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
  /* Start the dashboard dev server for integration tests.
     Disabled by default — enable with PW_WEB_SERVER=1 when running tests
     that need the live Next.js server. Heatmap rendering tests use
     page.setContent() and run standalone without a server. */
  ...(process.env.PW_WEB_SERVER
    ? {
        webServer: {
          command: "pnpm --filter @analytics-platform/dashboard dev",
          port: 3000,
          reuseExistingServer: !process.env.CI,
        },
      }
    : {}),
});
