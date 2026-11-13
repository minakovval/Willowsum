import type { Page } from "@playwright/test";
import {
  AUTH_PATHS,
  canonicalPath,
  CHILDREN,
  GALLERY_TOKENS_PATH,
  IMPORT_WIZARD_PATH,
  SECTIONS,
  SETTINGS_PATH,
} from "../src/routing/routes.ts";
import { findContrastProblems, type ContrastProblem } from "./contrast.ts";
import { expect, h1, signIn, signUp, test } from "./fixtures.ts";

/**
 * DS-06@PoC AC2: the contrast check of every route in the light theme at 1280 px (NFR-07@PoC), in Chromium and
 * WebKit. The routes come from the app's own route table, so a new route is checked without editing this file.
 * Auth screens are also checked in the states a person reaches only through the API (errors, the notice of an
 * unconfirmed account, «Перевірте пошту» of a real sign-up).
 */
const NOT_FOUND = "/no-such-page";
const routes: readonly string[] = [
  "/",
  ...SECTIONS.flatMap((s) => s.pages.map((p) => p.path)),
  ...CHILDREN.map((c) => c.path),
  SETTINGS_PATH,
  IMPORT_WIZARD_PATH,
  GALLERY_TOKENS_PATH,
  // «/signup/check-email» needs a sign-up in progress: checked below after a real one.
  ...Object.keys(AUTH_PATHS).filter((p) => p !== "/signup/check-email"),
  NOT_FOUND,
];

async function expectNoContrastProblems(page: Page): Promise<void> {
  // Fonts and the first paint settle before measuring.
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  const problems: ContrastProblem[] = await page.evaluate(findContrastProblems);
  expect(problems, JSON.stringify(problems, null, 2)).toEqual([]);
}

test.describe("DS-06@PoC AC2: contrast of every route, light theme, 1280 px", () => {
  for (const path of routes) {
    test(`DS-06@PoC AC2: ${path}`, async ({ page }) => {
      await page.goto(`/#${path}`);
      await expect(h1(page).first()).toBeVisible();
      // The route itself rendered: the address is its own (or its canonical one) and not «Сторінку не знайдено».
      const shown = canonicalPath(path);
      await expect(page).toHaveURL((url) => url.hash === `#${shown}`);
      if (path === NOT_FOUND) await expect(h1(page)).toHaveText("Сторінку не знайдено");
      else await expect(h1(page).first()).not.toHaveText("Сторінку не знайдено");
      await expectNoContrastProblems(page);
    });
  }

  test("DS-06@PoC AC2: sign-up with every field's error shown", async ({ page }) => {
    await page.goto("/#/signup");
    // The button is inactive (`aria-disabled`) but still answers a press by showing every field's reason.
    await page.getByRole("button", { name: /^Створити акаунт/ }).click({ force: true });
    await expect(page.getByText("Введіть ім’я")).toBeVisible();
    await expectNoContrastProblems(page);
  });

  test("DS-06@PoC AC2: «Перевірте пошту» after a real sign-up", async ({ page, stack }) => {
    await signUp(page, stack.person());
    await expectNoContrastProblems(page);
  });

  test("DS-06@PoC AC2: sign-in with «Невірний email або пароль» and with «Спершу підтвердіть email»", async ({
    page,
    stack,
  }) => {
    const who = stack.person();
    await signIn(page, who.email, who.password);
    await expect(page.getByText("Невірний email або пароль")).toBeVisible();
    await expectNoContrastProblems(page);

    await signUp(page, who);
    await signIn(page, who.email, who.password);
    await expect(page.getByText("Спершу підтвердіть email.")).toBeVisible();
    await expectNoContrastProblems(page);
  });

  test("DS-06@PoC AC2: «Email підтверджено» of a real confirmation link", async ({ page, stack }) => {
    const who = stack.person();
    await signUp(page, who);
    await page.goto(await stack.confirmationLink(who.email));
    await expect(h1(page)).toHaveText("Email підтверджено");
    await expectNoContrastProblems(page);
  });
});
