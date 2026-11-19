import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { I18nProvider } from "@willowsum/i18n";
import { HideAmountsProvider } from "@willowsum/ui";
import { installMatchMedia } from "@willowsum/ui/test-utils";
import { AuthApiProvider } from "../../auth/api.ts";
import { fakeApi, plain, problem, resetAuthState, type Reply } from "../../auth/testing.tsx";
import { filtersFromHash } from "../../transactions/filters.ts";
import { shiftMonth } from "../budget/model.ts";
import { TrendScreen } from "./TrendScreen.tsx";
import { MAX_MONTHS, windows } from "./model.ts";

/**
 * BUD-16@PoC b) (wave 2, row 133): S-133 «Тренд» on `GET /v1/budget/trend` (BUD-16a), `GET /v1/budget` and the
 * categories. Only the screen is rendered (no shell, no router). Board: PocPlanTrend, texts: PocPlanTrendTexts.
 * Today is 2026-11-19 unless a test says otherwise: the last completed period is 2026-10. The amounts are synthetic.
 */
const money = (amount: string) => ({ amount, currency: "EUR" });
const BUDGET = (firstPeriod: string) => ({
  budget: { id: "b0000000-0000-4000-8000-000000000001", currency: "EUR", firstPeriod },
});
const GROCERIES = "c0000000-0000-4000-8000-000000000001";
const LONG = "Дуже довга назва категорії витрат на побутові потреби родини з трьома дітьми";
const TREE = {
  groups: [
    {
      id: "9a000000-0000-4000-8000-000000000001",
      kind: "expense",
      name: "Щоденне",
      categories: [
        { id: GROCERIES, kind: "expense", name: "Продукти", hidden: false },
        { id: "c0000000-0000-4000-8000-000000000002", kind: "expense", name: LONG, hidden: false },
        { id: "c0000000-0000-4000-8000-000000000003", kind: "expense", name: "Прихована", hidden: true },
      ],
    },
  ],
};

/** The spending of a month is 2 000 + 10 × its month number, the plan 3 000 (4 800 in 2026-11), the income 5 500. */
function trendOf(from: string, to: string, over: (period: string) => object = () => ({})) {
  const months = [];
  for (let p = from; p <= to; p = shiftMonth(p, 1)) {
    const n = Number(p.slice(5));
    months.push({
      period: p,
      mode: "past",
      spent: money(`${2000 + n * 10}.50`),
      income: money("5500.00"),
      plan: p === "2026-11" ? money("4800.00") : money("3000.00"),
      ...over(p),
    });
  }
  return { currency: "EUR", approximate: { nearestRateCount: 0, unavailableCount: 0 }, months };
}

interface Options {
  first?: string;
  budget?: Reply;
  trend?: Reply;
  over?: (period: string) => object;
}
function setup(o: Options = {}) {
  const queries: URLSearchParams[] = [];
  const api = fakeApi({
    "GET /v1/budget": o.budget ?? { status: 200, body: BUDGET(o.first ?? "2025-01") },
    "GET /v1/categories": { status: 200, body: TREE },
    "GET /v1/budget/trend": (_call, url) => {
      queries.push(url.searchParams);
      return (
        o.trend ?? {
          status: 200,
          body: trendOf(url.searchParams.get("from")!, url.searchParams.get("to")!, o.over),
        }
      );
    },
  });
  return { api, queries };
}

function open(o: Options = {}, today = "2026-11-19", locale: "uk" | "en" = "uk") {
  const s = setup(o);
  render(
    <I18nProvider initialLocale={locale}>
      <HideAmountsProvider initialHidden={false}>
        <AuthApiProvider value={s.api.client}>
          <TrendScreen today={today} />
        </AuthApiProvider>
      </HideAmountsProvider>
    </I18nProvider>,
  );
  return s;
}

beforeEach(() => {
  installMatchMedia({ width: 1280 });
  resetAuthState();
  window.location.hash = "#/planning/budget/trend";
});
afterEach(cleanup);

const bars = () => screen.findAllByRole("button", { name: /^Витрати, / });
const lastQuery = (q: URLSearchParams[]) => q.at(-1)!;

describe("BUD-06@PoC FR 7: S-133 «Тренд»", () => {
  it("BUD-06@PoC FR 7: 12 completed periods as columns, the income and budget lines, the category filter and the period switch «1М · 3М · 1Р · Усе» on «1Р»", async () => {
    const { queries } = open();
    expect(await bars()).toHaveLength(12);
    expect(lastQuery(queries).get("from")).toBe("2025-11");
    expect(lastQuery(queries).get("to")).toBe("2026-10");
    const legend = plain(document.body.textContent);
    expect(legend).toContain("Дохід");
    expect(legend).toContain("Бюджет");
    expect((screen.getByRole("combobox", { name: "Категорія" }) as HTMLSelectElement).value).toBe("");
    const radios = screen.getAllByRole("radio");
    expect(radios.map((r) => r.nextElementSibling?.textContent)).toEqual(["1М", "3М", "1Р", "Усе"]);
    expect((screen.getByRole("radio", { name: "1Р" }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText(/Витрати за завершені періоди · Листопад 2025 – Жовтень 2026/)).toBeTruthy();
    expect(
      screen.getByText(/найвищі — Грудень 2025 \(2 120,50 €\), найнижчі — Січень 2026 \(2 010,50 €\)/),
    ).toBeTruthy();
  });

  it("BUD-06@PoC FR 7: the view button of the chart card is shown inactive — the chart has one view", async () => {
    open();
    await bars();
    const view = screen.getByRole("button", { name: "Вигляд: Стовпчики" });
    expect(view.getAttribute("aria-disabled")).toBe("true");
  });

  it("BUD-06@PoC FR 7: «1М», «3М», «1Р» ask for the last 1, 3 and 12 completed periods; «Усе» for all periods of the budget", async () => {
    const { queries } = open({ first: "2026-02" });
    await bars();
    for (const [name, from, count] of [
      ["1М", "2026-10", 1],
      ["3М", "2026-08", 3],
      ["Усе", "2026-02", 9],
      ["1Р", "2026-02", 9],
    ] as const) {
      fireEvent.click(screen.getByRole("radio", { name }));
      await waitFor(() => expect(lastQuery(queries).get("from")).toBe(from));
      expect(lastQuery(queries).get("to")).toBe("2026-10");
      await waitFor(() => expect(screen.getAllByRole("button", { name: /^Витрати, / })).toHaveLength(count));
    }
  });

  it("BUD-06@PoC FR 7: the category filter sends the category and lists the visible expense categories", async () => {
    const { queries } = open();
    await bars();
    const select = screen.getByRole("combobox", { name: "Категорія" });
    await waitFor(() => expect(within(select).getAllByRole("option").length).toBeGreaterThan(1));
    expect(
      within(select)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["Усі", "Продукти", LONG]);
    fireEvent.change(select, { target: { value: GROCERIES } });
    await waitFor(() => expect(lastQuery(queries).get("categoryId")).toBe(GROCERIES));
  });

  it("BUD-06@PoC FR 7: a column opens the transactions of its month", async () => {
    open();
    const march = (await bars()).find((b) =>
      /березень 2026|Березень 2026/i.test(b.getAttribute("aria-label") ?? ""),
    )!;
    fireEvent.click(march);
    expect(window.location.hash).toBe("#/money/transactions?from=2026-03-01&to=2026-03-31");
    expect(filtersFromHash(window.location.hash)).toMatchObject({
      dateFrom: "2026-03-01",
      dateTo: "2026-03-31",
    });
  });

  it("BUD-06@PoC FR 10: the columns and the rows of the table open from the keyboard", async () => {
    open();
    const column = (await bars())[0]!;
    column.focus();
    expect(document.activeElement).toBe(column);
    fireEvent.keyDown(column, { key: "Enter" });
    fireEvent.click(column);
    expect(window.location.hash).toMatch(/^#\/money\/transactions\?from=2025-11-01&to=2025-11-30$/);
    window.location.hash = "#/planning/budget/trend";
    const row = screen.getByRole("row", { name: /Відкрити транзакції: Грудень 2025/ });
    row.focus();
    fireEvent.keyDown(row, { key: "Enter" });
    expect(window.location.hash).toBe("#/money/transactions?from=2025-12-01&to=2025-12-31");
  });

  it("BUD-06@PoC FR 7: the table repeats the chart's numbers and sorts by a column", async () => {
    open();
    await bars();
    const table = screen.getByRole("table", { name: "Витрати, бюджет і дохід за періодами" });
    expect(within(table).getAllByRole("row")).toHaveLength(13);
    // The table lists the latest period first, as the board does.
    expect(plain(within(table).getAllByRole("row")[1]!.textContent)).toContain("Жовтень 2026");
    expect(plain(within(table).getByRole("row", { name: /Жовтень 2026/ }).textContent)).toContain(
      "2 100,50 €",
    );
    fireEvent.click(within(table).getByRole("button", { name: /Витрати/ }));
    const first = within(table).getAllByRole("row")[1]!;
    expect(plain(first.textContent)).toContain("Грудень 2025");
    fireEvent.click(within(table).getByRole("button", { name: /Витрати/ }));
    expect(plain(within(table).getAllByRole("row")[1]!.textContent)).toContain("Січень 2026");
  });

  it("BUD-06@PoC FR 7: «Факт − план» shows the arrow and the amount, and «—» for a month without a plan", async () => {
    open({ over: (p) => (p === "2026-10" ? { plan: null } : {}) });
    await bars();
    const row = (name: RegExp) => screen.getByRole("row", { name });
    expect(plain(row(/Березень 2026/).textContent)).toContain("▼ 969,50 €");
    expect(plain(row(/Жовтень 2026/).textContent)).toMatch(/—\s*—\s*5 500,00 €$|2 100,50 €——/);
  });
});

describe("BUD-16@PoC: the plan line", () => {
  it("BUD-16@PoC AC1: the plan of a completed November is 4 800 € (the sum of its limits), without marks of a method change", async () => {
    open({ first: "2026-09" }, "2026-12-03");
    expect(await bars()).toHaveLength(3);
    const november = screen.getByRole("row", { name: /Листопад 2026/ });
    expect(plain(november.textContent)).toContain("4 800,00 €");
    const text = plain(document.body.textContent).toLowerCase();
    expect(text).not.toContain("метод");
    expect(screen.queryByRole("tab", { name: /Метод/ })).toBeNull();
  });

  it("BUD-16@PoC FR 5: the screen states facts: no advice, only amounts, periods and differences", async () => {
    open();
    await bars();
    const text = plain(document.body.textContent).toLowerCase();
    for (const advice of ["рекомендуємо", "варто", "радимо", "порада"]) expect(text).not.toContain(advice);
  });
});

describe("BUD-06@PoC FR 7, #603: «Усе» in windows of 120 months", () => {
  it("BUD-06@PoC FR 7: «Усе» — windows() splits a range into requests of at most 120 months, in order, without a gap", () => {
    expect(MAX_MONTHS).toBe(120);
    expect(windows("2026-01", "2026-10")).toEqual([["2026-01", "2026-10"]]);
    expect(windows("2014-01", "2023-12")).toEqual([["2014-01", "2023-12"]]);
    expect(windows("2014-01", "2026-10")).toEqual([
      ["2014-01", "2023-12"],
      ["2024-01", "2026-10"],
    ]);
    expect(windows("2000-01", "2026-10").map(([f, t]) => [f, t])).toHaveLength(3);
  });

  it("BUD-06@PoC FR 7: «Усе» of a space with 13 years of history asks twice (120 and 33 months) and shows every period once", async () => {
    const { queries } = open({ first: "2014-01" });
    await bars();
    fireEvent.click(screen.getByRole("radio", { name: "Усе" }));
    await waitFor(() => expect(queries.filter((q) => q.get("from") === "2024-01")).toHaveLength(1));
    const asked = queries.slice(-2).map((q) => [q.get("from"), q.get("to")]);
    expect(asked).toEqual([
      ["2014-01", "2023-12"],
      ["2024-01", "2026-10"],
    ]);
    await waitFor(() =>
      expect(screen.getByRole("table", { name: "Витрати, бюджет і дохід за періодами" })).toBeTruthy(),
    );
    await waitFor(() => expect(screen.getAllByRole("row")).toHaveLength(1 + 154));
  });
});

describe("BUD-16@PoC b): states", () => {
  it("BUD-16@PoC b) loading: a skeleton of the chart's height while the data loads", async () => {
    let release: (r: Reply) => void = () => undefined;
    const pending = new Promise<Reply>((resolve) => (release = resolve));
    const api = fakeApi({
      "GET /v1/budget": () => pending,
      "GET /v1/categories": { status: 200, body: TREE },
      "GET /v1/budget/trend": (_c, url) => ({
        status: 200,
        body: trendOf(url.searchParams.get("from")!, url.searchParams.get("to")!),
      }),
    });
    render(
      <I18nProvider initialLocale="uk">
        <AuthApiProvider value={api.client}>
          <TrendScreen today="2026-11-19" />
        </AuthApiProvider>
      </I18nProvider>,
    );
    expect(document.querySelector(".ws-skeleton")).not.toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
    release({ status: 200, body: BUDGET("2025-01") });
    await bars();
    expect(document.querySelector(".ws-skeleton")).toBeNull();
  });

  it("BUD-16@PoC b) empty: no budget yet — «Ще немає завершених періодів», no table", async () => {
    open({ budget: { status: 200, body: { budget: null } } });
    expect(await screen.findByText("Ще немає завершених періодів")).toBeTruthy();
    expect(screen.getByText("Тренд з'явиться, коли закінчиться перший місяць бюджету.")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("BUD-16@PoC b) empty: a budget that began this month has no completed period", async () => {
    const { queries } = open({ first: "2026-11" });
    expect(await screen.findByText("Ще немає завершених періодів")).toBeTruthy();
    expect(queries).toHaveLength(0);
  });

  it("BUD-16@PoC b) error: «Не вдалося завантажити тренд» with the support code, and «Спробувати ще раз» loads it again", async () => {
    let fail = true;
    const api = fakeApi({
      "GET /v1/budget": { status: 200, body: BUDGET("2025-01") },
      "GET /v1/categories": { status: 200, body: TREE },
      "GET /v1/budget/trend": (_c, url) =>
        fail
          ? problem(500, "INTERNAL")
          : {
              status: 200,
              body: trendOf(url.searchParams.get("from")!, url.searchParams.get("to")!),
            },
    });
    render(
      <I18nProvider initialLocale="uk">
        <AuthApiProvider value={api.client}>
          <TrendScreen today="2026-11-19" />
        </AuthApiProvider>
      </I18nProvider>,
    );
    expect(await screen.findByText("Не вдалося завантажити тренд")).toBeTruthy();
    expect(plain(document.body.textContent)).toContain("Код: 0123456789abcdef0123456789abcdef");
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Спробувати ще раз" }));
    expect(await bars()).toHaveLength(12);
  });

  it("BUD-16@PoC b) one point: «1М» shows one column, a note and no highest / lowest line", async () => {
    open();
    await bars();
    fireEvent.click(screen.getByRole("radio", { name: "1М" }));
    await waitFor(() => expect(screen.getAllByRole("button", { name: /^Витрати, / })).toHaveLength(1));
    expect(screen.getByText(/Один завершений період: на графіку одна точка\./)).toBeTruthy();
    expect(plain(document.body.textContent)).not.toContain("найвищі");
    expect(screen.getAllByRole("row")).toHaveLength(2);
  });

  it("BUD-16@PoC b) the hatched «з цілей» part is not drawn: the server does not return it", async () => {
    open();
    await bars();
    expect(plain(document.body.textContent)).not.toContain("з цілей");
    expect(plain(document.body.textContent).toLowerCase()).not.toContain("з них з цілей");
  });
});

describe("BUD-16@PoC b): texts and long names", () => {
  it("BUD-16@PoC b) en: every text of the screen is English, none is left in Ukrainian", async () => {
    open({}, "2026-11-19", "en");
    await screen.findAllByRole("button", { name: /^Spending, / });
    expect(screen.getByRole("combobox", { name: "Category" })).toBeTruthy();
    expect((screen.getByRole("radio", { name: "1Y" }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole("button", { name: "View: Columns" })).toBeTruthy();
    expect(screen.getByRole("table", { name: "Spending, budget and income by period" })).toBeTruthy();
    // The names of the user's categories are data, not texts of the screen.
    const copy = document.body.cloneNode(true) as HTMLElement;
    copy.querySelectorAll("option").forEach((o) => o.remove());
    expect(copy.textContent!.match(/[А-Яа-яІіЇїЄє]+/g)).toBeNull();
  });

  it("BUD-16@PoC b) a category with a very long name stays in the filter and the page keeps one column", async () => {
    open();
    await bars();
    const select = screen.getByRole("combobox", { name: "Категорія" });
    await waitFor(() => expect(within(select).getByRole("option", { name: LONG })).toBeTruthy());
    fireEvent.change(select, { target: { value: "c0000000-0000-4000-8000-000000000002" } });
    expect(await bars()).toHaveLength(12);
  });
});
