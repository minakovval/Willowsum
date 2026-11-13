import { expect, h1, signIn, signUp, test } from "./fixtures.ts";
import { SUPPORTED_BROWSERS } from "../src/browser/support.ts";
import { findContrastProblems } from "./contrast.ts";

/**
 * NFR-07@PoC EC1: an unsupported browser sees a notice that lists the supported browsers, and signing in is not
 * blocked. The unsupported one is a faked user agent (Firefox, which joins in PoC v2). «Supported» means released in
 * the last 3 months (FR 1): each project also presents itself as the oldest supported version of its browser.
 */
const FIREFOX = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:155.0) Gecko/20100101 Firefox/155.0";
const notice = "Цей браузер не підтримується.";
const CHROME_AT_MINIMUM = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${SUPPORTED_BROWSERS.chromium.version}.0.0.0 Safari/537.36`;
const SAFARI_AT_MINIMUM = `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${SUPPORTED_BROWSERS.safari.version}.0 Safari/605.1.15`;

test.describe("NFR-07@PoC EC1: supported browser at the minimum", () => {
  test.use({
    userAgent: async ({ browserName }, provide) =>
      provide(browserName === "chromium" ? CHROME_AT_MINIMUM : SAFARI_AT_MINIMUM),
  });
  test("NFR-07@PoC EC1: no notice in the oldest supported Chrome or Safari", async ({ page }) => {
    await page.goto("/#/login");
    await expect(h1(page)).toHaveText("Вхід");
    await expect(page.getByText(notice)).toHaveCount(0);
  });
});

test.describe("NFR-07@PoC EC1: the engine's own user agent", () => {
  test("NFR-07@PoC EC1: the bundled Chromium is a supported Chrome (no override needed)", async ({
    page,
    browserName,
  }) => {
    // Playwright's WebKit reports Safari 26.6 (released 2026-07-27, outside the window), so it shows the notice; the
    // other WebKit tests still pass with it. Only the Chromium engine is checked here.
    test.skip(browserName !== "chromium", "WebKit's bundled Safari version is older than the window");
    await page.goto("/#/login");
    await expect(h1(page)).toHaveText("Вхід");
    await expect(page.getByText(notice)).toHaveCount(0);
  });
});

test.describe("NFR-07@PoC EC1: unsupported browser", () => {
  test.use({ userAgent: FIREFOX });

  test("NFR-07@PoC EC1: the notice names the supported browsers; sign-up, confirmation and sign-in still work", async ({
    page,
    stack,
  }) => {
    const who = stack.person();
    await page.goto("/#/login");
    const status = page.getByRole("status").filter({ hasText: notice });
    await expect(status).toBeVisible();
    await expect(status).toContainText("Chrome, Edge і Safari");
    await expect(status).toContainText("випущених за останні 3 місяці");
    // DS-06@PoC AC2: the notice keeps the contrast rules.
    expect(await page.evaluate(findContrastProblems)).toEqual([]);

    await signUp(page, who);
    await page.goto(await stack.confirmationLink(who.email));
    await expect(h1(page)).toHaveText("Email підтверджено");
    await signIn(page, who.email, who.password);
    await expect(page).toHaveURL(/#\/planning\/budget$/);
    expect((await page.request.get("/v1/session")).status()).toBe(200);
  });
});
