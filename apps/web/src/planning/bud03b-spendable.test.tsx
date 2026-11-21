import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { installMatchMedia } from "@willowsum/ui/test-utils";
import { fakeApi, plain, problem, renderAt, resetAuthState, type Reply } from "../auth/testing.tsx";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * BUD-03@PoC b) (wave 2, row 126): the card «Можна витратити» of S-121 «Бюджет» on `GET /v1/budget/periods/{period}/spendable`
 * (#573, #641, #651) and `GET /v1/me/features`. Only the screen is rendered; every sum is the API's (synthetic), the web
 * formats it. Today is 2026-11-12 (Kyiv), a 30-day period: 19 days to the end, today included. Boards: PocPlanBudget,
 * PocPlanBudgetBreakdown, PocPlanBudgetOverspent, PocStates, PocPlanBudgetTexts.
 */
const PAGE = "#/planning/budget";
const money = (amount: string) => ({ amount, currency: "EUR" });
const SPENDABLE = "GET /v1/budget/periods/2026-11/spendable";
const PAY = "5a000000-0000-4000-8000-000000000001";
const LOAN = "5a000000-0000-4000-8000-000000000002";
const GOAL_A = "5a000000-0000-4000-8000-000000000003";
const GOAL_B = "5a000000-0000-4000-8000-000000000004";
const DEBT = "5a000000-0000-4000-8000-000000000005";
const CAT = "5a000000-0000-4000-8000-000000000006";
const LONG = "Дуже довга назва регулярного платежу за комунальні послуги й обслуговування будинку";

const BUDGET = {
  budget: {
    id: "b0000000-0000-4000-8000-000000000001",
    createdOn: "2026-09-03",
    currency: "EUR",
    firstPeriod: "2026-09",
    incomePlan: money("6000.00"),
    limits: [],
    proportional: null,
    version: 1,
  },
};

const period = (p: string, mode: "past" | "current" | "future") => ({
  period: p,
  mode,
  currency: "EUR",
  approximate: { nearestRateCount: 0, unavailableCount: 0 },
  groups: [],
  incomeActual: mode === "future" ? null : money("6000.00"),
  incomePlan: money("6000.00"),
  outsidePlan: { categories: [], total: mode === "future" ? null : money("0.00") },
  plannedSavings: money("0.00"),
  proportional: null,
  totals: { limits: money("0.00"), spent: money("0.00"), remaining: money("0.00") },
});

type Approx = Partial<{
  nearestRateCount: number;
  unavailableCount: number;
  obligations: boolean;
  incomes: boolean;
  goals: boolean;
  plannedExpenses: boolean;
}>;

/** AC1: income 6 000, spent 2 300, regular 1 900, goals 500 → 1 300 and 68,42 a day (19 days). */
function body(
  over: { figures?: object | null; approximate?: Approx; unavailable?: string[]; daysLeft?: number } = {},
) {
  const figures =
    over.figures === null
      ? null
      : {
          amount: money("1300.00"),
          daily: money("68.42"),
          overspend: null,
          income: {
            plan: money("6000.00"),
            actual: money("6000.00"),
            expected: money("6000.00"),
            stillExpected: money("0.00"),
            value: money("6000.00"),
            pending: false,
          },
          spent: { total: money("2300.00"), limited: money("2300.00"), outsidePlan: money("0.00") },
          regularPayments: {
            items: [
              {
                kind: "recurring",
                paymentId: PAY,
                categoryId: null,
                dueOn: "2026-11-20",
                overdueDays: null,
                amount: money("1700.00"),
              },
              { kind: "loan", accountId: LOAN, amount: money("200.00") },
            ],
            total: money("1900.00"),
          },
          goals: {
            items: [
              {
                goalId: GOAL_A,
                planned: money("300.00"),
                contributed: money("0.00"),
                amount: money("300.00"),
              },
              {
                goalId: GOAL_B,
                planned: money("200.00"),
                contributed: money("0.00"),
                amount: money("200.00"),
              },
            ],
            total: money("500.00"),
          },
          plannedExpenses: { items: [], total: money("0.00") },
          mandatory: { categories: [], total: money("0.00") },
          mini: [
            { row: "income", amount: money("6000.00") },
            { row: "spent", amount: money("2300.00") },
            { row: "regular", amount: money("1900.00") },
            { row: "goals", amount: money("500.00") },
            { row: "mandatory", amount: money("0.00") },
          ],
          ...over.figures,
        };
  return {
    period: "2026-11",
    currency: "EUR",
    daysLeft: over.daysLeft ?? 19,
    figures,
    unavailable: over.unavailable ?? [],
    approximate: {
      nearestRateCount: 0,
      unavailableCount: 0,
      obligations: false,
      incomes: false,
      goals: false,
      plannedExpenses: false,
      ...over.approximate,
    },
  };
}

const FEATURES: Reply = {
  status: 200,
  body: { features: ["budget.period", "budget.spendable", "budget.plan"] },
};

function api(over: Record<string, Reply> = {}) {
  return fakeApi({
    "GET /v1/budget": { status: 200, body: BUDGET },
    "GET /v1/categories": {
      status: 200,
      body: {
        groups: [
          {
            id: "g0000000-0000-4000-8000-000000000001",
            systemKey: null,
            kind: "expense",
            name: "Щоденне",
            renamed: false,
            tone: "neutral",
            categories: [
              {
                id: CAT,
                groupId: "g0000000-0000-4000-8000-000000000001",
                systemKey: null,
                kind: "expense",
                name: "Продукти",
                renamed: false,
                icon: "shopping",
                color: "#336699",
                iconTone: "white",
                essential: true,
                hidden: false,
                deletable: true,
              },
            ],
          },
        ],
      },
    },
    "GET /v1/budget/periods/2026-11": { status: 200, body: period("2026-11", "current") },
    "GET /v1/budget/periods/2026-12": { status: 200, body: period("2026-12", "future") },
    "GET /v1/budget/periods/2026-10": { status: 200, body: period("2026-10", "past") },
    "GET /v1/me/features": FEATURES,
    [SPENDABLE]: { status: 200, body: body() },
    "GET /v1/goals": {
      status: 200,
      body: {
        goals: [
          { id: GOAL_A, name: "Відпустка в Італії" },
          { id: GOAL_B, name: "Подушка безпеки" },
        ],
      },
    },
    "GET /v1/debts": { status: 200, body: { debts: [{ accountId: DEBT, name: "Кредитна картка" }] } },
    "GET /v1/recurring/payments": { status: 200, body: { items: [{ id: PAY, name: LONG }] } },
    "GET /v1/accounts": { status: 200, body: { items: [{ id: LOAN, name: "Автокредит" }] } },
    ...over,
  });
}

beforeEach(() => {
  installMatchMedia({ width: 1280 });
  resetAuthState();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-12T10:00:00Z"));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const region = () => document.querySelector<HTMLElement>("[data-plan-region='spendable']")!;
async function open(over: Record<string, Reply> = {}, hash = PAGE) {
  const fake = api(over);
  renderAt(hash, fake.client);
  await screen.findByRole("table");
  await waitFor(() => expect(region().querySelector("[aria-busy='true']")).toBeNull());
  return fake;
}
const card = () => within(region());
/** The sum of one source in the breakdown, by its label. */
const sourceOf = (dialog: HTMLElement, label: string) => {
  const s = [...dialog.querySelectorAll(".bud-spend-source")].find(
    (e) => e.querySelector(".bud-spend-source-label")?.textContent === label,
  );
  if (!s) throw new Error(`no source ${label}`);
  return plain(s.querySelector(".bud-spend-source-amount")?.textContent);
};

describe("BUD-03@PoC b) S-121: the card «Можна витратити»", () => {
  it("BUD-03@PoC AC1, FR 13: the card shows 1 300,00 € to the end of the period and 68,42 € a day with 19 days, today included", async () => {
    const fake = await open();
    expect(plain(card().getByTestId("spendable-amount").textContent)).toBe("1 300,00 €");
    expect(plain(region().textContent)).toContain("68,42 € на день");
    expect(plain(region().textContent)).toContain("19 днів, з сьогоднішнім");
    expect(plain(region().textContent)).toContain("до кінця листопада");
    expect(fake.calls.filter((c) => c.path === "/v1/budget/periods/2026-11/spendable")).toHaveLength(1);
  });

  it("BUD-03@PoC FR 15: the mini breakdown has the five rows with their sums — «Дохід», «Витрачено», «Регулярні платежі», «Цілі», «Обов’язкові»", async () => {
    await open();
    const rows = [...region().querySelectorAll(".bud-spend-mini > div")].map((r) => plain(r.textContent));
    expect(rows).toEqual([
      "Дохід6 000,00 €",
      "Витрачено−2 300,00 €",
      "Регулярні платежі−1 900,00 €",
      "Цілі−500,00 €",
      "Обов’язкові0,00 €",
    ]);
  });

  it("BUD-03@PoC FR 4, AC6, EC2: the last day — the daily limit is the API's figure, equal to the rest; the day word agrees (1 день)", async () => {
    await open({
      [SPENDABLE]: {
        status: 200,
        body: body({ daysLeft: 1, figures: { amount: money("90.00"), daily: money("90.00") } }),
      },
    });
    expect(plain(card().getByTestId("spendable-amount").textContent)).toBe("90,00 €");
    expect(plain(region().textContent)).toContain("90,00 € на день");
    expect(plain(region().textContent)).toContain("1 день, з сьогоднішнім");
  });

  it("BUD-03@PoC FR 4: a negative sum without overspend shows «−» and a daily limit of 0 as the API gives them", async () => {
    await open({
      [SPENDABLE]: {
        status: 200,
        body: body({ figures: { amount: money("-120.50"), daily: money("0.00") } }),
      },
    });
    expect(plain(card().getByTestId("spendable-amount").textContent)).toBe("−120,50 €");
    expect(plain(region().textContent)).toContain("0,00 € на день");
    expect(region().querySelector(".bud-spend-over")).toBeNull();
  });
});

describe("BUD-03@PoC b) the breakdown", () => {
  it("BUD-03@PoC AC2, FR 8: «›» opens the breakdown — income plan and fact, spent, the regular payments with dates and names, goals — each with a way to its source", async () => {
    await open();
    fireEvent.click(card().getByRole("button", { name: "Показати розбивку суми" }));
    const dialog = await screen.findByRole("dialog", { name: "З чого складається сума" });
    expect(sourceOf(dialog, "Очікуваний дохід")).toBe("6 000,00 €");
    expect(plain(dialog.textContent)).toContain("план 6 000,00 € · факт 6 000,00 € · більше з двох");
    expect(sourceOf(dialog, "Витрачено")).toBe("−2 300,00 €");
    expect(sourceOf(dialog, "Регулярні платежі")).toBe("−1 900,00 €");
    expect(sourceOf(dialog, "Внески в цілі")).toBe("−500,00 €");
    // The names come from the lists of the sources (loaded when it opens), long ones wrap.
    await within(dialog).findByText(new RegExp(LONG));
    expect(plain(dialog.textContent)).toContain("20 лист. 2026 р. · " + LONG);
    expect(within(dialog).getByText("Автокредит")).toBeTruthy();
    expect(within(dialog).getByText("Відпустка в Італії")).toBeTruthy();
    expect(within(dialog).getByText("Подушка безпеки")).toBeTruthy();
    const links = within(dialog)
      .getAllByRole("link")
      .map((a) => [a.getAttribute("aria-label"), a.getAttribute("href")]);
    expect(links).toEqual([
      ["Перейти: Витрачено", "#/money/transactions"],
      ["Перейти: Регулярні платежі", "#/planning/recurring"],
      ["Перейти: Внески в цілі", "#/planning/goals"],
      ["Перейти: Заплановані витрати", "#/planning/debts/plan"],
    ]);
    expect(within(dialog).getByRole("button", { name: "Перейти: Дохід" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Перейти: Категорії" })).toBeTruthy();
  });

  it("BUD-03@PoC AC9: «Обов’язкові категорії: ще потрібно 30,00 €» with the category behind it", async () => {
    await open({
      [SPENDABLE]: {
        status: 200,
        body: body({
          figures: {
            mandatory: { categories: [{ categoryId: CAT, amount: money("30.00") }], total: money("30.00") },
          },
        }),
      },
    });
    fireEvent.click(card().getByRole("button", { name: "Показати розбивку суми" }));
    const dialog = await screen.findByRole("dialog", { name: "З чого складається сума" });
    expect(plain(dialog.textContent)).toContain("Обов’язкові категорії: ще потрібно 30,00 €");
    expect(await within(dialog).findByText("Продукти")).toBeTruthy();
  });

  it("BUD-03@PoC FR 8: «Перейти: Дохід» and «Перейти: Категорії» close the breakdown and leave the focus on the heading of the card they lead to", async () => {
    await open();
    for (const [go, target] of [
      ["Перейти: Дохід", "income"],
      ["Перейти: Категорії", "categories"],
    ] as const) {
      fireEvent.click(card().getByRole("button", { name: "Показати розбивку суми" }));
      const dialog = await screen.findByRole("dialog", { name: "З чого складається сума" });
      fireEvent.click(within(dialog).getByRole("button", { name: go }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      const heading = document.querySelector<HTMLElement>(`[data-plan-region='${target}'] h2`)!;
      await waitFor(() => expect(document.activeElement).toBe(heading));
    }
  });

  it("BUD-03@PoC FR 10: «Переглянути категорії» of the overspend block leaves the focus on the heading of the categories", async () => {
    await open({
      [SPENDABLE]: {
        status: 200,
        body: body({
          figures: {
            amount: money("-200.00"),
            daily: money("0.00"),
            overspend: { amount: money("150.00"), base: money("1000.00") },
          },
        }),
      },
    });
    fireEvent.click(card().getByRole("button", { name: "Переглянути категорії" }));
    const heading = document.querySelector<HTMLElement>("[data-plan-region='categories'] h2")!;
    await waitFor(() => expect(document.activeElement).toBe(heading));
  });

  it("BUD-03@PoC FR 8: a net-negative «Витрачено» (refunds above spending) shows one «−» in the breakdown, never «−−»", async () => {
    await open({
      [SPENDABLE]: {
        status: 200,
        body: body({
          figures: {
            spent: { total: money("-50.00"), limited: money("-50.00"), outsidePlan: money("0.00") },
          },
        }),
      },
    });
    fireEvent.click(card().getByRole("button", { name: "Показати розбивку суми" }));
    const dialog = await screen.findByRole("dialog", { name: "З чого складається сума" });
    expect(sourceOf(dialog, "Витрачено")).toBe("−50,00 €");
    expect(plain(dialog.textContent)).not.toContain("−−");
    expect(plain(region().textContent)).not.toContain("−−");
  });

  it("BUD-03@PoC FR 8: Esc closes the breakdown and the focus returns to «›»", async () => {
    await open();
    const opener = card().getByRole("button", { name: "Показати розбивку суми" });
    fireEvent.click(opener);
    const dialog = await screen.findByRole("dialog", { name: "З чого складається сума" });
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(opener);
  });

  it("BUD-03@PoC FR 3, AC5, EC1: income not come in yet — the plan is used and marked «очікується» on the card and in the breakdown", async () => {
    await open({
      [SPENDABLE]: {
        status: 200,
        body: body({
          figures: {
            income: {
              plan: money("6000.00"),
              actual: money("0.00"),
              expected: money("0.00"),
              stillExpected: money("0.00"),
              value: money("6000.00"),
              pending: true,
            },
          },
        }),
      },
    });
    expect(card().getByText("очікується")).toBeTruthy();
    fireEvent.click(card().getByRole("button", { name: "Показати розбивку суми" }));
    const dialog = await screen.findByRole("dialog", { name: "З чого складається сума" });
    expect(within(dialog).getByText("очікується")).toBeTruthy();
    expect(plain(dialog.textContent)).toContain("план 6 000,00 € · факт 0,00 €");
  });

  it("BUD-03@PoC EC5: a goal's spend is not counted twice — «Витрачено» is the API's figure, the note says goal spends are left out, and no sum is added on the web", async () => {
    await open({
      [SPENDABLE]: {
        status: 200,
        body: body({
          figures: {
            spent: { total: money("1700.00"), limited: money("1700.00"), outsidePlan: money("0.00") },
          },
        }),
      },
    });
    fireEvent.click(card().getByRole("button", { name: "Показати розбивку суми" }));
    const dialog = await screen.findByRole("dialog", { name: "З чого складається сума" });
    expect(sourceOf(dialog, "Витрачено")).toBe("−1 700,00 €");
    expect(plain(dialog.textContent)).toContain("без витрат із цілей");
  });
});

describe("BUD-03@PoC b) overspend", () => {
  const over = {
    amount: money("150.00"),
    base: money("1000.00"),
  };
  const overBody = body({
    figures: { amount: money("-200.00"), daily: money("0.00"), overspend: over },
  });

  it("BUD-03@PoC AC4, FR 10: «Перевитрата 150,00 €» in the state «перевищено» — marker «✕», the word, the shade over-3 (15 % of the limits), daily limit 0, two actions", async () => {
    await open({ [SPENDABLE]: { status: 200, body: overBody } });
    const block = region().querySelector<HTMLElement>(".bud-spend-over")!;
    expect(plain(block.textContent)).toContain("Перевитрата 150,00 €");
    expect(block.getAttribute("data-level")).toBe("3");
    expect(region().querySelector(".bud-spend")!.getAttribute("data-over-level")).toBe("3");
    const mark = block.querySelector("[data-status='a.over']")!;
    expect(mark.textContent).toContain("✕");
    expect(mark.textContent).toContain("перевищено");
    expect(plain(region().textContent)).toContain("0,00 € на день");
    expect(card().getByRole("button", { name: "Переглянути категорії" })).toBeTruthy();
    expect(card().getByRole("link", { name: "Зменшити внесок у ціль цього місяця" })).toBeTruthy();
  });

  it("BUD-03@PoC AC4: the shades follow the share of the overspend in the optional limits: 4 % over-1, 7 % over-2, 600 % over-8, no limits over-8", async () => {
    const cases: [string, string, string][] = [
      ["40.00", "1000.00", "1"],
      ["70.00", "1000.00", "2"],
      ["6000.00", "1000.00", "8"],
      ["10.00", "0.00", "8"],
    ];
    for (const [amount, base, level] of cases) {
      cleanup();
      resetAuthState();
      await open({
        [SPENDABLE]: {
          status: 200,
          body: body({
            figures: {
              amount: money("-1.00"),
              daily: money("0.00"),
              overspend: { amount: money(amount), base: money(base) },
            },
          }),
        },
      });
      expect(region().querySelector(".bud-spend-over")!.getAttribute("data-level")).toBe(level);
    }
  });

  it("BUD-03@PoC AC4: nothing changes without a confirmation — the actions only navigate (no request but reads)", async () => {
    const fake = await open({ [SPENDABLE]: { status: 200, body: overBody } });
    fireEvent.click(card().getByRole("button", { name: "Переглянути категорії" }));
    expect(fake.calls.filter((c) => c.method !== "GET")).toEqual([]);
    expect(fake.calls.filter((c) => c.path === "/v1/budget/plan-grid")).toEqual([]);
  });

  it("BUD-03@PoC FR 10: with «План» on «Зменшити внесок у ціль цього місяця» opens the plan grid", async () => {
    await open({ [SPENDABLE]: { status: 200, body: overBody } });
    expect(
      card().getByRole("link", { name: "Зменшити внесок у ціль цього місяця" }).getAttribute("href"),
    ).toBe("#/planning/budget/plan");
  });

  it("BUD-03@PoC FR 10: with «План» off (`budget.plan` not on) the action leads to «Цілі», not to a grid that is not there", async () => {
    await open({
      [SPENDABLE]: { status: 200, body: overBody },
      "GET /v1/me/features": { status: 200, body: { features: ["budget.period", "budget.spendable"] } },
    });
    expect(
      card().getByRole("link", { name: "Зменшити внесок у ціль цього місяця" }).getAttribute("href"),
    ).toBe("#/planning/goals");
  });
});

describe("BUD-03@PoC b) states", () => {
  it("BUD-03@PoC «Стани»: loading shows a skeleton in the shape of the card while the sum is calculated", async () => {
    let release: (r: Reply) => void = () => undefined;
    const pending = new Promise<Reply>((resolve) => (release = resolve));
    renderAt(PAGE, heldApi(pending).client);
    await waitFor(() => expect(region().querySelector("[aria-busy='true']")).toBeTruthy());
    expect(card().queryByTestId("spendable-amount")).toBeNull();
    release({ status: 200, body: body() });
    expect(await card().findByTestId("spendable-amount")).toBeTruthy();
  });

  it("BUD-03@PoC «Стани»: an error says «Не вдалося розрахувати суму», shows the code and «Спробувати ще раз» that reads again; the page works", async () => {
    let calls = 0;
    const fake = await open({
      [SPENDABLE]: () => (++calls === 1 ? problem(500, "BUD_500") : { status: 200, body: body() }),
    } as unknown as Record<string, Reply>);
    const alert = await card().findByRole("alert");
    expect(alert.textContent).toContain("Не вдалося розрахувати суму");
    expect(plain(region().textContent)).toContain("Код: 0123456789abcdef0123456789abcdef");
    // The rest of the page works: a card's error does not break it.
    expect(screen.getByRole("table")).toBeTruthy();
    fireEvent.click(card().getByRole("button", { name: "Спробувати ще раз" }));
    expect(await card().findByTestId("spendable-amount")).toBeTruthy();
    expect(fake.calls.filter((c) => c.path.endsWith("/spendable"))).toHaveLength(2);
  });

  it("BUD-03@PoC «Стани»: a network failure is an error of the card too, with a retry", async () => {
    await open({ [SPENDABLE]: "network" });
    expect((await card().findByRole("alert")).textContent).toContain("Не вдалося розрахувати суму");
    expect(card().getByRole("button", { name: "Спробувати ще раз" })).toBeTruthy();
  });

  it("BUD-03@PoC EC4, «Стани»: a part without a rate (`unavailable`) — no sum, which parts lack data and how many transactions have no rate; retry offered", async () => {
    await open({
      [SPENDABLE]: {
        status: 200,
        body: body({
          figures: null,
          unavailable: ["obligations", "goals"],
          approximate: { unavailableCount: 2 },
        }),
      },
    });
    expect(card().queryByTestId("spendable-amount")).toBeNull();
    expect(region().querySelector(".bud-spend")!.getAttribute("data-state")).toBe("unavailable");
    expect(plain(region().textContent)).toContain("Не вдалося розрахувати суму");
    expect(plain(region().textContent)).toContain("Курс недоступний · 2");
    expect(plain(region().textContent)).toContain("Немає курсу або даних: регулярні платежі, внески в цілі");
    expect(card().getByRole("button", { name: "Спробувати ще раз" })).toBeTruthy();
    expect(card().queryByRole("button", { name: "Показати розбивку суми" })).toBeNull();
  });

  it("BUD-03@PoC EC4: a transaction without any rate (`unavailableCount` > 0, no source listed) is the same state, never a partial sum", async () => {
    await open({
      [SPENDABLE]: { status: 200, body: body({ figures: null, approximate: { unavailableCount: 1 } }) },
    });
    expect(card().queryByTestId("spendable-amount")).toBeNull();
    expect(plain(region().textContent)).toContain("Курс недоступний · 1");
  });

  it("BUD-03@PoC EC4, «Стани»: «приблизно» beside the sum when any source is at the nearest rate; none otherwise", async () => {
    await open();
    expect(card().queryByText("приблизно")).toBeNull();
    cleanup();
    resetAuthState();
    await open({ [SPENDABLE]: { status: 200, body: body({ approximate: { obligations: true } }) } });
    expect(card().getAllByText("приблизно").length).toBeGreaterThan(0);
    fireEvent.click(card().getByRole("button", { name: "Показати розбивку суми" }));
    const dialog = await screen.findByRole("dialog", { name: "З чого складається сума" });
    // The mark stands at the source that is approximate, not at the others.
    const sources = [...dialog.querySelectorAll(".bud-spend-source")];
    const marked = sources
      .filter((s) => s.querySelector("[data-status='g.approximate']"))
      .map((s) => s.querySelector(".bud-spend-source-label")!.textContent);
    expect(marked).toEqual(["Регулярні платежі"]);
  });

  it("BUD-03@PoC EC4: the nearest-rate transactions mark «Витрачено»; goals and planned expenses at the nearest rate mark their rows", async () => {
    await open({
      [SPENDABLE]: {
        status: 200,
        body: body({
          approximate: { nearestRateCount: 3, goals: true, plannedExpenses: true, incomes: true },
        }),
      },
    });
    fireEvent.click(card().getByRole("button", { name: "Показати розбивку суми" }));
    const dialog = await screen.findByRole("dialog", { name: "З чого складається сума" });
    const marked = [...dialog.querySelectorAll(".bud-spend-source")]
      .filter((s) => s.querySelector("[data-status='g.approximate']"))
      .map((s) => s.querySelector(".bud-spend-source-label")!.textContent);
    expect(marked).toEqual(["Очікуваний дохід", "Витрачено", "Внески в цілі", "Заплановані витрати"]);
  });

  it("BUD-03@PoC FR 8: an overdue payment of the list says «Прострочено на N дн.»", async () => {
    await open({
      [SPENDABLE]: {
        status: 200,
        body: body({
          figures: {
            regularPayments: {
              items: [
                {
                  kind: "recurring",
                  paymentId: PAY,
                  categoryId: null,
                  dueOn: "2026-11-05",
                  overdueDays: 7,
                  amount: money("1900.00"),
                },
              ],
              total: money("1900.00"),
            },
          },
        }),
      },
    });
    fireEvent.click(card().getByRole("button", { name: "Показати розбивку суми" }));
    const dialog = await screen.findByRole("dialog", { name: "З чого складається сума" });
    expect(plain(dialog.textContent)).toContain("Прострочено на 7 дн.");
  });

  it("BUD-03@PoC AC7, EC3: no budget — no card of «Можна витратити», the page shows «Бюджету ще немає» with its buttons, and the sum is not asked for", async () => {
    const fake = api({ "GET /v1/budget": { status: 200, body: { budget: null } } });
    renderAt(PAGE, fake.client);
    expect(await screen.findByRole("heading", { level: 2, name: "Бюджету ще немає" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Можна витратити" })).toBeNull();
    expect(fake.calls.some((c) => c.path.endsWith("/spendable"))).toBe(false);
    expect(screen.getByRole("link", { name: "Створити за моїми витратами" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Почати з нуля" })).toBeTruthy();
  });

  it("BUD-03@PoC AC8: the API answers «не знайдено» (a space without the function or a scoped member) — the slot stays empty, no sum and no error", async () => {
    await open({ [SPENDABLE]: problem(404, "NOT_FOUND") });
    await screen.findByRole("table");
    await waitFor(() => expect(region().getAttribute("data-empty")).toBe("true"));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Можна витратити" })).toBeNull();
  });

  it("BUD-03@PoC FR 4: a past and a future month have no «Можна витратити» (it runs to the end of the current period) — the sum is not asked for", async () => {
    for (const month of ["2026-10", "2026-12"]) {
      cleanup();
      resetAuthState();
      const fake = api();
      renderAt(`${PAGE}?period=${month}`, fake.client);
      await screen.findByRole("table");
      expect(fake.calls.some((c) => c.path.endsWith("/spendable"))).toBe(false);
      // A past month is S-135 «Підсумок періоду» (FLW-38, row 149): it has no slot for the sum; a future one keeps its empty slot.
      if (month === "2026-10") expect(document.querySelector('[data-plan-region="spendable"]')).toBeNull();
      else expect(region().getAttribute("data-empty")).toBe("true");
    }
  });

  it("BUD-03@PoC FR 9: a new transaction is counted by the API — the next visit of the page shows the recalculated sum and daily limit, not the old ones", async () => {
    // The same space before and after a transaction: the API's answer changes between two visits.
    const before = api();
    const after = api({
      [SPENDABLE]: {
        status: 200,
        body: body({ figures: { amount: money("1200.00"), daily: money("63.16") } }),
      },
    });
    const first = renderAt(PAGE, before.client);
    expect(plain((await screen.findByTestId("spendable-amount")).textContent)).toBe("1 300,00 €");
    first.unmount();
    renderAt(PAGE, after.client);
    await waitFor(() => expect(plain(screen.getByTestId("spendable-amount").textContent)).toBe("1 200,00 €"));
    expect(plain(region().textContent)).toContain("63,16 € на день");
    expect(after.calls.filter((c) => c.path.endsWith("/spendable"))).toHaveLength(1);
  });

  it("BUD-03@PoC FR 11, FR 12: the card has no pace chart, no forecast and no stale-bank warning", async () => {
    await open();
    expect(region().querySelector("svg[role='img'], canvas")).toBeNull();
    expect(plain(region().textContent)).not.toMatch(/Швидше за план|прогноз|темп|застар/i);
  });
});

describe("BUD-03@PoC b) texts and tokens", () => {
  it("BUD-03@PoC «Стани»: every string of the card comes from the catalogue in uk and en (no literals in the component)", () => {
    const dir = join(dirname(fileURLToPath(import.meta.url)), "spendable");
    const source = readFileSync(join(dir, "SpendableCard.tsx"), "utf8");
    expect(source).not.toMatch(/>\s*[А-Яа-яІіЇїЄє][^<{]*</);
    const css = readFileSync(join(dir, "spendable.css"), "utf8");
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});

/** The page's API with the answer of the sum held back until it is released. */
function heldApi(held: Promise<Reply>) {
  return fakeApi({
    "GET /v1/budget": { status: 200, body: BUDGET },
    "GET /v1/categories": { status: 200, body: { groups: [] } },
    "GET /v1/budget/periods/2026-11": { status: 200, body: period("2026-11", "current") },
    "GET /v1/me/features": FEATURES,
    [SPENDABLE]: () => held,
  });
}
