import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { I18nProvider } from "@willowsum/i18n";
import { installMatchMedia } from "@willowsum/ui/test-utils";
import { AuthApiProvider } from "../../auth/api.ts";
import { fakeApi, plain, problem, renderAt, resetAuthState, type Reply } from "../../auth/testing.tsx";
import { PeriodSummary } from "./PeriodSummary.tsx";

/**
 * FLW-38@PoC (wave 2, row 149): S-135 «Підсумок періоду» — the cards over the categories of a finished month, on
 * `GET /v1/budget/periods/{period}/summary` (#681), `GET /v1/budget/compare` (base «Середнє за 3 міс.») and
 * `GET /v1/recurring/payments` (the names). Today is 2026-11-21. Boards: PocPlanPeriod, PocPlanPeriodTexts. Synthetic data.
 */
const eur = (amount: string) => ({ amount, currency: "EUR" });
const C = {
  cafe: "c0000000-0000-4000-8000-000000000001",
  travel: "c0000000-0000-4000-8000-000000000002",
  clothes: "c0000000-0000-4000-8000-000000000003",
};
const P = (n: number) => `d0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const charge = (n: number, dueOn: string, amount: string, over: Record<string, unknown> = {}) => ({
  paymentId: P(n),
  categoryId: null,
  dueOn,
  expected: eur(amount),
  status: "paid",
  paidOn: dueOn,
  overdueDays: null,
  ...over,
});

const REGULAR = {
  count: 7,
  paid: 7,
  late: 1,
  missed: 0,
  items: [
    charge(1, "2026-10-01", "1200.00"),
    charge(2, "2026-10-05", "9.99"),
    charge(3, "2026-10-10", "150.00", { status: "paid-late", paidOn: "2026-10-12" }),
    charge(4, "2026-10-14", "6.50"),
    charge(5, "2026-10-20", "180.00"),
    charge(6, "2026-10-25", "12.00"),
    charge(7, "2026-10-25", "10.99"),
  ],
};
const PAYMENT_NAMES = [
  "Оренда",
  "Netflix",
  "Гуртки Соні",
  "Київстар",
  "Комунальні",
  "Інтернет «Воля»",
  "Spotify Family",
];

function summary(over: Record<string, unknown> = {}) {
  return {
    period: "2026-10",
    currency: "EUR",
    window: { from: "2026-10-01", to: "2026-10-31" },
    income: { actual: eur("5550.00"), plan: eur("5500.00"), difference: eur("50.00") },
    expenses: { actual: eur("3144.46"), plan: eur("3000.00"), difference: eur("144.46") },
    netFlow: eur("2405.54"),
    savingsRate: "43.3",
    regularPayments: REGULAR,
    approximate: { nearestRateCount: 0, unavailableCount: 0 },
    ...over,
  };
}

const tx = (current: number, base: number | null) => ({ current, base });
function compare(over: Record<string, unknown> = {}) {
  return {
    currency: "EUR",
    type: "month",
    window: { from: "2026-10-01", to: "2026-10-31" },
    inProgress: false,
    finished: true,
    year: "2026",
    finishedPeriods: 14,
    approximate: { nearestRateCount: 0, unavailableCount: 0 },
    bases: [],
    base: {
      available: true,
      base: "avg3",
      full: false,
      months: 3,
      window: { from: "2026-07-01", to: "2026-09-30" },
    },
    income: { overall: row(), categories: [] },
    expenses: { overall: row(), categories: [] },
    largest: [
      { categoryId: C.travel, difference: eur("-483.33"), transactions: tx(0, 1) },
      { categoryId: C.cafe, difference: eur("240.00"), transactions: tx(26, 20) },
      { categoryId: C.clothes, difference: eur("82.50"), transactions: tx(5, 3) },
    ],
    ...over,
  };
}
const row = () => ({
  categoryId: null,
  current: eur("0"),
  plan: null,
  planDifference: null,
  base: null,
  difference: null,
  transactions: tx(0, 0),
});

const tree = {
  groups: [
    {
      id: "9a000000-0000-4000-8000-000000000001",
      categories: [
        { id: C.cafe, name: "Кафе і ресторани" },
        { id: C.travel, name: "Подорожі" },
        { id: C.clothes, name: "Одяг" },
      ],
    },
  ],
};

const paymentList = (names = PAYMENT_NAMES) => ({
  items: names.map((name, i) => ({ id: P(i + 1), name })),
  nextCursor: null,
});

function api(over: Record<string, Reply> = {}) {
  return fakeApi({
    "GET /v1/budget/periods/2026-10/summary": { status: 200, body: summary() },
    "GET /v1/budget/compare": { status: 200, body: compare() },
    "GET /v1/categories": { status: 200, body: tree },
    "GET /v1/recurring/payments": { status: 200, body: paymentList() },
    ...over,
  });
}

function open(fake: ReturnType<typeof api>, locale: "uk" | "en" = "uk") {
  return render(
    <I18nProvider initialLocale={locale}>
      <AuthApiProvider value={fake.client}>
        <PeriodSummary period="2026-10" />
      </AuthApiProvider>
    </I18nProvider>,
  );
}

/** The text a reader sees: the visually hidden spoken form is left out. */
const seen = (el: Element) => {
  const copy = el.cloneNode(true) as Element;
  copy.querySelectorAll(".ws-visually-hidden").forEach((n) => n.remove());
  return plain(copy.textContent);
};
const figure = (name: string) => document.querySelector<HTMLElement>(`[data-figure="${name}"]`)!;
const payments = () => document.querySelector<HTMLElement>('[data-card="payments"]')!;

beforeEach(() => {
  installMatchMedia({ width: 1280 });
  resetAuthState();
});
afterEach(cleanup);

describe("FLW-38@PoC FR 1: the figures of a finished month", () => {
  it("FLW-38@PoC FR 1: «Дохід» and «Витрати» show the fact, the plan of the snapshot and the difference with an arrow, and the period reads «1–31 жовтня · період завершено»", async () => {
    open(api());
    await screen.findByText(/період завершено/);
    expect(seen(figure("income"))).toBe("Дохід5 550,00 €план 5 500,00 € · ▲ 50,00 €");
    expect(seen(figure("expenses"))).toBe("Витрати3 144,46 €план 3 000,00 € · ▲ 144,46 €");
    expect(plain(document.querySelector(".per-subtitle")?.textContent)).toBe(
      "1–31 жовтня · період завершено" +
        "план — знімок на 31 жовтня 2026 р. · факт оновлюється при зміні категорій транзакцій",
    );
  });

  it("FLW-38@PoC FR 1: an arrow is not the only sign — the figure has its spoken form, and the colour follows better or worse (spending above the plan is worse, income above it is better)", async () => {
    open(api());
    await screen.findByText(/період завершено/);
    const spoken = (name: string) => figure(name).querySelector(".ws-visually-hidden")?.textContent ?? "";
    expect(spoken("income")).toMatch(/зросло|вище|50/);
    expect(figure("income").querySelector(".per-tone")?.className).toContain("per-tone--gain");
    expect(figure("expenses").querySelector(".per-tone")?.className).toContain("per-tone--loss");
  });

  it("FLW-38@PoC FR 1: below the plan the arrow points down; spending below the plan is better (green), income below it is worse (red)", async () => {
    open(
      api({
        "GET /v1/budget/periods/2026-10/summary": {
          status: 200,
          body: summary({
            income: { actual: eur("5000.00"), plan: eur("5500.00"), difference: eur("-500.00") },
            expenses: { actual: eur("2900.00"), plan: eur("3000.00"), difference: eur("-100.00") },
          }),
        },
      }),
    );
    await screen.findByText(/період завершено/);
    expect(seen(figure("income"))).toContain("▼ 500,00 €");
    expect(figure("income").querySelector(".per-tone")?.className).toContain("per-tone--loss");
    expect(seen(figure("expenses"))).toContain("▼ 100,00 €");
    expect(figure("expenses").querySelector(".per-tone")?.className).toContain("per-tone--gain");
  });

  it("FLW-38@PoC AC5: income 4 000 € and expenses 3 100 € — the net flow 900 € and the savings rate 22,5 %, both as the API gives them", async () => {
    open(
      api({
        "GET /v1/budget/periods/2026-10/summary": {
          status: 200,
          body: summary({
            income: { actual: eur("4000.00"), plan: eur("4000.00"), difference: eur("0.00") },
            expenses: { actual: eur("3100.00"), plan: eur("3100.00"), difference: eur("0.00") },
            netFlow: eur("900.00"),
            savingsRate: "22.5",
          }),
        },
      }),
    );
    await screen.findByText(/період завершено/);
    expect(seen(figure("net"))).toBe("Чистий потік900,00 €дохід − витрати");
    expect(seen(figure("rate"))).toBe("Норма заощаджень22,5 %(дохід − витрати) ÷ дохід");
  });

  it("FLW-38@PoC EC1: without income the savings rate is «–» with the reason, not 0 % and not an error", async () => {
    open(
      api({
        "GET /v1/budget/periods/2026-10/summary": {
          status: 200,
          body: summary({
            income: { actual: eur("0.00"), plan: eur("0.00"), difference: eur("0.00") },
            netFlow: eur("-3144.46"),
            savingsRate: null,
          }),
        },
      }),
    );
    await screen.findByText(/період завершено/);
    expect(seen(figure("rate"))).toBe("Норма заощаджень–немає доходу — норма не рахується");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("FLW-38@PoC FR 1: a part of a month (the first period of the budget) reads its dates, not «1–31»", async () => {
    open(
      api({
        "GET /v1/budget/periods/2026-10/summary": {
          status: 200,
          body: summary({ window: { from: "2026-10-12", to: "2026-10-31" } }),
        },
      }),
    );
    expect(await screen.findByText(/12–31 жовтня · період завершено/)).toBeTruthy();
  });

  it("FLW-38@PoC FR 1: the web adds and divides nothing — the figures are the API's strings (a net flow that is not income minus expenses is shown as sent)", async () => {
    open(
      api({
        "GET /v1/budget/periods/2026-10/summary": {
          status: 200,
          body: summary({ netFlow: eur("1.23"), savingsRate: "7.7" }),
        },
      }),
    );
    await screen.findByText(/період завершено/);
    expect(seen(figure("net"))).toContain("1,23 €");
    expect(seen(figure("rate"))).toContain("7,7 %");
  });
});

describe("FLW-38@PoC FR 3: the three largest changes against the average", () => {
  it("FLW-38@PoC AC1: «Кафе і ресторани: ▲ 240,00 € до середнього, на 6 транзакцій більше» over «липень–вересень 2026»", async () => {
    const fake = api();
    open(fake);
    await screen.findByText(/^Подорожі:/, { selector: "strong" });
    const items = screen.getAllByRole("listitem");
    const card = screen
      .getByRole("heading", { name: /^Порівняно з середнім за 3\s+міс\.$/ })
      .closest("section")!;
    const list = within(card).getAllByRole("listitem").map(seen);
    expect(list).toEqual([
      "Подорожі: ▼ 483,33 € до середнього, на 1 транзакцію менше",
      "Кафе і ресторани: ▲ 240,00 € до середнього, на 6 транзакцій більше",
      "Одяг: ▲ 82,50 € до середнього, на 2 транзакції більше",
    ]);
    expect(items.length).toBeGreaterThan(3);
    expect(seen(card)).toContain("липень–вересень 2026");
    const ask = fake.calls.find((c) => c.path === "/v1/budget/compare");
    expect(ask).toBeTruthy();
  });

  it("FLW-38@PoC FR 3: the compare is asked for the month with the base «Середнє за 3 міс.» and the card opens the tab «Порівняння» on it", async () => {
    const queries: string[] = [];
    const fake = api({
      "GET /v1/budget/compare": ((_c: never, u: URL) => {
        queries.push(u.search);
        return { status: 200, body: compare() };
      }) as never,
    });
    open(fake);
    const link = await screen.findByRole("link", { name: "Відкрити «Порівняння»" });
    expect(link.getAttribute("href")).toBe("#/planning/budget/compare?type=month&period=2026-10&base=avg3");
    expect(queries[0]).toContain("base=avg3");
    expect(queries[0]).toContain("period=2026-10");
  });

  it("FLW-38@PoC FR 3: fewer than three months of history — «за 2 міс.» beside the window", async () => {
    open(
      api({
        "GET /v1/budget/compare": {
          status: 200,
          body: compare({
            base: {
              available: true,
              base: "avg3",
              full: false,
              months: 2,
              window: { from: "2026-08-01", to: "2026-09-30" },
            },
          }),
        },
      }),
    );
    const card = (
      await screen.findByRole("heading", { name: /^Порівняно з середнім за 3\s+міс\.$/ })
    ).closest("section")!;
    await waitFor(() => expect(seen(card)).toContain("серпень–вересень 2026"));
    expect(seen(card)).toContain("за 2 міс.");
  });

  it("FLW-38@PoC FR 3: no history (the base is not available) — a plain sentence, not an empty list", async () => {
    open(
      api({
        "GET /v1/budget/compare": {
          status: 200,
          body: compare({
            base: { available: false, base: "avg3", full: false, months: null, window: null },
            largest: [],
          }),
        },
      }),
    );
    expect(await screen.findByText("Замало завершених місяців, щоб порівняти з середнім")).toBeTruthy();
  });

  it("FLW-38@PoC UI error: the card fails alone — the figures and the payments stay, with «Спробувати ще раз» and the API's code", async () => {
    let calls = 0;
    const fake = api({
      "GET /v1/budget/compare": (() =>
        ++calls === 1 ? problem(500, "INTERNAL") : { status: 200, body: compare() }) as never,
    });
    open(fake);
    expect(await screen.findByText("Не вдалося побудувати порівняння")).toBeTruthy();
    expect(screen.getByText(/Код:\s*0123456789abcdef0123456789abcdef/)).toBeTruthy();
    expect(seen(figure("income"))).toContain("5 550,00 €");
    fireEvent.click(screen.getByRole("button", { name: "Спробувати ще раз" }));
    expect(await screen.findByText(/^Кафе і ресторани:/, { selector: "strong" })).toBeTruthy();
  });
});

describe("FLW-38@PoC FR 1: regular payments of the month", () => {
  it("FLW-38@PoC FR 1: «жовтень · сплачено 7 з 7 · 1 із запізненням», every charge with its date, name, amount and the words of its status", async () => {
    open(api());
    const card = await waitFor(() => {
      const c = payments();
      expect(within(c).getAllByRole("listitem").length).toBe(7);
      return c;
    });
    expect(seen(card)).toContain("жовтень · сплачено 7 з 7 · 1 із запізненням");
    const rows = within(card).getAllByRole("listitem").map(seen);
    expect(rows[0]).toBe("1 жовт.Оренда1 200,00 €✓Сплачено 1 жовт.");
    expect(rows[2]).toBe("10 жовт.Гуртки Соні150,00 €✓Сплачено із запізненням · 12 жовт.");
    expect(rows[6]).toBe("25 жовт.Spotify Family10,99 €✓Сплачено 25 жовт.");
  });

  it("FLW-38@PoC FR 1: a charge that was not paid says so in words (not only in colour) and the summary counts it", async () => {
    const items = [
      charge(1, "2026-10-01", "1200.00"),
      charge(2, "2026-10-05", "9.99", { status: "overdue", paidOn: null, overdueDays: 26 }),
      charge(3, "2026-10-10", "150.00", { status: "skipped", paidOn: null }),
    ];
    open(
      api({
        "GET /v1/budget/periods/2026-10/summary": {
          status: 200,
          body: summary({ regularPayments: { count: 3, paid: 1, late: 0, missed: 2, items } }),
        },
      }),
    );
    const card = await waitFor(() => {
      const c = payments();
      expect(within(c).getAllByRole("listitem").length).toBe(3);
      return c;
    });
    const text = seen(card);
    expect(text).toContain("жовтень · сплачено 1 з 3 · не сплачено: 2");
    expect(text).toContain("Прострочено на 26 дн.");
    expect(text).toContain("Пропущено");
  });

  it("FLW-38@PoC UI empty: a month without regular payments says so", async () => {
    open(
      api({
        "GET /v1/budget/periods/2026-10/summary": {
          status: 200,
          body: summary({ regularPayments: { count: 0, paid: 0, late: 0, missed: 0, items: [] } }),
        },
      }),
    );
    expect(await screen.findByText("У цьому місяці регулярних платежів не було")).toBeTruthy();
    expect(within(payments()).queryByRole("list")).toBeNull();
  });

  it("FLW-38@PoC FR 1: the regular payments are not known (null) — «поки невідомі», never an empty card of zeros", async () => {
    open(
      api({
        "GET /v1/budget/periods/2026-10/summary": { status: 200, body: summary({ regularPayments: null }) },
      }),
    );
    expect(await screen.findByText("Регулярні платежі поки невідомі")).toBeTruthy();
    expect(seen(payments())).not.toContain("сплачено 0 з 0");
  });

  it("FLW-38@PoC FR 1: a payment that is no longer in the list (or a list that did not load) keeps its date and amount under «Платіж»", async () => {
    open(api({ "GET /v1/recurring/payments": problem(500, "INTERNAL") }));
    await waitFor(() => expect(within(payments()).getAllByRole("listitem").length).toBe(7));
    expect(within(payments()).getAllByText("Платіж").length).toBe(7);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("FLW-38@PoC FR 1: a long month shows eight charges and «Показати всі · N» opens the rest", async () => {
    const items = Array.from({ length: 14 }, (_, i) =>
      charge(i + 1, `2026-10-${String(i + 1).padStart(2, "0")}`, "10.00"),
    );
    open(
      api({
        "GET /v1/budget/periods/2026-10/summary": {
          status: 200,
          body: summary({ regularPayments: { count: 14, paid: 14, late: 0, missed: 0, items } }),
        },
        "GET /v1/recurring/payments": {
          status: 200,
          body: paymentList(items.map((_, i) => `Платіж ${i + 1}`)),
        },
      }),
    );
    const more = await screen.findByRole("button", { name: "Показати всі · 14" });
    expect(within(payments()).getAllByRole("listitem").length).toBe(8);
    expect(more.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(more);
    expect(within(payments()).getAllByRole("listitem").length).toBe(14);
    fireEvent.click(screen.getByRole("button", { name: "Згорнути" }));
    expect(within(payments()).getAllByRole("listitem").length).toBe(8);
  });
});

describe("FLW-38@PoC «Стани інтерфейсу»", () => {
  it("FLW-38@PoC UI loading: a skeleton in the place of the figures while the summary comes", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const fake = api({
      "GET /v1/budget/periods/2026-10/summary": (async () => {
        await gate;
        return { status: 200, body: summary() };
      }) as never,
    });
    open(fake);
    const busy = screen.getByLabelText("Підсумок періоду");
    expect(busy.getAttribute("aria-busy")).toBe("true");
    expect(screen.queryByText("Дохід")).toBeNull();
    release();
    expect(await screen.findByText(/період завершено/)).toBeTruthy();
  });

  it("FLW-38@PoC UI error: «Не вдалося завантажити бюджет», the budget's words and «Код: …», never the sign-in text; «Спробувати ще раз» asks again", async () => {
    let calls = 0;
    const fake = api({
      "GET /v1/budget/periods/2026-10/summary": (() =>
        ++calls === 1 ? problem(503, "MODULE_UNAVAILABLE") : { status: 200, body: summary() }) as never,
    });
    open(fake);
    const alert = await screen.findByRole("alert");
    expect(seen(alert)).toContain("Не вдалося завантажити бюджет");
    expect(seen(alert)).toContain("Бюджет зараз недоступний. Спробуйте пізніше");
    expect(seen(alert)).toContain("Код: 0123456789abcdef0123456789abcdef");
    expect(seen(alert)).not.toContain("Реєстрація і вхід недоступні");
    fireEvent.click(within(alert).getByRole("button", { name: "Спробувати ще раз" }));
    expect(await screen.findByText(/період завершено/)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("FLW-38@PoC UI error: the function is off for the space (404 NOT_FOUND) — the budget's error, not the sign-in's", async () => {
    open(api({ "GET /v1/budget/periods/2026-10/summary": problem(404, "NOT_FOUND") }));
    const alert = await screen.findByRole("alert");
    expect(seen(alert)).toContain("Бюджет зараз недоступний. Спробуйте пізніше");
    expect(seen(alert)).not.toContain("Реєстрація");
  });

  it("FLW-38@PoC UI error: the network is down — «Не вдалося» with the budget's retry and no code", async () => {
    open(api({ "GET /v1/budget/periods/2026-10/summary": "network" }));
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByRole("button", { name: "Спробувати ще раз" })).toBeTruthy();
    expect(seen(alert)).not.toContain("Код:");
  });

  it("FLW-38@PoC UI not finished: the month is not over (400 not_finished) — a note, not an error and no figures", async () => {
    open(
      api({
        "GET /v1/budget/periods/2026-10/summary": {
          status: 400,
          body: {
            type: "urn:willowsum:problem:validation_failed",
            title: "VALIDATION_FAILED",
            status: 400,
            code: "VALIDATION_FAILED",
            errors: [{ in: "path", path: "period", issue: "not_finished" }],
          },
          headers: { "content-type": "application/problem+json" },
        },
      }),
    );
    expect(await screen.findByText("Підсумок з’явиться, коли період завершиться")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(document.querySelector("[data-figure]")).toBeNull();
  });

  it("FLW-38@PoC UI before the budget start: «Бюджет ще не існував на цю дату» (404 BUDGET_PERIOD_BEFORE_START), not an error", async () => {
    open(api({ "GET /v1/budget/periods/2026-10/summary": problem(404, "BUDGET_PERIOD_BEFORE_START") }));
    expect(await screen.findByText("Бюджет ще не існував на цю дату")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("FLW-38@PoC UI long names: a 60+ character name and a word without spaces keep their text whole (the layout wraps them, the card does not grow)", async () => {
    const long = "Оплата річного членства в клубі любителів дуже довгих назв платежів у родині Синтетичних";
    const word = "Надзвичайнодовгаоднословеснаназвабезжоднихпробілівдлятеступеренесення";
    open(
      api({
        "GET /v1/recurring/payments": {
          status: 200,
          body: paymentList([long, word, ...PAYMENT_NAMES.slice(2)]),
        },
        "GET /v1/categories": {
          status: 200,
          body: {
            groups: [
              {
                id: "g",
                categories: [
                  { id: C.cafe, name: word },
                  { id: C.travel, name: long },
                  { id: C.clothes, name: "Одяг" },
                ],
              },
            ],
          },
        },
      }),
    );
    expect(await screen.findByText(long, { selector: ".per-name" })).toBeTruthy();
    expect(screen.getByText(word, { selector: ".per-name" })).toBeTruthy();
    expect(await screen.findByText(new RegExp(`^${word}:`), { selector: "strong" })).toBeTruthy();
  });

  it("FLW-38@PoC UI en: the English strings of the screen", async () => {
    open(api(), "en");
    expect(await screen.findByText(/1–31 October · period finished/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Compared with the 3-month average" })).toBeTruthy();
    expect(screen.getByText(/paid 7 of 7 · 1 late/)).toBeTruthy();
  });
});

describe("FLW-38@PoC BUD-02 FR 16: the page «Бюджет» shows the summary for a finished month", () => {
  const BUDGET = {
    budget: {
      id: "b0000000-0000-4000-8000-000000000001",
      createdOn: "2026-05-03",
      currency: "EUR",
      firstPeriod: "2026-05",
      incomePlan: eur("5500.00"),
      limits: [],
      proportional: null,
      version: 1,
    },
  };
  const periodBody = (mode: string) => ({
    period: mode === "past" ? "2026-10" : "2026-11",
    mode,
    currency: "EUR",
    approximate: { nearestRateCount: 0, unavailableCount: 0 },
    groups: [],
    incomeActual: eur("5550.00"),
    incomePlan: eur("5500.00"),
    outsidePlan: { categories: [], total: eur("0.00") },
    plannedSavings: eur("0.00"),
    proportional: null,
    totals: { limits: eur("0.00"), spent: eur("0.00"), remaining: eur("0.00") },
    summary: null,
    expectedPayments: null,
  });
  const base = {
    "GET /v1/budget": { status: 200, body: BUDGET } as Reply,
    "GET /v1/categories": { status: 200, body: tree } as Reply,
    "GET /v1/budget/compare": { status: 200, body: compare() } as Reply,
    "GET /v1/recurring/payments": { status: 200, body: paymentList() } as Reply,
  };

  it("FLW-38@PoC FR 1: October (past) shows the summary above the categories and takes «Можна витратити» and the income card out", async () => {
    const fake = fakeApi({
      ...base,
      "GET /v1/budget/periods/2026-10": { status: 200, body: periodBody("past") },
      "GET /v1/budget/periods/2026-10/summary": { status: 200, body: summary() },
    });
    renderAt("#/planning/budget?period=2026-10", fake.client);
    expect(await screen.findByText(/1–31 жовтня · період завершено/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Категорії" })).toBeTruthy();
    expect(document.querySelector("[data-plan-region='summary']")).toBeTruthy();
    expect(document.querySelector("[data-plan-region='spendable']")).toBeNull();
    expect(screen.queryByText("План доходу")).toBeNull();
  });

  it("FLW-38@PoC FR 1: the current month does not ask for the summary (it would answer not_finished)", async () => {
    const fake = fakeApi({
      ...base,
      "GET /v1/budget/periods/2026-11": { status: 200, body: periodBody("current") },
    });
    renderAt("#/planning/budget", fake.client);
    await screen.findByText("План доходу");
    expect(fake.calls.some((c) => c.path.endsWith("/summary"))).toBe(false);
    expect(document.querySelector("[data-plan-region='summary']")).toBeNull();
  });
});
