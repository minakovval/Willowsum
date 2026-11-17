import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";

/**
 * FIN-03@PoC FR 28 with CMP-21@PoC AC13, AC21: S-048 «Нова транзакція» on the smallest supported desktop window,
 * 1280 × 720 px — at most 624 px, nothing scrolls, the same height and bar position on every step. The API is answered
 * in the browser with synthetic data (one account, one merchant, one category group), so the layout alone is measured.
 */
test.use({ viewport: { width: 1280, height: 720 } });

const LIMIT = 720 - 2 * 48;
const TODAY = "2026-11-02";
const money = (amount: string) => ({ amount, currency: "EUR" });
const DATA: Record<string, unknown> = {
  accounts: {
    items: [
      {
        id: "00000000-0000-4000-8000-000000000001",
        kind: "current",
        group: "cash",
        name: "Поточний",
        institution: null,
        number: { last4: "4417", masked: "••4417" },
        status: "active",
        closedOn: null,
        source: "manual",
        updatedOn: TODAY,
        inProfileCurrency: { total: money("1000.00"), approximate: false, unavailableCount: 0 },
        currencies: [
          {
            currency: "EUR",
            amount: money("1000.00"),
            equivalent: money("1000.00"),
            rateDate: null,
            approximate: false,
            restricted: false,
          },
        ],
        creditCard: null,
        loan: null,
      },
    ],
    nextCursor: null,
  },
  merchants: {
    items: [
      {
        id: "m1",
        name: "Сільпо",
        initials: "С",
        intermediary: false,
        mergedInto: null,
        transactionCount: 23,
      },
    ],
  },
  categories: { groups: [] },
};

async function answerApi(page: Page) {
  await page.route("**/v1/**", (route) => {
    const url = new URL(route.request().url());
    const name = url.pathname.split("/")[2] ?? "";
    const body =
      route.request().method() === "GET" && name in DATA
        ? DATA[name]
        : url.pathname === "/v1/session"
          ? {
              expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
              idleExpiresAt: new Date(Date.now() + 1_800_000).toISOString(),
            }
          : {};
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
}

async function box(page: Page) {
  return page.locator("dialog.ws-dialog[open]").evaluate((d) => {
    const body = d.querySelector<HTMLElement>(".ws-dialog-body")!;
    const bar = d.querySelector<HTMLElement>(".ws-dialog-actions")!;
    return {
      height: d.getBoundingClientRect().height,
      scrolls: body.scrollHeight > body.clientHeight + 0.5 || d.scrollHeight > d.clientHeight + 0.5,
      barTop: bar.getBoundingClientRect().top,
    };
  });
}

test("FIN-03@PoC FR 28: «Нова транзакція» at 1280 × 720 — at most 624 px, no scrolling, the same height and bar position on all three steps", async ({
  page,
}) => {
  await answerApi(page);
  await page.goto("/#/money/transactions/new");
  const dialog = page.getByRole("dialog", { name: "Нова транзакція" });
  await expect(dialog.getByRole("button", { name: /^Рахунок/ })).toContainText("Поточний");
  await expect(dialog.getByRole("link", { name: "Імпортувати виписку" })).toBeVisible();
  const amount = dialog.getByRole("textbox", { name: /Сума/ });
  await amount.fill("45,50");
  await amount.blur();
  const first = await box(page);
  expect(first.height).toBeLessThanOrEqual(LIMIT);
  expect(first.scrolls).toBe(false);
  // «Скасувати» at the start, «Далі» and the main action at the end, in one row (CMP-21 п. 6).
  const bar = await dialog
    .locator(".ws-dialog-action")
    .evaluateAll((buttons) => buttons.map((b) => Math.round(b.getBoundingClientRect().top)));
  expect(new Set(bar).size).toBe(1);
  for (const step of [2, 3]) {
    await dialog.getByRole("button", { name: "Далі" }).click();
    await expect(dialog.locator(`.ws-form-step[data-step="${step - 1}"]`)).not.toHaveAttribute("inert");
    expect(await box(page)).toEqual(first);
  }
  await dialog.getByRole("button", { name: "Назад" }).click();
  expect(await box(page)).toEqual(first);
});
