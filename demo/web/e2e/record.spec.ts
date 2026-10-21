import { expect, test } from "@playwright/test";

// The fallback screen recording: the four moments at a pace a viewer can
// follow, about two minutes. `RECORD=1 npx playwright test e2e/record.spec.ts`
// writes a .webm under test-results/.
test.skip(!process.env.RECORD, "recording only");
test.use({ viewport: { width: 1280, height: 860 } });

const hold = (page: import("@playwright/test").Page, ms: number) => page.waitForTimeout(ms);

async function glide(page: import("@playwright/test").Page, to: number) {
  await page.evaluate(async (y) => {
    const start = window.scrollY;
    const steps = 40;
    for (let i = 1; i <= steps; i++) {
      window.scrollTo(0, start + ((y - start) * i) / steps);
      await new Promise((r) => setTimeout(r, 25));
    }
  }, to);
}

test("recording", async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto("/");
  await hold(page, 4000);
  await page.getByRole("button", { name: "I understand" }).click();
  await hold(page, 2000);

  // 1. Give
  await page.getByRole("button", { name: /Sign in with your email|Start with a test wallet/ }).click();
  await expect(page.locator(".figure")).toContainText("100");
  await hold(page, 5000);
  await page.getByRole("button", { name: /Give 50 tCHF/ }).click();

  // 2. Split
  await expect(page.locator(".split .split-row:not(.split-head):not(.split-total)")).toHaveCount(8);
  await hold(page, 6000);
  await glide(page, 520);
  await hold(page, 8000);
  await glide(page, 1000);
  await hold(page, 6000);
  await page.getByRole("button", { name: "Next: Release" }).click();
  await glide(page, 0);

  // 3. Release
  await hold(page, 6000);
  await page.getByRole("button", { name: "Release with approval" }).click();
  await expect(page.locator(".outcome.paid")).toBeVisible();
  await glide(page, 300);
  await hold(page, 8000);
  await page.getByRole("button", { name: "Try it without approval" }).click();
  await expect(page.locator(".outcome.refused")).toBeVisible();
  await glide(page, 620);
  await hold(page, 10000);
  await page.getByRole("button", { name: "Next: Check" }).click();
  await glide(page, 0);

  // 4. Check it
  await hold(page, 4000);
  await page.getByRole("link", { name: "Open your receipt" }).click();
  await expect(page.getByText("received by the zakat pool")).toBeVisible();
  await expect(page.getByText(/to the partner organisation/)).toBeVisible();
  await hold(page, 8000);
  await glide(page, 520);
  await hold(page, 8000);

  // The same record on the public explorer.
  const href = await page.locator('a[href*="stellar.expert/explorer/testnet/tx/"]').nth(2).getAttribute("href");
  await page.goto(href!);
  await hold(page, 12000);
});
