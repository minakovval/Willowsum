import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { installMatchMedia } from "@willowsum/ui/test-utils";
import { fakeApi, plain, renderAt, resetAuthState, type Call, type Reply } from "../auth/testing.tsx";
import { endSession } from "../auth/session.ts";
import { resetNavigationSession } from "../routing/session.ts";
import { filteredTransactionsPath } from "./filters.ts";

/**
 * FIN-03@PoC AC21, FR 33; DAT-01@PoC FR 7; CMP-32@PoC — the filters of S-046 «Транзакції» (canvas
 * PocMoneyTxFilters, PocMoneyTxNoResults; «Тексти» PocMoneyTxTexts). The fake API filters by the `filter` values of
 * the query as the server's whitelist does (joined by AND). Synthetic data only.
 */
const ACC = "00000000-0000-4000-8000-000000000001";
const ACC2 = "00000000-0000-4000-8000-000000000002";
const ACC3 = "00000000-0000-4000-8000-000000000003";
const TAG = "00000000-0000-4000-8000-0000000000a1";
const TAG2 = "00000000-0000-4000-8000-0000000000b2";
const txId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const eur = (amount: string) => ({ amount, currency: "EUR" });

/** 30 transactions: odd ones on «Поточний», even on «Кредитна»; every third one an income; n.50 € each. */
function tx(n: number) {
  const income = n % 3 === 0;
  return {
    id: txId(n),
    accountId: n % 2 ? ACC : ACC2,
    amount: eur(income ? `${n}.50` : `-${n}.50`),
    type: income ? "income" : "expense",
    date: `2026-11-${String(n).padStart(2, "0")}`,
    counterparty: n % 5 === 0 ? `Сільпо ${n}` : `Мерчант ${n}`,
    description: null,
    status: n === 4 ? "pending" : "posted",
    source: "manual",
    hidden: false,
    split: n === 7 ? { mode: "categories", needsReview: false, parts: [] } : null,
    transfer: null,
    mergedInto: null,
    mergedDuplicates: [],
    note: null,
    tags: n === 8 ? [{ id: TAG, name: "родина" }] : [],
    review: null,
    version: 1,
    recordedAt: "2026-11-02T09:14:00Z",
  };
}
const ALL = Array.from({ length: 30 }, (_, i) => tx(i + 1));
type Tx = ReturnType<typeof tx>;

const total = (amount: string) => ({
  total: eur(amount),
  converted: false,
  approximate: false,
  nearestRateCount: 0,
  partial: false,
  noRateCount: 0,
});
const SUMMARY = {
  currency: "EUR",
  income: total("1.00"),
  expense: total("-1.00"),
  difference: total("0.00"),
};

/** One `filter` value as the server's whitelist reads it. */
function matches(t: Tx, filter: string): boolean {
  const [, field, op, value] = /^(\w+)\.(\w+):(.*)$/.exec(filter)!;
  const magnitude = Math.abs(Number(t.amount.amount));
  switch (`${field}.${op}`) {
    case "search.has":
      return t.counterparty.includes(value!);
    case "accountId.eq":
      return t.accountId === value;
    case "accountId.in":
      return value!.split(",").includes(t.accountId);
    case "type.eq":
      return (value === "in") === Number(t.amount.amount) > 0;
    case "amount.gte":
      return magnitude >= Number(value);
    case "amount.lte":
      return magnitude <= Number(value);
    case "date.gte":
      return t.date >= value!;
    case "date.lte":
      return t.date <= value!;
    case "status.eq":
      return t.status === value;
    case "split.eq":
      return (t.split !== null) === (value === "true");
    case "tag.in":
      return t.tags.some((tag) => value!.split(",").includes(tag.id));
    case "tag.eq":
      return t.tags.some((tag) => tag.id === value);
    case "counterparty.has":
      return t.counterparty.includes(value!);
    default:
      throw new Error(`unexpected filter ${filter}`);
  }
}

function listReply(_call: Call, url: URL): Reply {
  const q = url.searchParams;
  const filters = q.getAll("filter");
  const shown = ALL.filter((t) => filters.every((f) => matches(t, f)));
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
      summary: SUMMARY,
    },
  };
}

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

function open(hash = "#/money/transactions") {
  const queries: URLSearchParams[] = [];
  const handlers: Record<string, Reply | ((call: Call, url: URL) => Reply)> = {
    "GET /v1/transactions": (call, url) => {
      queries.push(url.searchParams);
      return listReply(call, url);
    },
    "GET /v1/accounts": {
      status: 200,
      body: {
        items: [
          account(ACC, "Поточний", "4417"),
          account(ACC2, "Кредитна", "9021"),
          account(ACC3, "Ощадний", "1180"),
        ],
        nextCursor: null,
      },
    },
    "GET /v1/transaction-tags": {
      status: 200,
      body: {
        items: [
          { id: TAG, name: "родина", count: 1 },
          { id: TAG2, name: "відпустка", count: 0 },
        ],
      },
    },
    "GET /v1/categories": { status: 200, body: { groups: [] } },
    "GET /v1/transaction-review": { status: 200, body: { count: 0 } },
    "GET /v1/transfer-proposals": { status: 200, body: { items: [], count: 0, more: false } },
  };
  for (const t of ALL)
    handlers[`GET /v1/transactions/${t.id}/category`] = {
      status: 200,
      body: { transactionId: t.id, categoryId: null, source: "manual" },
    };
  const api = fakeApi(handlers);
  renderAt(hash, api.client);
  return { api, lists: () => queries, lastFilters: () => queries.at(-1)?.getAll("filter") ?? [] };
}

const loaded = () =>
  waitFor(() =>
    expect(document.querySelectorAll(".ws-tx-row-table:not(.ws-tx-head)").length).toBeGreaterThan(0),
  );
const rows = () => [...document.querySelectorAll<HTMLElement>(".ws-tx-row-table:not(.ws-tx-head)")];
const toolbar = () => screen.getByRole("toolbar", { name: "Керування списком" });
const filtersButton = () => within(toolbar()).getByRole("button", { name: /^Фільтри/ });
const panel = () => screen.getByRole("dialog", { name: "Фільтри" });
const rowButton = (label: string) => within(panel()).getByRole("button", { name: new RegExp(`^${label}:`) });
const range = () => plain(document.querySelector(".ws-pagination__range")?.textContent);
const chips = () => [...document.querySelectorAll(".ws-filter-chip")].map((c) => plain(c.textContent));
const go = (hash: string) =>
  act(() => {
    window.location.hash = hash;
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });

function check(label: string, ...options: string[]) {
  fireEvent.click(rowButton(label));
  const list = screen.getByRole("listbox", { name: label });
  for (const o of options) fireEvent.click(within(list).getByRole("option", { name: o }));
  // A list of several values stays open; close it as a press elsewhere would.
  if (screen.queryByRole("listbox", { name: label })) fireEvent.keyDown(list, { key: "Escape" });
}

function typeIn(label: string, values: Record<string, string>) {
  fireEvent.click(rowButton(label));
  for (const [name, value] of Object.entries(values))
    fireEvent.change(screen.getByLabelText(name, { selector: "input" }), { target: { value } });
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
}

const apply = () => fireEvent.click(within(panel()).getByRole("button", { name: "Застосувати" }));

beforeEach(() => {
  installMatchMedia({ width: 1280 });
  localStorage.clear();
  sessionStorage.clear();
  resetNavigationSession();
  resetAuthState();
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("S-046 «Транзакції»: the filters built so far — not yet «Категорії», «Стан: можливий дубль» or several states, so the requirement items they belong to are not claimed", () => {
  it("FIN-03@PoC AC21: «Рахунки: Поточний» and «Тип: списання», then «Застосувати» — the panel closes, the list shows only such transactions and the pagination row shows their number", async () => {
    const { lastFilters } = open();
    await loaded();
    expect(range()).toBe("1–25 з 30");
    fireEvent.click(filtersButton());
    check("Рахунки", "Поточний ··4417");
    check("Тип", "Списання");
    // Nothing is applied until «Застосувати».
    expect(lastFilters()).toEqual([]);
    apply();
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(lastFilters()).toEqual([`accountId.eq:${ACC}`, "type.eq:out"]));
    // Odd and not divisible by 3 among 1–30: 10 transactions.
    await waitFor(() => expect(range()).toBe("1–10 з 10"));
    expect(rows()).toHaveLength(10);
    expect(rows().every((r) => r.textContent?.includes("Поточний ··4417"))).toBe(true);
    expect(rows().every((r) => plain(r.querySelector(".ws-row-money")?.textContent).startsWith("−"))).toBe(
      true,
    );
    expect(plain(within(toolbar()).getByRole("status").textContent)).toBe("Знайдено 10 транзакцій");
  });

  it("filter panel: one button «Фільтри» opens the panel under it with rows «підпис — випадний список» Період, Рахунки, Тип, Сума, Стан, Теги, Мерчант; unset ones say «Будь-який», «Усі» or «Будь-які» in grey; no «Умова»", async () => {
    open();
    await loaded();
    const button = filtersButton();
    expect(button.textContent).toBe("Фільтри");
    expect(button.getAttribute("aria-haspopup")).toBe("dialog");
    fireEvent.click(button);
    expect([...panel().querySelectorAll(".ws-filter-row__label")].map((l) => l.textContent)).toEqual([
      "Період",
      "Рахунки",
      "Тип",
      "Сума",
      "Стан",
      "Теги",
      "Мерчант",
    ]);
    const shown = [...panel().querySelectorAll<HTMLButtonElement>(".ws-filter-row__button")];
    expect(shown.map((b) => b.getAttribute("aria-label"))).toEqual([
      "Період: Будь-який",
      "Рахунки: Усі",
      "Тип: Списання і надходження",
      "Сума: Будь-яка",
      "Стан: Будь-який",
      "Теги: Будь-які",
      "Мерчант: Будь-який",
    ]);
    expect(shown.every((b) => b.hasAttribute("data-unset"))).toBe(true);
    expect(within(panel()).queryByText(/Умова/)).toBeNull();
    expect(
      within(panel())
        .getAllByRole("button")
        .slice(-2)
        .map((b) => b.textContent),
    ).toEqual(["Скинути все", "Застосувати"]);
  });

  it("CMP-32@PoC AC4: with «Рахунки: Поточний, Ощадний» and «Тип: списання» the button says «Фільтри · 2», the chips stand beside it with «×», the open panel shows «Поточний ··4417, Ощадний ··1180» and the unset rows in grey; «×» removes one filter", async () => {
    const { lastFilters } = open();
    await loaded();
    fireEvent.click(filtersButton());
    check("Рахунки", "Поточний ··4417", "Ощадний ··1180");
    check("Тип", "Списання");
    apply();
    await waitFor(() => expect(lastFilters()).toEqual([`accountId.in:${ACC},${ACC3}`, "type.eq:out"]));
    expect(filtersButton().textContent).toBe("Фільтри · 2");
    expect(chips()).toEqual(["Рахунки: 2", "Тип: списання"]);
    expect(
      screen.getByRole("button", { name: "Прибрати фільтр: Рахунки — Поточний ··4417, Ощадний ··1180" }),
    ).toBeTruthy();
    fireEvent.click(filtersButton());
    expect(rowButton("Рахунки").getAttribute("aria-label")).toBe("Рахунки: Поточний ··4417, Ощадний ··1180");
    expect(rowButton("Рахунки").hasAttribute("data-unset")).toBe(false);
    expect(rowButton("Сума").hasAttribute("data-unset")).toBe(true);
    fireEvent.keyDown(panel(), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Прибрати фільтр: Тип — списання" }));
    await waitFor(() => expect(lastFilters()).toEqual([`accountId.in:${ACC},${ACC3}`]));
    expect(filtersButton().textContent).toBe("Фільтри · 1");
    expect(chips()).toEqual(["Рахунки: 2"]);
  });

  it("filter panel: «Період» and «Сума» take «від» and «до» inside the drop-down, «Стан» one state, «Теги» several with check boxes, «Мерчант» a text it contains — each goes to the server's filter", async () => {
    const { lastFilters } = open();
    await loaded();
    fireEvent.click(filtersButton());
    typeIn("Період", { від: "2026-11-05", до: "2026-11-20" });
    typeIn("Сума", { від: "5,5", до: "18" });
    check("Стан", "Розділені");
    check("Теги", "родина", "відпустка");
    typeIn("Мерчант", { містить: " Мерчант " });
    apply();
    await waitFor(() =>
      expect(lastFilters()).toEqual([
        "date.gte:2026-11-05",
        "date.lte:2026-11-20",
        "amount.gte:5.5",
        "amount.lte:18",
        "split.eq:true",
        `tag.in:${TAG},${TAG2}`,
        "counterparty.has:Мерчант",
      ]),
    );
    expect(filtersButton().textContent).toBe("Фільтри · 5");
    expect(chips()).toEqual([
      "5 лист. 2026 р. – 20 лист. 2026 р.",
      "Сума: 5,5 – 18",
      "Стан: розділені",
      "Теги: 2",
      "Мерчант: Мерчант",
    ]);
    expect(
      screen
        .getAllByRole("button", { name: /^Прибрати фільтр/ })
        .map((b) => plain(b.getAttribute("aria-label"))),
    ).toContain("Прибрати фільтр: Період — 5 лист. 2026 р. – 20 лист. 2026 р.");
    // «Розділені» (n 7) and «родина» (n 8) never meet: the server joins the filters by AND.
    expect(await screen.findByRole("heading", { name: "Нічого не знайдено" })).toBeTruthy();
  });

  it("filter panel: an amount the server cannot take is not sent — «Застосувати» keeps the panel open and the field says why", async () => {
    const { lastFilters, lists } = open();
    await loaded();
    const before = lists().length;
    fireEvent.click(filtersButton());
    typeIn("Сума", { від: "10 €" });
    apply();
    expect(panel()).toBeTruthy();
    fireEvent.click(rowButton("Сума"));
    expect(plain(panel().querySelector(".ws-field-error")?.textContent)).toBe(
      "Помилка. Введіть суму числом, наприклад 25,50",
    );
    expect(lists().length).toBe(before);
    expect(lastFilters()).toEqual([]);
  });

  it("filter panel: «Скинути все» removes every filter at once; the panel closes", async () => {
    const { lastFilters } = open();
    await loaded();
    fireEvent.click(filtersButton());
    check("Рахунки", "Кредитна ··9021");
    check("Стан", "Очікує");
    apply();
    await waitFor(() => expect(lastFilters()).toEqual([`accountId.eq:${ACC2}`, "status.eq:pending"]));
    fireEvent.click(filtersButton());
    fireEvent.click(within(panel()).getByRole("button", { name: "Скинути все" }));
    await waitFor(() => expect(lastFilters()).toEqual([]));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(chips()).toEqual([]);
    expect(filtersButton().textContent).toBe("Фільтри");
  });

  it("FIN-03@PoC «Стани інтерфейсу», DAT-01@PoC «Стани інтерфейсу»: filters that match nothing show «Нічого не знайдено» and «Скинути фільтри», not the empty state of a space without transactions; the button resets the filters", async () => {
    const { lastFilters } = open();
    await loaded();
    fireEvent.click(filtersButton());
    typeIn("Мерчант", { містить: "ikea" });
    apply();
    const title = await screen.findByRole("heading", { name: "Нічого не знайдено" });
    const state = title.closest("section")!;
    expect(plain(state.textContent)).toContain(
      "Немає транзакцій за цими фільтрами. Спробуйте змінити або скинути фільтри.",
    );
    expect(screen.queryByText("Транзакцій ще немає")).toBeNull();
    expect(chips()).toEqual(["Мерчант: ikea"]);
    fireEvent.click(within(state).getByRole("button", { name: "Скинути фільтри" }));
    await waitFor(() => expect(lastFilters()).toEqual([]));
    await loaded();
    expect(chips()).toEqual([]);
  });
});

describe("FIN-03@PoC FR 33, DAT-01@PoC FR 7: filters from a link and back", () => {
  it("FIN-03@PoC FR 33, GRID-02@PoC AC10: «Усі N транзакцій рахунку» opens this page with the active filter «Рахунок: <назва>» as a chip with «×»; the link's query is dropped from the address", async () => {
    expect(filteredTransactionsPath({ account: ACC })).toBe(`/money/transactions?account=${ACC}`);
    const { lists, lastFilters } = open(`#${filteredTransactionsPath({ account: ACC })}`);
    await waitFor(() => expect(lastFilters()).toEqual([`accountId.eq:${ACC}`]));
    await waitFor(() => expect(chips()).toEqual(["Рахунок: Поточний ··4417"]));
    expect(filtersButton().textContent).toBe("Фільтри · 1");
    expect(window.location.hash).toBe("#/money/transactions");
    await waitFor(() => expect(range()).toBe("1–15 з 15"));
    // The list never showed every transaction first with the filter's chip on it.
    expect(lists().at(-1)!.getAll("filter")).toEqual([`accountId.eq:${ACC}`]);
    fireEvent.click(screen.getByRole("button", { name: "Прибрати фільтр: Рахунки — Поточний ··4417" }));
    await waitFor(() => expect(lastFilters()).toEqual([]));
  });

  it("FIN-03@PoC FR 33: «Схожі транзакції» opens this page with «Мерчант: <назва>»", async () => {
    const { lastFilters } = open(`#${filteredTransactionsPath({ merchant: "Сільпо" })}`);
    await waitFor(() => expect(lastFilters()).toEqual(["counterparty.has:Сільпо"]));
    await waitFor(() => expect(chips()).toEqual(["Мерчант: Сільпо"]));
    await waitFor(() => expect(range()).toBe("1–6 з 6"));
  });

  it("DAT-01@PoC AC1, FR 7: the user opens a record from a filtered list and comes back — the filters come back with their chips", async () => {
    const { lastFilters } = open();
    await loaded();
    fireEvent.click(filtersButton());
    check("Рахунки", "Кредитна ··9021");
    apply();
    await waitFor(() => expect(range()).toBe("1–15 з 15"));
    const row = screen.getAllByRole("link", { name: /^Мерчант 2,/ })[0]!;
    go(row.getAttribute("href")!);
    await waitFor(() => expect(screen.queryByRole("toolbar")).toBeNull());
    go("#/money/transactions");
    await waitFor(() => expect(range()).toBe("1–15 з 15"));
    expect(lastFilters()).toEqual([`accountId.eq:${ACC2}`]);
    expect(chips()).toEqual(["Рахунок: Кредитна ··9021"]);
  });

  it("ACC-04@PoC FR 2, DAT-01@PoC FR 7: the filters applied before the session ended are not kept for the next sign-in in the same tab", async () => {
    const first = open();
    await loaded();
    fireEvent.click(filtersButton());
    check("Рахунки", "Кредитна ··9021");
    apply();
    await waitFor(() => expect(first.lastFilters()).toEqual([`accountId.eq:${ACC2}`]));
    expect(sessionStorage.getItem("ws:list-state:transactions")).toContain(ACC2);
    act(() => endSession("idle"));
    cleanup();
    expect(JSON.stringify({ ...sessionStorage })).not.toContain(ACC2);
    const second = open();
    await loaded();
    expect(second.lists().every((q) => q.getAll("filter").length === 0)).toBe(true);
    expect(chips()).toEqual([]);
  });

  it("DAT-01@PoC FR 7: a stored view with filters of the wrong shape is not used — the list opens without filters", async () => {
    for (const filters of [
      { accounts: ["not-an-id"] },
      { amountFrom: "-5" },
      { dateFrom: "2026-02-30" },
      { state: "duplicate" },
      { merchant: "x".repeat(201) },
    ]) {
      const state = {
        page: 1,
        pageSize: 25,
        sort: { column: "when", direction: "desc" },
        search: "",
        filters: {
          dateFrom: "",
          dateTo: "",
          accounts: [],
          type: null,
          amountFrom: "",
          amountTo: "",
          state: null,
          tags: [],
          merchant: "",
          ...filters,
        },
      };
      sessionStorage.setItem("ws:list-state:transactions", JSON.stringify({ state, scrollY: 0 }));
      const opened = open();
      await loaded();
      expect(opened.lists()[0]!.getAll("filter")).toEqual([]);
      cleanup();
    }
  });
});
