import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * Every screen state of the design spec, at 1280 × 860 and 375 × 812, against
 * live testnet. Slow steps are held open by delaying the request behind them;
 * nothing is mocked, so every state on the screenshots is one the app reached.
 *
 *   DESIGN_CHECK=../design-check npx playwright test e2e/states.spec.ts
 */
const OUT = process.env.DESIGN_CHECK;
test.skip(!OUT, "set DESIGN_CHECK to the screenshot folder");
// The disclaimer is captured on its own; every other screen starts past it.
test.beforeEach(async ({ page }, info) => {
  if (info.title === "disclaimer") return;
  await page.addInitScript(() => {
    localStorage.setItem("cipherphi-demo:disclaimer", "1");
    localStorage.setItem("cipherphi-demo:tips", "off");
    localStorage.setItem("cipherphi-demo:tips-done", "1");
  });
});
test.setTimeout(600_000);

const SIZES = [
  { name: "1280", width: 1280, height: 860 },
  { name: "375", width: 375, height: 812 },
] as const;

/** One screenshot per size, full page, then back to desktop. */
async function shoot(page: Page, name: string) {
  for (const s of SIZES) {
    await page.setViewportSize({ width: s.width, height: s.height });
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${OUT}/${name}-${s.name}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1280, height: 860 });
}

/**
 * Hold matching requests until `release()` is called. The route stays
 * registered afterwards and lets everything through, because unrouting while a
 * request is held would cancel it.
 */
/** Holds the matching requests until released; `only` narrows them by request. */
function hold(page: Page, url: string | RegExp, only?: (route: Route) => boolean) {
  let open: () => void = () => {};
  const gate = new Promise<void>((r) => (open = r));
  const handler = async (route: Route) => {
    if (!only || only(route)) await gate;
    await route.continue();
  };
  return {
    start: () => page.route(url, handler),
    release: async () => open(),
  };
}

const RPC = /soroban-testnet\.stellar\.org/;

test("disclaimer", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("dialog", { name: "For testing only" })).toBeVisible();
  await shoot(page, "0-disclaimer");
});

test("visitor who releases first", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: /^Start$|Sign in/ })).toBeVisible();
  await shoot(page, "1b-landing-test-wallet");

  // 1d: hold the onboarding request so the setup lines stay up.
  const onboard = hold(page, "**/api/onboard");
  await onboard.start();
  await page.getByRole("button", { name: /^Start$|Sign in/ }).click();
  await expect(page.locator(".setup li")).toHaveCount(2);
  await shoot(page, "1d-setup");
  await onboard.release();

  await expect(page.locator(".figure")).toBeVisible();
  await shoot(page, "1e-ready");

  // Error: the first donation request is dropped before it reaches the server.
  await page.route("**/api/contribute", (r) => r.abort("failed"), { times: 1 });
  await page.getByRole("button", { name: /as zakat/ }).click();
  await expect(page.locator(".error")).toBeVisible({ timeout: 60_000 });
  await shoot(page, "1-error");

  // 1f: hold the real donation request.
  const contribute = hold(page, "**/api/contribute");
  await contribute.start();
  await page.getByRole("button", { name: /as zakat/ }).click();
  await expect(page.getByText("Giving…")).toBeVisible();
  await expect(page.getByText(/^Submitting it to Stellar testnet/)).toBeVisible();
  await shoot(page, "1f-giving");

  // Split loading: hold the pool's balance read behind the split, but not the
  // confirmation polling the donation itself waits on.
  const rpc = hold(page, RPC, (r) => r.request().postData()?.includes("simulateTransaction") ?? false);
  await rpc.start();
  await contribute.release();
  await expect(page.locator(".skeleton")).toBeVisible();
  await shoot(page, "2-split-loading");
  await rpc.release();
  await expect(page.locator(".split .split-row")).toHaveCount(10);
  await page.waitForTimeout(1200);
  await shoot(page, "2-split");

  // 1g: back to Give with a donation recorded.
  await page.getByRole("button", { name: /Step 1, Give|^Give/ }).first().click();
  await expect(page.locator(".panel")).toBeVisible();
  await shoot(page, "1g-returning");
  await page.getByRole("button", { name: "See how it was split" }).click();
  await page.getByRole("button", { name: /^Next/ }).click();

  await expect(page.getByRole("button", { name: "Release with approval" })).toBeVisible();
  await shoot(page, "3-release-start");

  let t = Date.now();
  await page.getByRole("button", { name: "Release with approval" }).click();
  await expect(page.getByText("Releasing…")).toBeVisible();
  await shoot(page, "3-release-busy");
  await expect(page.locator(".outcome.paid")).toBeVisible({ timeout: 120_000 });
  console.log(`release: ${((Date.now() - t) / 1000).toFixed(1)} s`);
  await page.waitForTimeout(400);
  await shoot(page, "3-release-paid");

  t = Date.now();
  await page.getByRole("button", { name: "Try it without approval" }).click();
  await expect(page.locator(".outcome.refused")).toBeVisible({ timeout: 120_000 });
  console.log(`refused attempt: ${((Date.now() - t) / 1000).toFixed(1)} s`);
  await page.waitForTimeout(400);
  await shoot(page, "3-release-both");

  await page.getByRole("button", { name: /^Next/ }).click();
  await expect(page.getByRole("link", { name: "Open your receipt" })).toBeVisible();
  await shoot(page, "4-check");
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "Copy receipt link" }).click();
  await expect(page.getByRole("button", { name: "Link copied" })).toBeVisible();
  await shoot(page, "4-check-copied");
  const receipt = await page.getByRole("link", { name: "Open your receipt" }).getAttribute("href");

  // Receipt, entries still loading.
  const reads = hold(page, RPC);
  await reads.start();
  await page.goto(receipt!);
  await expect(page.getByText("Reading from the ledger…").first()).toBeVisible();
  await shoot(page, "5-receipt-loading");
  await reads.release();
  await page.reload();
  await expect(page.locator(".entry.ok")).toHaveCount(4, { timeout: 60_000 });
  await shoot(page, "5-receipt-full");

  // Receipt with a payout hash the node does not have, and no refused attempt.
  const url = new URL(receipt!, "http://x");
  url.searchParams.set("r", "0".repeat(64));
  url.searchParams.delete("f");
  await page.goto(url.pathname + url.search);
  await expect(page.locator(".entry.missing")).toBeVisible({ timeout: 60_000 });
  await shoot(page, "5-receipt-missing-optional-absent");

  await page.goto("/receipt");
  await shoot(page, "5-receipt-empty");

  // Leaving the finished demo lands on the first page.
  await page.goBack();
  await page.goBack();
  await page.goBack();
  await page.getByRole("button", { name: "Back to the start" }).click();
  await expect(page.getByRole("button", { name: /^Start$|Sign in/ })).toBeVisible();
  await shoot(page, "6-back-to-start");
});

test("visitor who tries without approval first", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /^Start$|Sign in/ }).click();
  await page.getByRole("button", { name: /as zakat/ }).click({ timeout: 90_000 });
  await page.getByRole("button", { name: /^Next/ }).click({ timeout: 90_000 });
  await page.getByRole("button", { name: "Try it without approval" }).click();
  await expect(page.getByText("Trying…")).toBeVisible();
  await expect(page.locator(".outcome.refused")).toBeVisible({ timeout: 120_000 });
  await page.waitForTimeout(400);
  await shoot(page, "3-release-refused");
});
