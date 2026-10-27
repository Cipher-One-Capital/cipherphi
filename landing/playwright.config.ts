import { defineConfig } from "@playwright/test";

/** `npx playwright test` against a running site: BASE_URL, or `next start -p 3300`. */
export default defineConfig({
  testDir: "e2e",
  use: { baseURL: process.env.BASE_URL ?? "http://localhost:3300" },
  outputDir: "test-results",
});
