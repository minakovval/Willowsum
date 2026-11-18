import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { cssDeclarations } from "@willowsum/ui/tokens";
import { installMatchMedia } from "@willowsum/ui/test-utils";
import {
  fakeApi,
  plain,
  problem,
  renderAt,
  resetAuthState,
  SUPPORT_ID,
  type Call,
  type Reply,
} from "../auth/testing.tsx";
import { endSession } from "../auth/session.ts";
import { resetNavigationSession } from "../routing/session.ts";

/**
 * FIN-03@PoC c) / DAT-01@PoC: S-046 «Транзакції» — the list, its toolbar, sort, pagination and states (canvas
 * PocMoneyTx, PocMoneyTxEmpty, PocMoneyTxLoading, PocMoneyTxError, PocMoneyTxNoResults; «Тексти» PocMoneyTxTexts).
 * The server pages, sorts and searches: the fake API answers by the query it receives. Synthetic data only.
 */
const ACC = "00000000-0000-4000-8000-000000000001";
const ACC2 = "00000000-0000-4000-8000-000000000002";
const FOOD = "00000000-0000-4000-8000-0000000000c1";
const TOTAL = 42;
const txId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const eur = (amount: string) => ({ amount, currency: "EUR" });

function tx(n: number, over: Record<string, unknown> = {}) {
  return {
    id: txId(n),
    accountId: n % 2 ? ACC : ACC2,
    amount: eur(n === 1 ? "3400.00" : `-${n}.50`),
    type: n === 1 ? "income" : "expense",
    date: `2026-10-${String(31 - (n % 28)).padStart(2, "0")}`,
    counterparty: `Мерчант ${n}`,
    description: null,
    status: "posted",
    source: "manual",
    hidden: false,
    split: null,
    transfer: null,
    mergedInto: null,
    mergedDuplicates: [],
    note: null,
    tags: [],
    review: null,
    version: 1,
    recordedAt: "2026-10-31T09:14:00Z",
    ...over,
  };
}
const ALL = Array.from({ length: TOTAL }, (_, i) => tx(i + 1));
ALL[0] = tx(1, {
  counterparty: "Сільпо",
  status: "pending",
  note: "чек",
  tags: [{ id: txId(900), name: "родина" }],
});
ALL[1] = tx(2, {
  split: {
    mode: "months",
    needsReview: false,
    parts: [1, 2, 3].map(() => ({ categoryId: FOOD, month: null, amount: eur("-1.00") })),
  },
});

const total = (amount: string | null, over: Record<string, unknown> = {}) => ({
  total: amount === null ? null : eur(amount),
  converted: false,
  approximate: false,
  nearestRateCount: 0,
  partial: false,
  noRateCount: 0,
  ...over,
});
const SUMMARY = {
  currency: "EUR",
  income: total("3400.00"),
  expense: total("-1015.30"),
  difference: total("2384.70"),
};

const account = (id: string, name: string, last4: string) => ({
  id,
  kind: "current",
  group: "cash",
  name,
  institution: null,
  number: { last4, masked: `••${last4}` },
  status: "active",
  closedOn: null,
  source: "manual",
  updatedOn: "2026-11-02",
  favourite: false,
  inProfileCurrency: { total: eur("1.00"), approximate: false, unavailableCount: 0 },
  currencies: [],
  creditCard: null,
  loan: null,
});
const GROUPS = [
  {
    id: "g1",
    systemKey: null,
    kind: "expense",
    name: "Харчування",
    renamed: false,
    tone: "#5872D2",
    categories: [
      {
        id: FOOD,
        groupId: "g1",
        systemKey: null,
        kind: "expense",
        name: "Продукти",
        renamed: false,
        icon: "budget",
        color: "#5872D2",
        iconTone: "white",
        essential: null,
        hidden: false,
        deletable: true,
      },
    ],
  },
];

type Handlers = Record<string, Reply | ((call: Call, url: URL) => Reply | Promise<Reply>)>;

/** The list answers by `page`, `pageSize` and `filter=search.has:` of the query, as the server does. */
function listReply(rows: readonly ReturnType<typeof tx>[], summary = SUMMARY) {
  return (_call: Call, url: URL): Reply => {
    const q = url.searchParams;
    const search = (q.get("filter") ?? "").replace(/^search\.has:/, "");
    const shown = search ? rows.filter((r) => r.counterparty.includes(search)) : rows;
    const page = Number(q.get("page") ?? "1");
    const size = Number(q.get("pageSize") ?? "25");
    const items = shown.slice((page - 1) * size, page * size);
    return {
      status: 200,
      body: {
        items,
        page,
        pageSize: size,
        count: shown.length,
        from: items.length ? (page - 1) * size + 1 : 0,
        to: (page - 1) * size + items.length,
        summary,
      },
    };
  };
}

function handlers(rows: readonly ReturnType<typeof tx>[] = ALL, over: Handlers = {}): Handlers {
  const out: Handlers = {
    "GET /v1/transactions": listReply(rows),
    "GET /v1/accounts": {
      status: 200,
      body: {
        items: [account(ACC, "Поточний", "4417"), account(ACC2, "Кредитна", "9021")],
        nextCursor: null,
      },
    },
    "GET /v1/categories": { status: 200, body: { groups: GROUPS } },
    "GET /v1/transaction-review": { status: 200, body: { count: 0 } },
    "GET /v1/transfer-proposals": { status: 200, body: { items: [], count: 0, more: false } },
    "GET /v1/merchants": { status: 200, body: { items: [] } },
  };
  for (const r of rows)
    out[`GET /v1/transactions/${r.id}/category`] = {
      status: 200,
      body: { transactionId: r.id, categoryId: r.id === txId(1) ? null : FOOD, source: "manual" },
    };
  return { ...out, ...over };
}

function open(h: Handlers = handlers()) {
  // The query of each list request, in order (the fake API's calls keep the path only).
  const queries: URLSearchParams[] = [];
  const list = h["GET /v1/transactions"];
  const api = fakeApi({
    ...h,
    "GET /v1/transactions": (call: Call, url: URL) => {
      queries.push(url.searchParams);
      return typeof list === "function" ? list(call, url) : list!;
    },
  });
  renderAt("#/money/transactions", api.client);
  const lists = () => queries;
  const lastQuery = () => queries.at(-1) ?? new URLSearchParams();
  return { api, lists, lastQuery };
}

const table = () => document.querySelector<HTMLElement>(".tx-table")!;
const loaded = () =>
  waitFor(() => expect(screen.getAllByRole("link", { name: /^Мерчант 3,/ }).length).toBe(1));
const toolbar = () => screen.getByRole("toolbar", { name: "Керування списком" });
const headButtons = () => [...table().querySelectorAll<HTMLButtonElement>(".ws-tx-sort")];
const headButton = (name: string) => headButtons().find((b) => b.textContent?.startsWith(name))!;
const go = (hash: string) =>
  act(() => {
    window.location.hash = hash;
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });

beforeEach(() => {
  installMatchMedia({ width: 1280 });
  localStorage.clear();
  sessionStorage.clear();
  resetNavigationSession();
  resetAuthState();
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("FIN-03@PoC c): the table of «Транзакції» (S-046)", () => {
  it("FIN-03@PoC AC13, DS-04@PoC FR 8: columns «Контрагент, Категорія, Рахунок, Дата і час, Сума», newest first by «Дата і час» (highlighted with its arrow), the other sortable columns with the grey double arrow, no grouping by days and no sort menu", async () => {
    const { lastQuery } = open();
    await loaded();
    const head = table().querySelector(".ws-tx-head")!;
    // The columns; the first cell is the «Вибрати сторінку» checkbox of the selection mode (DAT-03@PoC FR 1).
    const columns = [...head.children].filter((c) => !c.matches(".ws-row-check"));
    expect(columns.map((c) => c.textContent?.replace(/,.*$/, ""))).toEqual([
      "Контрагент",
      "Категорія",
      "Рахунок",
      "Дата і час",
      "Сума",
    ]);
    expect(lastQuery().get("sort")).toBe("-date");
    expect(headButton("Дата і час").dataset.sort).toBe("desc");
    expect(headButton("Дата і час").textContent).toContain("за спаданням");
    expect(headButton("Дата і час").title).toBe("Сортувати за: дата і час");
    expect(headButton("Контрагент").dataset.sort).toBe("none");
    expect(headButton("Сума").dataset.sort).toBe("none");
    // «Категорія» and «Рахунок» are not in the server's sort whitelist: plain headers, no arrow.
    expect(headButtons().map((b) => b.textContent?.replace(/,.*$/, ""))).toEqual([
      "Контрагент",
      "Дата і час",
      "Сума",
    ]);
    expect(table().querySelectorAll(".ws-tx-row-table:not(.ws-tx-head)").length).toBe(25);
    expect(table().querySelector("h2, h3, [role='heading']")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Сортувати$/ })).toBeNull();
  });

  it("FIN-03@PoC FR 13: a row shows the counterparty with its marks, the category chip («Без категорії» dashed), the account «Поточний ··4417», the date with the time under it and the signed amount on the right", async () => {
    open();
    await loaded();
    const first = screen.getByRole("link", { name: /^Сільпо,/ });
    const row = first.closest<HTMLElement>(".ws-tx-row")!;
    expect(row.classList.contains("ws-tx-row-noasset")).toBe(true);
    expect(row.querySelector(".ws-tx-category-none")?.textContent).toBe("Без категорії");
    expect(row.textContent).toContain("Поточний ··4417");
    expect(row.querySelector(".ws-tx-when")?.children.length).toBe(2);
    expect(plain(row.querySelector(".ws-row-money")?.textContent)).toContain("3 400,00 €");
    const name = first.getAttribute("aria-label")!;
    expect(name).toContain("Очікує");
    expect(name).toContain("Теги: родина");
    expect(name).toContain("є нотатка");
    expect(first.getAttribute("href")).toBe(`#/money/transactions/${txId(1)}`);
    const split = screen.getByRole("link", { name: /^Мерчант 2,/ });
    expect(plain(split.getAttribute("aria-label"))).toContain("розділено на 3 міс.");
    expect(split.closest(".ws-tx-row")!.textContent).toContain("Продукти");
    expect(split.closest(".ws-tx-row")!.textContent).toContain("Кредитна ··9021");
  });

  it("DAT-01@PoC FR 3: a press on a header sorts by it ascending, the next press descending; the arrow follows", async () => {
    const { lastQuery } = open();
    await loaded();
    act(() => headButton("Контрагент").click());
    await waitFor(() => expect(lastQuery().get("sort")).toBe("counterparty"));
    expect(headButton("Контрагент").dataset.sort).toBe("asc");
    expect(headButton("Контрагент").textContent).toContain("за зростанням");
    expect(headButton("Дата і час").dataset.sort).toBe("none");
    act(() => headButton("Контрагент").click());
    await waitFor(() => expect(lastQuery().get("sort")).toBe("-counterparty"));
    expect(headButton("Контрагент").dataset.sort).toBe("desc");
    act(() => headButton("Сума").click());
    await waitFor(() => expect(lastQuery().get("sort")).toBe("amount"));
  });

  it("FIN-03@PoC AC14: 42 transactions, 25 a page — one block right under the table «Рядків на сторінці 25 ˅ · 1–25 з 42 ‹ ›», «‹» unavailable; «›» opens «26–42 з 42»", async () => {
    const { lastQuery } = open();
    await loaded();
    const nav = screen.getByRole("navigation", { name: "Сторінки списку" });
    expect(screen.getAllByRole("navigation", { name: "Сторінки списку" }).length).toBe(1);
    expect(table().compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(plain(nav.textContent)).toContain("Рядків на сторінці");
    expect(plain(nav.querySelector(".ws-pagination__range")?.textContent)).toBe("1–25 з 42");
    expect((within(nav).getByRole("combobox") as HTMLSelectElement).value).toBe("25");
    expect(
      within(nav).getByRole("button", { name: "Попередня сторінка" }).getAttribute("aria-disabled"),
    ).toBe("true");
    act(() => within(nav).getByRole("button", { name: "Наступна сторінка" }).click());
    await waitFor(() =>
      expect(plain(nav.querySelector(".ws-pagination__range")?.textContent)).toBe("26–42 з 42"),
    );
    expect(lastQuery().get("page")).toBe("2");
    expect(table().querySelectorAll(".ws-tx-row-table:not(.ws-tx-head)").length).toBe(17);
  });

  it("DAT-01@PoC FR 5: the page, its size, the sort and the search go to the server; the table shows what it returned, the count from it", async () => {
    const { lastQuery, lists } = open();
    await loaded();
    expect(Object.fromEntries(lastQuery())).toEqual({ page: "1", pageSize: "25", sort: "-date" });
    const nav = screen.getByRole("navigation", { name: "Сторінки списку" });
    act(() => {
      fireEvent.change(within(nav).getByRole("combobox"), { target: { value: "50" } });
    });
    await waitFor(() => expect(lastQuery().get("pageSize")).toBe("50"));
    await waitFor(() =>
      expect(table().querySelectorAll(".ws-tx-row-table:not(.ws-tx-head)").length).toBe(42),
    );
    const before = lists().length;
    fireEvent.change(within(toolbar()).getByRole("searchbox", { name: "Пошук транзакцій" }), {
      target: { value: "Сільпо" },
    });
    await waitFor(() => expect(lastQuery().get("filter")).toBe("search.has:Сільпо"));
    expect(lastQuery().get("page")).toBe("1");
    expect(lists().length).toBe(before + 1);
    await waitFor(() => expect(table().querySelectorAll(".ws-tx-row-table:not(.ws-tx-head)").length).toBe(1));
    expect(plain(screen.getByRole("toolbar").querySelector('[role="status"]')?.textContent)).toBe(
      "Знайдено 1 транзакцію",
    );
  });

  it("DAT-01@PoC AC1, FR 7: on page 2 with a search and a sort, the user opens a record and comes back — the page, the scroll position, the search and the sort are restored", async () => {
    const { lastQuery } = open();
    await loaded();
    fireEvent.change(within(toolbar()).getByRole("searchbox"), { target: { value: "Мерчант" } });
    await waitFor(() => expect(lastQuery().get("filter")).toBe("search.has:Мерчант"));
    act(() => headButton("Сума").click());
    await waitFor(() => expect(lastQuery().get("sort")).toBe("amount"));
    const nav = () => screen.getByRole("navigation", { name: "Сторінки списку" });
    await waitFor(() =>
      expect(
        within(nav()).getByRole("button", { name: "Наступна сторінка" }).getAttribute("aria-disabled"),
      ).not.toBe("true"),
    );
    act(() => within(nav()).getByRole("button", { name: "Наступна сторінка" }).click());
    await waitFor(() => expect(lastQuery().get("page")).toBe("2"));
    Object.defineProperty(window, "scrollY", { configurable: true, value: 840 });
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });
    const row = await screen.findByRole("link", { name: /^Мерчант 30,/ });
    go(row.getAttribute("href")!);
    await waitFor(() => expect(screen.queryByRole("toolbar")).toBeNull());
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Транзакція");
    Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
    const scrolled = vi.mocked(window.scrollTo);
    scrolled.mockClear();
    go("#/money/transactions");
    await waitFor(() => expect(screen.getByRole("link", { name: /^Мерчант 30,/ })).toBeTruthy());
    expect(lastQuery().get("page")).toBe("2");
    expect(lastQuery().get("sort")).toBe("amount");
    expect(lastQuery().get("filter")).toBe("search.has:Мерчант");
    expect((within(toolbar()).getByRole("searchbox") as HTMLInputElement).value).toBe("Мерчант");
    expect(headButton("Сума").dataset.sort).toBe("asc");
    expect(plain(nav().querySelector(".ws-pagination__range")?.textContent)).toBe("26–41 з 41");
    await waitFor(() => expect(scrolled).toHaveBeenLastCalledWith(0, 840));
    Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
  });

  it("ACC-04@PoC FR 2, DAT-01@PoC FR 7: the search typed before the session ended is not kept for the next sign-in in the same tab", async () => {
    const first = open();
    await loaded();
    fireEvent.change(within(toolbar()).getByRole("searchbox"), { target: { value: "Мерчант 3" } });
    await waitFor(() => expect(first.lastQuery().get("filter")).toBe("search.has:Мерчант 3"));
    expect(sessionStorage.getItem("ws:list-state:transactions")).toContain("Мерчант 3");
    // The session ends (15 min idle): the sign-in screen replaces the page.
    act(() => endSession("idle"));
    cleanup();
    expect(JSON.stringify({ ...sessionStorage })).not.toContain("Мерчант 3");
    // The next person signs in in the same tab and opens «Транзакції».
    const second = open();
    await loaded();
    expect((within(toolbar()).getByRole("searchbox") as HTMLInputElement).value).toBe("");
    expect(second.lists().every((q) => q.get("filter") === null)).toBe(true);
  });

  it("CMP-60@PoC AC2: the sort chosen comes back with this list only — another list's saved state is untouched", async () => {
    sessionStorage.setItem("ws:list-state:accounts", '{"state":{"page":3},"scrollY":0}');
    const first = open();
    await loaded();
    act(() => headButton("Контрагент").click());
    await waitFor(() => expect(first.lastQuery().get("sort")).toBe("counterparty"));
    go("#/money/accounts");
    go("#/money/transactions");
    await waitFor(() => expect(headButton("Контрагент").dataset.sort).toBe("asc"));
    expect(sessionStorage.getItem("ws:list-state:accounts")).toBe('{"state":{"page":3},"scrollY":0}');
  });

  it("DAT-01@PoC FR 7: a stored view of the wrong shape is not used — the list opens on page 1, 25 rows, newest first, no search", async () => {
    for (const state of [
      { page: 0, pageSize: 25, sort: { column: "when", direction: "desc" }, search: "" },
      { page: 2, pageSize: 40, sort: { column: "when", direction: "desc" }, search: "" },
      { page: 2, pageSize: 50, sort: { column: "category", direction: "asc" }, search: "" },
      { page: 2, pageSize: 50, sort: { column: "when", direction: "up" }, search: "" },
      { page: 2, pageSize: 50, sort: { column: "when", direction: "desc" }, search: "x".repeat(201) },
      { page: "2", pageSize: 50 },
      "page 2",
    ]) {
      sessionStorage.setItem("ws:list-state:transactions", JSON.stringify({ state, scrollY: 0 }));
      const opened = open();
      await loaded();
      const q = opened.lists()[0]!;
      expect([q.get("page"), q.get("pageSize"), q.get("sort"), q.get("filter")]).toEqual([
        "1",
        "25",
        "-date",
        null,
      ]);
      expect(screen.queryByRole("alert")).toBeNull();
      cleanup();
    }
  });

  it("DAT-01@PoC FR 2: one view — a table; no «Картки / Таблиця» switch", async () => {
    open();
    await loaded();
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.queryByRole("button", { name: /Картки|Таблиця/ })).toBeNull();
    expect(screen.queryByRole("tab", { name: /Картки|Таблиця/ })).toBeNull();
    expect(table().querySelector(".ws-tx-head")).toBeTruthy();
  });

  it("DAT-01@PoC FR 8, FR 10, GRID-02@PoC FR 11, AC6: the columns are fixed by the list — its own set, no «Колонки» button and no column choice; «Параметри» is not shown while it has no item (CMP-60@PoC «Стани»)", async () => {
    open();
    await loaded();
    const head = table().querySelector(".ws-tx-head")!;
    expect(
      [...head.children]
        .filter((c) => !c.matches(".ws-row-check"))
        .map((c) => c.textContent?.replace(/,.*$/, "")),
    ).toEqual(["Контрагент", "Категорія", "Рахунок", "Дата і час", "Сума"]);
    expect(screen.queryByRole("button", { name: "Колонки" })).toBeNull();
    expect(within(toolbar()).queryByRole("button", { name: "Параметри" })).toBeNull();
    expect(screen.queryByText(/Колонк/)).toBeNull();
    expect(screen.queryByText("Показати оригінальні валюти")).toBeNull();
    expect(screen.queryByText(/Створити звіт/)).toBeNull();
  });
});

describe("FIN-03@PoC c): header, tabs and toolbar", () => {
  it("FIN-03@PoC AC22: «Історія імпорту» beside «Імпортувати виписку» opens «Імпорт», not the import wizard", async () => {
    open();
    await loaded();
    const header = screen.getByRole("heading", { level: 1, name: "Транзакції" }).parentElement!;
    const link = within(header).getByRole("link", { name: "Історія імпорту" });
    const actions = [...header.querySelectorAll("a, button")].map((el) => el.textContent);
    expect(actions.indexOf("Історія імпорту")).toBe(actions.indexOf("Імпортувати виписку") + 1);
    go(link.getAttribute("href")!);
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Імпорт"));
    expect(window.location.hash).toBe("#/money/transactions/import");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("FIN-03@PoC AC16, FR 25: with 0 in «До розбору» the tab has its name only and the totals have no such chip; with 5 it reads «До розбору · 5» and opens the queue", async () => {
    open();
    await loaded();
    const tabs = screen.getByRole("tablist", { name: "Розділи транзакцій" });
    expect(
      within(tabs)
        .getAllByRole("tab")
        .map((t) => t.textContent),
    ).toEqual(["Транзакції", "До розбору", "Пари"]);
    expect(document.querySelector(".tx-totals")!.textContent).not.toContain("До розбору");
    cleanup();
    const h = handlers(ALL, {
      "GET /v1/transaction-review": { status: 200, body: { count: 5 } },
      "GET /v1/transfer-proposals": { status: 200, body: { items: [], count: 3, more: false } },
    });
    open(h);
    await loaded();
    const review = await screen.findByRole("tab", { name: "До розбору · 5" });
    expect(screen.getByRole("tab", { name: "Пари · 3" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Транзакції" }).getAttribute("aria-selected")).toBe("true");
    go(review.getAttribute("href")!);
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "До розбору · 5" }).getAttribute("aria-selected")).toBe("true"),
    );
    expect(window.location.hash).toBe("#/money/transactions/review");
    expect(screen.queryByRole("toolbar")).toBeNull();
  });

  it("FIN-03@PoC FR 13: one row above the table holds the search «Пошук за мерчантом, описом»; no «Колонки», no «Картки / Таблиця»; the page header has the «…» of «Правила категорій» only (BUD-14@PoC FR 4)", async () => {
    open();
    await loaded();
    const bar = toolbar();
    expect(bar.compareDocumentPosition(table()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(bar).getByRole("searchbox", { name: "Пошук транзакцій" }).getAttribute("placeholder")).toBe(
      "Пошук за мерчантом, описом",
    );
    expect(within(bar).queryByRole("button", { name: "Колонки" })).toBeNull();
    expect(within(bar).queryByRole("radiogroup")).toBeNull();
    const header = screen.getByRole("heading", { level: 1 }).parentElement!;
    // BUD-14@PoC FR 4: the «…» of the header holds one item, «Правила категорій» (S-197).
    expect(within(header).getAllByRole("button", { name: "Ще дії" })).toHaveLength(1);
  });

  it("DAT-01@PoC FR 5: the search takes at most the 200 characters the server accepts, so a long paste still gets a list, not the error state", async () => {
    const first = open();
    await loaded();
    const search = within(toolbar()).getByRole("searchbox") as HTMLInputElement;
    expect(search.maxLength).toBe(200);
    fireEvent.change(search, { target: { value: "Мерчант 3" + "x".repeat(300) } });
    await waitFor(() => expect(first.lastQuery().get("filter")).toMatch(/^search\.has:Мерчант 3x+$/));
    expect(first.lastQuery().get("filter")!.length).toBe("search.has:".length + 200);
    await waitFor(() => expect(screen.getByText("Нічого не знайдено")).toBeTruthy());
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("FIN-03@PoC c): the totals and the states of the list", () => {
  it("DAT-01@PoC FR 12: «Надходження», «Списання», «Різниця» in the profile currency with signs; converted totals say so, approximate ones say «приблизно» and how many went at the nearest rate, partial ones «без N записів: немає курсу»", async () => {
    const summary = {
      currency: "EUR",
      income: total("3400.00", { converted: true }),
      expense: total("-165.00", { converted: true, approximate: true, nearestRateCount: 1 }),
      difference: total("3235.00", {
        converted: true,
        approximate: true,
        nearestRateCount: 1,
        partial: true,
        noRateCount: 2,
      }),
    };
    open(handlers(ALL, { "GET /v1/transactions": listReply(ALL, summary) }));
    await loaded();
    const totals = screen.getByRole("group", { name: "Підсумки списку" });
    expect(plain(totals.textContent)).toBe(
      "Надходження +3 400,00 €Списання −165,00 €Різниця +3 235,00 €конвертовано · у EUR за курсом на дату операціїприблизно · 1 транзакція за найближчим курсом · без 2 записів: немає курсу",
    );
  });

  it("DAT-01@PoC FR 12: no rate for any record — no total, only the mark", async () => {
    const none = total(null, { partial: true, noRateCount: 1 });
    const summary = { currency: "EUR", income: none, expense: none, difference: none };
    open(handlers(ALL, { "GET /v1/transactions": listReply(ALL, summary) }));
    await loaded();
    const totals = screen.getByRole("group", { name: "Підсумки списку" });
    expect(totals.textContent).not.toMatch(/€/);
    expect(plain(totals.textContent)).toContain("без 1 запису: немає курсу");
  });

  it("FIN-03@PoC AC19: a space without transactions — «Транзакцій ще немає» with «Імпортувати виписку» and «Додати вручну», which opens «Нова транзакція»", async () => {
    open(handlers([]));
    const empty = await screen.findByRole("region", { name: "Транзакцій ще немає" });
    expect(
      within(empty)
        .getAllByRole("link")
        .map((l) => l.textContent),
    ).toEqual(["Імпортувати виписку"]);
    expect(within(empty).getByRole("link", { name: "Імпортувати виписку" }).getAttribute("href")).toBe(
      "#/import",
    );
    expect(screen.queryByRole("toolbar")).toBeNull();
    act(() => within(empty).getByRole("button", { name: "Додати вручну" }).click());
    expect(screen.getByRole("dialog", { name: "Нова транзакція" })).toBeTruthy();
  });

  it("FIN-03@PoC «Стани інтерфейсу»: nothing found — «Нічого не знайдено» and «Скинути фільтри», which brings the whole list back", async () => {
    const { lastQuery } = open();
    await loaded();
    fireEvent.change(within(toolbar()).getByRole("searchbox"), { target: { value: "ikea" } });
    const none = await screen.findByRole("region", { name: "Нічого не знайдено" });
    expect(none.textContent).toContain("Немає транзакцій «ikea». Спробуйте змінити або скинути фільтри.");
    expect(screen.getByRole("toolbar")).toBeTruthy();
    act(() => within(none).getByRole("button", { name: "Скинути фільтри" }).click());
    await waitFor(() => expect(lastQuery().get("filter")).toBeNull());
    await loaded();
    expect((within(toolbar()).getByRole("searchbox") as HTMLInputElement).value).toBe("");
  });

  it("FIN-03@PoC «Стани інтерфейсу»: loading — skeleton rows under the toolbar, no spinner; an error — «Не вдалося завантажити транзакції», «Спробувати ще раз» and the support code, and the retry loads again", async () => {
    let answer: Reply | null = null;
    let release: (r: Reply) => void = () => undefined;
    const h = handlers(ALL, {
      "GET /v1/transactions": () =>
        answer ??
        new Promise<Reply>((resolve) => {
          release = resolve;
        }),
    });
    open(h);
    await waitFor(() =>
      expect(document.querySelector(".tx-table .ws-skeleton, .tx-table [aria-busy='true']")).toBeTruthy(),
    );
    expect(screen.getByRole("toolbar")).toBeTruthy();
    expect(document.querySelector("[role='progressbar']")).toBeNull();
    await act(async () => release(problem(500, "INTERNAL")));
    const error = await screen.findByRole("alert");
    expect(error.textContent).toContain("✕ Помилка");
    expect(error.textContent).toContain(
      "Не вдалося завантажити транзакції. Перевірте з’єднання та спробуйте ще раз.",
    );
    expect(error.textContent).toContain(`Код: ${SUPPORT_ID}`);
    answer = listReply(ALL)(
      { method: "GET", path: "/v1/transactions", origin: "", body: undefined },
      new URL("http://localhost/v1/transactions"),
    );
    act(() => within(error).getByRole("button", { name: "Спробувати ще раз" }).click());
    await loaded();
  });
});

describe("GRID-02@PoC the table of «Транзакції» on narrow containers", () => {
  it("GRID-02@PoC FR 7, AC2: the table is the container of its rows, and below 520 px of that container a row is a card — the header leaves the layout, the row wraps, nothing scrolls sideways", async () => {
    open();
    await loaded();
    expect(table().classList.contains("ws-tx-table")).toBe(true);
    const dir = dirname(fileURLToPath(import.meta.url));
    const ui = readFileSync(join(dir, "../../../../packages/ui/src/styles/components.css"), "utf8").replace(
      /\s+/g,
      " ",
    );
    expect(ui).toContain(".ws-tx-table { container-type: inline-size;");
    const narrow = ui.slice(ui.indexOf("@container (max-width: 519px) { .ws-tx-table .ws-tx-head {"));
    expect(narrow).toContain(
      ".ws-tx-table .ws-tx-row-table.ws-tx-row-table { display: flex; flex-wrap: wrap;",
    );
    // The threshold is the container's, not a window media query; the wide form still has its fixed columns.
    expect(ui).not.toMatch(/@media \(max-width: 5\d\d px\) \{ \.ws-tx-/);
    expect(table().style.overflowX).toBe("");
    expect(readFileSync(join(dir, "transactions.css"), "utf8").match(/\.tx-table \{[^}]*\}/)![0]).toContain(
      "overflow: hidden",
    );
  });
});

describe("GRID-02@PoC the «Гроші» section: root, menu and tabs", () => {
  const navPages = () =>
    [...document.querySelectorAll(".ws-nav-page")].map((e) => e.querySelector(".ws-nav-label")!.textContent);

  it("GRID-02@PoC FR 12, FR 13, AC5, AC8: the section opens «Транзакції»; with 0 in the queue and 2 pair proposals the menu has «Транзакції» (no counter) and «Рахунки», the tabs «Транзакції», «До розбору» and «Пари · 2»", async () => {
    const h = handlers(ALL, {
      "GET /v1/transfer-proposals": { status: 200, body: { items: [], count: 2, more: false } },
    });
    const api = fakeApi(h);
    renderAt("#/money", api.client);
    // Entering the section for the first time in the session opens its root.
    expect(window.location.hash).toBe("#/money/transactions");
    await loaded();
    expect(navPages()).toEqual(["Транзакції", "Рахунки"]);
    expect(document.querySelector(".ws-nav-page .ws-nav-badge")).toBeNull();
    const tabs = within(screen.getByRole("tablist", { name: "Розділи транзакцій" })).getAllByRole("tab");
    await waitFor(() =>
      expect(tabs.map((t) => t.textContent)).toEqual(["Транзакції", "До розбору", "Пари · 2"]),
    );
  });

  it("GRID-02@PoC FR 12, FR 13, AC5: with 5 in the queue the counter «5» is beside «Транзакції» and in the tab; the badge is plain muted text, never amber", async () => {
    const h = handlers(ALL, { "GET /v1/transaction-review": { status: 200, body: { count: 5 } } });
    open(h);
    await loaded();
    const link = await screen.findByRole("link", { name: /^Транзакції,\s5\sдо\sрозбору$/ });
    expect(link.querySelector(".ws-nav-badge")!.textContent).toBe("5");
    expect(screen.getByRole("tab", { name: "До розбору · 5" })).toBeTruthy();
    const dir = dirname(fileURLToPath(import.meta.url));
    const shell = cssDeclarations(
      readFileSync(join(dir, "../../../../packages/ui/src/styles/shell.css"), "utf8"),
    );
    const badge = shell.filter((d) => d.selector === ".ws-nav-badge" && d.atRules.length === 0);
    expect(badge.find((d) => d.property === "color")?.value).toBe("var(--ws-ink-muted)");
    expect(badge.some((d) => d.value.includes("accent"))).toBe(false);
    expect(badge.some((d) => d.property === "background" || d.property === "border")).toBe(false);
  });
});
