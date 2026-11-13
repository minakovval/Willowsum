import { devices } from "@playwright/test";
import { expect, h1, signIn, signUp, test } from "./fixtures.ts";
import { SUPPORTED_BROWSERS } from "../src/browser/support.ts";
import { findContrastProblems } from "./contrast.ts";

/**
 * NFR-07@PoC EC1: an unsupported browser sees a notice that lists the supported browsers, and signing in is not
 * blocked. The engines under test are supported, so the unsupported one is a faked user agent (Firefox, which joins in
 * PoC v2); the notice must not appear for the engines' own desktop user agents.
 */
const FIREFOX = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:155.0) Gecko/20100101 Firefox/155.0";
const notice = "Цей браузер не підтримується.";

test.describe("NFR-07@PoC EC1: supported browser", () => {
  // The bundled Chromium can be older than the last two Chrome releases: the Chromium project presents itself as the
  // oldest supported Chrome; WebKit keeps its own Safari user agent.
  test.use({
    userAgent: async ({ browserName }, provide) =>
      provide(
        browserName === "chromium"
          ? `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${SUPPORTED_BROWSERS.chromium}.0.0.0 Safari/537.36`
          : devices["Desktop Safari"].userAgent,
      ),
  });
  test("NFR-07@PoC EC1: no notice in a supported browser", async ({ page }) => {
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
