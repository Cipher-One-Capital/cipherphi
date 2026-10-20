import { defineConfig } from "@playwright/test";

/**
 * `npm run e2e` walks the four moments in a fresh browser against live
 * testnet. BASE_URL points it at a deployment; without it, the local dev
 * server, which uses a local test key in place of Privy.
 */
export default defineConfig({
  testDir: "e2e",
  timeout: 240_000,
  expect: { timeout: 90_000 },
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:3100",
    viewport: { width: 1280, height: 860 },
    video: process.env.RECORD ? { mode: "on", size: { width: 1280, height: 860 } } : "off",
  },
  outputDir: "test-results",
});
