import type { Locator, Page } from "@playwright/test";
import {
  AUTH_PATHS,
  canonicalPath,
  CHILDREN,
  GALLERY_TOKENS_PATH,
  IMPORT_WIZARD_PATH,
  PROFILE_PATH,
  SECTIONS,
  SETTINGS_PATH,
  SPACE_SETTINGS_PATH,
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
  PROFILE_PATH,
  SPACE_SETTINGS_PATH,
  IMPORT_WIZARD_PATH,
  GALLERY_TOKENS_PATH,
  // «/signup/check-email» needs a sign-up in progress: checked below after a real one.
  ...Object.keys(AUTH_PATHS).filter((p) => p !== "/signup/check-email"),
  NOT_FOUND,
];

async function expectNoContrastProblems(page: Page): Promise<void> {
  // Fonts and the first paint settle before measuring.
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  // A control that is changing state (a button going from disabled to enabled, a dialog opening) is measured on the
  // colours it is fading through, not on its final ones: wait until no finite transition or animation is running.
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            document
              .getAnimations()
              .filter(
                (a) => a.playState === "running" && a.effect?.getComputedTiming().iterations !== Infinity,
              ).length,
        ),
      { message: "transitions and animations finished before the contrast is measured" },
    )
    .toBe(0);
  const problems: ContrastProblem[] = await page.evaluate(findContrastProblems);
  expect(problems, JSON.stringify(problems, null, 2)).toEqual([]);
}

/**
 * «Підтвердити» is `aria-disabled` while the request runs and returns to its colour after it: measured in between, it
 * is grey on grey (2.99), so the state change has to be over first. (Absent once the dialog locks, then it is gone.)
 */
async function expectConfirmIdle(dialog: Locator): Promise<void> {
  const confirm = dialog.getByRole("button", { name: "Підтвердити" });
  await expect(confirm).not.toHaveAttribute("aria-disabled", "true");
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

  test("DS-06@PoC AC2: «Розділити транзакцію» (S-049) in both modes, gallery", async ({ page }) => {
    await page.goto(`/#${GALLERY_TOKENS_PATH}`);
    await page.getByRole("button", { name: "Розділити", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Розділити транзакцію" });
    await expect(dialog).toBeVisible();
    await expectNoContrastProblems(page);
    await dialog.getByRole("radio", { name: "На кілька місяців" }).check();
    await expect(dialog.getByText(/частин(и)? по/).first()).toBeVisible();
    await expectNoContrastProblems(page);
    // AC8: no scrolling in the dialog, also before a category is chosen (the reason line is shown) and for 36 months.
    const fits = () => dialog.evaluate((e) => e.scrollHeight <= e.clientHeight && e.clientHeight <= 624);
    expect(await fits()).toBe(true);
    await dialog.getByLabel(/Місяців/).fill("36");
    expect(await fits()).toBe(true);
  });

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

test.describe("DS-06@PoC AC2: contrast of the CMP-21 dialogs in the gallery, light theme, 1280 px", () => {
  for (const name of ["delete", "unsaved", "options", "column", "error", "form", "short", "word"]) {
    test(`DS-06@PoC AC2: dialog «${name}»`, async ({ page }) => {
      await page.goto(`/#${GALLERY_TOKENS_PATH}`);
      await page.locator(`button[data-case="${name}"]`).click();
      const dialog = page.locator("dialog.ws-dialog[open]");
      await expect(dialog).toBeVisible();
      if (name === "error") {
        await dialog.locator('.ws-dialog-action[data-variant="danger"]').click();
        await expect(dialog.getByRole("alert")).toContainText("Помилка");
      }
      if (name === "form") {
        // The step indicator, «Обов’язкове поле» under the left fields and the reason line above the inactive buttons.
        await page.keyboard.press("Tab");
        await page.keyboard.press("Tab");
        await expect(dialog.locator(".ws-field-error")).toHaveCount(2);
      }
      await expectNoContrastProblems(page);
    });
  }
});

/**
 * DS-06@PoC AC2 on «Налаштування» (S-186), «Профіль» (S-187) and the step-up dialog (S-032) in the states the route
 * table alone does not reach (ACC-05@PoC «Стани інтерфейсу»). The profile is answered here in the browser
 * (synthetic), so no account is needed.
 */
test.describe("DS-06@PoC AC2: «Налаштування», «Профіль» and step-up in their states", () => {
  const profile = {
    name: "Олена Синтетична",
    email: "olena@example.test",
    locale: "uk-UA",
    timeZone: "Europe/Kyiv",
  };
  const json = (body: unknown, status = 200) => ({
    status,
    contentType: status < 400 ? "application/json" : "application/problem+json",
    body: JSON.stringify(body),
  });
  const problemOf = (status: number, code: string) =>
    json({ type: "about:blank", title: code, status, code }, status);

  test("DS-06@PoC AC2: «Налаштування» with the profile and with its load error", async ({ page }) => {
    let fail = false;
    await page.route("**/v1/profile", (route) =>
      route.fulfill(fail ? problemOf(500, "INTERNAL") : json(profile)),
    );
    await page.goto(`/#${SETTINGS_PATH}`);
    await expect(page.getByText(profile.email)).toBeVisible();
    await expectNoContrastProblems(page);
    fail = true;
    await page.reload();
    await expect(page.getByRole("alert")).toContainText("Не вдалося завантажити профіль");
    await expectNoContrastProblems(page);
  });

  test("DS-06@PoC AC2: «Профіль» saved, a failed save, a short password and the step-up dialog with its errors", async ({
    page,
  }) => {
    let failSave = false;
    let stepUp = 0;
    await page.route("**/v1/profile", (route) =>
      route.request().method() === "PATCH"
        ? route.fulfill(failSave ? problemOf(500, "INTERNAL") : json({ ...profile, name: "Олена Інша" }))
        : route.fulfill(json(profile)),
    );
    await page.route("**/v1/session/step-up", (route) =>
      route.fulfill(
        ++stepUp === 1
          ? problemOf(403, "STEP_UP_PASSWORD_INVALID")
          : { ...problemOf(429, "SIGN_IN_LOCKED"), headers: { "Retry-After": "900" } },
      ),
    );
    await page.goto(`/#${PROFILE_PATH}`);
    const name = page.getByRole("textbox", { name: /^Ім’я/ });
    await expect(name).toHaveValue(profile.name);
    await expectNoContrastProblems(page);

    await name.fill("Олена Інша");
    await page.getByRole("button", { name: "Зберегти", exact: true }).click();
    await expect(page.getByText("Профіль збережено")).toBeVisible();
    await expectNoContrastProblems(page);

    failSave = true;
    await name.fill("Ще інша");
    await page.getByRole("button", { name: "Зберегти", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Не вдалося зберегти. Спробуйте ще раз");
    await expectNoContrastProblems(page);

    await page.getByRole("button", { name: "Змінити пароль" }).click();
    await page.getByLabel(/^Новий пароль/).fill("short");
    await page.getByRole("button", { name: "Зберегти пароль" }).click();
    await expect(page.getByText(/не коротшим за\s12\sсимволів/)).toBeVisible();
    await expectNoContrastProblems(page);

    await page.getByLabel(/^Новий пароль/).fill("synthetic-new-password");
    await page.getByRole("button", { name: "Зберегти пароль" }).click();
    const dialog = page.getByRole("dialog", { name: "Підтвердіть, що це ви" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel(/^Поточний пароль/)).toBeFocused();
    await expectConfirmIdle(dialog);
    await expectNoContrastProblems(page);

    await dialog.getByLabel(/^Поточний пароль/).fill("synthetic-wrong");
    await dialog.getByRole("button", { name: "Підтвердити" }).click();
    await expect(dialog.getByText("Пароль неправильний")).toBeVisible();
    await expectConfirmIdle(dialog);
    await expectNoContrastProblems(page);

    await dialog.getByLabel(/^Поточний пароль/).fill("synthetic-wrong");
    await dialog.getByRole("button", { name: "Підтвердити" }).click();
    await expect(dialog.getByRole("alert")).toContainText("Вхід тимчасово заблоковано. Спробуйте через 15");
    await expectNoContrastProblems(page);

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("button", { name: "Зберегти пароль" })).toBeFocused();
  });
});

/**
 * DS-06@PoC AC2 on «Налаштування → Простір» (S-200, ACC-08@PoC FR 5) in the states the route table alone does not
 * reach: the flag `household.space-settings` ships off, so the space is answered here in the browser (synthetic).
 */
test.describe("DS-06@PoC AC2: «Простір» (S-200) in its states", () => {
  test("DS-06@PoC AC2: «Простір» with its name, an invalid name, a saved name and a failed save", async ({
    page,
  }) => {
    let failSave = false;
    await page.route("**/v1/space", async (route) => {
      const request = route.request();
      if (request.method() === "PATCH" && failSave)
        return route.fulfill({
          status: 500,
          contentType: "application/problem+json",
          body: JSON.stringify({ type: "about:blank", title: "INTERNAL", status: 500, code: "INTERNAL" }),
        });
      const name =
        request.method() === "PATCH"
          ? (JSON.parse(request.postData() ?? "{}") as { name: string }).name
          : "Родина Коваль";
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ name, dataRegion: "eu", reportingCurrency: "EUR" }),
      });
    });
    await page.goto(`/#${SPACE_SETTINGS_PATH}`);
    const field = page.getByRole("textbox", { name: /Назва простору/ });
    await expect(field).toHaveValue("Родина Коваль");
    await expectNoContrastProblems(page);

    await field.fill("");
    await page.getByRole("button", { name: "Зберегти" }).click();
    await expect(page.getByText("Введіть назву простору.")).toBeVisible();
    await expectNoContrastProblems(page);

    await field.fill("Коваль і батьки");
    await page.getByRole("button", { name: "Зберегти" }).click();
    await expect(page.getByText("Назву збережено")).toBeVisible();
    await expectNoContrastProblems(page);

    failSave = true;
    await field.fill("Інша назва");
    await page.getByRole("button", { name: "Зберегти" }).click();
    await expect(page.getByRole("alert")).toContainText("Не вдалося виконати дію. Спробуйте ще раз");
    await expectNoContrastProblems(page);
  });
});
