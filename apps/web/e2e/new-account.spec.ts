import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { expectFormStepsFit } from "./form-steps.ts";

/**
 * FIN-01@PoC FR 3 (with CMP-21@PoC «Форма створення…», п. 7): S-052 «Новий рахунок» in a real browser on the
 * smallest supported desktop window, 1280 × 720 px — every step of every account type, and the tallest states
 * («Інша установа», a duplicate number, «+ додати ще валюту»), fits the window minus 2 × 48 px without scrolling.
 * The API is answered in the page with synthetic data (no account is created).
 */
test.use({ viewport: { width: 1280, height: 720 } });

const EXISTING = "00000000-0000-4000-8000-000000000202";

async function mockApi(page: Page, duplicate: boolean) {
  await page.route("**/v1/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = (status: number, body: unknown) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (path === "/v1/accounts/banks")
      return json(200, {
        items: [{ code: "322001", name: "Універсал Банк", country: "UA" }],
        nextCursor: null,
        source: { attribution: "НБУ", url: "https://bank.gov.ua", asOf: "2026-11-16" },
      });
    if (path === "/v1/accounts/duplicate-check")
      return json(200, {
        duplicate: duplicate
          ? { accountId: EXISTING, institution: "Універсал Банк", maskedNumber: "••4417" }
          : null,
      });
    if (path === "/v1/accounts") return json(200, { items: [], nextCursor: null });
    return json(404, { type: "about:blank", title: "NOT_FOUND", status: 404, code: "NOT_FOUND" });
  });
}

async function openForm(page: Page, kind: string, duplicate = false) {
  await mockApi(page, duplicate);
  await page.goto(`/#/money/accounts/new?type=${kind}`);
  // The same route with another `?type=` keeps the page: load it afresh.
  await page.reload();
  const dialog = page.getByRole("dialog", { name: "Новий рахунок" });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Steps 1 and 2 filled, then step 3 shown. */
async function toStep3(page: Page, kind: string, duplicate = false) {
  const dialog = await openForm(page, kind, duplicate);
  await dialog.getByRole("textbox", { name: /^Назва/ }).fill("Синтетичний");
  await dialog.getByRole("button", { name: "Далі" }).click();
  await dialog.getByRole("textbox", { name: /^Залишок/ }).fill("120000");
  await dialog.getByRole("button", { name: /^Валюта/ }).click();
  await page.getByRole("combobox", { name: "Пошук" }).fill("EUR");
  await page.getByRole("option", { name: "EUR", exact: true }).click();
  await dialog.getByRole("button", { name: "Далі" }).click();
  await expect(dialog.locator('.ws-form-step[data-step="2"]')).not.toHaveAttribute("inert");
  return dialog;
}

async function noScroll(page: Page) {
  const box = await page.locator("dialog.ws-dialog[open]").evaluate((d) => {
    const body = d.querySelector<HTMLElement>(".ws-dialog-body")!;
    return {
      height: d.getBoundingClientRect().height,
      scrolls: body.scrollHeight > body.clientHeight + 0.5 || d.scrollHeight > d.clientHeight + 0.5,
    };
  });
  expect(box.height).toBeLessThanOrEqual(720 - 2 * 48);
  expect(box.scrolls).toBe(false);
}

for (const kind of ["current", "savings", "deposit", "cash", "credit-card", "loan"])
  test(`FIN-01@PoC FR 3: «Новий рахунок» of the type ${kind} — each of the three steps fits 1280 × 720 without scrolling`, async ({
    page,
  }) => {
    await toStep3(page, kind);
    const m = await expectFormStepsFit(page);
    expect(m.steps).toHaveLength(3);
    await noScroll(page);
  });

test("FIN-01@PoC FR 3, FR 25: a duplicate number with «Відкрити наявний» still fits — «Кредит» and «Поточний» with one more currency", async ({
  page,
}) => {
  const loan = await toStep3(page, "loan", true);
  await loan.getByRole("textbox", { name: /^Номер/ }).fill("4417");
  await expect(loan.getByRole("link", { name: "Відкрити наявний" })).toBeVisible();
  await expectFormStepsFit(page);
  await noScroll(page);

  const current = await toStep3(page, "current", true);
  await current.getByRole("textbox", { name: /^Номер/ }).fill("4417");
  await current.getByRole("button", { name: "+ додати ще валюту" }).click();
  await expect(current.getByRole("link", { name: "Відкрити наявний" })).toBeVisible();
  await expectFormStepsFit(page);
  await noScroll(page);
});

test("FIN-01@PoC FR 4: «Інша установа» with «Назва установи» and «Країна» keeps step 1 within 1280 × 720", async ({
  page,
}) => {
  const dialog = await openForm(page, "current");
  await dialog.getByRole("button", { name: /Банк або установа/ }).click();
  await page.getByRole("option", { name: "Інша установа" }).click();
  await expect(dialog.getByRole("textbox", { name: /^Назва установи/ })).toBeVisible();
  await expectFormStepsFit(page);
  await noScroll(page);
});
