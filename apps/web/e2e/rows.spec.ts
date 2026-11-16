import { expect, test } from "./fixtures.ts";

/** CMP-27@PoC, CMP-28@PoC: the rows as laid out in a real browser at 1280 px (the gallery sections). */
test.describe("CMP-27@PoC, CMP-28@PoC: rows at 1280 px", () => {
  test("CMP-27@PoC FR «Будова»: a row is at least 56 px high, the amount takes at most 45 % and keeps its full value", async ({
    page,
  }) => {
    await page.goto("/#/gallery/tokens");
    await expect(page.locator('[data-case="list-row-account"]')).toBeVisible();
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll(".ws-list-row:not(.ws-list-row-loading), .ws-tx-row-list")].map((row) => {
        const r = row.getBoundingClientRect();
        const money = row.querySelector(".ws-row-money")?.getBoundingClientRect();
        const amount = row.querySelector(".ws-row-money .ws-amount");
        return {
          height: r.height,
          share: money ? money.width / r.width : 0,
          cut: amount ? amount.getBoundingClientRect().width < 8 : false,
        };
      }),
    );
    expect(rows.length).toBeGreaterThan(5);
    for (const row of rows) {
      expect(row.height).toBeGreaterThanOrEqual(56);
      expect(row.share).toBeLessThanOrEqual(0.45 + 0.001);
      expect(row.cut).toBe(false);
    }
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBe(0);
  });

  test("CMP-28@PoC AC6: the table's columns line up between the header and the rows", async ({ page }) => {
    await page.goto("/#/gallery/tokens");
    const table = page.locator('[data-case="tx-table"]');
    await expect(table).toBeVisible();
    const lefts = await table.evaluate((root) => {
      const cols = (el: Element | null) =>
        el ? [...el.children].map((c) => Math.round(c.getBoundingClientRect().left)) : [];
      return {
        head: cols(root.querySelector(".ws-tx-head")),
        row: cols(root.querySelector(".ws-tx-row-table:not(.ws-tx-head)")),
      };
    });
    expect(lefts.head.length).toBeGreaterThan(4);
    expect(lefts.row.slice(-1)[0]).toBeGreaterThan(lefts.row[0]!);
  });
});
