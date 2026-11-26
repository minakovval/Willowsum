import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { installMatchMedia } from "@willowsum/ui/test-utils";
import { AuthApiProvider } from "../auth/api.ts";
import { fakeApi, plain, problem, resetAuthState, SUPPORT_ID, type Reply } from "../auth/testing.tsx";
import { BudgetPlanPage } from "./plan/BudgetPlanPage.tsx";

/**
 * BUD-17@PoC b) (wave 2, row 127): S-126 «Бюджет → План» on `GET /v1/budget/plan-grid` and
 * `PUT /v1/budget/plan-grid/cells`. Only the screen is rendered. Boards: PocPlanBudgetPlan, PocPlanBudgetPlanOver,
 * PocPlanBudgetPlanTexts. Synthetic values; today is 2026-11-18 (the grid starts in November).
 */
const TODAY = "2026-11-18";
const eur = (amount: string) => ({ amount, currency: "EUR" });
const G_DAILY = "9a000000-0000-4000-8000-000000000002";
const FOOD = "c0000000-0000-4000-8000-000000000001";
const RENT = "c0000000-0000-4000-8000-000000000002";
const LONG_ID = "c0000000-0000-4000-8000-000000000003";
const GOAL_TRIP = "d0000000-0000-4000-8000-000000000001";
const LOAN = "e0000000-0000-4000-8000-000000000001";
const SALARY = "f0000000-0000-4000-8000-000000000001";
const FREELANCE = "f0000000-0000-4000-8000-000000000002";
const RENTAL = "f0000000-0000-4000-8000-000000000003";
const G_INCOME = "9a000000-0000-4000-8000-000000000003";
const LONG_INCOME = `Дохід від здавання в оренду квартири на вулиці з дуже довгою назвою ${"Нерозривнеслово".repeat(2)}`;
const LONG_NAME = `Категорія з дуже довгою назвою на шістдесят і більше символів у рядку плану ${"Нерозривнеслово".repeat(3)}`;

const monthsFrom = (first: string, count = 12) => {
  const [y, m] = first.split("-").map(Number) as [number, number];
  return Array.from({ length: count }, (_, i) => {
    const n = y * 12 + (m - 1) + i;
    return `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, "0")}`;
  });
};

type Cell = { amount: ReturnType<typeof eur> | null; own: boolean; version: number };
const cell = (amount: string | null, version = 0): Cell => ({
  amount: amount === null ? null : eur(amount),
  own: version > 0,
  version,
});
const flat = <T,>(n: number, make: (i: number) => T): T[] => Array.from({ length: n }, (_, i) => make(i));

interface GridOver {
  first?: string;
  foodAt?: (i: number) => Cell;
  /** Row 231: «Надходження» — a row per income category; «Дохід від оренди» in UAH with today's rate. */
  freelanceAt?: (i: number) => Cell;
  rental?: boolean;
  unallocated?: ({ kind: "unallocated" | "deficit"; amount: ReturnType<typeof eur> } | null)[];
  goalAt?: (i: number) => Cell;
  extra?: boolean;
}

function grid(over: GridOver = {}) {
  const periods = monthsFrom(over.first ?? "2026-11");
  const sum = (v: string) => flat(12, () => eur(v));
  return {
    currency: "EUR",
    months: periods.map((period, i) => ({ period, mode: i === 0 ? "current" : "future", inBudget: true })),
    income: {
      categories: [
        { categoryId: SALARY, cells: flat(12, () => cell("5000.00")) },
        { categoryId: FREELANCE, cells: flat(12, over.freelanceAt ?? (() => cell("600.00"))) },
        ...(over.rental
          ? [
              {
                categoryId: RENTAL,
                cells: flat(12, () => ({ ...cell(null), amount: { amount: "20000.00", currency: "UAH" } })),
              },
            ]
          : []),
      ],
      // ARC-07 FR 3: the former fields, deprecated — the page reads none of them.
      plan: flat(12, () => cell("5600.00")),
      rows: [],
      other: flat(12, () => null),
      totals: sum(over.rental ? "6000.00" : "5600.00"),
    },
    expenses: {
      groups: [
        {
          groupId: G_DAILY,
          categories: [
            { categoryId: FOOD, cells: flat(12, over.foodAt ?? (() => cell("700.00"))) },
            { categoryId: RENT, cells: flat(12, () => cell("1200.00")) },
            { categoryId: LONG_ID, cells: flat(12, () => cell("45.00")) },
          ],
        },
      ],
      totals: sum("1945.00"),
    },
    goals: {
      rows: [
        {
          goalId: GOAL_TRIP,
          cells: flat(12, (i) => ({
            ...(over.goalAt ? over.goalAt(i) : cell("334.00")),
            required: eur("334.00"),
          })),
        },
      ],
      savings: flat(12, () => cell("400.00")),
      totals: sum("734.00"),
    },
    debts: {
      rows: [
        {
          accountId: LOAN,
          cells: flat(12, () => ({ minimum: eur("310.00"), extra: over.extra ? eur("100.00") : null })),
        },
      ],
      totals: sum("310.00"),
    },
    rates: over.rental ? [{ currency: "UAH", rate: "0.02", date: "2026-11-17" }] : [],
    unallocated:
      over.unallocated ?? flat(12, () => ({ kind: "unallocated" as const, amount: eur("200.00") })),
  };
}

const tree = {
  groups: [
    {
      id: G_DAILY,
      systemKey: null,
      kind: "expense",
      name: "Щоденне",
      renamed: false,
      tone: "neutral",
      categories: [
        [FOOD, "Продукти"],
        [RENT, "Оренда"],
        [LONG_ID, LONG_NAME],
      ].map(([id, name]) => ({
        id,
        groupId: G_DAILY,
        systemKey: null,
        kind: "expense",
        name,
        renamed: false,
        icon: "shopping",
        color: "#336699",
        iconTone: "white",
        essential: false,
        hidden: false,
        deletable: true,
      })),
    },
    {
      id: G_INCOME,
      systemKey: null,
      kind: "income",
      name: "Доходи",
      renamed: false,
      tone: "neutral",
      categories: [
        [SALARY, "Зарплата"],
        [FREELANCE, "Фриланс"],
        [RENTAL, LONG_INCOME],
      ].map(([id, name]) => ({
        id,
        groupId: G_INCOME,
        systemKey: null,
        kind: "income",
        name,
        renamed: false,
        icon: "wallet",
        color: "#336699",
        iconTone: "white",
        essential: null,
        hidden: false,
        deletable: true,
      })),
    },
  ],
};

const PATHS = {
  grid: "GET /v1/budget/plan-grid",
  put: "PUT /v1/budget/plan-grid/cells",
};

function api(over: Record<string, Parameters<typeof fakeApi>[0][string]> = {}, g: unknown = grid()) {
  return fakeApi({
    [PATHS.grid]: { status: 200, body: g },
    "GET /v1/categories": { status: 200, body: tree },
    "GET /v1/goals": { status: 200, body: { goals: [{ id: GOAL_TRIP, name: "Відпустка" }] } },
    "GET /v1/debts": { status: 200, body: { debts: [{ accountId: LOAN, name: "Автокредит" }] } },
    "GET /v1/recurring/payments": {
      status: 200,
      body: { items: [{ id: SALARY, name: "Андрій, зарплата" }] },
    },
    [PATHS.put]: { status: 200, body: { amount: eur("650.00"), version: 1 } },
    ...over,
  });
}

const show = (client: ReturnType<typeof fakeApi>["client"]) =>
  render(
    <AuthApiProvider value={client}>
      <BudgetPlanPage today={TODAY} />
    </AuthApiProvider>,
  );

const cellOf = async (row: string, month: string) =>
  screen.findByRole("textbox", { name: `${row}, ${month}` });
const edit = async (row: string, month: string, text: string) => {
  const input = await cellOf(row, month);
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: text } });
  fireEvent.blur(input);
};
/** `409 VERSION_CONFLICT` with the current version of the cell (BUD-17 a). */
const conflict: Reply = {
  status: 409,
  body: {
    type: "urn:willowsum:problem:version_conflict",
    title: "VERSION_CONFLICT",
    status: 409,
    code: "VERSION_CONFLICT",
    currentVersion: 2,
    supportId: SUPPORT_ID,
  },
  headers: { "content-type": "application/problem+json" },
};
const val = (el: HTMLElement | null | undefined) => plain((el as HTMLInputElement).value);
const puts = (calls: ReturnType<typeof fakeApi>["calls"]) => calls.filter((c) => c.method === "PUT");

beforeEach(() => {
  installMatchMedia({ width: 1280 });
  resetAuthState();
  window.location.hash = "#/planning/budget/plan";
});
afterEach(cleanup);

describe("BUD-17@PoC «Бюджет → План» (S-126)", () => {
  it("BUD-17@PoC AC1: the grid shows the current month and 11 next ones, «Продукти» of November is 700,00 and there are no auto-assign, undo, redo or history buttons", async () => {
    show(api().client);
    const table = await screen.findByRole("table", { name: "" }).catch(() => screen.findByRole("table"));
    const heads = within(table).getAllByRole("columnheader");
    // «Рядок плану» and 12 months.
    expect(heads).toHaveLength(13);
    expect(heads[1]!.getAttribute("aria-label")).toBe("Листопад 2026");
    expect(heads[12]!.getAttribute("aria-label")).toBe("Жовтень 2027");
    expect(val((await cellOf("Продукти", "листопад")) as HTMLInputElement)).toBe("700,00");
    for (const name of [/Автопризначити/, /Відмінити/, /Повторити/, /Історія/])
      expect(screen.queryByRole("button", { name })).toBeNull();
  });

  it("BUD-17@PoC AC2: leaving a cell saves 650 for that month only — no save button — and the grid is read again", async () => {
    const fake = api();
    show(fake.client);
    await edit("Продукти", "грудень", "650");
    await waitFor(() => expect(puts(fake.calls)).toHaveLength(1));
    expect(puts(fake.calls)[0]!.body).toEqual({
      period: "2026-12",
      kind: "limit",
      lineId: FOOD,
      amount: { amount: "650.00", currency: "EUR" },
      version: 0,
    });
    expect(screen.queryByRole("button", { name: /Зберегти/ })).toBeNull();
    // Saved and re-read: the page asked for the grid again.
    await waitFor(() =>
      expect(fake.calls.filter((c) => c.method === "GET" && c.path === "/v1/budget/plan-grid")).toHaveLength(
        2,
      ),
    );
  });

  it("BUD-17@PoC AC3: a cell of a month that is over is read only and is never sent", async () => {
    // The page was opened in October and left open past the turn of the month.
    const fake = api({}, grid({ first: "2026-10" }));
    show(fake.client);
    const october = (await cellOf("Продукти", "жовтень")) as HTMLInputElement;
    expect(october.getAttribute("readonly")).not.toBeNull();
    fireEvent.focus(october);
    fireEvent.change(october, { target: { value: "1" } });
    fireEvent.blur(october);
    expect(puts(fake.calls)).toHaveLength(0);
    expect((await cellOf("Продукти", "листопад")).getAttribute("readonly")).toBeNull();
  });

  it("BUD-17@PoC FR 2: the server refusing a month that just ended says «Минулий місяць змінити не можна»", async () => {
    const fake = api({
      [PATHS.put]: {
        status: 400,
        body: {
          type: "urn:willowsum:problem:validation_failed",
          title: "VALIDATION_FAILED",
          status: 400,
          code: "VALIDATION_FAILED",
          errors: [{ in: "body", path: "period", issue: "past" }],
          supportId: SUPPORT_ID,
        },
        headers: { "content-type": "application/problem+json" },
      },
    });
    show(fake.client);
    await edit("Продукти", "листопад", "710");
    expect(plain((await screen.findByRole("alert")).textContent ?? "")).toContain(
      "Минулий місяць змінити не можна",
    );
  });

  it("BUD-17@PoC AC4: after a 409 the cell shows the value of the other window and the message says «Продукти, вересень: 700,00 € → 750,00 €»", async () => {
    let reads = 0;
    const fake = api(
      {
        [PATHS.grid]: () => {
          reads += 1;
          // The second read (after the conflict) holds the other window's 750.
          return {
            status: 200,
            body: grid({
              first: "2026-09",
              foodAt: () => (reads > 1 ? cell("750.00", 2) : cell("600.00", 1)),
            }),
          };
        },
        [PATHS.put]: conflict,
      },
      grid(),
    );
    render(
      <AuthApiProvider value={fake.client}>
        <BudgetPlanPage today="2026-09-10" />
      </AuthApiProvider>,
    );
    await edit("Продукти", "вересень", "700");
    const alert = await screen.findByRole("alert");
    expect(plain(alert.textContent ?? "")).toContain(
      "Значення змінено в іншому вікні: Продукти, вересень: 700,00 € → 750,00 €",
    );
    expect(val(await cellOf("Продукти", "вересень"))).toBe("750,00");
    // The user may enter their own value again: it goes with the version just read.
    fake.calls.length = 0;
    await edit("Продукти", "вересень", "700");
    await waitFor(() => expect(puts(fake.calls)).toHaveLength(1));
    expect(puts(fake.calls)[0]!.body).toMatchObject({ amount: { amount: "700.00" }, version: 2 });
  });

  it("BUD-17@PoC FR 3: no silent overwrite — a conflict never leaves the typed value in the cell", async () => {
    let reads = 0;
    const fake = api({
      [PATHS.grid]: () => {
        reads += 1;
        return {
          status: 200,
          body: grid({ foodAt: () => (reads > 1 ? cell("750.00", 2) : cell("600.00", 1)) }),
        };
      },
      [PATHS.put]: problem(409, "VERSION_CONFLICT"),
    });
    show(fake.client);
    await edit("Продукти", "грудень", "700");
    await screen.findByRole("alert");
    await waitFor(() =>
      expect(val(screen.getByRole("textbox", { name: "Продукти, грудень" }))).toBe("750,00"),
    );
  });

  it("BUD-17@PoC EC2: a failed save puts the previous value back and says «Не вдалося зберегти — повторіть спробу»", async () => {
    const fake = api({ [PATHS.put]: problem(500, "INTERNAL") });
    show(fake.client);
    await edit("Продукти", "грудень", "650");
    expect(plain((await screen.findByRole("alert")).textContent ?? "")).toContain(
      "Не вдалося зберегти — повторіть спробу",
    );
    expect(val(screen.getByRole("textbox", { name: "Продукти, грудень" }))).toBe("700,00");
  });

  it("BUD-17@PoC AC6: the sections and «Не розподілено 200,00» (a deficit is «! Дефіцит 200,00 €» in loss colour)", async () => {
    show(api().client);
    for (const name of ["Надходження", "Витрати", "Цілі й заощадження", "Погашення боргів"])
      expect((await screen.findByRole("button", { name })).getAttribute("aria-expanded")).toBe("true");
    const row = screen.getByRole("row", { name: /Не розподілено/ });
    expect(plain(within(row).getAllByRole("cell")[0]!.textContent ?? "")).toContain("200,00");
    cleanup();
    const deficit = { kind: "deficit" as const, amount: eur("200.00") };
    show(api({}, grid({ unallocated: flat(12, () => deficit) })).client);
    const cells = within(await screen.findByRole("row", { name: /Не розподілено/ })).getAllByRole("cell");
    const mark = cells[0]!.querySelector("[data-status='v.deficit']")!;
    expect(mark.querySelector(".ws-status-marker")!.textContent).toBe("!");
    expect(plain(mark.querySelector(".ws-status-word")!.textContent ?? "")).toBe("Дефіцит 200,00 €");
    expect(mark.closest("[data-tone]")!.getAttribute("data-tone")).toBe("negative");
  });

  it("BUD-17@PoC AC7: a goal cell of December is saved as the planned contribution of that month", async () => {
    const fake = api({ [PATHS.put]: { status: 200, body: { amount: eur("200.00"), version: 1 } } });
    show(fake.client);
    await edit("Відпустка", "грудень", "200");
    await waitFor(() => expect(puts(fake.calls)).toHaveLength(1));
    expect(puts(fake.calls)[0]!.body).toEqual({
      period: "2026-12",
      kind: "goal",
      lineId: GOAL_TRIP,
      amount: { amount: "200.00", currency: "EUR" },
      version: 0,
    });
  });

  it("BUD-17@PoC FR 1 (owner decision 2026-11-21): «Надходження» is a row per income category — «Зарплата» 5 000,00 and «Фриланс» 600,00, 5 600,00 together; no «План доходу», «Інші надходження» or regular income row", async () => {
    show(api().client);
    expect(val(await cellOf("Зарплата", "листопад"))).toBe("5 000,00");
    expect(val(await cellOf("Фриланс", "листопад"))).toBe("600,00");
    const section = screen.getByRole("button", { name: "Надходження" }).closest("tr")!;
    expect(plain(section.textContent ?? "")).toContain("5 600,00");
    for (const gone of [/План доходу/, /Інші надходження/, /Андрій, зарплата/])
      expect(screen.queryByRole("textbox", { name: gone })).toBeNull();
  });

  it("BUD-17@PoC FR 1, FR 2: a month of «Фриланс» is saved as that category's income cell, for that month only", async () => {
    const { client, calls } = api();
    show(client);
    await edit("Фриланс", "грудень", "800,25");
    await waitFor(() => expect(puts(calls)).toHaveLength(1));
    expect(puts(calls)[0]!.body).toEqual({
      period: "2026-12",
      kind: "income",
      lineId: FREELANCE,
      amount: { amount: "800.25", currency: "EUR" },
      version: 0,
    });
  });

  it("BUD-17@PoC business rules (owner decision 2026-11-26): a UAH income category's row is in UAH — named, typed and sent in UAH; the section's sum is «≈» with today's rate in its hint", async () => {
    const { client, calls } = api({}, grid({ rental: true }));
    show(client);
    expect(val(await cellOf(LONG_INCOME, "листопад"))).toBe("20 000,00");
    const rowEl = screen.getByRole("row", { name: new RegExp(LONG_INCOME.slice(0, 30)) });
    expect(within(rowEl).getByText("UAH")).toBeTruthy();
    const hint = "За поточним курсом: 1 UAH = 0,02 EUR (17.11.2026)";
    const section = screen.getByRole("button", { name: "Надходження" }).closest("tr")!;
    const mark = within(section).getByRole("img", { name: /За поточним курсом/ });
    expect(plain(mark.textContent ?? "")).toBe("≈");
    expect(plain(mark.getAttribute("aria-label") ?? "")).toBe(hint);
    const sums = within(section).getAllByRole("cell");
    expect(plain(sums[0]!.textContent ?? "")).toBe("6 000,00");
    expect(plain(sums[0]!.getAttribute("title") ?? "")).toBe(hint);
    // «Витрати» has no row of another currency: no «≈».
    const expenses = screen.getByRole("button", { name: "Витрати" }).closest("tr")!;
    expect(within(expenses).queryByRole("img", { name: /За поточним курсом/ })).toBeNull();
    await edit(LONG_INCOME, "січень", "25 000,5");
    await waitFor(() => expect(puts(calls)).toHaveLength(1));
    expect(puts(calls)[0]!.body).toMatchObject({
      kind: "income",
      lineId: RENTAL,
      amount: { amount: "25000.50", currency: "UAH" },
    });
  });

  it("BUD-17@PoC FR 1: a section folds and unfolds, and a debt payment is read only with its lock", async () => {
    show(api().client);
    const fold = await screen.findByRole("button", { name: "Витрати" });
    fireEvent.click(fold);
    expect(fold.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("textbox", { name: "Оренда, листопад" })).toBeNull();
    fireEvent.click(fold);
    expect(await cellOf("Оренда", "листопад")).toBeTruthy();
    const loan = screen.getByRole("textbox", { name: "Автокредит · мінімум, листопад" });
    expect(loan.getAttribute("readonly")).not.toBeNull();
    expect(
      within(screen.getByRole("row", { name: /Автокредит · мінімум/ })).getByRole("img", {
        name: "лише для читання",
      }),
    ).toBeTruthy();
  });

  it("BUD-17@PoC FR 5: there is no tab «Перевитрати» — the tabs are «Бюджет», «План», «Порівняння», «Тренд» and «Грошовий потік»", async () => {
    show(api().client);
    const tabs = await screen.findAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual([
      "Бюджет",
      "План",
      "Порівняння",
      "Тренд",
      "Грошовий потік",
    ]);
    // Every tab is a link with its own address; the selected one is in the Tab order, ← → move between them.
    expect(tabs.map((t) => t.getAttribute("href"))).toEqual([
      "#/planning/budget",
      "#/planning/budget/plan",
      "#/planning/budget/compare",
      "#/planning/budget/trend",
      "#/planning/budget/money-flow",
    ]);
    expect(tabs.map((t) => t.getAttribute("tabindex"))).toEqual(["-1", "0", "-1", "-1", "-1"]);
    expect(tabs[1]!.getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByRole("tab", { name: /Перевитрати/ })).toBeNull();
  });

  it("BUD-17@PoC FR 7: the grid is one table of 12 month columns for 1280 px, with no card layout for narrow screens", async () => {
    const { container } = show(api().client);
    await screen.findByRole("table");
    expect(container.querySelectorAll("table")).toHaveLength(1);
    expect(container.querySelector("[data-layout='cards'], .ws-card-list")).toBeNull();
    // The table scrolls inside its region and the region can be reached from the keyboard.
    const region = screen.getByRole("region", { name: "План за місяцями" });
    expect(region.getAttribute("tabindex")).toBe("0");
  });

  it("BUD-17@PoC FR 8: the amounts are facts — a deficit is a number, with no advice, offer or button to fix it", async () => {
    const deficit = { kind: "deficit" as const, amount: eur("43.00") };
    show(api({}, grid({ unallocated: flat(12, () => deficit) })).client);
    const row = await screen.findByRole("row", { name: /Не розподілено/ });
    expect(plain(row.textContent ?? "")).toContain("Дефіцит 43,00 €");
    expect(within(row).queryByRole("button")).toBeNull();
    expect(screen.queryByText(/Змінити на|Рекомендуємо|Порада/)).toBeNull();
  });

  it("BUD-17@PoC «Стани інтерфейсу»: without a budget the page says «План ще не заповнено» with «Заповнити вручну»", async () => {
    show(api({ [PATHS.grid]: problem(404, "NOT_FOUND") }).client);
    expect(await screen.findByRole("heading", { name: "План ще не заповнено" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Заповнити вручну" }).getAttribute("href")).toBe(
      "#/planning/budget/new",
    );
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("BUD-17@PoC «Стани інтерфейсу»: while the grid loads the page shows a skeleton, not an empty table", async () => {
    let release: (r: Reply) => void = () => undefined;
    const fake = api({ [PATHS.grid]: () => new Promise<Reply>((r) => (release = r)) });
    const { container } = show(fake.client);
    await waitFor(() => expect(container.querySelector("[aria-busy='true']")).not.toBeNull());
    expect(screen.queryByRole("table")).toBeNull();
    release({ status: 200, body: grid() });
    expect(await screen.findByRole("table")).toBeTruthy();
  });

  it("BUD-17@PoC «Стани інтерфейсу»: a failed load shows the error with the code and «Спробувати ще раз», and the retry loads the grid", async () => {
    let fail = true;
    const fake = api({
      [PATHS.grid]: () => (fail ? problem(500, "INTERNAL") : { status: 200, body: grid() }),
    });
    show(fake.client);
    const alert = await screen.findByRole("alert");
    expect(plain(alert.textContent ?? "")).toContain("Не вдалося завантажити план");
    expect(plain(alert.textContent ?? "")).toContain(`Код: ${SUPPORT_ID}`);
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Спробувати ще раз" }));
    expect(await screen.findByRole("table")).toBeTruthy();
  });

  it("BUD-17@PoC money: typed amounts stay decimal strings — «1 234,5» is sent as «1234.50» and a 20-digit value is shown and kept exactly", async () => {
    const huge = "90071992547409931234.10";
    const fake = api({}, grid({ foodAt: (i) => (i === 1 ? cell(huge, 1) : cell("700.00")) }));
    show(fake.client);
    expect(val(await cellOf("Продукти", "грудень"))).toBe("90 071 992 547 409 931 234,10");
    await edit("Оренда", "січень", "1 234,5");
    await waitFor(() => expect(puts(fake.calls)).toHaveLength(1));
    expect(puts(fake.calls)[0]!.body).toMatchObject({ amount: { amount: "1234.50", currency: "EUR" } });
    // Focus brings back every digit to edit, and leaving without a change sends nothing.
    fake.calls.length = 0;
    const input = await cellOf("Продукти", "грудень");
    fireEvent.focus(input);
    expect(val(input)).toBe("90 071 992 547 409 931 234,10");
    fireEvent.blur(input);
    expect(puts(fake.calls)).toHaveLength(0);
  });

  it("BUD-17@PoC money: text that is not an amount is not sent and the cell says what to enter", async () => {
    const fake = api();
    show(fake.client);
    await edit("Продукти", "грудень", "12abc");
    expect(plain((await screen.findByRole("alert")).textContent ?? "")).toContain(
      "Введіть число, наприклад 3 000,00.",
    );
    await edit("Продукти", "січень", "10,123");
    expect(plain((await screen.findByRole("alert")).textContent ?? "")).toContain(
      "Використовуйте до 2 знаків після коми для EUR.",
    );
    expect(puts(fake.calls)).toHaveLength(0);
    expect(val(screen.getByRole("textbox", { name: "Продукти, грудень" }))).toBe("700,00");
  });

  it("BUD-17@PoC money: a negative or 16-digit amount is refused in the cell with its own message, not «Не вдалося зберегти»", async () => {
    const fake = api();
    show(fake.client);
    await edit("Продукти", "грудень", "-5");
    expect(plain((await screen.findByRole("alert")).textContent ?? "")).toContain(
      "Введіть суму, не меншу за нуль.",
    );
    await edit("Продукти", "січень", "1234567890123456");
    await waitFor(() =>
      expect(plain(screen.getByRole("alert").textContent ?? "")).toContain(
        "Сума завелика: до 15 цифр до коми.",
      ),
    );
    expect(puts(fake.calls)).toHaveLength(0);
    expect(screen.getByRole("alert").textContent).not.toContain("Не вдалося зберегти");
  });

  it("BUD-17@PoC NFR-08: an amount wider than its cell is abbreviated with a dotted underline and the full value in the title, never cut with «…» (GRID-00 FR 19)", async () => {
    const huge = "1234567890123.45";
    const wide = vi.spyOn(HTMLInputElement.prototype, "scrollWidth", "get").mockReturnValue(100);
    const narrow = vi.spyOn(HTMLInputElement.prototype, "clientWidth", "get").mockReturnValue(50);
    try {
      show(api({}, grid({ foodAt: () => cell(huge, 1) })).client);
      const input = (await cellOf("Продукти", "листопад")) as HTMLInputElement;
      await waitFor(() => expect(input.getAttribute("data-abbreviated")).toBe("true"));
      expect(input.value).not.toContain("…");
      expect(input.value.length).toBeLessThan(plain(input.title).length);
      expect(plain(input.title)).toBe("1 234 567 890 123,45");
    } finally {
      wide.mockRestore();
      narrow.mockRestore();
    }
  });

  it("BUD-17@PoC FR 2: Enter saves, Escape gives the shown value back, and an empty cell with its own value goes back to the default (amount null)", async () => {
    const fake = api({}, grid({ foodAt: (i) => (i === 1 ? cell("650.00", 3) : cell("700.00")) }));
    show(fake.client);
    const input = await cellOf("Продукти", "січень");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "5" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(puts(fake.calls)).toHaveLength(0);
    expect(val(input)).toBe("700,00");
    const own = await cellOf("Продукти", "грудень");
    fireEvent.focus(own);
    fireEvent.change(own, { target: { value: "" } });
    fireEvent.blur(own);
    await waitFor(() => expect(puts(fake.calls)).toHaveLength(1));
    expect(puts(fake.calls)[0]!.body).toMatchObject({ period: "2026-12", amount: null, version: 3 });
  });

  it("BUD-17@PoC NFR-08: every cell has a name (row, month), the heading of a month is spoken in full and the long name of a row is cut with the full text in its title", async () => {
    show(api().client);
    const long = await cellOf(LONG_NAME, "листопад");
    expect(long).toBeTruthy();
    expect(screen.getByTitle(LONG_NAME).classList.contains("plan-label")).toBe(true);
    expect(screen.getAllByRole("rowheader").length).toBeGreaterThan(5);
  });
});
