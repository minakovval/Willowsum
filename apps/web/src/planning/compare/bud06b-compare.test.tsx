import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { installMatchMedia } from "@willowsum/ui/test-utils";
import { AuthApiProvider } from "../../auth/api.ts";
import { fakeApi, plain, problem, resetAuthState, type Reply } from "../../auth/testing.tsx";
import { CompareScreen } from "./ComparePage.tsx";

/**
 * BUD-06@PoC b) (wave 2, row 132): S-132 «Порівняння» and S-290 «Рік: план і факт» with the period picker CMP-72@PoC, on
 * `GET /v1/budget/compare` and `/year` (#605, #625). Only the screen is rendered (`CompareScreen`), on a fake API with
 * synthetic data; today is 2026-11-19 unless a test says otherwise. Boards: PocPlanCompare, …Base, …Period, …Year,
 * PocPlanCompareTexts.
 */
const eur = (amount: string) => ({ amount, currency: "EUR" });
const C = {
  cafe: "c0000000-0000-4000-8000-000000000001",
  travel: "c0000000-0000-4000-8000-000000000002",
  gifts: "c0000000-0000-4000-8000-000000000003",
  food: "c0000000-0000-4000-8000-000000000004",
  fuel: "c0000000-0000-4000-8000-000000000005",
  salary: "c0000000-0000-4000-8000-000000000006",
};
const G = { daily: "9a000000-0000-4000-8000-000000000001" };
const NAMES: Record<string, string> = {
  [C.cafe]: "Кафе і ресторани",
  [C.travel]: "Подорожі",
  [C.gifts]: "Подарунки",
  [C.food]: "Продукти",
  [C.fuel]: "Пальне",
  [C.salary]: "Дохід",
};

type Tone = "gain" | "gain-soft" | "loss" | "loss-soft" | "none";
const change = (amount: string, percent: string | null, tone: Tone) => ({
  amount: eur(amount),
  percent,
  direction: tone === "none" ? "none" : amount.startsWith("-") ? "down" : "up",
  tone,
});
const row = (
  categoryId: string | null,
  current: string,
  plan: string | null,
  planDifference: ReturnType<typeof change> | null,
  base: string | null,
  difference: ReturnType<typeof change> | null,
  tx = { current: 10, base: 8 as number | null },
) => ({
  categoryId,
  current: eur(current),
  plan: plan === null ? null : eur(plan),
  planDifference,
  base: base === null ? null : eur(base),
  difference,
  transactions: tx,
});

const OVERALL = row(
  null,
  "3144.46",
  "3000.00",
  change("144.46", "4.8", "loss"),
  "3071.10",
  change("73.36", "2.4", "loss-soft"),
);
const baseInfo = (base: string, extra: Record<string, unknown> = {}) => ({
  bases: ["previous", "last-year", "avg3", "avg6", "avg12"].map((b) => ({
    base: b,
    available: true,
    reason: null,
    months: b.startsWith("avg") ? Number(b.slice(3)) : null,
  })),
  base: {
    available: true,
    base,
    full: false,
    months: base.startsWith("avg") ? Number(base.slice(3)) : null,
    window: { from: "2026-07-01", to: "2026-09-30" },
  },
  ...extra,
});

function compare(base = "avg3", over: Record<string, unknown> = {}) {
  return {
    currency: "EUR",
    type: "month",
    window: { from: "2026-10-01", to: "2026-10-31" },
    inProgress: false,
    finished: true,
    year: "2026",
    finishedPeriods: 14,
    approximate: { nearestRateCount: 0, unavailableCount: 0 },
    ...baseInfo(base),
    income: {
      overall: row(
        null,
        "5550.00",
        "5500.00",
        change("50.00", "0.9", "gain-soft"),
        "5516.67",
        change("33.33", "0.6", "gain-soft"),
      ),
      categories: [
        row(
          C.salary,
          "5550.00",
          "5500.00",
          change("50.00", "0.9", "gain-soft"),
          "5516.67",
          change("33.33", "0.6", "gain-soft"),
        ),
      ],
    },
    expenses: {
      overall: OVERALL,
      categories: [
        row(C.travel, "0.00", null, null, "483.33", change("-483.33", "100.0", "gain"), {
          current: 0,
          base: 1,
        }),
        row(
          C.cafe,
          "498.60",
          "200.00",
          change("298.60", "149.3", "loss"),
          "258.60",
          change("240.00", "92.8", "loss"),
          { current: 26, base: 20 },
        ),
        row(
          C.food,
          "742.30",
          "750.00",
          change("-7.70", "1.0", "gain-soft"),
          "705.88",
          change("36.42", "5.2", "loss-soft"),
        ),
        row(
          C.fuel,
          "168.40",
          "170.00",
          change("-1.60", "0.9", "gain-soft"),
          "180.23",
          change("-11.83", "6.6", "gain-soft"),
        ),
      ],
    },
    largest: [
      { categoryId: C.travel, difference: eur("-483.33"), transactions: { current: 0, base: 1 } },
      { categoryId: C.cafe, difference: eur("240.00"), transactions: { current: 26, base: 20 } },
      { categoryId: C.food, difference: eur("36.42"), transactions: { current: 10, base: 10 } },
    ],
    ...over,
  };
}

const tree = {
  groups: [
    {
      id: G.daily,
      categories: Object.entries(NAMES).map(([id, name]) => ({ id, name })),
    },
  ],
};

function yearBody() {
  const months = Array.from({ length: 12 }, (_, i) => ({
    period: `2026-${String(i + 1).padStart(2, "0")}`,
    mode: i < 10 ? "past" : i === 10 ? "current" : "future",
  }));
  const cells = (fact: string, plan: string) =>
    months.map((m) =>
      m.mode === "future"
        ? { fact: null, plan: eur(plan), difference: null }
        : { fact: eur(fact), plan: eur(plan), difference: change("-12.00", "2.0", "gain-soft") },
    );
  const line = (fact: string, plan: string) => ({
    cells: cells(fact, plan),
    total: eur("5380.00"),
    plan: eur("5500.00"),
    difference: change("-120.00", "2.2", "gain-soft"),
  });
  return {
    currency: "EUR",
    year: "2026",
    months,
    approximate: { nearestRateCount: 0, unavailableCount: 0 },
    income: line("5380.00", "5500.00"),
    groups: [
      {
        groupId: G.daily,
        ...line("700.00", "720.00"),
        categories: [{ categoryId: C.food, ...line("700.00", "720.00") }],
      },
    ],
    expenses: line("700.00", "720.00"),
  };
}

const asked: URL[] = [];
function api(answer: (u: URL) => Reply | undefined = () => undefined) {
  asked.length = 0;
  return fakeApi({
    "GET /v1/budget/compare": ((_c: never, u: URL) => {
      asked.push(u);
      const type = u.searchParams.get("type") ?? "month";
      const base = u.searchParams.get("base") ?? (type === "year" || type === "ytd" ? "last-year" : "avg3");
      return answer(u) ?? { status: 200, body: compare(base, { type }) };
    }) as never,
    "GET /v1/budget/compare/year": ((_c: never, u: URL) => {
      asked.push(u);
      return { status: 200, body: yearBody() };
    }) as never,
    "GET /v1/categories": { status: 200, body: tree },
  });
}

function open(
  fake: ReturnType<typeof api>,
  hash = "#/planning/budget/compare?type=month&period=2026-10&base=avg3",
  today = "2026-11-19",
) {
  window.location.hash = hash;
  return render(
    <AuthApiProvider value={fake.client}>
      <CompareScreen today={today} />
    </AuthApiProvider>,
  );
}
/** The text a reader sees: the visually hidden spoken form is left out. */
const seen = (el: Element) => {
  const copy = el.cloneNode(true) as Element;
  copy.querySelectorAll(".ws-visually-hidden").forEach((n) => n.remove());
  return plain(copy.textContent);
};
const cells = (r: HTMLElement) => within(r).getAllByRole("cell").map(seen);
const tableOf = (name: string) => screen.getByRole("table", { name });
const rowOf = (table: HTMLElement, name: string) =>
  within(table).getByRole("row", { name: new RegExp(`^${name}`) });
const lastAsk = () => asked[asked.length - 1]!;
const heads = (table: HTMLElement) =>
  within(table)
    .getAllByRole("columnheader")
    .map((h) => plain(h.textContent));

beforeEach(() => {
  installMatchMedia({ width: 1280 });
  resetAuthState();
  try {
    window.localStorage.clear();
  } catch {
    /* none */
  }
});
afterEach(cleanup);

describe("BUD-06@PoC FR 1: the table of categories", () => {
  it("BUD-06@PoC AC9: «План» of a category with a limit and «± до плану» in the strong red; a category without a limit has «–»", async () => {
    open(api());
    const expenses = await screen.findByRole("table", { name: "Витрати" });
    const cafe = rowOf(expenses, "Кафе і ресторани");
    expect(cells(cafe)).toContain("200,00 €");
    const diff = within(cafe).getByText(/^▲ 298,60 € · 149,3 %$/);
    expect(diff.closest(".cmp-tone")?.className).toContain("cmp-tone--loss");
    expect(diff.closest(".cmp-tone")?.className).not.toContain("soft");
    const travel = rowOf(expenses, "Подорожі");
    expect(cells(travel)[2]).toBe("–поза планом");
  });

  it("BUD-06@PoC AC15: base «Сер. за 3 міс.» — soft red, strong red and soft green by the API's tone; one cell, no percent column", async () => {
    open(api());
    const expenses = await screen.findByRole("table", { name: "Витрати" });
    const tone = (name: string, text: RegExp) =>
      within(rowOf(expenses, name)).getByText(text).closest(".cmp-tone")!.className;
    expect(tone("Продукти", /^▲ 36,42 € · 5,2 %$/)).toContain("cmp-tone--loss-soft");
    expect(tone("Кафе і ресторани", /^▲ 240,00 € · 92,8 %$/)).toMatch(/cmp-tone--loss(?!-)/);
    expect(tone("Пальне", /^▼ 11,83 € · 6,6 %$/)).toContain("cmp-tone--gain-soft");
    const h = heads(expenses);
    expect(h).toContain("Сер. за 3 міс.");
    expect(h).toContain("± до сер.");
    expect(h).not.toContain("База");
    expect(h.some((x) => /^%$|відсот/i.test(x))).toBe(false);
  });

  it("BUD-06@PoC FR 1: the amounts are shown from the decimal strings — no float rounding, no re-sort", async () => {
    const big = "12345678901234567890.12";
    const body = compare("avg3");
    body.expenses.categories = [
      row(C.fuel, "9.50", null, null, null, null),
      row(C.food, big, null, null, null, null),
      row(C.cafe, "10.25", null, null, null, null),
    ];
    open(api(() => ({ status: 200, body })));
    const expenses = await screen.findByRole("table", { name: "Витрати" });
    const names = within(expenses)
      .getAllByRole("row")
      .slice(1)
      .map((r) => plain(within(r).getAllByRole("cell")[0]!.textContent));
    expect(names.slice(0, 3)).toEqual(["Пальне", "Продукти", "Кафе і ресторани"]);
    expect(within(expenses).getByText("12 345 678 901 234 567 890,12 €")).toBeTruthy();
  });

  it("BUD-06@PoC AC7: a category with a zero base shows the difference in euros without a percentage", async () => {
    const body = compare("avg3");
    body.expenses.categories = [
      row(
        C.gifts,
        "80.00",
        "100.00",
        change("-20.00", "20.0", "gain-soft"),
        "0.00",
        change("80.00", null, "loss"),
      ),
    ];
    open(api(() => ({ status: 200, body })));
    const expenses = await screen.findByRole("table", { name: "Витрати" });
    expect(within(rowOf(expenses, "Подарунки")).getByText("▲ 80,00 €")).toBeTruthy();
  });

  it("BUD-06@PoC AC12: the base columns are named by the chosen base; the control reads «Порівняти з:» and there is no «База»", async () => {
    open(api());
    const select = (await screen.findByLabelText("Порівняти з:")) as HTMLSelectElement;
    expect(select.value).toBe("avg3");
    fireEvent.change(select, { target: { value: "previous" } });
    await waitFor(() => expect(lastAsk().searchParams.get("base")).toBe("previous"));
    const expenses = await screen.findByRole("table", { name: "Витрати" });
    await waitFor(() => expect(heads(expenses)).toContain("Попер. період"));
    expect(heads(expenses)).toContain("± до попер.");
    expect(heads(expenses)).not.toContain("База");
  });

  it("BUD-06@PoC AC13: «Попередній період», «Той самий період минулого року» and «Середнє за 12 міс.» name the columns", async () => {
    open(api());
    const select = (await screen.findByLabelText("Порівняти з:")) as HTMLSelectElement;
    const expected: [string, string, string][] = [
      ["previous", "Попер. період", "± до попер."],
      ["last-year", "Минулий рік", "± до мин. року"],
      ["avg12", "Сер. за 12 міс.", "± до сер."],
    ];
    for (const [value, base, diff] of expected) {
      fireEvent.change(select, { target: { value } });
      await waitFor(() => expect(heads(tableOf("Витрати"))).toContain(base));
      expect(heads(tableOf("Витрати"))).toContain(diff);
    }
  });

  it("BUD-06@PoC AC2: the three largest changes are explained as facts — «Кафе і ресторани: ▲ 240,00 € до середнього, на 6 транзакцій більше»", async () => {
    open(api());
    const card = await screen.findByRole("region", { name: "Найбільші зміни" });
    const items = within(card)
      .getAllByRole("listitem")
      .map((li) => plain(li.textContent));
    expect(items).toEqual([
      "Подорожі: ▼ 483,33 € до середнього, на 1 транзакцію менше",
      "Кафе і ресторани: ▲ 240,00 € до середнього, на 6 транзакцій більше",
      "Продукти: ▲ 36,42 € до середнього",
    ]);
  });
});

describe("BUD-06@PoC: the base, the window and the approximate counts", () => {
  it("BUD-06@PoC AC1: a period in progress compares the same dates; «Повний попередній період» asks for the base whole", async () => {
    const cut = compare("previous", {
      inProgress: true,
      finished: false,
      window: { from: "2026-11-01", to: "2026-11-12" },
      base: {
        available: true,
        base: "previous",
        full: false,
        months: null,
        window: { from: "2026-10-01", to: "2026-10-12" },
      },
    });
    const fake = api((u) => ({
      status: 200,
      body:
        u.searchParams.get("full") === "true"
          ? { ...cut, base: { ...cut.base, full: true, window: { from: "2026-10-01", to: "2026-10-31" } } }
          : cut,
    }));
    open(fake, "#/planning/budget/compare?type=month&period=2026-11&base=previous", "2026-11-12");
    expect(await screen.findByText(/1–12 лист\. 2026 · база на ту саму дату: 1–12 жовт\. 2026/)).toBeTruthy();
    fireEvent.click(screen.getByRole("switch", { name: "Повний попередній період" }));
    await waitFor(() => expect(lastAsk().searchParams.get("full")).toBe("true"));
    expect(await screen.findByText(/база цілком: 1–31 жовт\. 2026/)).toBeTruthy();
  });

  it("BUD-06@PoC AC6: the base on 31 March ends on the last day of the shorter month, as the API gives it", async () => {
    const body = compare("previous", {
      inProgress: true,
      window: { from: "2026-03-01", to: "2026-03-31" },
      base: {
        available: true,
        base: "previous",
        full: false,
        months: null,
        window: { from: "2026-02-01", to: "2026-02-28" },
      },
    });
    open(
      api(() => ({ status: 200, body })),
      "#/planning/budget/compare?type=month&period=2026-03&base=previous",
      "2026-03-31",
    );
    expect(await screen.findByText(/база на ту саму дату: 1–28 лют\. 2026/)).toBeTruthy();
  });

  it("BUD-06@PoC AC5: no data a year ago — «Той самий період минулого року» is inactive with the reason and a link to import; the average says «за 2 міс.»", async () => {
    const body = compare("avg6", {
      bases: [
        { base: "previous", available: true, reason: null, months: null },
        { base: "last-year", available: false, reason: "no_history", months: null },
        { base: "avg3", available: true, reason: null, months: 2 },
        { base: "avg6", available: true, reason: null, months: 2 },
        { base: "avg12", available: true, reason: null, months: 2 },
      ],
      base: {
        available: true,
        base: "avg6",
        full: false,
        months: 2,
        window: { from: "2026-09-01", to: "2026-10-31" },
      },
    });
    open(
      api(() => ({ status: 200, body })),
      "#/planning/budget/compare?type=month&period=2026-11&base=avg6",
    );
    const option = (await screen.findByRole("option", {
      name: /^Той самий період минулого року — немає даних за листопад 2025$/,
    })) as HTMLOptionElement;
    expect(option.disabled).toBe(true);
    expect(screen.getByRole("link", { name: "Імпортувати старі виписки" })).toBeTruthy();
    expect(await screen.findByText("за 2 міс.")).toBeTruthy();
  });

  it("BUD-06@PoC EC «База недоступна»: the table keeps the plan, the base columns show «–» and a note says why", async () => {
    const body = {
      ...compare("last-year"),
      base: { available: false, base: "last-year", full: false, months: null, window: null },
    };
    body.expenses.categories = [
      row(C.cafe, "498.60", "200.00", change("298.60", "149.3", "loss"), null, null),
    ];
    body.largest = [];
    open(
      api(() => ({ status: 200, body })),
      "#/planning/budget/compare?type=month&period=2026-10&base=last-year",
    );
    expect(
      await screen.findByText("Базу порівняння не можна показати: за її дати немає даних."),
    ).toBeTruthy();
    const cafe = rowOf(tableOf("Витрати"), "Кафе і ресторани");
    expect(cells(cafe)).toEqual([
      "Кафе і ресторани",
      "498,60 €",
      "200,00 €",
      "▲ 298,60 € · 149,3 %",
      "–",
      "–",
    ]);
    expect(screen.queryByRole("region", { name: "Найбільші зміни" })).toBeNull();
  });

  it("BUD-06@PoC FR 1: the approximate notice shows its counts — the nearest rate and the missing rate", async () => {
    const body = compare("avg3", { approximate: { nearestRateCount: 3, unavailableCount: 2 } });
    open(api(() => ({ status: 200, body })));
    expect(await screen.findByText(/3 транзакції за найближчим курсом/)).toBeTruthy();
    expect(screen.getByText("Курс недоступний · 2")).toBeTruthy();
  });
});

describe("BUD-06@PoC: «З початку року» of a past year (owner, 2026-11-19)", () => {
  const past = compare("last-year", {
    type: "ytd",
    finishedPeriods: 30,
    inProgress: false,
    finished: false,
    year: "2025",
    window: { from: "2025-01-01", to: "2025-11-19" },
    base: {
      available: true,
      base: "last-year",
      full: false,
      months: null,
      window: { from: "2024-01-01", to: "2024-11-19" },
    },
  });
  it("CMP-72@PoC FR 2: «‹» works for «З початку року» and goes to the year before; «Повний попередній період» is offered although `inProgress` is false", async () => {
    const fake = api((u) => ({
      status: 200,
      body: { ...past, base: { ...past.base, full: u.searchParams.get("full") === "true" } },
    }));
    open(fake, "#/planning/budget/compare?type=ytd&period=2025");
    expect(
      await screen.findByText(/1 січ\. – 19 лист\. 2025 · база на ту саму дату: 1 січ\. – 19 лист\. 2024/),
    ).toBeTruthy();
    const full = screen.getByRole("switch", { name: "Повний попередній період" });
    fireEvent.click(full);
    await waitFor(() => expect(lastAsk().searchParams.get("full")).toBe("true"));
    expect(lastAsk().searchParams.get("type")).toBe("ytd");
    const prev = screen.getByRole("button", { name: "Попередній період" });
    expect(prev.getAttribute("aria-disabled")).toBeNull();
    fireEvent.click(prev);
    await waitFor(() => expect(lastAsk().searchParams.get("period")).toBe("2024"));
  });

  it("CMP-72@PoC FR 2: «‹» of «З початку року» is inactive, with «Даних раніше немає», when the history starts in that year", async () => {
    const fake = api(() => ({ status: 200, body: { ...past, finishedPeriods: 13 } }));
    open(fake, "#/planning/budget/compare?type=ytd&period=2025");
    await screen.findByRole("table", { name: "Витрати" });
    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: /^Попередній період\. Даних раніше немає$/ })
          .getAttribute("aria-disabled"),
      ).toBe("true"),
    );
  });
});

describe("BUD-06@PoC AC1: the default period", () => {
  it("BUD-06@PoC AC1: opened without a choice on the 12th, the screen shows the month in progress, the same dates, and offers «Повний попередній період»", async () => {
    const cut = compare("previous", {
      inProgress: true,
      finished: false,
      window: { from: "2026-11-01", to: "2026-11-12" },
      base: {
        available: true,
        base: "previous",
        full: false,
        months: null,
        window: { from: "2026-10-01", to: "2026-10-12" },
      },
    });
    const fake = api(() => ({ status: 200, body: cut }));
    open(fake, "#/planning/budget/compare", "2026-11-12");
    expect(await screen.findByRole("button", { name: "Листопад 2026" })).toBeTruthy();
    expect(lastAsk().searchParams.get("period")).toBe("2026-11");
    expect(await screen.findByRole("switch", { name: "Повний попередній період" })).toBeTruthy();
    expect(await screen.findByText(/база на ту саму дату/)).toBeTruthy();
  });
});

describe("CMP-72@PoC: the lists and «‹»", () => {
  it("CMP-72@PoC FR 1: the list opens on the chosen option; Home and End go to the first and the last", async () => {
    open(api());
    await screen.findByRole("table", { name: "Витрати" });
    fireEvent.click(screen.getByRole("button", { name: "Тип періоду: Місяць" }));
    const options = screen.getAllByRole("option");
    expect(document.activeElement).toBe(options[0]);
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "ArrowDown" });
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "End" });
    expect(document.activeElement).toBe(options[3]);
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Home" });
    expect(document.activeElement).toBe(options[0]);
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Тип періоду: Місяць" }));
    fireEvent.click(screen.getByRole("option", { name: "Рік" }));
    await screen.findByRole("button", { name: "Тип періоду: Рік" });
    fireEvent.click(screen.getByRole("button", { name: "Тип періоду: Рік" }));
    const chosen = screen.getByRole("option", { name: "Рік" });
    expect(chosen.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(chosen);
  });

  it("CMP-72@PoC FR 2: «‹» of «З початку року» is inactive when the history starts after the end of the earlier window (history from December 2025, today November 2026)", async () => {
    open(
      api((u) => ({
        status: 200,
        body: compare("last-year", { type: u.searchParams.get("type") ?? "ytd", finishedPeriods: 11 }),
      })),
      "#/planning/budget/compare?type=ytd&period=2026",
    );
    await screen.findByRole("table", { name: "Витрати" });
    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: /^Попередній період\. Даних раніше немає$/ })
          .getAttribute("aria-disabled"),
      ).toBe("true"),
    );
  });

  it("CMP-72@PoC FR 1: the reason of an inactive base keeps «IV квартал» in capitals", async () => {
    const body = compare("previous", {
      type: "quarter",
      bases: [
        { base: "previous", available: true, reason: null, months: null },
        { base: "last-year", available: false, reason: "no_history", months: null },
        { base: "avg3", available: true, reason: null, months: 3 },
        { base: "avg6", available: true, reason: null, months: 3 },
        { base: "avg12", available: true, reason: null, months: 3 },
      ],
    });
    open(
      api(() => ({ status: 200, body })),
      "#/planning/budget/compare?type=quarter&period=2026-Q4&base=previous",
    );
    expect(
      await screen.findByRole("option", {
        name: /^Той самий період минулого року — немає даних за IV квартал 2025$/,
      }),
    ).toBeTruthy();
  });
});

describe("CMP-72@PoC: the period picker", () => {
  it("CMP-72@PoC AC1: the type «Квартал» turns «Жовтень 2026» into «IV квартал 2026» and the table is built for the quarter", async () => {
    const fake = api();
    open(fake);
    await screen.findByRole("table", { name: "Витрати" });
    fireEvent.click(screen.getByRole("button", { name: "Тип періоду: Місяць" }));
    fireEvent.click(screen.getByRole("option", { name: "Квартал" }));
    expect(await screen.findByRole("button", { name: "IV квартал 2026" })).toBeTruthy();
    await waitFor(() => expect(lastAsk().searchParams.get("type")).toBe("quarter"));
    expect(lastAsk().searchParams.get("period")).toBe("2026-Q4");
  });

  it("CMP-72@PoC AC2: type «Рік», «‹» shows 2025 and the base is «Минулий рік»", async () => {
    open(api(), "#/planning/budget/compare?type=year&period=2026");
    await screen.findByRole("table", { name: "Витрати" });
    fireEvent.click(screen.getByRole("button", { name: "Попередній період" }));
    expect(await screen.findByRole("button", { name: "2025" })).toBeTruthy();
    await waitFor(() => expect(lastAsk().searchParams.get("period")).toBe("2025"));
    const select = (await screen.findByLabelText("Порівняти з:")) as HTMLSelectElement;
    expect(select.value).toBe("last-year");
    expect(within(select).getByRole("option", { name: "Минулий рік" })).toBeTruthy();
  });

  it("CMP-72@PoC AC3: «›» is inactive for the current month", async () => {
    open(api(), "#/planning/budget/compare?type=month&period=2026-11&base=previous");
    await screen.findByRole("table", { name: "Витрати" });
    expect(screen.getByRole("button", { name: "Наступний період" }).getAttribute("aria-disabled")).toBe(
      "true",
    );
  });

  it("CMP-72@PoC AC4: the list of types holds «Місяць», «Квартал», «З початку року», «Рік» and no «Власний»", async () => {
    open(api());
    await screen.findByRole("table", { name: "Витрати" });
    const opener = screen.getByRole("button", { name: "Тип періоду: Місяць" });
    expect(opener.getAttribute("aria-haspopup")).toBe("listbox");
    fireEvent.click(opener);
    const options = within(screen.getByRole("listbox", { name: "Тип періоду" }))
      .getAllByRole("option")
      .map((o) => plain(o.textContent));
    expect(options).toEqual(["✓Місяць", "Квартал", "З початку року", "Рік"]);
  });

  it("CMP-72@PoC AC6: a change by an arrow is announced politely — «Показано: Вересень 2026»", async () => {
    open(api());
    await screen.findByRole("table", { name: "Витрати" });
    fireEvent.click(screen.getByRole("button", { name: "Попередній період" }));
    await waitFor(() =>
      expect(screen.getByText("Показано: Вересень 2026").getAttribute("role")).toBe("status"),
    );
  });

  it("CMP-72@PoC FR 1: the keyboard opens the type list, Esc closes it and the focus returns to the opener", async () => {
    open(api());
    await screen.findByRole("table", { name: "Витрати" });
    const opener = screen.getByRole("button", { name: "Тип періоду: Місяць" });
    opener.focus();
    fireEvent.keyDown(opener, { key: "ArrowDown" });
    const list = screen.getByRole("listbox", { name: "Тип періоду" });
    fireEvent.keyDown(list, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});

describe("BUD-06@PoC FR 11: S-290 «Рік: план і факт»", () => {
  it("BUD-06@PoC AC11: 12 months of 2026, December only the plan in grey, «Разом за рік», «План», «Різниця» and «Дохід» on top", async () => {
    open(api(), "#/planning/budget/compare?type=year&period=2026&view=year");
    const table = await screen.findByRole("table", { name: "2026 · план і факт за місяцями" });
    const h = heads(table);
    expect(h).toHaveLength(1 + 12 + 3);
    expect(h.slice(-3)).toEqual(["Разом за рік", "План", "Різниця"]);
    const rows = within(table).getAllByRole("row");
    expect(plain(within(rows[1]!).getAllByRole("cell")[0]!.textContent)).toBe("Дохід");
    const december = plain(within(rows[1]!).getAllByRole("cell")[12]!.textContent);
    expect(december).toBe("5 500,00план");
    expect(within(rows[1]!).getAllByRole("cell")[12]!.querySelector(".ws-muted")).not.toBeNull();
    expect(lastAsk().pathname).toBe("/v1/budget/compare/year");
    expect(lastAsk().searchParams.get("year")).toBe("2026");
  });

  it("BUD-06@PoC AC14: «Рік: план і факт» of «III квартал 2026» shows the 12 months of 2026", async () => {
    open(api(), "#/planning/budget/compare?type=quarter&period=2026-Q3");
    await screen.findByRole("table", { name: "Витрати" });
    fireEvent.click(screen.getByRole("radio", { name: "Рік: план і факт" }));
    const table = await screen.findByRole("table", { name: "2026 · план і факт за місяцями" });
    expect(heads(table)).toHaveLength(16);
    expect(lastAsk().searchParams.get("year")).toBe("2026");
  });

  it("BUD-06@PoC AC12: the switch «З порівнянням / Рік: план і факт» stays visible after the type changes to «Квартал» and «Рік»", async () => {
    open(api());
    await screen.findByRole("table", { name: "Витрати" });
    for (const type of ["Квартал", "Рік"]) {
      fireEvent.click(screen.getByRole("button", { name: /^Тип періоду:/ }));
      fireEvent.click(screen.getByRole("option", { name: type }));
      await waitFor(() => expect(screen.getByRole("button", { name: `Тип періоду: ${type}` })).toBeTruthy());
      expect(screen.getByRole("radio", { name: "З порівнянням" })).toBeTruthy();
      expect(screen.getByRole("radio", { name: "Рік: план і факт" })).toBeTruthy();
    }
  });
});

describe("BUD-06@PoC FR 1: «З початку року»", () => {
  it("BUD-06@PoC AC10: the type «З початку року» gives «Січень — жовтень 2026» and the base «Той самий період минулого року»", async () => {
    open(api(), "#/planning/budget/compare?type=month&period=2026-10&base=avg3", "2026-10-20");
    await screen.findByRole("table", { name: "Витрати" });
    fireEvent.click(screen.getByRole("button", { name: "Тип періоду: Місяць" }));
    fireEvent.click(screen.getByRole("option", { name: "З початку року" }));
    expect(await screen.findByRole("button", { name: "Січень — жовтень 2026" })).toBeTruthy();
    await waitFor(() => expect(lastAsk().searchParams.get("type")).toBe("ytd"));
    expect(lastAsk().searchParams.get("period")).toBe("2026");
    expect(((await screen.findByLabelText("Порівняти з:")) as HTMLSelectElement).value).toBe("last-year");
  });
});

describe("BUD-06@PoC «Стани інтерфейсу»", () => {
  it("BUD-06@PoC EC loading: the skeleton of the table is shown while the answer is awaited", async () => {
    let release: (r: Reply) => void = () => undefined;
    const wait = new Promise<Reply>((r) => (release = r));
    const fake = fakeApi({
      "GET /v1/budget/compare": (() => wait) as never,
      "GET /v1/categories": { status: 200, body: tree },
    });
    open(fake);
    expect((await screen.findAllByRole("status")).length).toBeGreaterThan(0);
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    release({ status: 200, body: compare() });
    expect(await screen.findByRole("table", { name: "Витрати" })).toBeTruthy();
  });

  it("BUD-06@PoC EC empty: without a finished period — «Ще немає завершених періодів для порівняння» with a link to import", async () => {
    open(api(() => ({ status: 200, body: compare("avg3", { finishedPeriods: 0 }) })));
    expect(
      await screen.findByRole("heading", { name: "Ще немає завершених періодів для порівняння" }),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "Імпортувати старі виписки" })).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("BUD-06@PoC EC error: «Не вдалося побудувати порівняння» with «Спробувати ще раз» that asks again", async () => {
    let fail = true;
    open(api(() => (fail ? problem(500, "INTERNAL") : { status: 200, body: compare() })));
    expect((await screen.findByRole("alert")).textContent).toContain("Не вдалося побудувати порівняння");
    expect(screen.getByText(/^Код: /)).toBeTruthy();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Спробувати ще раз" }));
    expect(await screen.findByRole("table", { name: "Витрати" })).toBeTruthy();
    // The picker stays usable in the error state.
    expect(screen.getByRole("button", { name: "Тип періоду: Місяць" })).toBeTruthy();
  });

  it("BUD-06@PoC EC error: a function that is off (404) is said plainly, not as a broken table", async () => {
    open(api(() => problem(404, "NOT_FOUND")));
    expect((await screen.findByRole("alert")).textContent).toMatch(
      /Не вдалося побудувати порівняння|тимчасово недоступне/,
    );
  });
});
