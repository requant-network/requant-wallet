import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: [
    ["list"],
    ["html", { outputFolder: ".wallet-test/report", open: "never" }],
  ],
  outputDir: ".wallet-test/e2e",
  use: {
    actionTimeout: 15_000,
    baseURL: "http://127.0.0.1:4173/wallet/",
    browserName: "chromium",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command:
      "node node_modules/vite/bin/vite.js preview --config vite.web.config.ts --host 127.0.0.1 --port 4173 --strictPort",
    url: "http://127.0.0.1:4173/wallet/",
    reuseExistingServer: false,
  },
});
