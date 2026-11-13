import { defineConfig, devices } from "@playwright/test";

/**
 * NFR-07@PoC FR 1, criterion «Веб»: end-to-end tests in the Chromium and WebKit engines at a window 1280 px wide
 * (Firefox joins in PoC v2, owner decision 2026-11-12). Light theme only (П-25). The stack — a fresh database, the
 * real API process and the production-like static build behind `vite preview` — starts once in global-setup.ts.
 *
 * Locally: build first (`pnpm --filter @willowsum/web e2e` does), with `DATABASE_URL` a PostgreSQL superuser URL.
 * `WS_E2E_CHROMIUM_PATH` points Chromium at a browser that is already installed (cloud sessions); CI installs its own.
 */
const viewport = { width: 1280, height: 800 };
const chromiumPath = process.env["WS_E2E_CHROMIUM_PATH"];

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.ts",
  globalSetup: "./global-setup.ts",
  fullyParallel: false,
  forbidOnly: Boolean(process.env["CI"]),
  retries: 0,
  workers: process.env["CI"] ? 2 : 1,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: process.env["CI"] ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    colorScheme: "light",
    locale: "uk-UA",
    timezoneId: "Europe/Kyiv",
    viewport,
    trace: "retain-on-failure",
    // The stack serves HTTPS with a certificate made for this run (global-setup.ts).
    ignoreHTTPSErrors: true,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport,
        ...(chromiumPath ? { launchOptions: { executablePath: chromiumPath } } : {}),
      },
    },
    { name: "webkit", use: { ...devices["Desktop Safari"], viewport } },
  ],
});
