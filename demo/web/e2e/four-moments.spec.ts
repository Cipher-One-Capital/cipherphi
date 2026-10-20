import { expect, test } from "@playwright/test";

const SHOTS = process.env.SHOTS;
const shot = async (page: import("@playwright/test").Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
};

test("give, see it split, see it released, check it", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Testnet demo.")).toBeVisible();
  await expect(page.getByText("Swiss Islamic Finance · Swiss Zakat Foundation · built by Bits & Blocks")).toBeVisible();
  await shot(page, "0-landing");

  // 1. Give
  await page.getByRole("button", { name: /Sign in with your email|Start with a test wallet/ }).click();
  await expect(page.getByText("tCHF (testnet)")).toBeVisible();
  await expect(page.locator(".figure")).toContainText("100");
  await shot(page, "1-give");
  await page.getByRole("button", { name: /Give 50 tCHF/ }).click();

  // 2. Split
  await expect(page.getByRole("heading", { name: "Split", exact: true })).toBeVisible();
  await expect(page.locator(".split .split-row:not(.split-head):not(.split-total)")).toHaveCount(8);
  await expect(page.locator(".split .split-total")).toContainText("50");
  await page.waitForTimeout(900);
  await shot(page, "2-split");
  await page.getByRole("button", { name: "Next: Release" }).click();

  // 3. Release
  await page.getByRole("button", { name: "Release with approval" }).click();
  await expect(page.locator(".outcome.paid")).toBeVisible();
  await page.getByRole("button", { name: "Try it without approval" }).click();
  const refused = page.locator(".outcome.refused");
  await expect(refused).toBeVisible();
  await expect(refused).toContainText("ThresholdNotMet");
  await shot(page, "3-released");
  await page.getByRole("button", { name: "Next: Check" }).click();

  // 4. Check it
  await page.getByRole("link", { name: "Open your receipt" }).click();
  await expect(page.getByRole("heading", { name: "Receipt", exact: true })).toBeVisible();
  await expect(page.getByText("received by the zakat pool")).toBeVisible();
  await expect(page.getByText(/from the share for the poor to the partner organisation/)).toBeVisible();
  await expect(page.getByText(/fewer than 2 of 3 eligibility signers/).first()).toBeVisible();
  const links = page.locator('a[href^="https://stellar.expert/explorer/testnet/tx/"]');
  expect(await links.count()).toBeGreaterThanOrEqual(4);
  await shot(page, "4-receipt");
});
