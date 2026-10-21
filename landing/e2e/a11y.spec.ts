import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * The landing page at both widths: no axe violations (WCAG 2.2 A and AA,
 * contrast included), every link and button reachable by Tab with the focus
 * ring, every button at least 48 px tall, and the links pointing where they say.
 */
for (const [width, height] of [
  [1440, 900],
  [375, 812],
]) {
  test(`landing at ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/");

    const axe = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);

    // Tab through once; every stop shows the ink ring.
    const noRing: string[] = [];
    let stops = 0;
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press("Tab");
      const f = await page.evaluate(() => {
        const e = document.activeElement as HTMLElement | null;
        if (!e || e === document.body) return null;
        if (e.dataset.seen) return "again";
        e.dataset.seen = "1";
        const shadow = getComputedStyle(e).boxShadow;
        return { name: (e.textContent || e.tagName).trim().slice(0, 30), ring: shadow.includes("14, 14, 18") };
      });
      if (f === "again") break;
      if (!f) continue;
      stops++;
      if (!f.ring) noRing.push(f.name);
    }
    expect(stops).toBeGreaterThan(5);
    expect(noRing).toEqual([]);

    const short = await page.$$eval(".btn, summary, .nav a, .foot nav a", (els) =>
      els
        .filter((e) => e.getBoundingClientRect().height > 0 && e.getBoundingClientRect().height < 48)
        .map((e) => e.textContent?.trim()),
    );
    expect(short).toEqual([]);

    // Nothing wider than the screen.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    const hrefs = await page.$$eval("a[href^='http']", (as) => [...new Set(as.map((a) => a.getAttribute("href")))]);
    expect(hrefs.sort()).toEqual([
      "https://demo.cipherphi.ch",
      "https://github.com/Cipher-One-Capital/cipherphi",
      "https://github.com/Cipher-One-Capital/cipherphi/blob/main/ARCHITECTURE.md",
    ]);
  });
}
