/**
 * Playwright configuration (Phases 1-2, 4, 8).
 * The app server is NOT managed here — start it first with `npm run dev:test`
 * (`tests/.artifacts/dev-server.json` provides the base URL). This keeps
 * production-safety guards (Resend mock, staging env) in one place.
 */
import { defineConfig, devices } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

function baseURL() {
  try {
    const f = path.join(__dirname, ".artifacts", "dev-server.json");
    return JSON.parse(fs.readFileSync(f, "utf8")).baseUrl as string;
  } catch {
    return process.env.APP_URL ?? "http://localhost:5173";
  }
}

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "tests/.artifacts/playwright-report" }]],
  outputDir: "tests/.artifacts/playwright-output",
  use: {
    baseURL: baseURL(),
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
