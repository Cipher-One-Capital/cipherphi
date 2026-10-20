import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Accessibility pass over every screen, against live testnet:
 * - axe with the WCAG 2.2 A and AA rules, contrast included;
 * - a keyboard walk: every control is reached by Tab and shows the focus ring;
 * - every button is at least 48 px tall.
 *
 *   npx playwright test e2e/a11y.spec.ts
 */
test.setTimeout(400_000);

type Report = { screen: string; violations: string[]; unreachable: string[]; noRing: string[]; short: string[] };
const reports: Report[] = [];

async function check(page: Page, screen: string) {
  await page.waitForTimeout(800);
  const axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .exclude("nextjs-portal")
    .analyze();
  const violations = axe.violations.map(
    (v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
  );

  // Everything the page offers to a pointer, visible and enabled.
  const controls = await page.$$eval(
    "a[href], button:not([disabled]), [tabindex]:not([tabindex='-1'])",
    (els) =>
      els
        .filter((e) => {
          const r = e.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && !e.closest("nextjs-portal");
        })
        .map((e) => (e.textContent || e.getAttribute("aria-label") || e.tagName).trim().slice(0, 40)),
  );

  // Tab through the page once and record what got focus, and whether it shows the ring.
  await page.locator("body").focus();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const reached = new Set<string>();
  const noRing: string[] = [];
  for (let i = 0; i < controls.length + 5; i++) {
    await page.keyboard.press("Tab");
    // Each element is tagged the first time it takes focus, so the walk stops
    // when Tab wraps round, even where two links share a name.
    const f = await page.evaluate(() => {
      const e = document.activeElement as HTMLElement | null;
      if (!e || e === document.body || e.closest("nextjs-portal")) return null;
      if (e.dataset.a11ySeen) return "again";
      e.dataset.a11ySeen = "1";
      const cs = getComputedStyle(e);
      return {
        name: (e.textContent || e.getAttribute("aria-label") || e.tagName).trim().slice(0, 40),
        ring: cs.boxShadow.includes("204, 254, 89") && cs.boxShadow.includes("14, 14, 18"),
      };
    });
    if (!f) continue;
    if (f === "again") break;
    reached.add(f.name);
    if (!f.ring) noRing.push(f.name);
  }
  await page.evaluate(() => document.querySelectorAll("[data-a11y-seen]").forEach((e) => e.removeAttribute("data-a11y-seen")));
  const unreachable = controls.filter((c) => !reached.has(c));

  const short = await page.$$eval("button, .btn", (els) =>
    els
      .filter((e) => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.height < 48 && !e.closest("nextjs-portal") && !e.classList.contains("linkish");
      })
      .map((e) => `${(e.textContent || e.getAttribute("aria-label") || "").trim().slice(0, 30)} ${Math.round(e.getBoundingClientRect().height)}px`),
  );
  reports.push({ screen, violations, unreachable, noRing, short });
}

test("every screen", async ({ page }) => {
  for (const size of [
    { width: 1280, height: 860 },
    { width: 375, height: 812 },
  ]) {
    await page.setViewportSize(size);
    const tag = `${size.width}`;
    await page.goto("/");
    await page.evaluate(() => sessionStorage.clear());
    await page.goto("/");
    await expect(page.getByRole("button", { name: /Start with a test wallet|Sign in/ })).toBeVisible();
    await check(page, `${tag} landing`);
    await page.getByRole("button", { name: /Start with a test wallet|Sign in/ }).click();
    await expect(page.getByRole("button", { name: /as zakat/ })).toBeVisible({ timeout: 90_000 });
    await check(page, `${tag} ready`);
    await page.getByRole("button", { name: /as zakat/ }).click();
    await expect(page.locator(".split-total")).toBeVisible({ timeout: 90_000 });
    await check(page, `${tag} split`);
    await page.getByRole("button", { name: "Next: Release" }).click();
    await check(page, `${tag} release`);
    await page.getByRole("button", { name: "Release with approval" }).click();
    await expect(page.locator(".outcome.paid")).toBeVisible({ timeout: 120_000 });
    await page.getByRole("button", { name: "Try it without approval" }).click();
    await expect(page.locator(".outcome.refused")).toBeVisible({ timeout: 120_000 });
    await check(page, `${tag} release both`);
    await page.getByRole("button", { name: "Next: Check" }).click();
    await check(page, `${tag} check`);
    await page.getByRole("link", { name: "Open your receipt" }).click();
    await expect(page.locator(".entry.ok")).toHaveCount(4, { timeout: 60_000 });
    await check(page, `${tag} receipt`);
    await page.goto("/receipt");
    await check(page, `${tag} receipt empty`);
  }

  // Reduced motion: no spinning, bars at full width without waiting.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const spinning = await page.evaluate(() => {
    const s = document.createElement("div");
    s.innerHTML = '<svg class="spinner"></svg>';
    document.body.append(s);
    return getComputedStyle(s.firstElementChild!).animationName;
  });

  console.log(JSON.stringify({ reports, reducedMotionSpinner: spinning }, null, 2));
  for (const r of reports) {
    expect(r.violations, r.screen).toEqual([]);
    expect(r.unreachable, r.screen).toEqual([]);
    expect(r.noRing, r.screen).toEqual([]);
    expect(r.short, r.screen).toEqual([]);
  }
  expect(spinning).toBe("none");
});
