import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * A first visit with the tips on, against live testnet: each tip shows in
 * turn, points at the right thing, passes axe, and moves on either with
 * "Got it" or by using what it points at. With DESIGN_CHECK set, every tip is
 * also captured at 1280 and 375 px.
 *
 *   DESIGN_CHECK=../design-check npx playwright test e2e/tips.spec.ts
 */
test.setTimeout(400_000);

const OUT = process.env.DESIGN_CHECK;
const seen: string[] = [];

async function tip(page: Page, title: string) {
  const bubble = page.locator(".tip");
  await expect(bubble).toHaveCount(1, { timeout: 120_000 });
  await expect(bubble.locator(".tip-title")).toHaveText(title);
  // The tip scrolls itself into view: no scrolling needed to read it.
  await expect
    .poll(() => bubble.evaluate((e) => {
      const r = e.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= innerHeight;
    }))
    .toBe(true);
  await expect(bubble.getByRole("button", { name: "Got it" })).toBeFocused();
  // Measure contrast once the bubble, and anything else sliding in (a new
  // donation in the live strip), has finished animating, not halfway through.
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Infinity)
        .map((a) => a.finished),
    ),
  );
  const axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .exclude("nextjs-portal")
    .analyze();
  const failures = axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
  expect(failures, title).toEqual([]);
  if (OUT) {
    const name = `7-tip-${String(seen.length + 1).padStart(2, "0")}-${title.toLowerCase().replace(/[^a-z]+/g, "-")}`;
    for (const [w, h] of [[1280, 860], [375, 812]]) {
      await page.setViewportSize({ width: w, height: h });
      await bubble.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${OUT}/${name}-${w}.png` });
    }
    await page.setViewportSize({ width: 1280, height: 860 });
  }
  seen.push(title);
}

const gotIt = (page: Page) => page.locator(".tip").getByRole("button", { name: "Got it" }).click();

test("first visit, with tips", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "I understand" }).click();

  // Landing: no tip on the Start button.
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeVisible();
  await page.waitForTimeout(800);
  await expect(page.locator(".tip")).toHaveCount(0);
  let release: () => void = () => {};
  const held = new Promise<void>((r) => (release = r));
  await page.route("**/api/onboard", async (route) => {
    await held;
    await route.continue();
  });
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await tip(page, "Setting you up");
  await gotIt(page);
  release();

  await tip(page, "Your test balance");
  await gotIt(page);
  await tip(page, "Choose your zakat");
  await page.getByRole("button", { name: "1.00 USDC", exact: true }).click();
  await tip(page, "Give your zakat");
  await page.getByRole("button", { name: "Give 1.00 USDC as zakat" }).click();

  await tip(page, "Where your zakat went");
  await gotIt(page);
  await tip(page, "Placeholder percentages");
  await gotIt(page);
  await tip(page, "Live donations");
  await gotIt(page);
  await page.getByRole("button", { name: "Next: Release" }).click();

  await tip(page, "Two keys for every payout");
  await gotIt(page);
  await tip(page, "Pay a partner, with approval");
  await page.getByRole("button", { name: "Release with approval" }).click();
  await tip(page, "Now try to cheat");
  await gotIt(page);
  await tip(page, "Paid");
  await gotIt(page);
  await page.getByRole("button", { name: "Try it without approval" }).click();
  await tip(page, "Refused");
  await gotIt(page);
  await page.getByRole("button", { name: "Next: Check" }).click();

  await tip(page, "Check it yourself");
  await page.getByRole("link", { name: "Open your receipt" }).click();

  // Opening the receipt ends the demo with a closing message, once; the last
  // tip follows it.
  const done = page.getByRole("dialog", { name: "Demo complete" });
  await expect(done).toBeVisible();
  await expect(done.getByRole("link", { name: /technical architecture/ })).toHaveAttribute("href", /ARCHITECTURE\.md$/);
  if (OUT) await page.screenshot({ path: `${OUT}/7-tip-99-demo-end-1280.png` });
  await done.getByRole("button", { name: "Keep exploring" }).click();
  await tip(page, "Verify the system");
  await gotIt(page);
  await expect(done).toBeHidden();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Receipt", exact: true })).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(page.locator(".tip")).toHaveCount(0);
  await expect(done).toBeHidden();
});

test("skipping the tips", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("cipherphi-demo:disclaimer", "1"));
  await page.goto("/");
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await page.locator(".tip").getByRole("button", { name: "Skip tips" }).click({ timeout: 90_000 });
  await expect(page.locator(".tip")).toHaveCount(0);
  await page.reload();
  await page.waitForTimeout(1500);
  await expect(page.locator(".tip")).toHaveCount(0);
  console.log(`tips shown in order: ${seen.join(" → ")}`);
});
