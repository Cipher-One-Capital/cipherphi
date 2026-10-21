import { defineConfig } from "@playwright/test";

/**
 * `npm run e2e` walks the four moments in a fresh browser against live
 * testnet. BASE_URL points it at a deployment; without it, the local dev
 * server, which uses a local test key in place of Privy. For a Vercel preview,
 * also set VERCEL_AUTOMATION_BYPASS_SECRET.
 */
export default defineConfig({
  testDir: "e2e",
  timeout: 240_000,
  expect: { timeout: 90_000 },
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:3100",
    // Vercel puts preview deployments behind a login. This secret, from the
    // project's Deployment Protection settings, lets the tests through.
    extraHTTPHeaders: process.env.VERCEL_AUTOMATION_BYPASS_SECRET
      ? {
          "x-vercel-protection-bypass": process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
          "x-vercel-set-bypass-cookie": "true",
        }
      : undefined,
    viewport: { width: 1280, height: 860 },
    video: process.env.RECORD ? { mode: "on", size: { width: 1280, height: 860 } } : "off",
  },
  outputDir: "test-results",
});
