import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { contrastRatio, colors } from "@willowsum/ui";
import { installMatchMedia } from "@willowsum/ui/test-utils";
import { createAuthClient } from "../auth/api.ts";
import {
  fakeApi,
  plain,
  problem,
  renderAt,
  resetAuthState,
  SUPPORT_ID,
  type Reply,
} from "../auth/testing.tsx";
import type { Account, AccountsSummary } from "./api.ts";

/**
 * FIN-01@PoC c) and GRID-02@PoC — S-050 «Рахунки» and S-051 «Додати рахунок» on `GET /v1/accounts` and
 * `GET /v1/accounts/summary` (canvas PocMoneyAccounts, PocMoneyAccountsStale, PocMoneyAddAcc and their «Тексти»
 * boards). Synthetic accounts only.
 */
const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "accounts.css"), "utf8").replace(
  /\s+/g,
  " ",
);
const eur = (amount: string) => ({ amount, currency: "EUR" });
const uah = (amount: string) => ({ amount, currency: "UAH" });
let n = 0;
const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

function account(over: Partial<Account> & Pick<Account, "name">): Account {
  const balance = over.currencies?.[0]?.amount ?? eur("0.00");
  return {
    id: id(),
    kind: "current",
    group: "cash",
    institution: null,
    number: null,
    status: "active",
    closedOn: null,
    source: "manual",
    updatedOn: "2026-11-01",
    favourite: false,
    inProfileCurrency: { total: balance, approximate: false, unavailableCount: 0 },
    currencies: [
      {
        currency: balance.currency,
        amount: balance,
        equivalent: balance,
        rateDate: null,
        approximate: false,
        restricted: false,
      },
    ],
    creditCard: null,
    loan: null,
    ...over,
  };
}

const current = account({
  name: "Щоденний",
  institution: { name: "Ощадбанк", country: "UA" },
  number: { last4: "4417", masked: "••4417" },
});
const hryvnia = account({
  name: "Скарбничка",
  kind: "savings",
  institution: { name: "ПриватБанк", country: "UA" },
  number: { last4: "1180", masked: "••1180" },
  source: "import",
  updatedOn: "2026-10-31",
  inProfileCurrency: { total: eur("18880.00"), approximate: false, unavailableCount: 0 },
  currencies: [
    {
      currency: "UAH",
      amount: uah("829680.00"),
      equivalent: eur("18880.00"),
      rateDate: "2026-11-02",
      approximate: false,
      restricted: false,
    },
  ],
});
const multi = account({
  name: "Мультивалютний",
  institution: { name: "Wise", country: "BE" },
  inProfileCurrency: { total: eur("1094.62"), approximate: false, unavailableCount: 0 },
  currencies: [
    {
      currency: "EUR",
      amount: eur("1000.00"),
      equivalent: eur("1000.00"),
      rateDate: null,
      approximate: false,
      restricted: false,
    },
    {
      currency: "UAH",
      amount: uah("4300.00"),
      equivalent: eur("94.62"),
      rateDate: "2026-11-02",
      approximate: false,
      restricted: false,
    },
  ],
});
const card = account({
  name: "Кредитна",
  kind: "credit-card",
  group: "credit",
  number: { last4: "9021", masked: "••9021" },
  inProfileCurrency: { total: eur("-1200.00"), approximate: false, unavailableCount: 0 },
  currencies: [
    {
      currency: "EUR",
      amount: eur("-1200.00"),
      equivalent: eur("-1200.00"),
      rateDate: null,
      approximate: false,
      restricted: false,
    },
  ],
  creditCard: {
    creditLimit: eur("5000.00"),
    debt: eur("1200.00"),
    available: eur("3800.00"),
    gracePeriodDays: null,
  },
});
const mortgage = account({
  name: "Іпотека",
  kind: "loan",
  group: "credit",
  inProfileCurrency: { total: eur("-120000.00"), approximate: false, unavailableCount: 0 },
  currencies: [
    {
      currency: "EUR",
      amount: eur("-120000.00"),
      equivalent: eur("-120000.00"),
      rateDate: null,
      approximate: false,
      restricted: false,
    },
  ],
  loan: { annualRate: "4.2", monthlyPayment: eur("650.00"), debt: eur("120000.00"), termsMissing: false },
});
const closed = account({ name: "Старий", status: "closed", closedOn: "2026-09-30" });

function summary(
  over: Partial<AccountsSummary["moneyTogether"]> = {},
  credit = { card: "0.00", loan: null as string | null },
  cash: string | null = "30280.00",
): AccountsSummary {
  return {
    currency: "EUR",
    cash: { total: cash === null ? null : eur(cash), approximate: false, unavailableCount: 0 },
    moneyTogether: {
      total: eur("30280.00"),
      approximate: false,
      unavailableCount: 0,
      staleRateCount: 0,
      rate: { source: "NBU", date: "2026-11-02" },
      breakdown: [
        {
          currency: "UAH",
          amount: uah("829680.00"),
          equivalent: eur("18880.00"),
          rateDate: "2026-11-02",
          approximate: false,
          restricted: false,
          percent: 62,
        },
        {
          currency: "EUR",
          amount: eur("11400.00"),
          equivalent: eur("11400.00"),
          rateDate: null,
          approximate: false,
          restricted: false,
          percent: 38,
        },
      ],
      ...over,
    },
    credit: {
      cardDebt: { total: eur(credit.card), approximate: false, unavailableCount: 0 },
      loanDebt: {
        total: credit.loan === null ? null : eur(credit.loan),
        approximate: false,
        unavailableCount: 0,
      },
    },
    sources: { import: 1, manual: 3 },
  };
}

type Handler = Reply | ((query: string) => Reply | Promise<Reply>);

/** A fake API on the app's origin for the two reads of the page; `queries` records each list request's query. */
function api(items: Account[], sum: AccountsSummary = summary(), over: Record<string, Handler> = {}) {
  const queries: string[] = [];
  const handlers: Record<string, Handler> = {
    "/v1/accounts": (query) => ({
      status: 200,
      body: {
        items: query.includes("includeClosed=true") ? items : items.filter((a) => a.status === "active"),
        nextCursor: null,
      },
    }),
    "/v1/accounts/summary": { status: 200, body: sum },
    ...over,
  };
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    const handler = request.method === "GET" ? handlers[url.pathname] : undefined;
    if (url.pathname === "/v1/accounts") queries.push(url.search);
    const reply = typeof handler === "function" ? await handler(url.search) : handler;
    if (reply === undefined || reply === "network") return new Response(null, { status: 599 });
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
      status: reply.status,
      headers: { "content-type": "application/json", ...reply.headers },
    });
  };
  return { client: createAuthClient(fetchImpl as typeof fetch), queries };
}

const heading = () => screen.getByRole("heading", { level: 1 });
const group = (name: string) => screen.getByRole("region", { name });
const rowOf = (name: string) => screen.getByText(name).closest("tr")!;

beforeEach(() => {
  installMatchMedia({ width: 1280 });
  resetAuthState();
});

describe("FIN-01@PoC c) S-050 «Рахунки»", () => {
  it("FIN-01@PoC AC5: groups «Готівкові» and «Кредитні»; each row shows institution, currency, balance in the profile currency with the account's own amount under it, last update and source", async () => {
    renderAt("#/money/accounts", api([current, hryvnia, card]).client);
    expect(plain(heading().textContent)).toBe("Рахунки");
    await screen.findByText("Скарбничка");
    expect(within(group("Готівкові")).getAllByRole("row")).toHaveLength(3);
    expect(within(group("Кредитні")).getAllByRole("row")).toHaveLength(2);
    const cols = within(group("Готівкові"))
      .getAllByRole("columnheader")
      .map((c) => plain(c.textContent));
    expect(cols).toEqual(["Рахунок", "Тип", "Валюта", "Джерело", "Баланс, EUR", "Субрахунки"]);
    const row = rowOf("Скарбничка");
    expect(plain(row.textContent)).toContain("··1180");
    expect(plain(row.textContent)).toContain("ПриватБанк");
    const cells = within(row)
      .getAllByRole("cell")
      .map((c) => plain(c.textContent));
    expect(cells[1]).toBe("Ощадний");
    expect(cells[2]).toBe("UAH");
    expect(cells[3]).toBe("Імпорт31 жовт.");
    expect(cells[4]).toBe("18 880,00 €829 680,00 ₴");
    // An account in the profile currency shows one amount only (FR 14).
    expect(
      within(rowOf("Щоденний"))
        .getAllByRole("cell")
        .map((c) => plain(c.textContent))[4],
    ).toBe("0,00 €");
    expect(within(rowOf("Щоденний")).getAllByRole("cell")[3]!.textContent).toContain("Вручну");
  });

  it("FIN-01@PoC FR 14: no «Підключення» tab, no «Банк» source and no connection rows — accounts come by import or by hand", async () => {
    renderAt("#/money/accounts", api([current]).client);
    await screen.findByText("Щоденний");
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.queryByText(/Підключ/)).toBeNull();
    expect(screen.queryByText("Банк")).toBeNull();
  });

  it("FIN-01@PoC AC12: «Гроші разом» 30 280,00 € with «курс НБУ на 2 лист. 2026 р.», two segments and the legend «UAH 829 680,00 ₴ · ≈ 18 880,00 € · 62 %» and «EUR 11 400,00 € · 38 %»", async () => {
    renderAt("#/money/accounts", api([current, hryvnia]).client);
    const card = await screen.findByRole("region", { name: "Гроші разом" });
    await within(card).findByText(/30 280,00/);
    expect(plain(card.textContent)).toContain("курс НБУ на 2 лист. 2026 р.");
    expect(plain(within(card).getByText(/30 280,00/).textContent)).toBe("30 280,00 €");
    expect(card.querySelectorAll(".accounts-bar-part")).toHaveLength(2);
    const legend = within(card)
      .getAllByRole("listitem")
      .map((li) => plain(li.textContent));
    expect(legend).toEqual(["UAH 829 680,00 ₴≈ 18 880,00 € · 62 %", "EUR 11 400,00 €38 %"]);
  });

  it("FIN-01@PoC FR 18: the profile currency has no equivalent in the legend; without any conversion the caption names no rate", async () => {
    const onlyEur = summary({
      rate: null,
      total: eur("11400.00"),
      breakdown: [
        {
          currency: "EUR",
          amount: eur("11400.00"),
          equivalent: eur("11400.00"),
          rateDate: null,
          approximate: false,
          restricted: false,
          percent: 100,
        },
      ],
    });
    renderAt("#/money/accounts", api([current], onlyEur).client);
    const card = await screen.findByRole("region", { name: "Гроші разом" });
    await within(card).findByText(/11 400,00/, { selector: ".accounts-total" });
    expect(plain(card.textContent)).toContain("готівкові мінус кредитні · у валюті профілю EUR");
    expect(plain(card.textContent)).not.toContain("курс НБУ");
    expect(card.textContent).not.toContain("≈");
  });

  it("FIN-01@PoC EC1: no rate for today — the total and the converted amounts show «≈», and the banner names the rate's date", async () => {
    const stale = summary({
      approximate: true,
      staleRateCount: 1,
      rate: { source: "NBU", date: "2026-11-01" },
      breakdown: [
        {
          currency: "UAH",
          amount: uah("829680.00"),
          equivalent: eur("18880.00"),
          rateDate: "2026-11-01",
          approximate: true,
          restricted: false,
          percent: 62,
        },
        {
          currency: "EUR",
          amount: eur("11400.00"),
          equivalent: eur("11400.00"),
          rateDate: null,
          approximate: false,
          restricted: false,
          percent: 38,
        },
      ],
    });
    const old = { ...hryvnia, inProfileCurrency: { ...hryvnia.inProfileCurrency, approximate: true } };
    renderAt("#/money/accounts", api([old], stale).client);
    const card = await screen.findByRole("region", { name: "Гроші разом" });
    expect(plain((await within(card).findByText(/30 280,00/)).textContent)).toBe("≈ 30 280,00 €");
    expect(plain(within(rowOf("Скарбничка")).getAllByRole("cell")[4]!.textContent)).toBe(
      "≈ 18 880,00 €829 680,00 ₴",
    );
    const banner = screen.getByRole("status", { name: "" });
    expect(plain(banner.textContent)).toContain("Частина даних не оновлена");
    expect(plain(banner.textContent)).toContain(
      "Суми у валюті профілю показано за курсом на 1 лист. 2026 р.",
    );
    fireEvent.click(within(banner).getByRole("button", { name: "Закрити банер" }));
    expect(screen.queryByText("Частина даних не оновлена")).toBeNull();
  });

  it("FIN-01@PoC FR 21: «Джерела даних» counts the active accounts by «Імпорт виписок» and «Вручну»", async () => {
    renderAt("#/money/accounts", api([current]).client);
    const card = await screen.findByRole("region", { name: "Джерела даних" });
    await within(card).findByText("4 активні рахунки");
    expect(plain(card.textContent)).toContain("Імпорт виписок1 рахунок");
    expect(plain(card.textContent)).toContain("Вручну3 рахунки");
    expect(screen.queryByText("Керувати підключеннями")).toBeNull();
  });

  it("FIN-12@PoC FR 1: the «Готівкові» header shows the group's total from the API (#424) — no sum made in the browser", async () => {
    renderAt(
      "#/money/accounts",
      api([current, card], summary({ total: eur("31480.00") }, { card: "1200.00", loan: null }, "32680.00"))
        .client,
    );
    const cashGroup = await screen.findByRole("region", { name: "Готівкові" });
    await within(cashGroup).findByText("32 680,00 €", { selector: ".accounts-group-sum p" });
    cleanup();
    renderAt("#/money/accounts", api([current], summary({}, undefined, null)).client);
    const withoutRate = await screen.findByRole("region", { name: "Готівкові" });
    await within(withoutRate).findByText(/активн/);
    expect(withoutRate.querySelector(".accounts-group-sum")).toBeNull();
  });

  it("FIN-01@PoC AC13: the «Кредитні» header shows the card debt 1 200,00 €; the card's row shows the limit 5 000,00 € and 3 800,00 € available", async () => {
    renderAt("#/money/accounts", api([current, card], summary({}, { card: "1200.00", loan: null })).client);
    const credit = await screen.findByRole("region", { name: "Кредитні" });
    await within(credit).findByText("−1 200,00 €", { selector: ".accounts-group-sum p" });
    expect(plain(credit.querySelector("header")!.textContent)).toContain("заборгованість · 1 рахунок");
    expect(plain(rowOf("Кредитна").textContent)).toContain("Ліміт 5 000,00 € · доступно 3 800,00 €");
    expect(within(rowOf("Кредитна")).getAllByRole("cell")[1]!.textContent).toBe("Кредитна картка");
  });

  it("FIN-01@PoC AC18: a loan «Іпотека» sits in «Кредитні» with −120 000,00 € and «4,2 % · 650,00 € / міс.», the header adds «Кредити: −120 000,00 €»", async () => {
    renderAt("#/money/accounts", api([mortgage], summary({}, { card: "0.00", loan: "120000.00" })).client);
    const credit = await screen.findByRole("region", { name: "Кредитні" });
    const row = rowOf("Іпотека");
    expect(plain(row.textContent)).toContain("4,2 % · 650,00 € / міс.");
    expect(plain(row.textContent)).toContain("−120 000,00 €");
    expect(plain(row.textContent)).not.toContain("Ліміт");
    await within(credit).findByText("Кредити: −120 000,00 €");
  });

  it("FIN-01@PoC FR 19: the group heading is plain text — no «›» and no «Скоро»", async () => {
    renderAt("#/money/accounts", api([current, card]).client);
    const credit = await screen.findByRole("region", { name: "Кредитні" });
    const title = within(credit).getByRole("heading", { level: 2 });
    expect(plain(title.textContent)).toBe("Кредитні");
    expect(title.querySelector("a")).toBeNull();
    expect(screen.queryByText(/Скоро/)).toBeNull();
    expect(screen.queryByText("›")).toBeNull();
  });

  it("FIN-01@PoC FR 13: a multi-currency account is one row «2 валюти» in the profile currency that opens its sub-accounts, each with the equivalent and its own amount under it", async () => {
    renderAt("#/money/accounts", api([multi]).client);
    await screen.findByText("Мультивалютний");
    const row = rowOf("Мультивалютний");
    const cells = within(row)
      .getAllByRole("cell")
      .map((c) => plain(c.textContent));
    expect(cells[2]).toBe("2 валюти");
    expect(cells[4]).toBe("1 094,62 €");
    expect(screen.queryByText("Субрахунок")).toBeNull();
    const toggle = within(row).getByRole("button", { name: "Показати субрахунки" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.getAttribute("aria-label")).toBe("Сховати субрахунки");
    const subs = screen.getAllByText("Субрахунок").map((c) => c.closest("tr")!);
    expect(subs.map((r) => plain(r.textContent))).toEqual([
      "СубрахунокEUR1 000,00 €1 000,00 €",
      "СубрахунокUAH94,62 €4 300,00 ₴",
    ]);
    for (const r of subs) expect(toggle.getAttribute("aria-controls")).toContain(r.id);
  });

  it("FIN-01@PoC AC4: the list shows the multi-currency account 1 000 EUR + 4 300 UAH as one row in EUR; opening it shows 1 000 EUR and 4 300 UAH", async () => {
    renderAt("#/money/accounts", api([multi]).client);
    await screen.findByText("Мультивалютний");
    expect(screen.getAllByText("Мультивалютний")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Показати субрахунки" }));
    expect(screen.getByText("1 000,00 €", { selector: ".accounts-subrow .accounts-small" })).toBeTruthy();
    expect(screen.getByText("4 300,00 ₴", { selector: ".accounts-subrow .accounts-small" })).toBeTruthy();
  });

  it("FIN-01@PoC AC24: a credit card with a 5 000,00 € limit, 1 200,00 € debt and a 55-day grace period shows «пільговий період 55 днів» without a date; a card with no grace period shows none", async () => {
    const withGrace = account({
      ...card,
      name: "Кредитна з пільговим",
      creditCard: { ...card.creditCard!, gracePeriodDays: 55 },
    });
    const without = account({
      ...card,
      name: "Кредитна без пільгового",
      creditCard: { ...card.creditCard!, gracePeriodDays: null },
    });
    renderAt("#/money/accounts", api([withGrace, without]).client);
    const row = (await screen.findByText("Кредитна з пільговим")).closest("tr")!;
    expect(plain(row.textContent)).toContain(
      "Ліміт 5 000,00 € · доступно 3 800,00 € · пільговий період 55 днів",
    );
    expect(row.textContent).not.toMatch(/\d{1,2}[./]\d{1,2}[./]\d{2,4}|\d{4}-\d{2}-\d{2}/);
    const bare = screen.getByText("Кредитна без пільгового").closest("tr")!;
    expect(bare.textContent).not.toContain("пільговий період");
  });

  it("FIN-01@PoC AC14: an account without transactions for 120 days has no «Неактивний» mark and shows as active", async () => {
    const quiet = account({ name: "Тихий", updatedOn: "2026-07-01" });
    renderAt("#/money/accounts", api([quiet]).client);
    await screen.findByText("Тихий");
    expect(screen.queryByText(/Неактивн/)).toBeNull();
    expect(screen.queryByText("Закритий")).toBeNull();
    expect(plain(group("Готівкові").textContent)).toContain("1 активний рахунок");
  });

  it("FIN-01@PoC FR 22: closed accounts appear only through «Параметри» → «Показати закриті», marked «Закритий»", async () => {
    const { client, queries } = api([current, closed]);
    renderAt("#/money/accounts", client);
    await screen.findByText("Щоденний");
    expect(screen.queryByText("Старий")).toBeNull();
    const options = screen.getByRole("button", { name: "Параметри" });
    expect(options.getAttribute("aria-haspopup")).toBe("menu");
    fireEvent.click(options);
    const item = screen.getByRole("menuitemcheckbox", { name: "Показати закриті" });
    expect(item.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(item);
    await screen.findByText("Старий");
    expect(within(rowOf("Старий")).getByText("Закритий")).toBeTruthy();
    expect(queries.some((q) => q.includes("includeClosed=true"))).toBe(true);
    // Focus returns to the button that opened the menu (GRID-02 FR 9).
    expect(document.activeElement).toBe(options);
    fireEvent.click(options);
    expect(
      screen.getByRole("menuitemcheckbox", { name: "Показати закриті" }).getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("FIN-01@PoC «Стани інтерфейсу»: with «Показати закриті» and no closed accounts the list says «Закритих рахунків немає»", async () => {
    renderAt("#/money/accounts", api([current]).client);
    await screen.findByText("Щоденний");
    fireEvent.click(screen.getByRole("button", { name: "Параметри" }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Показати закриті" }));
    expect(await screen.findByText("Закритих рахунків немає")).toBeTruthy();
  });

  it("FIN-01@PoC FR 22: when every account is closed, «Параметри» → «Показати закриті» still reaches them", async () => {
    renderAt("#/money/accounts", api([closed], summary({ total: null, breakdown: [], rate: null })).client);
    await waitFor(() => expect(document.querySelector(".accounts-loading")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Параметри" }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Показати закриті" }));
    expect(await screen.findByText("Старий")).toBeTruthy();
    expect(within(rowOf("Старий")).getByText("Закритий")).toBeTruthy();
    // Closed accounts are not «no accounts yet».
    expect(screen.queryByText("Ще немає рахунків")).toBeNull();
  });

  it("FIN-01@PoC «Стани інтерфейсу»: loading shows the skeleton of the list", () => {
    renderAt("#/money/accounts", fakeApi({ "GET /v1/accounts": () => new Promise<Reply>(() => {}) }).client);
    expect(document.querySelector(".accounts-loading [aria-busy='true']")).not.toBeNull();
  });

  it("FIN-01@PoC «Стани інтерфейсу»: an error says «Не вдалося завантажити рахунки» with «Спробувати ще раз» and the code; retrying loads the list", async () => {
    let fail = true;
    renderAt(
      "#/money/accounts",
      api([current], summary(), {
        "/v1/accounts": () =>
          fail ? problem(500, "INTERNAL") : { status: 200, body: { items: [current], nextCursor: null } },
      }).client,
    );
    const alert = await screen.findByRole("alert");
    expect(plain(alert.textContent)).toContain("✕ Помилка");
    expect(plain(alert.textContent)).toContain("Не вдалося завантажити рахунки.");
    expect(plain(alert.textContent)).toContain(`Код: ${SUPPORT_ID}`);
    fail = false;
    fireEvent.click(within(alert).getByRole("button", { name: "Спробувати ще раз" }));
    expect(await screen.findByText("Щоденний")).toBeTruthy();
  });

  it("FIN-01@PoC «Стани інтерфейсу»: a failed «Гроші разом» keeps the rest of the page working", async () => {
    renderAt(
      "#/money/accounts",
      api([current], summary(), { "/v1/accounts/summary": problem(500, "INTERNAL") }).client,
    );
    await screen.findByText("Щоденний");
    const card = screen.getByRole("region", { name: "Гроші разом" });
    expect(plain((await within(card).findByRole("alert")).textContent)).toBe(
      "Не вдалося показати картку. Решта сторінки працює.",
    );
    expect(within(card).getByRole("button", { name: "Спробувати ще раз" })).toBeTruthy();
  });

  it("GRID-02@PoC EC1: no accounts — «Ще немає рахунків» with adding by hand or importing", async () => {
    renderAt("#/money/accounts", api([]).client);
    const empty = await screen.findByRole("region", { name: "Ще немає рахунків" });
    expect(plain(empty.textContent)).toContain("Додайте перший вручну або імпортуйте виписку.");
    expect(within(empty).getByRole("link", { name: "Імпортувати виписку" }).getAttribute("href")).toBe(
      "#/import",
    );
    fireEvent.click(within(empty).getByRole("button", { name: "Додати рахунок" }));
    expect(await screen.findByRole("dialog", { name: "Додати рахунок" })).toBeTruthy();
  });

  it("FIN-01@PoC «Права доступу»: Owner sees the accounts and balances, and «Додати рахунок» is active", async () => {
    renderAt("#/money/accounts", api([current, hryvnia]).client);
    await screen.findByText("Скарбничка");
    const add = screen.getAllByRole("button", { name: "Додати рахунок" })[0]!;
    expect(add.getAttribute("aria-disabled")).toBeNull();
  });

  it("FIN-01@PoC «Бізнес-правила»: a number with letters in its last 4 characters is masked «··AB12»; the full number is never shown", async () => {
    const iban = account({ name: "Revolut", number: { last4: "AB12", masked: "••AB12" } });
    renderAt("#/money/accounts", api([iban]).client);
    await screen.findByText("Revolut");
    expect(plain(rowOf("Revolut").textContent)).toContain("··AB12");
  });

  it("FIN-01@PoC «Стани інтерфейсу»: the error title, the banner and the muted text keep their contrast", () => {
    const ratio = (fg: keyof typeof colors, bg: keyof typeof colors) =>
      contrastRatio(colors[fg].light, colors[bg].light);
    // «✕ Помилка» on the card, the stale-rate banner, muted text on the sub-rows and on the cards.
    expect(ratio("loss", "surface-200")).toBeGreaterThanOrEqual(4.5);
    expect(ratio("on-warning", "tint-warning")).toBeGreaterThanOrEqual(4.5);
    expect(ratio("ink-muted", "surface-100")).toBeGreaterThanOrEqual(4.5);
    expect(ratio("ink-muted", "surface-200")).toBeGreaterThanOrEqual(4.5);
  });
});

describe("FIN-01@PoC S-051 «Додати рахунок»", () => {
  it("FIN-01@PoC AC16: «Додати рахунок» opens the choice: «Імпортувати виписку» («Рекомендовано») first, then «Додати вручну»; no «Підключити банк»", async () => {
    renderAt("#/money/accounts", api([current]).client);
    await screen.findByText("Щоденний");
    const opener = screen.getByRole("button", { name: "Додати рахунок" });
    opener.focus();
    fireEvent.click(opener);
    const dialog = await screen.findByRole("dialog", { name: "Додати рахунок" });
    const ways = within(dialog).getAllByRole("link");
    expect(ways.map((w) => plain(w.textContent))).toEqual([
      "Імпортувати виписку" +
        "iРекомендовано" +
        "CSV, TSV, XLSX, XLS — рахунок визначиться з файлу, транзакції додадуться разом",
      "Додати вручну" + "Готівка, депозит, кредит або банк — назва, валюта і залишок",
    ]);
    expect(within(dialog).queryByText(/Підключити банк/)).toBeNull();
    expect(ways[0]!.getAttribute("href")).toBe("#/import");
    expect(ways[1]!.getAttribute("href")).toBe("#/money/accounts/new");
    fireEvent.click(within(dialog).getByRole("button", { name: "Скасувати" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("FIN-01@PoC FR 24: «Додати вручну» opens the form «Новий рахунок»", async () => {
    renderAt("#/money/accounts", api([current]).client);
    await screen.findByText("Щоденний");
    fireEvent.click(screen.getByRole("button", { name: "Додати рахунок" }));
    const dialog = await screen.findByRole("dialog", { name: "Додати рахунок" });
    expect(within(dialog).getByRole("button", { name: "Закрити" })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("link", { name: /Додати вручну/ }));
    // S-052 opens over «Рахунки» (FIN-01@PoC c2).
    expect(await screen.findByRole("dialog", { name: "Новий рахунок" })).toBeTruthy();
    expect(plain(heading().textContent)).toBe("Рахунки");
  });
});

describe("GRID-02@PoC «Рахунки» page grid", () => {
  it("GRID-02@PoC FR 1: header, then «Гроші разом» 8 + «Джерела даних» 4, then «Готівкові» and «Кредитні» on all 12 columns", async () => {
    renderAt("#/money/accounts", api([current, card]).client);
    await screen.findByText("Кредитна");
    const grid = document.querySelector(".accounts-grid")!;
    const blocks = [...grid.children].map((c) =>
      c.className.split(" ").find((x) => x.startsWith("accounts-") && x !== "accounts-grid"),
    );
    expect(blocks).toEqual([
      "accounts-money",
      "accounts-sources",
      "accounts-toolbar",
      "accounts-group",
      "accounts-group",
    ]);
    expect(css).toContain(
      ".accounts-grid { display: grid; grid-template-columns: repeat(var(--ws-columns), minmax(0, 1fr)); gap: var(--ws-gutter);",
    );
    expect(css).toContain(".accounts-grid > * { grid-column: 1 / -1; }");
    expect(css).toMatch(
      /@media \(min-width: 1024px\) \{ \.accounts-grid > \.accounts-money \{ grid-column: span 8;[^}]*\} \.accounts-grid > \.accounts-sources \{ grid-column: span 4;/,
    );
    // No brokerage accounts in «Гроші»: only the two groups.
    expect(
      screen
        .getAllByRole("region")
        .map(
          (r) =>
            r.getAttribute("aria-labelledby") &&
            plain(document.getElementById(r.getAttribute("aria-labelledby")!)?.textContent),
        ),
    ).toEqual(["Гроші разом", "Джерела даних", "Готівкові", "Кредитні"]);
  });

  it("GRID-02@PoC FR 7: the accounts table is a stack of cards below 520 px of its container — every cell carries its column heading, the wrapper is the container", async () => {
    renderAt("#/money/accounts", api([current, card]).client);
    await screen.findByText("Кредитна");
    const table = document.querySelector<HTMLTableElement>(".accounts-table")!;
    expect(table.parentElement!.classList.contains("ws-table-wrap")).toBe(true);
    const heads = [...table.querySelectorAll("thead th:not(:has(.ws-visually-hidden))")].map((th) =>
      plain(th.textContent),
    );
    const labels = [...table.querySelectorAll("tbody tr")[0]!.querySelectorAll("td")].map((td) =>
      td.getAttribute("data-label"),
    );
    // The card's captions are the column headings, not separate strings.
    for (const head of heads.filter((h) => !h.startsWith("Баланс"))) expect(labels).toContain(head);
    expect(labels.filter((l) => l !== null && l !== "")).toHaveLength(5);
    // The threshold is the container's 520 px (519 and below), not a window media query.
    const ui = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../../../packages/ui/src/styles/components.css"),
      "utf8",
    ).replace(/\s+/g, " ");
    expect(ui).toContain(".ws-table-wrap { container-type: inline-size;");
    expect(ui).toContain("@container (max-width: 519px) { .ws-table thead {");
    expect(ui).toContain("content: attr(data-label);");
  });

  it("GRID-02@PoC FR 5: «Рахунки» has no «Підключення» tab and no tabs at all", async () => {
    renderAt("#/money/accounts", api([current]).client);
    await screen.findByText("Щоденний");
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByText("Підключення")).toBeNull();
  });

  it("GRID-02@PoC FR 14: the page names its main action — «Імпортувати виписку» and «Додати рахунок», no «+ Додати» or «…» in the header", async () => {
    renderAt("#/money/accounts", api([current]).client);
    await screen.findByText("Щоденний");
    const head = heading().closest(".accounts-head")!;
    const actions = [...head.querySelectorAll("a, button")].map((b) => plain(b.textContent));
    expect(actions).toEqual(["Імпортувати виписку", "Додати рахунок"]);
    expect(head.querySelector(".ws-button-primary")?.textContent).toBe("Додати рахунок");
  });

  it("GRID-02@PoC FR 10: the list's columns are fixed — no «Колонки» button and no «Змінити порядок»", async () => {
    renderAt("#/money/accounts", api([current]).client);
    await screen.findByText("Щоденний");
    expect(screen.queryByRole("button", { name: /Колонки/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Параметри" }));
    expect(screen.getAllByRole("menuitemcheckbox").map((i) => plain(i.textContent))).toEqual([
      "Показати закриті",
    ]);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Параметри" }));
  });
});
