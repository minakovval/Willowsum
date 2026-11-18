import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Decimal } from "@willowsum/domain-kernel";
import { installMatchMedia } from "@willowsum/ui/test-utils";
import { fakeApi, plain, problem, renderAt, resetAuthState, type Reply } from "../auth/testing.tsx";

/**
 * BUD-02@PoC d) (wave 2, row 123): S-121 «Бюджет» — the current, a past and a future month (S-289), the totals row
 * over the table and the filter of the card «Категорії» (CMP-32 variant «у картці»), on the budget API of #313 and
 * the categories API. Today is 2026-11-18 in Kyiv. Boards: PocPlanBudget, PocPlanBudgetCatFilter, PocPlanBudgetNext,
 * PocPlanBudgetTexts. The categories and the amounts are synthetic.
 */
const PAGE = "#/planning/budget";
const G_HOME = "9a000000-0000-4000-8000-000000000001";
const G_DAILY = "9a000000-0000-4000-8000-000000000002";
const G_FAMILY = "9a000000-0000-4000-8000-000000000003";

const money = (amount: string) => ({ amount, currency: "EUR" });
let seq = 0;
const catId = () => `c0000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;

interface Cat {
  id: string;
  name: string;
  group: string;
  limit: string;
  spent: string;
  mandatory: boolean;
}
const cat = (name: string, group: string, limit: string, spent: string, mandatory = false): Cat => ({
  id: catId(),
  name,
  group,
  limit,
  spent,
  mandatory,
});

/** 15 categories, 4 of them over the limit: -8.20, -48.60, -2.97 and -16.40 (76.17 in all). */
const CATS: Cat[] = [
  cat("Оренда", G_HOME, "1200.00", "1200.00", true),
  cat("Комунальні", G_HOME, "180.00", "0.00", true),
  cat("Зв’язок", G_HOME, "45.00", "33.00", true),
  cat("Продукти", G_DAILY, "620.00", "352.35", true),
  cat("Транспорт", G_DAILY, "160.00", "168.20", true),
  cat("Пальне", G_DAILY, "140.00", "96.20"),
  cat("Кафе і ресторани", G_DAILY, "200.00", "248.60"),
  cat("Підписки", G_DAILY, "38.00", "40.97"),
  cat("Паркування", G_DAILY, "4.00", "4.00"),
  cat("Спорт", G_DAILY, "50.00", "10.00"),
  cat("Кіно", G_DAILY, "72.00", "70.00"),
  cat("Освіта", G_FAMILY, "150.00", "150.00", true),
  cat("Одяг", G_FAMILY, "230.00", "64.90"),
  cat("Здоров’я", G_FAMILY, "80.00", "96.40", true),
  cat("Подарунки", G_FAMILY, "100.00", "0.00"),
];

const left = (c: Cat) => new Decimal(c.limit).minus(c.spent).toFixed(2);
const tree = (cats: Cat[]) => ({
  groups: [
    ["Житло і рахунки", G_HOME],
    ["Щоденне", G_DAILY],
    ["Родина", G_FAMILY],
  ].map(([name, id]) => ({
    id,
    systemKey: null,
    kind: "expense",
    name,
    renamed: false,
    tone: "neutral",
    categories: cats
      .filter((c) => c.group === id)
      .map((c) => ({
        id: c.id,
        groupId: id,
        systemKey: null,
        kind: "expense",
        name: c.name,
        renamed: false,
        icon: "shopping",
        color: "#336699",
        iconTone: "white",
        essential: c.mandatory,
        hidden: false,
        deletable: true,
      })),
  })),
});

function period(
  p: string,
  mode: "past" | "current" | "future",
  over: { cats?: Cat[]; outside?: { id: string | null; spent: string }[]; approximate?: number } = {},
) {
  const cats = over.cats ?? CATS;
  const future = mode === "future";
  const limits = "3143.00";
  return {
    period: p,
    mode,
    currency: "EUR",
    approximate: { nearestRateCount: over.approximate ?? 0, unavailableCount: 0 },
    groups: [G_HOME, G_DAILY, G_FAMILY].map((g) => ({
      groupId: g,
      categories: cats
        .filter((c) => c.group === g)
        .map((c) => ({
          categoryId: c.id,
          groupId: g,
          limit: money(c.limit),
          mandatory: c.mandatory,
          spent: future ? null : money(c.spent),
          remaining: future ? null : money(left(c)),
        })),
    })),
    incomeActual: future ? null : money("5600.00"),
    incomePlan: money("5600.00"),
    mode_: undefined,
    outsidePlan: {
      categories: (over.outside ?? []).map((o) => ({ categoryId: o.id, spent: money(o.spent) })),
      total: future ? null : money("0.00"),
    },
    plannedSavings: money("0.00"),
    proportional: null,
    totals: {
      limits: money(limits),
      spent: future ? null : money("2806.77"),
      remaining: future ? null : money("336.23"),
    },
  };
}

const BUDGET = {
  budget: {
    id: "b0000000-0000-4000-8000-000000000001",
    createdOn: "2026-09-03",
    currency: "EUR",
    firstPeriod: "2026-09",
    incomePlan: money("5600.00"),
    limits: [],
    proportional: null,
    version: 1,
  },
};

function api(over: Record<string, Reply> = {}, cats: Cat[] = CATS) {
  return fakeApi({
    "GET /v1/budget": { status: 200, body: BUDGET },
    "GET /v1/categories": { status: 200, body: tree(cats) },
    "GET /v1/budget/periods/2026-11": { status: 200, body: period("2026-11", "current") },
    "GET /v1/budget/periods/2026-12": { status: 200, body: period("2026-12", "future") },
    "GET /v1/budget/periods/2026-10": { status: 200, body: period("2026-10", "past") },
    ...over,
  });
}

beforeEach(() => {
  installMatchMedia({ width: 1280 });
  resetAuthState();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-18T10:00:00Z"));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const rowOf = (name: string) => {
  const row = [...document.querySelectorAll<HTMLElement>(".bud-table tbody tr")].find(
    (r) => r.querySelector("th")?.querySelector(".bud-name")?.firstChild?.textContent === name,
  );
  if (!row) throw new Error(`no row ${name}`);
  return row;
};
const names = (group?: string) =>
  [
    ...document.querySelectorAll<HTMLElement>(
      group ? `.bud-table tbody[data-group='${group}'] .bud-name` : ".bud-table .bud-name",
    ),
  ].map((e) => e.firstChild?.textContent);
const heads = () => [...document.querySelectorAll(".bud-table thead th")].map((h) => h.textContent);
const cellsOf = (row: HTMLElement) => [...row.querySelectorAll("td")].map((c) => plain(c.textContent));

async function open(over: Record<string, Reply> = {}, hash = PAGE, cats: Cat[] = CATS) {
  renderAt(hash, api(over, cats).client);
  await screen.findByRole("table");
}

describe("BUD-02@PoC d) S-121 «Бюджет»: the current month", () => {
  it("BUD-02@PoC FR 9: the income plan and fact, the groups with the categories, «Разом» — as the API gives them", async () => {
    await open();
    const income = document.querySelector<HTMLElement>("[data-plan-region='income']")!;
    expect(plain(income.textContent)).toContain("Дохід");
    expect(plain(income.textContent)).toContain("План доходу5 600,00 €");
    expect(plain(income.textContent)).toContain("Отримано5 600,00 €");
    expect(heads()).toEqual(["Категорія", "Витрачено", "Ліміт", "Залишок"]);
    expect([...document.querySelectorAll(".bud-group th")].map((h) => h.textContent)).toEqual([
      "Житло і рахунки",
      "Щоденне",
      "Родина",
    ]);
    expect(cellsOf(rowOf("Продукти"))).toEqual(["352,35 €", "620,00 €", "267,65 €"]);
    expect(plain(document.querySelector(".bud-total")!.textContent)).toBe(
      "Разом2 806,77 €3 143,00 €336,23 €",
    );
    expect(rowOf("Оренда").textContent).toContain("обов’язкова");
  });

  it("BUD-02@PoC FR 9: the state of a row is a word on the usage scale; a mandatory limit spent is «ліміт вичерпано»", async () => {
    await open();
    expect(rowOf("Оренда").textContent).toContain("ліміт вичерпано");
    expect(rowOf("Комунальні").textContent).toContain("не почато");
    expect(rowOf("Зв’язок").textContent).toContain("є залишок");
    expect(rowOf("Кіно").textContent).toContain("майже вичерпано");
    expect(rowOf("Паркування").textContent).toContain("вичерпано");
    expect(rowOf("Транспорт").textContent).toContain("перевищено");
  });

  it("BUD-02@PoC FR 9, AC5: a category without a limit is in «Поза планом» with its spent amount and no bar", async () => {
    const trips = cat("Подорожі", G_DAILY, "0.00", "150.00");
    await open(
      {
        "GET /v1/budget/periods/2026-11": {
          status: 200,
          body: period("2026-11", "current", { outside: [{ id: trips.id, spent: "150.00" }] }),
        },
      },
      PAGE,
      [...CATS, trips],
    );
    const outside = document.querySelector<HTMLElement>("tbody[data-group='outside']")!;
    expect(outside.textContent).toContain("Поза планом");
    expect(plain(outside.textContent)).toContain("Подорожі150,00 €");
    expect(outside.querySelector("[role='progressbar'], .ws-usage")).toBeNull();
  });

  it("BUD-02@PoC FR 19, AC9: the totals row over the table — spent of the limits, the overspend and how many categories", async () => {
    await open();
    const sum = plain(document.querySelector(".bud-summary")!.textContent);
    expect(sum).toContain("Витрачено2 806,77 €з лімітів 3 143,00 €");
    expect(sum).toContain("Перевитрата76,17 €у 4 категоріях");
  });

  it("BUD-02@PoC AC3: approximate amounts are marked «приблизно» with the number of transactions at the nearest rate", async () => {
    await open({
      "GET /v1/budget/periods/2026-11": {
        status: 200,
        body: period("2026-11", "current", { approximate: 1 }),
      },
    });
    expect(screen.getByText(/1 транзакція за найближчим курсом/)).toBeTruthy();
    expect(screen.getByText("приблизно")).toBeTruthy();
  });

  it("BUD-02@PoC FR 9 (PoC): no target amounts and no card «Темп і прогноз»", async () => {
    await open();
    expect(screen.queryByText(/Цільов/)).toBeNull();
    expect(screen.queryByText(/Темп і прогноз/)).toBeNull();
  });

  it("GRID-04@PoC FR 2, AC3: an overspent row says «✕ перевищено» and the minus amount only in «Залишок»", async () => {
    await open();
    const row = rowOf("Здоров’я");
    expect(row.textContent).toContain("✕");
    expect(row.textContent).toContain("перевищено");
    expect(cellsOf(row)).toEqual(["96,40 €", "80,00 €", "−16,40 €"]);
    const sentence = plain(row.textContent);
    expect(sentence.match(/16,40/g)).toHaveLength(1);
    expect(sentence).not.toMatch(/більше за план/);
    expect(document.querySelector("[data-plan-page='budget']")!.innerHTML).not.toMatch(/amber/i);
  });
});

describe("BUD-02@PoC d) FR 16: the budget period", () => {
  it("BUD-02@PoC AC8: «›» shows the plan of December with the banner, without «Можна витратити» and the fact", async () => {
    await open();
    expect(screen.getByText("Листопад 2026")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Наступний місяць" }));
    await waitFor(() => expect(screen.getByText("Грудень 2026")).toBeTruthy());
    expect((await screen.findAllByText(/Це план на грудень — витрат ще немає/)).length).toBeGreaterThan(0);
    expect(screen.getByText(/з’явиться 1 грудня/)).toBeTruthy();
    expect(window.location.hash).toBe("#/planning/budget?period=2026-12");
    expect(heads()).toEqual(["Категорія", "План"]);
    expect(screen.queryByText("Можна витратити")).toBeNull();
    expect(cellsOf(rowOf("Продукти"))).toEqual(["620,00 €"]);
    expect(document.querySelector(".ws-usage")).toBeNull();
    expect(screen.queryByRole("button", { name: /Фільтри/ })).toBeNull();
    expect(screen.queryByText(/Отримано/)).toBeNull();
  });

  it("BUD-02@PoC AC8: «‹» shows October as the plan from the snapshot against the live fact, without «Можна витратити»", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Попередній місяць" }));
    expect(await screen.findByText(/План проти факту · Жовтень 2026/)).toBeTruthy();
    expect(cellsOf(rowOf("Продукти"))).toEqual(["352,35 €", "620,00 €", "267,65 €"]);
    expect(screen.queryByText("Можна витратити")).toBeNull();
    expect(screen.queryByText(/Це план на/)).toBeNull();
  });

  it("BUD-02@PoC FR 16: the month comes from the address (S-289) and «‹» stops at the first period of the budget", async () => {
    await open({}, "#/planning/budget?period=2026-12");
    expect((await screen.findAllByText(/Це план на грудень/)).length).toBeGreaterThan(0);
    cleanup();
    await open(
      { "GET /v1/budget/periods/2026-09": { status: 200, body: period("2026-09", "past") } },
      "#/planning/budget?period=2026-09",
    );
    expect(screen.getByRole("button", { name: "Попередній місяць" }).getAttribute("aria-disabled")).toBe(
      "true",
    );
  });

  it("BUD-02@PoC EC «Запит на дату до першого періоду»: «Бюджет ще не існував на цю дату»", async () => {
    renderAt(
      "#/planning/budget?period=2026-08",
      api({ "GET /v1/budget/periods/2026-08": problem(404, "BUDGET_PERIOD_BEFORE_START") }).client,
    );
    expect(await screen.findByText("Бюджет ще не існував на цю дату")).toBeTruthy();
  });
});

describe("BUD-02@PoC d) «Стани інтерфейсу»", () => {
  it("BUD-02@PoC UI empty (#541): without a budget the page keeps its empty state", async () => {
    renderAt(PAGE, api({ "GET /v1/budget": { status: 200, body: { budget: null } } }).client);
    expect(await screen.findByRole("heading", { level: 2, name: "Бюджету ще немає" })).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("BUD-02@PoC FR 2: the empty state offers «Створити за моїми витратами» and «Почати з нуля»; both open the wizard", async () => {
    renderAt(PAGE, api({ "GET /v1/budget": { status: 200, body: { budget: null } } }).client);
    for (const name of ["Створити за моїми витратами", "Почати з нуля"]) {
      const link = await screen.findByRole("link", { name });
      expect(link.getAttribute("href")).toBe("#/planning/budget/new");
    }
  });

  it("BUD-02@PoC UI loading: a skeleton of the groups while the period comes", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    renderAt(
      PAGE,
      api({
        "GET /v1/budget/periods/2026-11": (async () => (
          await gate,
          { status: 200, body: period("2026-11", "current") }
        )) as never,
      }).client,
    );
    expect(await screen.findByLabelText("Категорії")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    await act(async () => release());
    expect(await screen.findByRole("table")).toBeTruthy();
  });

  it("BUD-02@PoC UI error: «Не вдалося завантажити бюджет», «Спробувати ще раз» reads again", async () => {
    let fail = true;
    renderAt(
      PAGE,
      api({
        "GET /v1/budget": (() => (fail ? problem(500, "INTERNAL") : { status: 200, body: BUDGET })) as never,
      }).client,
    );
    expect(await screen.findByText("Не вдалося завантажити бюджет")).toBeTruthy();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Спробувати ще раз" }));
    expect(await screen.findByRole("table")).toBeTruthy();
  });
});

describe("BUD-02@PoC d) FR 9, FR 20: sorting and the filter of the card «Категорії»", () => {
  it("BUD-02@PoC AC11: a heading sorts the categories inside each group; the groups keep their place", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Сортувати за: Залишок" }));
    expect(names("9a000000-0000-4000-8000-000000000002")).toEqual([
      "Кафе і ресторани",
      "Транспорт",
      "Підписки",
      "Паркування",
      "Кіно",
      "Спорт",
      "Пальне",
      "Продукти",
    ]);
    expect([...document.querySelectorAll(".bud-group th")].map((h) => h.textContent)).toEqual([
      "Житло і рахунки",
      "Щоденне",
      "Родина",
    ]);
    expect(screen.getByRole("columnheader", { name: /Залишок/ }).getAttribute("aria-sort")).toBe("ascending");
    fireEvent.click(screen.getByRole("button", { name: "Сортувати за: Залишок" }));
    expect(names("9a000000-0000-4000-8000-000000000002")[0]).toBe("Продукти");
  });

  it("CMP-32@PoC FR 8, AC8 / BUD-02@PoC AC10: «Стан: Перевищено» shows 4 of 15 at once, with the chip, the count and «Скинути фільтри»", async () => {
    await open();
    expect(names()).toHaveLength(15);
    const button = screen.getByRole("button", { name: "Фільтри" });
    expect(button.getAttribute("aria-haspopup")).toBe("menu");
    fireEvent.click(button);
    const menu = screen.getByRole("menu");
    expect(within(menu).queryByRole("button", { name: "Застосувати" })).toBeNull();
    const over = within(menu).getByRole("menuitemcheckbox", { name: /Перевищено/ });
    expect(over.textContent).toContain("4");
    expect(over.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(over);
    expect(over.getAttribute("aria-checked")).toBe("true");
    expect(names().sort()).toEqual(["Здоров’я", "Кафе і ресторани", "Підписки", "Транспорт"]);
    expect(screen.getByRole("button", { name: "Фільтри · 1" })).toBeTruthy();
    const chips = screen.getByRole("list", { name: "Застосовані фільтри" });
    expect(within(chips).getByText("Стан: перевищено")).toBeTruthy();
    expect(within(chips).getByRole("button", { name: "Прибрати фільтр: Стан — перевищено" })).toBeTruthy();
    expect(screen.getByText("Показано 4 з 15 категорій")).toBeTruthy();
    // The filter acts on the table only: the totals row is the same (CMP-32 «Фільтр діє лише на свою картку»).
    const sum = plain(document.querySelector(".bud-summary")!.textContent);
    expect(sum).toContain("Витрачено2 806,77 €з лімітів 3 143,00 €");
    expect(sum).toContain("Перевитрата76,17 €у 4 категоріях");
    fireEvent.click(screen.getByRole("button", { name: "Скинути фільтри" }));
    expect(names()).toHaveLength(15);
    expect(screen.queryByRole("list", { name: "Застосовані фільтри" })).toBeNull();
  });

  it("CMP-32@PoC FR 8: the menu has the sections «Тип», «Стан», «Групи» with the count of each value; Escape closes it", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Фільтри" }));
    const menu = screen.getByRole("menu");
    const count = (group: string, label: RegExp) =>
      within(within(menu).getByRole("group", { name: group })).getByRole("menuitemcheckbox", { name: label })
        .textContent;
    expect(count("Тип", /^Обов/)).toContain("7");
    expect(count("Тип", /Необов/)).toContain("8");
    expect(count("Стан", /Не почато/)).toContain("2");
    expect(count("Стан", /Майже/)).toContain("1");
    expect(count("Групи", /Щоденне/)).toContain("8");
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Фільтри" }));
  });

  it("CMP-32@PoC FR 8: «Тип» and «Групи» narrow the table; the chip's «×» removes one value", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Фільтри" }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: /^Обов/ }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: /Родина/ }));
    expect(names().sort()).toEqual(["Освіта", "Здоров’я"].sort());
    expect(screen.getByRole("button", { name: "Фільтри · 2" })).toBeTruthy();
    // BUD-02 AC10: the totals row counts every category, not the 1 overspent one left in the table.
    expect(plain(document.querySelector(".bud-summary")!.textContent)).toContain(
      "Перевитрата76,17 €у 4 категоріях",
    );
    fireEvent.click(screen.getByRole("button", { name: "Прибрати фільтр: Група — родина" }));
    expect(names()).toHaveLength(7);
  });

  it("CMP-32@PoC FR 8: a filter that matches nothing says so and keeps «Скинути фільтри»", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Фільтри" }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: /Поза планом/ }));
    expect(screen.getByText("За цими фільтрами категорій немає")).toBeTruthy();
    expect(screen.getByText("Показано 0 з 15 категорій")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Скинути фільтри" })).toBeTruthy();
  });
});

describe("BUD-02@PoC d) owner decisions of 2026-11-18 and the fix round", () => {
  const zero = cat("Подорожі", G_DAILY, "0.00", "150.00");
  const withZero = (extra: Cat[]) => [...CATS, ...extra];
  const zeroPeriod = (cats: Cat[]) => ({
    "GET /v1/budget/periods/2026-11": { status: 200, body: period("2026-11", "current", { cats }) } as Reply,
  });

  it("BUD-02@PoC FR 9, FR 19, FR 20: a category with a limit of 0 € and spending is «перевищено» — the row, the state filter and the overspend agree", async () => {
    const cats = withZero([zero]);
    await open(zeroPeriod(cats), PAGE, cats);
    const row = rowOf("Подорожі");
    expect(row.getAttribute("data-state")).toBe("over");
    expect(row.textContent).toContain("перевищено");
    expect(cellsOf(row)).toEqual(["150,00 €", "0,00 €", "−150,00 €"]);
    expect(plain(document.querySelector(".bud-summary")!.textContent)).toContain(
      "Перевитрата226,17 €у 5 категоріях",
    );
    fireEvent.click(screen.getByRole("button", { name: "Фільтри" }));
    expect(screen.getByRole("menuitemcheckbox", { name: /Перевищено/ }).textContent).toContain("5");
    expect(screen.getByRole("menuitemcheckbox", { name: /Поза планом/ }).textContent).toContain("0");
  });

  it("BUD-02@PoC FR 20: «Поза планом» rows count as «Необов’язкові» for «Тип» and a «Групи» filter hides them", async () => {
    const trips = cat("Подорожі", G_DAILY, "0.00", "150.00");
    await open(
      {
        "GET /v1/budget/periods/2026-11": {
          status: 200,
          body: period("2026-11", "current", { outside: [{ id: trips.id, spent: "150.00" }] }),
        },
      },
      PAGE,
      [...CATS, trips],
    );
    fireEvent.click(screen.getByRole("button", { name: "Фільтри" }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: /Необов/ }));
    expect(names()).toContain("Подорожі");
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: /Щоденне/ }));
    expect(names()).not.toContain("Подорожі");
  });

  it("BUD-02@PoC FR 16: the future month has no category filter", async () => {
    await open({}, "#/planning/budget?period=2026-12");
    await screen.findAllByText(/Це план на грудень/);
    expect(screen.queryByRole("button", { name: /Фільтри/ })).toBeNull();
  });

  it("BUD-02@PoC FR 20: «Показано N з M категорій» follows the plural of the total", async () => {
    const one = [CATS[0]!];
    await open(
      {
        "GET /v1/budget/periods/2026-11": { status: 200, body: period("2026-11", "current", { cats: one }) },
      },
      PAGE,
      one,
    );
    fireEvent.click(screen.getByRole("button", { name: "Фільтри" }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: /Вичерпано/ }));
    expect(screen.getByText("Показано 1 з 1 категорії")).toBeTruthy();
  });

  it("BUD-02@PoC UI error: a 404 on the budget is shown in the budget's words, not as a sign-in outage", async () => {
    renderAt(PAGE, api({ "GET /v1/budget": problem(404, "NOT_FOUND") }).client);
    expect(await screen.findByText("Бюджет зараз недоступний. Спробуйте пізніше")).toBeTruthy();
    expect(screen.queryByText(/Реєстрація і вхід/)).toBeNull();
  });
});
