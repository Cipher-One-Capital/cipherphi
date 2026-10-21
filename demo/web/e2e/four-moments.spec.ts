import { expect, test } from "@playwright/test";

const SHOTS = process.env.SHOTS;
const shot = async (page: import("@playwright/test").Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
};

test("give, see it split, see it released, check it", async ({ page }) => {
  // The first-run tips have their own test; this one walks the flow without them.
  await page.addInitScript(() => localStorage.setItem("cipherphi-demo:tips", "off"));
  await page.goto("/");
  // The disclaimer comes first, once per browser.
  const disclaimer = page.getByRole("dialog", { name: "For testing only" });
  await expect(disclaimer).toContainText("Nothing here moves real money.");
  await disclaimer.getByRole("button", { name: "I understand" }).click();
  await expect(disclaimer).toBeHidden();
  await expect(page.getByRole("navigation", { name: "Demo steps" })).toHaveCount(0);
  await shot(page, "0-landing");

  // 1. Give
  await page.getByRole("button", { name: /Sign in with your email|Start with a test wallet/ }).click();
  await expect(page.getByText("USDC (testnet)")).toBeVisible();
  await expect(page.locator(".figure")).toContainText("10.00");
  await shot(page, "1-give");
  await page.getByRole("button", { name: /Give 5 USDC/ }).click();

  // 2. Split
  await expect(page.getByRole("heading", { name: "Split", exact: true })).toBeVisible();
  await expect(page.locator(".split .split-row:not(.split-head):not(.split-total)")).toHaveCount(8);
  await expect(page.locator(".split .split-total")).toContainText("5.00");
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

  // The receipt leads back to the demo, where the visitor can leave it and land on the first page.
  await page.getByRole("link", { name: /Back to the demo/ }).first().click();
  await expect(page.getByRole("heading", { name: "Demo complete" })).toBeVisible();
  await page.getByRole("button", { name: "Back to the start" }).click();
  await expect(page.getByRole("button", { name: /Sign in with your email|Start with a test wallet/ })).toBeVisible();
  await expect(disclaimer).toBeHidden();
});
