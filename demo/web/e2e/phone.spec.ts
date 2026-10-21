import { expect, test } from "@playwright/test";

// The landing page and a receipt at phone width: no horizontal scroll.
test.use({ viewport: { width: 375, height: 800 } });

test("fits a phone without sideways scrolling", async ({ page }) => {
  for (const path of ["/", `/receipt?c=${process.env.RECEIPT_C ?? ""}&r=${process.env.RECEIPT_R ?? ""}&f=${process.env.RECEIPT_F ?? ""}`]) {
    await page.goto(path);
    await page.waitForTimeout(4000);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `${path} scrolls sideways`).toBeLessThanOrEqual(0);
    if (process.env.SHOTS) {
      await page.screenshot({ path: `${process.env.SHOTS}/phone${path === "/" ? "-landing" : "-receipt"}.png`, fullPage: true });
    }
  }
});
