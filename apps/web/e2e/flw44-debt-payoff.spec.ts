import { expect, test, type Locator, type Page } from "@playwright/test";
import { eur, kyivToday, monthOf, shiftMonth, dayOf, World } from "./world.ts";

/**
 * FLW-44@PoC «План погашення боргів» end to end (wave 2, row 149): the real API and database behind a real browser at
 * 1280 px. A person with no debts sees the empty page; then credit accounts are added through the API and the flow is
 * walked on the screens «Борги → Борги · План погашення · Стратегія · Прогрес» and in «Бюджет → План». The expected
 * months and interest are computed in the test from the rule of FLW-44 (interest = balance × annual rate ÷ 12, rounded
 * to the cent to even, then the payment), not read from the screen. Not covered because the product has no such step
 * yet: «Ставка змінна; розрахунок за поточною» and a debt in another currency (BUD-19 п. 9, EC1), the account's settings
 * screen (a placeholder), «Можна витратити» lowered by the extra payment (it is asked for the
 * current period only, and the plan's payment starts the month after saving: AC5 in part), the progress «відхилення від плану» of a month that has passed.
 */
test.describe.configure({ mode: "serial" });

let world: World;
let p: Page;
const today = kyivToday();
const month = monthOf(today);
const DISCLAIMER = "Розрахунок за введеними даними, не фінансова порада";

test.beforeAll(async ({ browser }) => {
  test.setTimeout(180_000);
  world = await World.create(browser);
  p = world.page;
});
test.afterAll(async () => {
  await world?.close();
});

const main = () => p.locator("main");
/** Opens the screen from a clean page: a hash change keeps the draft of the scenario in the open app, so reload. */
const open = async (hash: string) => {
  await p.goto(`/#${hash}`);
  await p.reload();
};
const plain = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

/** Banker's rounding of `a ÷ b` for non-negative bigints. */
function divEven(a: bigint, b: bigint): bigint {
  const q = a / b;
  const r2 = (a % b) * 2n;
  return r2 > b || (r2 === b && q % 2n === 1n) ? q + 1n : q;
}
/** Months and total interest (in cents) of a debt of `balance` cents at `rate` % a year paid `payment` cents a month. */
function payoff(balance: bigint, rate: bigint, payment: bigint) {
  let left = balance;
  let interest = 0n;
  let months = 0;
  const balances: bigint[] = [];
  while (left > 0n && months < 1200) {
    const i = divEven(left * rate, 1200n);
    interest += i;
    left = left + i - (left + i < payment ? left + i : payment);
    months += 1;
    balances.push(left);
  }
  return { months, interest, balances };
}
/** 797.18 → «797,18 €» with a space between thousands. */
function eurText(cents: bigint): string {
  const whole = (cents / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${whole},${(cents % 100n).toString().padStart(2, "0")} €`;
}
const text = async (l: Locator) => plain(await l.innerText());

test("FLW-44@PoC FR «Актор і точка входу»: no debts — «Боргів не додано» and «Додати рахунок» opens «Новий рахунок» with the type «Кредит»", async () => {
  await open("/planning/debts");
  await expect(main().getByText("Боргів не додано")).toBeVisible();
  await main().getByRole("link", { name: "Додати рахунок" }).click();
  await expect(p).toHaveURL(/#\/money\/accounts\/new\?type=loan/);
  await expect(p.getByRole("dialog", { name: "Новий рахунок" })).toBeVisible();
  // The type chosen is «Кредит», not the default.
  await expect(p.getByRole("dialog").locator("select").first()).toHaveValue("loan");
});

test.describe("with debts", () => {
  test.beforeAll(async () => {
    test.setTimeout(120_000);
    const since = dayOf(shiftMonth(month, -1), 1);
    const loan = (name: string, balance: string, rate: string, payment: string) =>
      world.account({
        kind: "loan",
        name,
        balance: eur(balance),
        balanceDate: since,
        annualRate: rate,
        monthlyPayment: payment,
      });
    await loan("Автокредит", "5000.00", "18", "300.00");
    await world.account({
      kind: "credit-card",
      name: "Visa",
      balance: eur("1000.00"),
      balanceDate: since,
      annualRate: "24",
    });
    await loan("Іпотека", "6000.00", "9", "200.00");
    await loan("Позика", "1500.00", "8", "100.00");
    await world.api("POST", "/v1/budget", { firstPeriod: month, incomePlan: eur("4000.00") }, [201]);
  });

  test("FLW-44@PoC FR 1, AC8: «Борги» lists every loan with the balance, the annual rate, the regular payment and the end date; a credit card without «Гасити щомісяця: …» shows its balance and the hint to enter it (owner, 2026-11-27)", async () => {
    await open("/planning/debts");
    const row = (name: string) => main().getByRole("row", { name: new RegExp(`^${name}`) });
    const auto = await text(row("Автокредит"));
    const calc = payoff(500_000n, 18n, 30_000n);
    expect(auto).toContain("5 000,00 €");
    expect(auto).toContain("18,0 %");
    expect(auto).toContain("300,00 €");
    expect(auto).toContain(`через ${calc.months} міс.`);
    // The card has no rate and no regular payment (the account's 24 % is not used); no end date until the amount is given.
    const visa = await text(row("Visa"));
    expect(visa).toContain("1 000,00 €");
    expect(visa).toContain("Вкажіть, скільки щомісяця гасите з картки");
    expect(visa).not.toMatch(/%|через|Немає ставки|Борг не зменшується/);
    await expect(main().getByText("Боргів", { exact: true })).toBeVisible();
  });

  test("FLW-44@PoC AC9, FR 1: the card of 1 000 € with «Гасити щомісяця: …» 200 € — paid off in 5 months, no interest; saved as the card's plan, the list shows the amount and the end date", async () => {
    await open("/planning/debts/plan");
    await main().getByRole("combobox", { name: "Борг" }).selectOption({ label: "Visa" });
    await expect(main().getByLabel("Ставка річних, %")).toHaveCount(0);
    await expect(main().getByLabel("Регулярний платіж / міс.")).toHaveCount(0);
    await expect(main()).toContainText("Вкажіть, скільки щомісяця гасите з картки");
    await main().getByLabel("Гасити щомісяця: …").fill("200");
    // 1 000 ÷ 200 = 5 months, rounded up; no interest on a card.
    await expect(main()).toContainText("Погашення через 5 міс.");
    await expect(main()).toContainText("відсотки за весь строк 0,00 €");
    await main().getByRole("button", { name: "Зберегти план" }).click();
    await expect(main()).toContainText("План збережено");
    await open("/planning/debts");
    const visa = await text(main().getByRole("row", { name: /^Visa/ }));
    // Balance, no rate («—»), the amount in the payment column, the end date; «0 %» is «Погашено».
    expect(visa).toContain("1 000,00 € — 200,00 €");
    expect(visa).toContain("через 5 міс.");
  });

  test("FLW-44@PoC AC1, FR 1: 5 000 € at 18 % a year — the interest of the first month is 75,00 € (the balance after the first payment is 4 775,00 €); the interest of the whole term is as the rule gives", async () => {
    await open("/planning/debts/plan");
    const calc = payoff(500_000n, 18n, 30_000n);
    expect(calc.balances[0]).toBe(477_500n);
    await expect(main()).toContainText(`Погашення через ${calc.months} міс.`);
    await expect(main()).toContainText(`відсотки за весь строк ${eurText(calc.interest)}`);
    // The table of the balances (the text alternative of the chart): month 1 = 5 000 + 75,00 − 300 = 4 775,00 €.
    await main().getByText("Таблиця залишку за місяцями").click();
    await expect(main().getByRole("row").nth(1)).toContainText("4 775,00 €");
  });

  test("FLW-44@PoC AC2, FR 2, AC6: an extra 100 € a month — at once the new term and «На N міс. раніше, економія на відсотках X €», marked «Розрахунок за введеними даними, не фінансова порада»", async () => {
    await open("/planning/debts/plan");
    const base = payoff(500_000n, 18n, 30_000n);
    const withExtra = payoff(500_000n, 18n, 40_000n);
    await main().getByLabel("Додатковий платіж / міс.").fill("100");
    await expect(main()).toContainText(
      `На ${base.months - withExtra.months} міс. раніше, економія на відсотках ${eurText(base.interest - withExtra.interest)}`,
    );
    await expect(main()).toContainText(`Погашення через ${withExtra.months} міс.`);
    await expect(main()).toContainText(DISCLAIMER);
    // The disclaimer is the page's footnote under the scenario and the result (about 1 400 px below the card's top once the
    // scenario is drawn, so not within one 800 px screen: an open question for AC6 «поруч», see the PR).
    const distance = await main()
      .locator("section.debts-result")
      .evaluate((card) => {
        const notes = [...document.querySelectorAll("main *")].filter(
          (el) => el.children.length === 0 && el.textContent?.includes("не фінансова порада"),
        );
        return notes.map((n) => n.getBoundingClientRect().top - card.getBoundingClientRect().top);
      });
    expect(distance.some((d) => d > 0)).toBe(true);
  });

  test("FLW-44@PoC AC4: a payment of 50 € below the interest of 75 € — no end date, the warning that the debt does not decrease", async () => {
    await open("/planning/debts/plan");
    await main().getByLabel("Регулярний платіж / міс.").fill("50");
    await expect(main()).toContainText("За цих умов борг не зменшується");
    await expect(main().getByText(/Погашення через \d+ міс\./)).toHaveCount(0);
  });

  test("FLW-44@PoC AC7, FR 3: the rate of the scenario overridden to 12 % — the account «Налаштування рахунку» still has 18 %, and so does the API", async () => {
    await open("/planning/debts/plan");
    await main().getByLabel("Ставка річних, %").fill("12");
    await expect(main()).toContainText(/відсотки за весь строк/);
    const shortened = payoff(500_000n, 12n, 30_000n);
    await expect(main()).toContainText(`Погашення через ${shortened.months} міс.`);
    await main().getByRole("link", { name: "Налаштування рахунку" }).click();
    await expect(p).toHaveURL(/#\/money\/accounts\//);
    // The screen of the account's settings is a placeholder yet («Тут поки нічого немає»): the rate is read from the list and the API.
    const accounts = await world.api<{ items: { name: string; loan: { annualRate: string } | null }[] }>(
      "GET",
      "/v1/accounts",
    );
    const loan = accounts.items.find((a) => a.name === "Автокредит");
    expect(Number(loan?.loan?.annualRate)).toBe(18);
    await open("/planning/debts");
    expect(await text(main().getByRole("row", { name: /^Автокредит/ }))).toContain("18,0 %");
  });

  test("FLW-44@PoC FR 4, AC3, AC9: «Стратегія» — the card's 200 € is in the total; Avalanche puts the rest on the rated loans before the card, Snowball on the smallest balance (the card); too little — the warning", async () => {
    await open("/planning/debts/strategy");
    // The minimums: 300 + 200 (the card) + 200 + 100 = 800 €; the card asks for nothing more.
    const total = main().getByRole("textbox", { name: /Усього на борги/ });
    await expect(total).toHaveValue(/800,00/);
    await expect(main().getByRole("textbox", { name: /Гасити щомісяця|гасити … \/ міс\./ })).toHaveCount(0);
    await total.fill("700");
    await expect(main()).toContainText("Сума менша за мінімальні платежі (800,00 €)");
    await total.fill("1000");
    await expect(main()).toContainText("Порядок погашення · Avalanche");
    const order = () => main().getByRole("table").last().getByRole("row");
    const rowOf = (name: string) => order().filter({ hasText: name });
    // Avalanche: the rest 200 € goes to «Автокредит» (18 %), the card gets its own 200 € only — 1 000 ÷ 200 = 5 months.
    await expect(rowOf("Visa")).toContainText("через 5 міс.");
    const names = async () => (await order().allTextContents()).map(plain);
    const avalanche = await names();
    expect(avalanche.findIndex((r) => r.includes("Автокредит"))).toBeLessThan(
      avalanche.findIndex((r) => r.includes("Іпотека")),
    );
    await expect(main().getByText("Avalanche").first()).toBeVisible();
    await expect(main().getByText("Snowball").first()).toBeVisible();
    await main()
      .getByRole("radio", { name: /Snowball/ })
      .click();
    await expect(main()).toContainText("Порядок погашення · Snowball");
    // Snowball: the card is the smallest balance — 200 + 200 € a month, paid off in 3 months.
    await expect(rowOf("Visa")).toContainText("через 3 міс.");
    await expect(order().nth(1)).toContainText("Visa");
    await expect(main()).toContainText(DISCLAIMER);
  });

  test("FLW-44@PoC FR 5, AC5: «Зберегти план» with «Додати до запланованих витрат» — the saved plan comes back, and «Бюджет → План» shows 100 € of «Погашення боргів» in each period up to the payoff month", async () => {
    await open("/planning/debts/plan");
    await main().getByLabel("Додатковий платіж / міс.").fill("100");
    await main().getByLabel("Додати до запланованих витрат").check();
    await main().getByRole("button", { name: "Зберегти план" }).click();
    await expect(main()).toContainText("План збережено");
    await p.reload();
    await expect(main()).toContainText("Збережений план");
    await expect(main().getByLabel("Додатковий платіж / міс.")).toHaveValue(/100/);
    const withExtra = payoff(500_000n, 18n, 40_000n);
    await open("/planning/budget/plan");
    const debtRow = main().getByRole("row", { name: /^Погашення боргів/ });
    await expect(debtRow).toBeVisible();
    // The cells of the row: the regular payments of the three loans (600 €) in this month, and with the extra 100 € from the
    // month after the plan was saved, in every month to the end of the 12 shown (the payoff is later, in month ${withExtra.months}).
    expect(withExtra.months).toBeGreaterThan(12);
    const cells = (await debtRow.locator("td").allTextContents()).map(plain).filter((c) => /\d/.test(c));
    expect(cells[0]).toBe("600,00");
    expect(cells.slice(1)).toEqual(Array.from({ length: 11 }, () => "700,00"));
  });

  test("FLW-44@PoC FR 6: «Прогрес» — «Погашено N %» for every debt and the plan against the facts; the saved plan is no longer «Плану немає»", async () => {
    await open("/planning/debts/progress");
    const auto = main().getByRole("row", { name: /^Автокредит/ });
    await expect(auto).toContainText("0 %");
    await expect(auto).not.toContainText("Плану немає");
    // The card's amount is its saved plan; a loan without one says «Плану немає».
    await expect(main().getByRole("row", { name: /^Іпотека/ })).toContainText("Плану немає");
    await expect(main().getByRole("row", { name: /^Visa/ })).not.toContainText("Плану немає");
    await expect(main()).toContainText(DISCLAIMER);
  });
});
