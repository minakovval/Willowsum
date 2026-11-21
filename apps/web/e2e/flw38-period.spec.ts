import { expect, type Locator, type Page } from "@playwright/test";
import { test as base } from "@playwright/test";
import { Decimal } from "@willowsum/domain-kernel";
import { ownerQuery } from "../../api/test/e2e-support.ts";
import { seedHistory, type History } from "./flw38-seed.ts";
import { daysIn, kyivToday, shiftMonth, World } from "./world.ts";

/**
 * FLW-38@PoC «Підсумок періоду і порівняння витрат» end to end (wave 2, row 149): a person signs in and the real API
 * answers every screen of the flow in a real browser at 1280 px — «Підсумок періоду» of a finished month, «Порівняння»,
 * «Тренд», «Грошовий потік», the mark «Одноразова витрата» in the transaction's details, the plan «План» whose change
 * does not touch a finished month. The state is built through the API relative to today (flw38-seed.ts); the clock is the
 * machine's, so the dates that depend on it (the day of «Попередній період», AC2) are computed in the test.
 */
const test = base;
test.describe.configure({ mode: "serial" });

let world: World;
let h: History;
let p: Page;
const today = kyivToday();
const month = today.slice(0, 7);
const last = shiftMonth(month, -1);
const MONTHS = [
  "Січень",
  "Лютий",
  "Березень",
  "Квітень",
  "Травень",
  "Червень",
  "Липень",
  "Серпень",
  "Вересень",
  "Жовтень",
  "Листопад",
  "Грудень",
];
/** «Жовтень 2026». */
const label = (m: string) => `${MONTHS[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}`;
/** The amount as the screens write it, spaces normalised: 3100 → «3 100,00 €». */
function eurText(n: Decimal | string): string {
  const [whole, cents] = new Decimal(n).toFixed(2).split(".");
  return `${whole!.replace(/\B(?=(\d{3})+(?!\d))/g, " ")},${cents} €`;
}
const plain = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
const cellsOf = async (row: Locator) => (await row.locator("td").allTextContents()).map(plain);
/** The column `index` of a row once the table is there: 0 category, 1 the period, 2 plan, 3 ± plan, 4 the base. */
const cellIs = (row: () => Locator, index: number, text: string) =>
  expect.poll(async () => (await cellsOf(row()))[index], { timeout: 15_000 }).toBe(text);

test.beforeAll(async ({ browser }) => {
  test.setTimeout(180_000);
  world = await World.create(browser);
  h = await seedHistory(world);
  p = world.page;
});
test.afterAll(async () => {
  await world?.close();
});

const main = () => p.locator("main");
const open = async (hash: string) => {
  await p.goto(`/#${hash}`);
};

test.describe("FLW-38@PoC FR 1: «Підсумок періоду» of a finished month", () => {
  test("FLW-38@PoC FR 1, AC5: October-like month — income 4 000 €, expenses 3 100 € against the plan 3 400 €, net flow 900 €, savings rate 22,5 %, with the snapshot of the plan", async () => {
    await open(`/planning/budget?period=${last}`);
    await expect(main()).toContainText("період завершено");
    await expect(main()).toContainText("план — знімок на");
    const card = (name: string) =>
      main()
        .locator("div", { hasText: new RegExp(`^${name}`) })
        .last();
    await expect(card("Дохід")).toContainText("4 000,00 €");
    await expect(card("Витрати")).toContainText("3 100,00 €");
    await expect(card("Витрати")).toContainText("план 3 400,00 €");
    await expect(card("Чистий потік")).toContainText("900,00 €");
    await expect(card("Норма заощаджень")).toContainText("22,5 %");
    // «План проти факту»: the categories of the snapshot with limit, spent and what is left.
    const groceries = main().getByRole("row", { name: /Продукти/ });
    expect(plain(await groceries.innerText())).toContain("2 500,00 € 2 600,00 € 100,00 €");
    // The finished period has a snapshot of the plan, written when it was first read.
    const rows = await ownerQuery(
      world.databaseUrl,
      `SELECT to_char(period, 'YYYY-MM') AS period, income_plan::numeric(20,2)::text AS income FROM budget.period_snapshots WHERE household_id = $1`,
      [await world.householdId()],
    );
    expect(rows.map((r) => r["period"])).toContain(last);
    expect(rows.find((r) => r["period"] === last)?.["income"]).toBe("4000.00");
  });

  test("FLW-38@PoC EC1: a month without income — the savings rate is «–», not 0 % and not an error", async () => {
    // Five months before: a month of the budget with an expense and no income.
    await open(`/planning/budget/money-flow?type=month&period=${shiftMonth(month, -5)}`);
    const kpi = main()
      .locator("div", { hasText: /^Норма заощаджень/ })
      .last();
    await expect(kpi).toContainText("–");
    await expect(kpi).toContainText("немає доходу — норма не рахується");
    await expect(main()).not.toContainText("0,0 %");
    await open(`/planning/budget?period=${shiftMonth(month, -5)}`);
    const summary = main()
      .locator("div", { hasText: /^Норма заощаджень/ })
      .last();
    await expect(summary).toContainText("немає доходу — норма не рахується");
  });
});

test.describe("FLW-38@PoC «Стани інтерфейсу»: requests", () => {
  test("FLW-38@PoC UI requests: «Підсумок періоду» asks each endpoint once and not again while it stays open (no request loop, the fix of PR 689)", async () => {
    const asked: string[] = [];
    const count = (r: { url(): string }) => {
      const path = new URL(r.url()).pathname;
      if (path.startsWith("/v1/") && path !== "/v1/session/refresh") asked.push(path);
    };
    p.on("request", count);
    await open(`/planning/budget?period=${last}`);
    await expect(main()).toContainText("Порівняно з середнім за 3 міс.");
    await expect(main()).toContainText("період завершено");
    await p.waitForTimeout(2000);
    p.off("request", count);
    const times = (path: string) => asked.filter((a) => a === path).length;
    for (const path of [`/v1/budget/periods/${last}/summary`, "/v1/budget/compare", "/v1/recurring/payments"])
      expect(times(path), path).toBe(1);
    // Nothing is asked more than a few times by one page: a loop sends hundreds.
    expect(asked.length).toBeLessThan(25);
  });
});

test.describe("FLW-38@PoC FR 3: the largest changes", () => {
  test("FLW-38@PoC AC1: the average of 3 months «Кафе і ресторани» 260 €, the month 500 € in 8 transactions — «Кафе і ресторани: ▲ 240,00 € до середнього, на 6 транзакцій більше»", async () => {
    await open(`/planning/budget?period=${last}`);
    await expect(main()).toContainText("Порівняно з середнім за 3 міс.");
    const cafes = main().locator("li", { hasText: "Кафе і ресторани" });
    await expect(cafes).toContainText("Кафе і ресторани: ▲ 240,00 €");
    await expect(cafes).toContainText("до середнього, на 6 транзакцій більше");
    // The card opens «Порівняння» of the month with the same base.
    await main().locator('a[href*="base=avg3"]').click();
    await expect(p).toHaveURL(/\/compare\?.*base=avg3/);
    await expect(main().getByRole("heading", { name: "Порівняння" })).toBeVisible();
  });
});

test.describe("FLW-38@PoC FR 2: «Порівняння»", () => {
  test("FLW-38@PoC AC2, FR 2: today is day d — «Попередній період» compares days 1–d of both periods; «Повний попередній період» shows all of the earlier one", async () => {
    const day = Math.min(Number(today.slice(8)), daysIn(last));
    await open(`/planning/budget/compare?type=month&period=${month}`);
    await expect(main().getByRole("heading", { name: "Порівняння" })).toBeVisible();
    // The window of the day: «1–21 лист. 2026 · база на ту саму дату: 1–21 жовт. 2026».
    const windowText = main().getByText(/база на ту саму дату/);
    await expect(windowText).toBeVisible();
    const upTo = day === 1 ? "1" : `1–${day}`;
    expect(plain(await windowText.innerText())).toMatch(
      new RegExp(
        `^${Number(today.slice(8)) === 1 ? "1" : `1–${Number(today.slice(8))}`} \\S+ \\d{4} · база на ту саму дату: ${upTo} \\S+ \\d{4}$`,
      ),
    );
    const total = () =>
      main()
        .getByRole("table", { name: "Витрати" })
        .getByRole("row", { name: /Усього витрат/ });
    const sameDates = h.previousMonthExpenses
      .filter(([d]) => d <= day)
      .reduce((sum, [, a]) => sum.plus(a), new Decimal("0"));
    await cellIs(total, 4, eurText(sameDates));
    // The whole earlier period: 3 100 €, the window names all of it.
    await main().getByRole("switch", { name: "Повний попередній період" }).click();
    await expect(main().getByText(/база на ту саму дату/)).toHaveCount(0);
    await cellIs(total, 4, eurText("3100"));
    await main().getByRole("switch", { name: "Повний попередній період" }).click();
    await expect(main().getByText(/база на ту саму дату/)).toBeVisible();
  });

  test("FLW-38@PoC AC4, FR 2: less than a year of data — «Той самий період минулого року» is inactive with the reason and the offer to import old statements", async () => {
    await open(`/planning/budget/compare?type=month&period=${month}`);
    await main()
      .getByRole("combobox", { name: /Порівняти з/ })
      .click();
    const option = p.getByRole("option", { name: /Той самий період минулого року/ });
    await expect(option).toContainText(
      `немає даних за ${label(shiftMonth(month, -12)).split(" ")[0]!.toLowerCase().replace(/ь$/, "")}`,
    );
    await expect(option).toBeDisabled();
    await p.keyboard.press("Escape");
    await expect(main().getByRole("link", { name: "Імпортувати старі виписки" })).toBeVisible();
    // The address with that base shows the same refusal, not a table of zeros.
    await open(`/planning/budget/compare?type=month&period=${month}&base=last-year`);
    await expect(main()).toContainText("Базу порівняння не можна показати: за її дати немає даних.");
  });

  test("FLW-38@PoC FR 2: the bases «Середнє за 3 / 6 / 12 міс.», the view «Рік: план і факт» (12 months by categories; 16 columns: the category, 12 months, the year, the plan and the difference) and the type of the period", async () => {
    await open(`/planning/budget/compare?type=month&period=${month}&base=avg3`);
    const header = main().getByRole("table", { name: "Витрати" }).getByRole("columnheader");
    await expect(header.nth(4)).toHaveText(/Сер\. за 3\sміс\./);
    await open(`/planning/budget/compare?type=month&period=${month}&base=avg6`);
    await expect(header.nth(4)).toHaveText(/Сер\. за 6\sміс\./);
    await open(`/planning/budget/compare?type=month&period=${month}&base=avg12`);
    await expect(header.nth(4)).toHaveText(/Сер\. за 12\sміс\./);
    // «Рік: план і факт»: the categories against the 12 months of the year.
    await main().getByRole("radio", { name: "Рік: план і факт" }).click();
    await expect(p).toHaveURL(/view=year/);
    await expect(main().getByRole("table").first().getByRole("columnheader")).toHaveCount(16, {
      timeout: 15_000,
    });
    await main().getByRole("radio", { name: "З порівнянням" }).click();
    await expect(p).not.toHaveURL(/view=year/);
    // The type of the period: a quarter, the year to date and the year are offered too.
    await main()
      .getByRole("button", { name: /^Тип періоду/ })
      .click();
    for (const name of ["Квартал", "З початку року", "Рік"])
      await expect(p.getByRole("option", { name })).toBeVisible();
  });
});

test.describe("FLW-38@PoC FR 4: «Одноразова витрата»", () => {
  test("FLW-38@PoC AC3, FR 4: «Ремонт даху» 3 500 € marked «Одноразова витрата» in its details — the average of 6 months leaves it out, the fact of its month keeps it; unmarked, it counts again", async () => {
    const roofMonth = shiftMonth(month, -3);
    const dim = (base: string) => `/planning/budget/compare?type=month&period=${base}&base=avg6`;
    const row = () => main().getByRole("table", { name: "Витрати" }).getByRole("row", { name: /^Дім/ });
    await open(dim(month));
    // Before the mark the repair is in the average: (5 × 100 + 3 600) ÷ 6.
    await cellIs(row, 4, eurText(new Decimal("4100").div("6")));
    // From «Тренд»: the category «Дім», the bar of the month opens its transactions, then the transaction's details.
    await open("/planning/budget/trend");
    await main()
      .getByRole("button", { name: /Категорія/ })
      .click();
    await p.getByRole("option", { name: "Дім" }).click();
    await main()
      .getByRole("button", { name: new RegExp(`^Витрати, ${label(roofMonth)}, 3 600,00 €`) })
      .click();
    await expect(p).toHaveURL(/#\/money\/transactions/);
    await main().getByText("Ремонт даху").first().click();
    await expect(p).toHaveURL(/#\/money\/transactions\/[0-9a-f-]{36}$/);
    const mark = p.getByRole("switch", { name: "Одноразова витрата" });
    await expect(mark).not.toBeChecked();
    await mark.click();
    await expect(mark).toBeChecked();
    // Saved by the server: the page reloaded shows it.
    await p.reload();
    await expect(p.getByRole("switch", { name: "Одноразова витрата" })).toBeChecked();
    // The average leaves it out …
    await open(dim(month));
    await cellIs(row, 4, eurText("100"));
    // … the fact of its month keeps it (3 600 € = the repair and the 100 € of the month).
    await open(`/planning/budget/compare?type=month&period=${roofMonth}&full=true`);
    await cellIs(row, 1, eurText("3600"));
    // Unmarked, it counts again.
    await open(`/money/transactions/${h.roofRepairId}`);
    await p.getByRole("switch", { name: "Одноразова витрата" }).click();
    await expect(p.getByRole("switch", { name: "Одноразова витрата" })).not.toBeChecked();
    await open(dim(month));
    await cellIs(row, 4, eurText(new Decimal("4100").div("6")));
    // Marked once more: the later steps read the month without the repair.
    await open(`/money/transactions/${h.roofRepairId}`);
    await p.getByRole("switch", { name: "Одноразова витрата" }).click();
    await expect(p.getByRole("switch", { name: "Одноразова витрата" })).toBeChecked();
  });
});

test.describe("FLW-38@PoC FR 5: the plan for the next period", () => {
  test("FLW-38@PoC FR 5: «Продукти» of the next month changed in «План» — it acts from that month, the finished month keeps the plan of its snapshot (3 400 €)", async () => {
    const next = shiftMonth(month, 1);
    const monthName = MONTHS[Number(next.slice(5)) - 1]!.toLowerCase();
    await open("/planning/budget/plan");
    const cell = main().getByRole("textbox", { name: `Продукти, ${monthName}` });
    await cell.fill("2700");
    await cell.blur();
    await expect(cell).toHaveValue(/2\s?700/);
    // The server has the new limit for the next month only: the plan of the period before is untouched.
    const grid = await world.api<{ months: unknown }>("GET", "/v1/budget/plan-grid");
    expect(JSON.stringify(grid)).toContain("2700");
    await open(`/planning/budget?period=${last}`);
    const spent = main()
      .locator("div", { hasText: /^Витрати/ })
      .last();
    await expect(spent).toContainText("план 3 400,00 €");
    await expect(main()).toContainText("з лімітів 3 400,00 €");
    await open(`/planning/budget/trend`);
    await expect(main().getByRole("row", { name: new RegExp(label(last)) })).toContainText(eurText("3400"));
  });
});

test.describe("FLW-38@PoC FR 6: «Тренд» and «Грошовий потік»", () => {
  const bars = () => main().getByRole("button", { name: /^Витрати, / });

  test("FLW-38@PoC FR 6: «Тренд» — columns of spending for «1М · 3М · 1Р · Усе», the lines of income and plan, the filter of a category, the view button inactive, a column opens the transactions of the period", async () => {
    await open("/planning/budget/trend");
    await expect(bars()).toHaveCount(6);
    await main().getByRole("radio", { name: "1М" }).check();
    await expect(bars()).toHaveCount(1);
    await main().getByRole("radio", { name: "3М" }).check();
    await expect(bars()).toHaveCount(3);
    await main().getByRole("radio", { name: "Усе" }).check();
    await expect(bars()).toHaveCount(6);
    await main().getByRole("radio", { name: "1Р" }).check();
    await expect(main()).toContainText(`Дохід · ${label(last)}`);
    await expect(main()).toContainText(`Бюджет · ${label(last)}`);
    // The only view is «Стовпчики»: its button is shown inactive.
    await expect(main().getByRole("button", { name: "Вигляд: Стовпчики" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    // A category: the columns are of that category.
    await main()
      .getByRole("button", { name: /Категорія/ })
      .click();
    await p.getByRole("option", { name: "Кафе і ресторани" }).click();
    await expect(
      main().getByRole("button", { name: new RegExp(`^Витрати, ${label(last)}, 500,00 €`) }),
    ).toBeVisible();
    // A column opens the transactions of its period, from the keyboard too.
    const column = main().getByRole("button", { name: new RegExp(`^Витрати, ${label(last)}`) });
    await column.focus();
    await p.keyboard.press("Enter");
    await expect(p).toHaveURL(/#\/money\/transactions/);
    await expect(main()).toContainText("Знайдено");
  });

  test("FLW-38@PoC FR 6: «Грошовий потік» — the types «Місяць», «Квартал», «З початку року», «Рік»; the views «Місяць» and «Помісячно»; the charts have one view, its button inactive", async () => {
    await open(`/planning/budget/money-flow?type=month&period=${last}`);
    await expect(main()).toContainText("Куди пішов дохід");
    await expect(main()).toContainText("Розрахунок");
    await expect(main().getByRole("button", { name: "Вигляд: Смуга" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    // The type of the period: the four, no «Власний».
    await main()
      .getByRole("button", { name: /^Тип періоду/ })
      .click();
    for (const name of ["Місяць", "Квартал", "З початку року", "Рік"])
      await expect(p.getByRole("option", { name })).toBeVisible();
    await expect(p.getByRole("option", { name: "Власний" })).toHaveCount(0);
    await p.getByRole("option", { name: "Рік" }).click();
    // A longer period reads month by month: the charts of net flow and savings rate and the table.
    await expect(main().getByRole("button", { name: "Вигляд: Стовпчики" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    const table = main().getByRole("table", { name: "Грошовий потік за місяцями" });
    await expect(table.getByRole("row", { name: new RegExp(label(last)) })).toContainText("900,00 €");
    await expect(table.getByRole("row", { name: new RegExp(label(last)) })).toContainText("22,5 %");
  });
});

test.describe("FLW-38@PoC AC5: «Грошовий потік»", () => {
  test("FLW-38@PoC AC5: income 4 000 € and expenses 3 100 € — net flow 900 €, savings rate 22,5 %", async () => {
    await open(`/planning/budget/money-flow?type=month&period=${last}`);
    const kpi = (name: string) =>
      main()
        .locator("div", { hasText: new RegExp(`^${name}`) })
        .last();
    await expect(kpi("Дохід")).toContainText("4 000,00 €");
    await expect(kpi("Витрати")).toContainText("3 100,00 €");
    await expect(kpi("Чистий потік")).toContainText("900,00 €");
    await expect(kpi("Норма заощаджень")).toContainText("22,5 %");
  });
});

test.describe("FLW-38@PoC EC2: a split transaction", () => {
  test("FLW-38@PoC EC2: «Продукти» 1 250 € split into «Продукти» 1 000 € and «Дім» 250 € — every screen counts the parts, the month's total does not change", async () => {
    await world.api("POST", `/v1/transactions/${h.splittableId}/split`, {
      mode: "categories",
      parts: [
        { categoryId: await world.categoryId("Продукти"), amount: "-1000.00" },
        { categoryId: await world.categoryId("Дім"), amount: "-250.00" },
      ],
    });
    await open(`/planning/budget?period=${last}`);
    await expect(main()).toContainText("3 100,00 €");
    expect(
      plain(
        await main()
          .getByRole("row", { name: /Продукти/ })
          .innerText(),
      ),
    ).toContain("2 250,00 €");
    expect(
      plain(
        await main()
          .getByRole("row", { name: /^Дім|Дім/ })
          .first()
          .innerText(),
      ),
    ).toContain("350,00 €");
    await open(`/planning/budget/compare?type=month&period=${last}&full=true`);
    const rows = main().getByRole("table", { name: "Витрати" });
    await cellIs(() => rows.getByRole("row", { name: /^Продукти/ }), 1, eurText("2250"));
    await cellIs(() => rows.getByRole("row", { name: /^Дім/ }), 1, eurText("350"));
  });
});
