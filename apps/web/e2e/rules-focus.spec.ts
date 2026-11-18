import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { answerApi, ID } from "./rules-api.ts";

/**
 * BUD-14@PoC FR 4 with WCAG 2.2 AA 2.4.3: «Вище» / «Нижче» of S-197 «Правила категорій» keep the keyboard focus on the
 * same button of the same rule after the table is read again. jsdom does not move focus when React re-inserts a row,
 * so this is measured in Chromium and WebKit. The API is answered in the browser with synthetic data and a stateful
 * order, as in `new-transaction.spec.ts`.
 */
test.use({ viewport: { width: 1280, height: 900 } });

const active = (page: Page) =>
  page.evaluate(() => ({
    rule: document.activeElement?.closest("tr")?.id ?? null,
    name: document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.tagName ?? null,
  }));

test.describe("BUD-14@PoC FR 4: the order by keyboard keeps the focus", () => {
  test("BUD-14@PoC FR 4: «Нижче» then «Вище» on one rule leave the focus on that button of that rule", async ({
    page,
  }) => {
    await answerApi(page);
    await page.goto("/#/money/transactions/rules");
    const row = page.locator(`#rule-${ID(2)}`);
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "Нижче" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("tbody tr").nth(2)).toHaveAttribute("id", `rule-${ID(2)}`);
    expect(await active(page)).toEqual({ rule: `rule-${ID(2)}`, name: "Нижче" });
    await page.keyboard.press("Enter");
    await expect(page.locator("tbody tr").nth(3)).toHaveAttribute("id", `rule-${ID(2)}`);
    // The last place: «Нижче» is inactive now, the focus is on «Вище» of the same rule.
    expect(await active(page)).toEqual({ rule: `rule-${ID(2)}`, name: "Вище" });
    await page.keyboard.press("Enter");
    await expect(page.locator("tbody tr").nth(2)).toHaveAttribute("id", `rule-${ID(2)}`);
    expect(await active(page)).toEqual({ rule: `rule-${ID(2)}`, name: "Вище" });
  });

  test("BUD-14@PoC FR 4: at the first place «Вище» is inactive and the focus goes to «Нижче» of the same rule", async ({
    page,
  }) => {
    await answerApi(page);
    await page.goto("/#/money/transactions/rules");
    const row = page.locator(`#rule-${ID(2)}`);
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "Вище" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("tbody tr").nth(0)).toHaveAttribute("id", `rule-${ID(2)}`);
    expect(await active(page)).toEqual({ rule: `rule-${ID(2)}`, name: "Нижче" });
  });
});
