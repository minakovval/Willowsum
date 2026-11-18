import { expect, test } from "./fixtures.ts";
import { answerApi, ID } from "./rules-api.ts";

/**
 * BUD-14@PoC FR 4: the order of S-197 «Правила категорій» changes by dragging the handle «#» (HTML drag and drop; jsdom
 * has no drag, so this is measured in Chromium only (issue #516; the keyboard path is rules-focus.spec.ts). The API is answered in the browser, as there.
 */
test.use({ viewport: { width: 1280, height: 900 } });

test.describe("BUD-14@PoC FR 4: the order by the drag handle", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "HTML drag and drop is checked in Chromium");

  test("BUD-14@PoC FR 4: dragging the handle of the first rule onto the third moves it to place 3", async ({
    page,
  }) => {
    await answerApi(page);
    await page.goto("/#/money/transactions/rules");
    const rows = page.locator("tbody tr");
    await expect(rows.first()).toBeVisible();
    const move = page.waitForRequest(
      (r) => r.method() === "POST" && r.url().endsWith(`/v1/category-rules/${ID(1)}/move`),
    );
    await page.locator(`#rule-${ID(1)} .rules-handle`).dragTo(page.locator(`#rule-${ID(3)}`));
    expect((await move).postDataJSON()).toEqual({ position: 3 });
    await expect(rows).toHaveCount(4);
    for (const [i, n] of [2, 3, 1, 4].entries())
      await expect(rows.nth(i)).toHaveAttribute("id", `rule-${ID(n)}`);
    await expect(page.locator(`#rule-${ID(1)} .rules-position`)).toHaveText("3");
  });

  test("BUD-14@PoC FR 4: dragging the last rule onto the first gives it the highest priority", async ({
    page,
  }) => {
    await answerApi(page);
    await page.goto("/#/money/transactions/rules");
    await expect(page.locator(`#rule-${ID(4)}`)).toBeVisible();
    await page.locator(`#rule-${ID(4)} .rules-handle`).dragTo(page.locator(`#rule-${ID(1)}`));
    const rows = page.locator("tbody tr");
    for (const [i, n] of [4, 1, 2, 3].entries())
      await expect(rows.nth(i)).toHaveAttribute("id", `rule-${ID(n)}`);
  });
});
