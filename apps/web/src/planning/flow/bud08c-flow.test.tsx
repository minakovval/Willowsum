import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { I18nProvider } from "@willowsum/i18n";
import { HideAmountsProvider } from "@willowsum/ui";
import { installMatchMedia } from "@willowsum/ui/test-utils";
import { AuthApiProvider } from "../../auth/api.ts";
import { fakeApi, plain, problem, resetAuthState, type Reply } from "../../auth/testing.tsx";
import { FlowScreen } from "./FlowScreen.tsx";
import { stateFromHash } from "./model.ts";

/**
 * BUD-08@PoC b) (wave 2, row 134): S-134 «Грошовий потік» on `GET /v1/cashflow` (BUD-08 a, #596 and #642), the goals and
 * the accounts (names only). Only the screen is rendered (no shell, no router). Board: PocPlanFlow, PocPlanFlowYear;
 * texts: PocPlanFlowTexts. Today is 2026-10-21 unless a test says otherwise. The amounts are synthetic.
 */
const m = (amount: string) => ({ amount, currency: "EUR" });
const ZERO = m("0.00");
const GOAL_A = "a0000000-0000-4000-8000-000000000001";
const GOAL_B = "a0000000-0000-4000-8000-000000000002";
const LOAN = "b0000000-0000-4000-8000-000000000001";
const LONG_GOAL = "Дуже довга назва цілі накопичення на подорож усією родиною до Італії влітку";
const LONG_LOAN = "Іпотечний кредит на квартиру в новобудові з довгою назвою від банку";

interface MonthOver {
  month?: string;
  income?: string;
  expenses?: string;
  net?: string;
  rate?: string | null;
  goals?: string;
  investments?: string;
  debt?: string;
  left?: string;
  fromGoals?: string;
  goalParts?: { goalId: string; amount: string }[];
  uncategorized?: { count: number; amount: string };
}
const monthOf = (o: MonthOver = {}) => ({
  month: o.month ?? "2026-09",
  income: m(o.income ?? "6000.00"),
  expenses: m("4500.00"),
  netFlow: m(o.net ?? "1500.00"),
  savingsRate: o.rate === undefined ? "25.0" : o.rate,
  uncategorizedInflows: { count: o.uncategorized?.count ?? 0, amount: m(o.uncategorized?.amount ?? "0.00") },
  goalContributions: {
    total: m(o.goals ?? "500.00"),
    goals: (o.goalParts ?? []).map((g) => ({ goalId: g.goalId, amount: m(g.amount) })),
  },
  investmentContributions: m(o.investments ?? "400.00"),
  investmentWithdrawals: ZERO,
  debtRepayment: m(o.debt ?? "0.00"),
  leftOnAccounts: m(o.left ?? "600.00"),
  fromGoals: m(o.fromGoals ?? "0.00"),
});

function reportOf(over: Record<string, unknown> = {}, months = [monthOf()]) {
  const first = months[0]!;
  return {
    type: "month",
    period: "2026-09",
    view: "month",
    currency: "EUR",
    months: over.months ?? months,
    totals: {
      income: first.income,
      expenses: first.expenses,
      netFlow: first.netFlow,
      savingsRate: first.savingsRate,
      averageMonthlyRate: first.savingsRate,
      highest: null,
      lowest: null,
      goalContributions: first.goalContributions,
      investmentContributions: first.investmentContributions,
      investmentWithdrawals: first.investmentWithdrawals,
      debtRepayment: first.debtRepayment,
      leftOnAccounts: first.leftOnAccounts,
      fromGoals: first.fromGoals,
      ...((over.totals as object | undefined) ?? {}),
    },
    loansWithoutRate: [],
    unpairedTransfers: 0,
    approximate: { nearestRateCount: 0, unavailableCount: 0 },
    empty: false,
    ...over,
  };
}

const MONTHS = [
  "2026-01",
  "2026-02",
  "2026-03",
  "2026-04",
  "2026-05",
  "2026-06",
  "2026-07",
  "2026-08",
  "2026-09",
];
const yearReport = (type: "year" | "ytd" | "quarter", period: string, months: string[]) => {
  const list = months.map((month, i) =>
    monthOf({
      month,
      income: "5000.00",
      net: `${2000 + i * 100}.00`,
      rate: month === "2026-07" ? "29.8" : `${40 + i}.0`,
      fromGoals: month === "2026-07" ? "1450.00" : "0.00",
    }),
  );
  return {
    ...reportOf({ type, period, view: "monthly" }, list),
    months: list,
    totals: {
      ...reportOf({}, list).totals,
      income: m("45000.00"),
      expenses: m("28766.24"),
      netFlow: m("25893.76"),
      savingsRate: "47.4",
      averageMonthlyRate: "46.9",
      highest: "2026-09",
      lowest: "2026-01",
      fromGoals: m("1450.00"),
    },
  };
};

interface Options {
  cashflow?: Reply | ((query: URLSearchParams) => Reply);
  accounts?: { id: string; name: string; kind: string; status: string }[];
}
function setup(o: Options = {}) {
  const queries: URLSearchParams[] = [];
  const api = fakeApi({
    "GET /v1/cashflow": (_call, url) => {
      queries.push(url.searchParams);
      const r = o.cashflow;
      return typeof r === "function" ? r(url.searchParams) : (r ?? { status: 200, body: reportOf() });
    },
    "GET /v1/goals": {
      status: 200,
      body: {
        goals: [
          { id: GOAL_A, name: "Відпустка в Італії" },
          { id: GOAL_B, name: LONG_GOAL },
        ],
      },
    },
    "GET /v1/accounts": {
      status: 200,
      body: {
        items: o.accounts ?? [{ id: LOAN, name: LONG_LOAN, kind: "loan", status: "active" }],
      },
    },
  });
  return { api, queries };
}

function open(
  o: Options = {},
  hash = "#/planning/budget/money-flow?type=month&period=2026-09",
  locale: "uk" | "en" = "uk",
) {
  window.location.hash = hash;
  const s = setup(o);
  render(
    <I18nProvider initialLocale={locale}>
      <HideAmountsProvider initialHidden={false}>
        <AuthApiProvider value={s.api.client}>
          <FlowScreen today="2026-10-21" />
        </AuthApiProvider>
      </HideAmountsProvider>
    </I18nProvider>,
  );
  return s;
}

beforeEach(() => {
  installMatchMedia({ width: 1280 });
  resetAuthState();
});
afterEach(cleanup);

const text = () => plain(document.body.textContent);
const ready = () => screen.findByText("Куди пішов дохід");
const row = (id: string) => document.querySelector(`[data-row="${id}"]`) as HTMLElement;
const legend = (id: string) => document.querySelector(`.flow-legend [data-part="${id}"]`) as HTMLElement;

describe("BUD-08@PoC FR 1: the period and the view", () => {
  it("BUD-08@PoC AC5: the types are «Місяць», «Квартал», «З початку року» and «Рік»; «Власний» is absent", async () => {
    open();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Тип періоду: Місяць" }));
    const options = within(screen.getByRole("listbox", { name: "Тип періоду" })).getAllByRole("option");
    expect(options.map((o) => o.textContent?.replace("✓", "").trim())).toEqual([
      "Місяць",
      "Квартал",
      "З початку року",
      "Рік",
    ]);
  });

  it("BUD-08@PoC AC5: the type «Рік» shows the view «Помісячно» with 12 months of the chosen year", async () => {
    const months = Array.from({ length: 12 }, (_, i) => `2025-${String(i + 1).padStart(2, "0")}`);
    const { queries } = open(
      { cashflow: { status: 200, body: yearReport("year", "2025", months) } },
      "#/planning/budget/money-flow?type=year&period=2025",
    );
    expect(await screen.findAllByRole("img", { name: /^Чистий потік, / })).toHaveLength(12);
    expect(queries.at(-1)!.get("type")).toBe("year");
    expect(queries.at(-1)!.get("period")).toBe("2025");
    expect(screen.queryByText("Куди пішов дохід")).toBeNull();
    expect(document.querySelector('[data-view="monthly"]')).toBeTruthy();
  });

  it("BUD-08@PoC FR 1: a change of the type keeps the period that holds the old one and asks the API for it", async () => {
    const { queries } = open();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Тип періоду: Місяць" }));
    fireEvent.click(screen.getByRole("option", { name: /Квартал/ }));
    await waitFor(() => expect(queries.at(-1)!.get("type")).toBe("quarter"));
    expect(queries.at(-1)!.get("period")).toBe("2026-Q3");
    expect(window.location.hash).toContain("type=quarter&period=2026-Q3");
  });

  it("BUD-08@PoC FR 1: an address with no choice opens the current month; a wrong period falls back to it", () => {
    expect(stateFromHash("#/planning/budget/money-flow", "2026-10-21")).toEqual({
      type: "month",
      period: "2026-10",
    });
    expect(stateFromHash("#/planning/budget/money-flow?type=month&period=oops", "2026-10-21").period).toBe(
      "2026-10",
    );
    expect(stateFromHash("#?type=custom&period=2026", "2026-10-21").type).toBe("month");
  });
});

describe("BUD-08@PoC FR 2: the view «Місяць»", () => {
  it("BUD-08@PoC AC1: shows income 6 000 €, spending 4 500 €, net flow 1 500 €, savings rate 25,0 %, 500 € to goals, 1 000 € left on the accounts and no investments row", async () => {
    open({
      cashflow: { status: 200, body: reportOf({}, [monthOf({ investments: "0.00", left: "1000.00" })]) },
    });
    await ready();
    const kpis = plain(document.querySelector(".flow-kpis")!.textContent);
    expect(kpis).toContain("6 000,00 €");
    expect(kpis).toContain("4 500,00 €");
    expect(kpis).toContain("1 500,00 €");
    expect(kpis).toContain("25,0 %");
    expect(plain(legend("goals").textContent)).toContain("500,00 €");
    expect(legend("investments")).toBeNull();
    expect(plain(legend("left").textContent)).toContain("1 000,00 €");
    expect(plain(row("left").textContent)).toContain("Залишилось на рахунках");
    expect(plain(row("left").textContent)).toContain("1 000,00 €");
    expect(plain(document.querySelector(".flow-band-total")!.textContent)).toContain("Усього6 000,00 €");
  });

  it("BUD-08@PoC FR 2: the rows are in the order of the calculation and the card «Куди пішов дохід» has the band «Смуга» with its button shown inactive", async () => {
    open();
    await ready();
    const names = [...document.querySelectorAll(".flow-legend .flow-legend-name")].map((e) => e.textContent);
    expect(names).toEqual([
      "Витрати",
      "Внески в цілі",
      "Внески в інвестиції",
      "Погашення боргу",
      "Залишилось на рахунках",
    ]);
    expect(document.querySelector(".flow-band")!.getAttribute("role")).toBe("img");
    expect(screen.getByRole("button", { name: "Вигляд: Смуга" }).getAttribute("aria-disabled")).toBe("true");
  });

  it("BUD-08@PoC FR 2: the row «Погашення боргу» has a quiet «›» with the hint «Відкрити «Борги»»", async () => {
    open();
    await ready();
    const link = within(legend("debt")).getByRole("link", { name: "Відкрити «Борги»" });
    expect(link.getAttribute("href")).toBe("#/planning/debts");
    expect(link.getAttribute("title")).toBe("Відкрити «Борги»");
    expect(within(row("debt")).getByRole("link", { name: "Відкрити «Борги»" })).toBeTruthy();
  });

  it("BUD-08@PoC FR 2: the calculation reads income − spending = net flow − goals − investments − debt = left on the accounts", async () => {
    open();
    await ready();
    const ids = [...document.querySelectorAll(".flow-calc > li")].map((e) => e.getAttribute("data-row"));
    expect(ids).toEqual(["income", "expenses", "net", "goals", "investments", "debt", "left"]);
    expect(plain(row("net").textContent)).toContain("норма заощаджень 25,0 %");
    expect(row("expenses").textContent).toContain("−");
    expect(within(row("expenses")).getByText("мінус")).toBeTruthy();
    expect(within(row("left")).getByText("дорівнює")).toBeTruthy();
  });

  it("BUD-08@PoC FR 5: the goals row names each goal with its amount, long names included", async () => {
    open({
      cashflow: {
        status: 200,
        body: reportOf({}, [
          monthOf({
            goals: "750.00",
            goalParts: [
              { goalId: GOAL_A, amount: "250.00" },
              { goalId: GOAL_B, amount: "500.00" },
            ],
          }),
        ]),
      },
    });
    await ready();
    const hint = plain(row("goals").textContent);
    expect(hint).toContain("Відпустка в Італії 250,00 €");
    expect(hint).toContain(`${LONG_GOAL} 500,00 €`);
    expect(hint).toContain("750,00 €");
  });
});

describe("BUD-08@PoC FR 3: the savings rate", () => {
  it("BUD-08@PoC AC3: a month without income shows the rate as «–» and the net flow −800 €", async () => {
    open({
      cashflow: {
        status: 200,
        body: reportOf({}, [
          monthOf({
            income: "0.00",
            net: "-800.00",
            rate: null,
            goals: "0.00",
            investments: "0.00",
            left: "-800.00",
          }),
        ]),
      },
    });
    await ready();
    const rate = [...document.querySelectorAll(".flow-kpi")].find((k) =>
      k.textContent?.includes("Норма заощаджень"),
    )!;
    expect(rate.querySelector(".flow-kpi-value")!.textContent).toBe("–");
    expect(plain(rate.textContent)).toContain("немає доходу");
    expect(plain(document.querySelector(".flow-kpis")!.textContent)).toContain("−800,00 €");
  });
});

describe("BUD-08@PoC FR 4: «Залишилось на рахунках»", () => {
  it("BUD-08@PoC FR 4: a negative value is shown and the screen says why", async () => {
    open({
      cashflow: {
        status: 200,
        body: reportOf({}, [monthOf({ left: "-120.00" })]),
      },
    });
    await ready();
    expect(plain(row("left").textContent)).toContain("−120,00 €");
    expect(plain(row("left").textContent)).toContain("Менше нуля");
  });

  it("BUD-08@PoC FR 4: a positive value has no explanation", async () => {
    open();
    await ready();
    expect(plain(row("left").textContent)).not.toContain("Менше нуля");
  });
});

describe("BUD-08@PoC FR 6: «Внески в інвестиції» (owner, 2026-11-20, item 1)", () => {
  it("BUD-08@PoC FR 6: the row is hidden in the band and the calculation while the space has no brokerage account, even if the API sends a zero field", async () => {
    open({
      cashflow: { status: 200, body: reportOf({}, [monthOf({ investments: "0.00", left: "1000.00" })]) },
    });
    await ready();
    expect(legend("investments")).toBeNull();
    expect(row("investments")).toBeNull();
    expect(text()).not.toContain("Внески в інвестиції");
  });

  it("BUD-08@PoC FR 6: the row appears when the space has an active brokerage account", async () => {
    open({
      cashflow: { status: 200, body: reportOf({}, [monthOf({ investments: "0.00", left: "1000.00" })]) },
      accounts: [
        {
          id: "c0000000-0000-4000-8000-000000000009",
          name: "Брокерський",
          kind: "brokerage",
          status: "active",
        },
      ],
    });
    await ready();
    expect(legend("investments")).toBeTruthy();
    expect(plain(row("investments").textContent)).toContain("переказ на брокерський рахунок");
  });

  it("BUD-08@PoC FR 6: a non-zero amount is never hidden", async () => {
    open();
    await ready();
    expect(plain(legend("investments").textContent)).toContain("400,00 €");
  });
});

describe("BUD-08@PoC FR 8, FR 9: what is neither income nor spending", () => {
  it("BUD-08@PoC EC3: transfers waiting for a pair are shown as the counter «Перекази без пари» that opens the pairs", async () => {
    open({
      cashflow: { status: 200, body: reportOf({ unpairedTransfers: 2 }) },
    });
    await ready();
    const unpaired = document.querySelector('[data-row="unpaired"]')!;
    expect(plain(unpaired.textContent)).toContain("Перекази без пари");
    expect(plain(unpaired.textContent)).toContain("2 ·");
    expect(unpaired.querySelector("a")!.getAttribute("href")).toBe("#/money/transactions/pairs");
  });

  it("BUD-08@PoC FR 9: an inflow without a category is shown with the hint that it lowers the spending", async () => {
    open({
      cashflow: {
        status: 200,
        body: reportOf({}, [monthOf({ uncategorized: { count: 2, amount: "46.80" } })]),
      },
    });
    await ready();
    const row_ = plain(document.querySelector('[data-row="uncategorized"]')!.textContent);
    expect(row_).toContain("Вхідні без категорії");
    expect(row_).toContain("2 · 46,80 € · зменшують витрати, доходом не рахуються");
  });

  it("BUD-08@PoC FR 8: with nothing to say the side card is not drawn", async () => {
    open();
    await ready();
    expect(screen.queryByText("Не є ні доходом, ні витратою")).toBeNull();
  });
});

describe("BUD-08@PoC FR 7: the loan payment", () => {
  it("BUD-08@PoC AC7: the debt repayment 230,00 € is its own row; interest is spending, so the rate stays", async () => {
    open({
      cashflow: {
        status: 200,
        body: reportOf({}, [monthOf({ debt: "230.00", left: "370.00" })]),
      },
    });
    await ready();
    expect(plain(legend("debt").textContent)).toContain("230,00 €");
    expect(plain(row("debt").textContent)).toContain("тіло кредитів");
    expect(plain(row("net").textContent)).toContain("25,0 %");
  });

  it("BUD-08@PoC EC2: a loan whose payments were not split for want of a rate is named with the hint to enter the rate", async () => {
    open({
      cashflow: {
        status: 200,
        body: reportOf({ loansWithoutRate: [LOAN] }, [monthOf({ debt: "650.00", left: "-50.00" })]),
      },
    });
    await ready();
    expect(plain(row("debt").textContent)).toContain(`без ставки не поділено: ${LONG_LOAN} — внесіть ставку`);
  });
});

describe("BUD-08@PoC FR 10, FR 11: the view «Помісячно»", () => {
  const url = "#/planning/budget/money-flow?type=ytd&period=2026";

  it("BUD-08@PoC AC2: shows the columns of net flow, the line of the savings rate and the table; spending from goals is its own layer «з цілей»", async () => {
    open({ cashflow: { status: 200, body: yearReport("ytd", "2026", MONTHS) } }, url);
    expect(await screen.findAllByRole("img", { name: /^Чистий потік, / })).toHaveLength(9);
    expect(
      screen.getByRole("img", { name: (n) => plain(n).startsWith("Витрати з цілей, Липень 2026, 1 450,00") }),
    ).toBeTruthy();
    expect(document.querySelectorAll(".ws-chart-swatch--dotted").length).toBeGreaterThan(0);
    expect(document.querySelectorAll(".ws-chart-swatch--hatched")).toHaveLength(0);
    expect(screen.getByRole("group", { name: "Норма заощаджень за місяцями" })).toBeTruthy();
    expect(screen.getByRole("table", { name: "Грошовий потік за місяцями" })).toBeTruthy();
  });

  it("BUD-08@PoC FR 10: each chart has a title and a description with the highest and the lowest month; the net flow chart has its view button inactive, the rate line has none", async () => {
    open({ cashflow: { status: 200, body: yearReport("ytd", "2026", MONTHS) } }, url);
    await screen.findAllByRole("img", { name: /^Чистий потік, / });
    expect(screen.getByRole("heading", { name: "Чистий потік" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Норма заощаджень" })).toBeTruthy();
    expect(text()).toMatch(/найвищий — Вересень 2026 \(\d[\d\s]*,\d\d €\), найнижчий — Січень 2026/);
    expect(text()).toMatch(/найвища — Вересень 2026 \(48,0 %\), найнижча — Липень 2026 \(29,8 %\)/);
    expect(screen.getByRole("button", { name: "Вигляд: Стовпчики" }).getAttribute("aria-disabled")).toBe(
      "true",
    );
    expect(screen.getAllByRole("button", { name: /^Вигляд:/ })).toHaveLength(1);
  });

  it("BUD-08@PoC FR 11: the period's rate and the average of the monthly rates are the API's numbers", async () => {
    open({ cashflow: { status: 200, body: yearReport("ytd", "2026", MONTHS) } }, url);
    await screen.findAllByRole("img", { name: /^Чистий потік, / });
    const kpis = plain(document.querySelector(".flow-kpis")!.textContent);
    expect(kpis).toContain("47,4 %");
    expect(kpis).toContain("середнє місячних норм 46,9 %");
    expect(kpis).toContain("45 000,00 €");
    expect(kpis).toContain("з них з цілей 1 450,00 €");
  });

  it("BUD-08@PoC AC6: the quarter shows 3 months (July, August, September) and the rate of the quarter 25,0 %", async () => {
    const body = yearReport("quarter", "2026-Q3", ["2026-07", "2026-08", "2026-09"]);
    open(
      {
        cashflow: {
          status: 200,
          body: { ...body, totals: { ...body.totals, savingsRate: "25.0", averageMonthlyRate: "25.3" } },
        },
      },
      "#/planning/budget/money-flow?type=quarter&period=2026-Q3",
    );
    expect(await screen.findAllByRole("img", { name: /^Чистий потік, / })).toHaveLength(3);
    const rows = within(screen.getByRole("table", { name: "Грошовий потік за місяцями" })).getAllByRole(
      "row",
    );
    expect(rows.map((r) => plain(r.textContent).slice(0, 12))).toEqual(
      expect.arrayContaining([expect.stringContaining("Вересень"), expect.stringContaining("Липень")]),
    );
    expect(plain(document.querySelector(".flow-kpis")!.textContent)).toContain("25,0 %");
  });

  it("BUD-08@PoC FR 10: the table repeats the chart's numbers, newest month first, with the period's row last; spending from goals only where there is some", async () => {
    open({ cashflow: { status: 200, body: yearReport("ytd", "2026", MONTHS) } }, url);
    await screen.findAllByRole("img", { name: /^Чистий потік, / });
    const rows = within(screen.getByRole("table", { name: "Грошовий потік за місяцями" })).getAllByRole(
      "row",
    );
    expect(rows).toHaveLength(1 + 9 + 1);
    expect(plain(rows[1]!.textContent)).toContain("Вересень 2026");
    const july = rows.find((r) => plain(r.textContent).includes("Липень 2026"))!;
    expect(plain(july.textContent)).toContain("1 450,00 €");
    expect(plain(july.textContent)).toContain("29,8 %");
    expect(plain(rows.at(-1)!.textContent)).toContain("Січень–вересень 2026");
    expect(plain(rows.at(-1)!.textContent)).toContain("28 766,24 €");
    expect(plain(rows.at(-1)!.textContent)).toContain("47,4 %");
  });

  it("BUD-08@PoC FR 3: a month without income shows «–» in the chart's table and no point on the rate line", async () => {
    const body = yearReport("ytd", "2026", MONTHS.slice(0, 3));
    body.months[1] = { ...body.months[1]!, income: m("0.00"), savingsRate: null as never };
    open({ cashflow: { status: 200, body } }, url);
    await screen.findAllByRole("img", { name: /^Чистий потік, / });
    const february = within(screen.getByRole("table", { name: "Грошовий потік за місяцями" })).getByRole(
      "row",
      { name: /Лютий 2026/ },
    );
    expect(plain(february.textContent)).toContain("–");
  });
});

describe("BUD-08@PoC FR 12: the rates", () => {
  it("BUD-08@PoC FR 12: amounts at the nearest rate carry the mark «приблизно» with the count of such rows", async () => {
    open({
      cashflow: {
        status: 200,
        body: reportOf({ approximate: { nearestRateCount: 3, unavailableCount: 0 } }),
      },
    });
    await ready();
    const note = document.querySelector('[data-note="approximate"]')!;
    expect(plain(note.textContent)).toContain("приблизно");
    expect(plain(note.textContent)).toContain("3 транзакції за найближчим курсом");
    expect(document.querySelector('[data-note="unavailable"]')).toBeNull();
  });

  it("BUD-08@PoC EC4: a currency with no rate at all says «Курс недоступний» and that its rows are not counted until a rate appears", async () => {
    open({
      cashflow: {
        status: 200,
        body: reportOf({ approximate: { nearestRateCount: 0, unavailableCount: 2 } }),
      },
    });
    await ready();
    const note = plain(document.querySelector('[data-note="unavailable"]')!.textContent);
    expect(note).toContain("Курс недоступний · 2");
    expect(note).toContain("рядки без курсу не враховано, доки курс не з'явиться");
    expect(document.querySelector('[data-note="approximate"]')).toBeNull();
  });

  it("BUD-08@PoC FR 12: with every rate known there are no marks", async () => {
    open();
    await ready();
    expect(document.querySelector("[data-note]")).toBeNull();
  });
});

describe("BUD-08@PoC «Стани інтерфейсу»", () => {
  it("BUD-08@PoC: while the report loads the screen shows the skeleton of the figures and the cards", async () => {
    let release: (r: Reply) => void = () => undefined;
    let asked = false;
    open({
      cashflow: (() =>
        new Promise<Reply>((r) => {
          asked = true;
          release = r;
        })) as never,
    });
    expect(document.querySelector('[data-state="loading"]')).toBeTruthy();
    expect(screen.queryByText("Куди пішов дохід")).toBeNull();
    await waitFor(() => expect(asked).toBe(true));
    release({ status: 200, body: reportOf() });
    await ready();
    expect(document.querySelector('[data-state="loading"]')).toBeNull();
  });

  it("BUD-08@PoC: a period with no budget-account transactions shows «Немає транзакцій рахунків бюджету за цей період» with a link to add them", async () => {
    open({ cashflow: { status: 200, body: reportOf({ empty: true }) } });
    expect(await screen.findByText("Немає транзакцій рахунків бюджету за цей період")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Додати транзакцію" }).getAttribute("href")).toBe(
      "#/money/transactions",
    );
    expect(document.querySelector(".flow-kpis")).toBeNull();
  });

  it("BUD-08@PoC: a failed report shows «Не вдалося розрахувати грошовий потік», the support code and «Спробувати ще раз», which asks again", async () => {
    let answers = 0;
    const { queries } = open({
      cashflow: () => (++answers === 1 ? problem(500, "INTERNAL") : { status: 200, body: reportOf() }),
    });
    expect(await screen.findByText("Не вдалося розрахувати грошовий потік")).toBeTruthy();
    expect(text()).toContain("Код:");
    fireEvent.click(screen.getByRole("button", { name: "Спробувати ще раз" }));
    await ready();
    expect(queries).toHaveLength(2);
  });

  it("BUD-08@PoC: a lost connection is the same error state, never an endless skeleton", async () => {
    open({ cashflow: "network" as never });
    expect(await screen.findByText("Не вдалося розрахувати грошовий потік")).toBeTruthy();
  });

  it("BUD-08@PoC: when the names fail to load the numbers are still shown", async () => {
    window.location.hash = "#/planning/budget/money-flow?type=month&period=2026-09";
    const api = fakeApi({
      "GET /v1/cashflow": { status: 200, body: reportOf() },
      "GET /v1/goals": problem(500, "INTERNAL"),
      "GET /v1/accounts": "network" as never,
    });
    render(
      <I18nProvider initialLocale="uk">
        <HideAmountsProvider initialHidden={false}>
          <AuthApiProvider value={api.client}>
            <FlowScreen today="2026-10-21" />
          </AuthApiProvider>
        </HideAmountsProvider>
      </I18nProvider>,
    );
    await ready();
    expect(plain(legend("left").textContent)).toContain("600,00 €");
  });
});

describe("BUD-08@PoC П-14, П-15: money and texts", () => {
  it("BUD-08@PoC П-14: every amount is the API's string formatted, never summed in the web (a total that does not add up is shown as sent)", async () => {
    open({
      cashflow: {
        status: 200,
        body: reportOf({}, [monthOf({ left: "123.45" })]),
      },
    });
    await ready();
    expect(plain(legend("left").textContent)).toContain("123,45 €");
  });

  it("BUD-08@PoC П-15: the screen is in English too", async () => {
    open({}, "#/planning/budget/money-flow?type=month&period=2026-09", "en");
    await screen.findByText("Where the income went");
    expect(text()).toContain("Net flow");
    expect(text()).toContain("Left on accounts");
    expect(text()).toContain("€6,000.00");
  });
});
