import { randomBytes } from "node:crypto";
import { test as base, expect, type Page } from "@playwright/test";
import { clearSignUpLimits, confirmationLinkFor } from "../../api/test/e2e-support.ts";

/** Shared steps of the end-to-end tests (NFR-07@PoC). Synthetic people and addresses only (`example.test`). */
function env(name: string): string {
  const value = process.env[name];
  if (!value)
    throw new Error(`${name} is not set: run the tests through e2e/playwright.config.ts (global setup)`);
  return value;
}

export interface Person {
  readonly name: string;
  readonly email: string;
  readonly password: string;
}

export interface Stack {
  /** A new synthetic person with a unique address. */
  person(): Person;
  /** The confirmation letter's link for the address (see confirmationLinkFor). */
  confirmationLink(email: string): Promise<string>;
}

export const test = base.extend<{ stack: Stack }>({
  // Playwright reads fixture dependencies from the destructuring pattern; this one has none.
  // eslint-disable-next-line no-empty-pattern
  baseURL: async ({}, provide) => provide(env("WS_E2E_BASE_URL")),
  stack: async ({ baseURL }, provide) => {
    const databaseUrl = env("WS_E2E_DATABASE_URL");
    // One client address for every test: the per-address sign-up limit must not decide the outcome.
    await clearSignUpLimits(databaseUrl);
    await provide({
      person: () => ({
        name: "Олена Синтетична",
        email: `e2e.${randomBytes(6).toString("hex")}@example.test`,
        password: ["synthetic", "end", "to", "end", randomBytes(4).toString("hex")].join(" "),
      }),
      confirmationLink: (email) => confirmationLinkFor(databaseUrl, email, baseURL!),
    });
  },
});
export { expect };

export const h1 = (page: Page) => page.getByRole("heading", { level: 1 });

/** S-001: fills the form, passes the synthetic CAPTCHA and sends it; ends on S-002 «Перевірте пошту». */
export async function signUp(page: Page, who: Person): Promise<void> {
  await page.goto("/#/signup");
  await expect(h1(page)).toHaveText("Створити акаунт");
  await page.getByLabel(/^Ім’я/).fill(who.name);
  await page.getByRole("textbox", { name: /^Email/ }).fill(who.email);
  await page
    .getByLabel(/^Пароль/, { exact: false })
    .first()
    .fill(who.password);
  await page.getByRole("checkbox", { name: "Я не робот" }).check();
  await page.getByRole("button", { name: /^Створити акаунт/ }).click();
  await expect(h1(page)).toHaveText("Перевірте пошту");
}

/** S-004: email and password, then «Увійти». */
export async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/#/login");
  await expect(h1(page)).toHaveText("Вхід");
  await page.getByRole("textbox", { name: /^Email/ }).fill(email);
  await page
    .getByLabel(/^Пароль/)
    .first()
    .fill(password);
  await page.getByRole("button", { name: /^Увійти/ }).click();
}
