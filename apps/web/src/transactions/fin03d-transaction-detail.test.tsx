import { act, screen, waitFor, within } from "@testing-library/react";
import { installMatchMedia } from "@willowsum/ui/test-utils";
import {
  fakeApi,
  plain,
  problem,
  renderAt,
  resetAuthState,
  SUPPORT_ID,
  type Reply,
} from "../auth/testing.tsx";
import { resetNavigationSession } from "../routing/session.ts";

/**
 * FIN-03@PoC d): S-047 «Деталь транзакції» with the menu «…» and «Історія змін» (canvas PocMoneyTxDetail,
 * PocMoneyTxDetailNoReceipt; «Тексти» PocMoneyTxDetailTexts). Synthetic data only.
 */
const ACC = "00000000-0000-4000-8000-000000000001";
const FOOD = "00000000-0000-4000-8000-0000000000c1";
const TX = "00000000-0000-4000-8000-0000000000aa";
const OTHER = "00000000-0000-4000-8000-0000000000bb";
const DETAIL = `#/money/transactions/${TX}`;
const HISTORY = `${DETAIL}/history`;

/**
 * «Історія змін» is a page of its own (CMP-21@PoC «Призначення»: much content is a separate page; a modal never
 * scrolls): no dialog, its own heading, breadcrumbs up to the transaction and a link back to it.
 */
async function historyPage() {
  await pick("Історія змін");
  await waitFor(() => expect(window.location.hash).toBe(HISTORY));
  await waitFor(() => expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Історія змін"));
  expect(screen.queryByRole("dialog")).toBeNull();
  const crumbs = screen.getByRole("navigation", { name: "Хлібні крихти" });
  expect(within(crumbs).getByRole("link", { name: "Сільпо" }).getAttribute("href")).toBe(DETAIL);
  return screen.getByRole("heading", { level: 1 }).closest<HTMLElement>("section")!;
}

function tx(over: Record<string, unknown> = {}) {
  return {
    id: TX,
    accountId: ACC,
    amount: { amount: "-42.80", currency: "EUR" },
    type: "expense",
    date: "2026-11-02",
    counterparty: "Сільпо",
    description: "Продукти на тиждень",
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
    recordedAt: "2026-11-02T09:14:00Z",
    ...over,
  };
}

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

const ACCOUNT = {
  id: ACC,
  kind: "current",
  group: "cash",
  name: "Поточний",
  institution: null,
  number: { last4: "4417", masked: "••4417" },
  status: "active",
  closedOn: null,
  source: "manual",
  updatedOn: "2026-11-02",
  favourite: false,
  inProfileCurrency: { total: { amount: "1.00", currency: "EUR" }, approximate: false, unavailableCount: 0 },
  currencies: [],
  creditCard: null,
  loan: null,
};

const side = (transactionId: string) => ({
  transactionId,
  accountId: ACC,
  amount: { amount: "-42.80", currency: "EUR" },
  date: "2026-11-02",
});
const PAIR = { first: side(TX), second: side(OTHER) };

type Handlers = Record<string, Reply | (() => Reply | Promise<Reply>)>;
function handlers(over: Handlers = {}, row = tx()): Handlers {
  return {
    [`GET /v1/transactions/${TX}`]: { status: 200, body: row },
    [`GET /v1/transactions/${TX}/category`]: {
      status: 200,
      body: { transactionId: TX, categoryId: FOOD, source: "merchant" },
    },
    "GET /v1/categories": { status: 200, body: { groups: GROUPS } },
    [`GET /v1/accounts/${ACC}`]: { status: 200, body: ACCOUNT },
    "GET /v1/duplicate-proposals": { status: 200, body: { items: [], count: 0, more: false } },
    "GET /v1/transaction-review": { status: 200, body: { count: 0 } },
    ...over,
  };
}

function open(h: Handlers = handlers(), hash = DETAIL) {
  const api = fakeApi(h);
  renderAt(hash, api.client);
  return api;
}

const card = () => screen.getByRole("heading", { level: 1 }).closest<HTMLElement>("section")!;
const loaded = () =>
  waitFor(() => expect(screen.getByRole("heading", { level: 1, name: "Сільпо" })).toBeTruthy());
const more = () => within(card()).getByRole("button", { name: "Ще дії" });
async function menuItems() {
  await act(async () => more().click());
  const menu = screen.getByRole("menu", { name: "Ще дії" });
  return within(menu).getAllByRole("menuitem");
}
const labels = (items: HTMLElement[]) => items.map((i) => i.querySelector(".ws-menu-label")?.textContent);
async function pick(name: string) {
  const item = (await menuItems()).find((i) => i.textContent?.includes(name))!;
  await act(async () => item.click());
}

beforeEach(() => {
  installMatchMedia({ width: 1280 });
  resetAuthState();
  resetNavigationSession();
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("FIN-03@PoC d): S-047 «Деталь транзакції»", () => {
  it("FIN-03@PoC FR 13: a row of S-046 opens the details of its transaction", async () => {
    const row = tx();
    open(
      handlers({
        "GET /v1/transactions": {
          status: 200,
          body: {
            items: [row],
            page: 1,
            pageSize: 25,
            count: 1,
            from: 1,
            to: 1,
            summary: Object.fromEntries(
              ["income", "expense", "difference"].map((k) => [
                k,
                {
                  total: null,
                  converted: false,
                  approximate: false,
                  nearestRateCount: 0,
                  partial: false,
                  noRateCount: 0,
                },
              ]),
            ),
          },
        },
        "GET /v1/accounts": { status: 200, body: { items: [ACCOUNT], nextCursor: null } },
        "GET /v1/transfer-proposals": { status: 200, body: { items: [], count: 0, more: false } },
      }),
      "#/money/transactions",
    );
    const link = await screen.findByRole("link", { name: /^Сільпо,/ });
    act(() => {
      window.location.hash = link.getAttribute("href")!;
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    await loaded();
    expect(document.title).toContain("Сільпо");
  });

  it("FIN-03@PoC FR 27: the heading — initials, the counterparty, «дата, час · рахунок · Проведена» and the amount; «Категорія» with its source, «Опис»; breadcrumbs and «Закрити» back to the list", async () => {
    open();
    await loaded();
    const c = card();
    expect(c.querySelector(".ws-tx-logo")?.textContent).toBe("С");
    const line = plain(c.querySelector(".txd-title .ws-muted")?.textContent);
    expect(line).toMatch(/^2 лист\. 2026.*, \d\d:\d\d · Поточний ··4417 · Проведена$/);
    expect(plain(c.querySelector(".txd-amount")?.textContent)).toContain("−42,80 €");
    const facts = c.querySelector(".txd-facts")!;
    expect([...facts.querySelectorAll("dt")].map((d) => d.textContent)).toEqual(["Категорія", "Опис"]);
    expect(facts.textContent).toContain("Продукти");
    expect(facts.textContent).toContain("як раніше");
    expect(facts.textContent).toContain("Продукти на тиждень");
    const crumbs = screen.getByRole("navigation", { name: "Хлібні крихти" });
    expect(within(crumbs).getByRole("link", { name: "Транзакції" }).getAttribute("href")).toBe(
      "#/money/transactions",
    );
    expect(within(c).getByRole("link", { name: "Закрити" }).getAttribute("href")).toBe(
      "#/money/transactions",
    );
  });

  it("FIN-03@PoC FR 27: the menu «…» of a manual transaction that is no «Можливий дубль» — «Історія змін» and «Видалити» (last, a danger item); nothing to hide (FR 18)", async () => {
    open();
    await loaded();
    const items = await menuItems();
    expect(labels(items)).toEqual(["Історія змін", "Видалити"]);
    expect(items.at(-1)!.dataset.tone).toBe("danger");
    expect(screen.getByRole("menu").querySelector("[role='separator']")).toBeTruthy();
  });

  it("FIN-03@PoC FR 18: a «Можливий дубль» of two manual transactions — «Приховати транзакцію» (POST …/hide); hidden, it shows «Приховано» and «Показати транзакцію» (FR 16)", async () => {
    let row = tx();
    const api = open(
      handlers({
        [`GET /v1/transactions/${TX}`]: () => ({ status: 200, body: row }),
        "GET /v1/duplicate-proposals": { status: 200, body: { items: [PAIR], count: 1, more: false } },
        [`POST /v1/transactions/${TX}/hide`]: () => {
          row = tx({ hidden: true });
          return { status: 200, body: row };
        },
        [`POST /v1/transactions/${TX}/show`]: () => {
          row = tx();
          return { status: 200, body: row };
        },
      }),
    );
    await loaded();
    expect(card().querySelector(".txd-marks")?.textContent).toContain("Можливий дубль");
    expect(labels(await menuItems())).toEqual(["Приховати транзакцію", "Історія змін", "Видалити"]);
    await act(async () => screen.getByRole("menuitem", { name: /Приховати транзакцію/ }).click());
    await waitFor(() => expect(card().querySelector(".txd-marks")?.textContent).toContain("Приховано"));
    expect(api.calls.some((c) => c.method === "POST" && c.path.endsWith("/hide"))).toBe(true);
    await pick("Показати транзакцію");
    await waitFor(() => expect(card().querySelector(".txd-marks")?.textContent).not.toContain("Приховано"));
    expect(api.calls.some((c) => c.method === "POST" && c.path.endsWith("/show"))).toBe(true);
  });

  it("FIN-03@PoC FR 18: a side of a transfer is never hidden, even in a «Можливий дубль» pair", async () => {
    open(
      handlers(
        { "GET /v1/duplicate-proposals": { status: 200, body: { items: [PAIR], count: 1, more: false } } },
        tx({
          transfer: {
            id: OTHER,
            counterpartId: OTHER,
            side: "outflow",
            date: "2026-11-02",
            fee: null,
            rate: null,
          },
        }),
      ),
    );
    await loaded();
    expect(card().querySelector(".txd-marks")?.textContent).toContain("переказ");
    expect(labels(await menuItems())).toEqual(["Історія змін", "Видалити"]);
  });

  it("FIN-03@PoC AC10: «Видалити» asks to confirm; «Видалити транзакцію» sends DELETE and goes back to the list", async () => {
    const api = open(
      handlers({ [`DELETE /v1/transactions/${TX}`]: { status: 200, body: { deleted: true } } }),
    );
    await loaded();
    await pick("Видалити");
    const confirm = screen.getByRole("alertdialog", { name: "Видалити транзакцію?" });
    expect(confirm.textContent).toContain("залишок рахунку повернеться до попереднього значення");
    expect(api.calls.some((c) => c.method === "DELETE")).toBe(false);
    // The safe way out has the focus, never the dangerous action (CMP-21@PoC AC1).
    expect(document.activeElement?.textContent).toBe("Скасувати");
    await act(async () => within(confirm).getByRole("button", { name: "Видалити транзакцію" }).click());
    await waitFor(() => expect(window.location.hash).toBe("#/money/transactions"));
    expect(api.calls.filter((c) => c.method === "DELETE").map((c) => c.path)).toEqual([
      `/v1/transactions/${TX}`,
    ]);
  });

  it("FIN-03@PoC FR 16: a failed delete stays in the dialog with «Код: …»; nothing else changes", async () => {
    open(handlers({ [`DELETE /v1/transactions/${TX}`]: problem(409, "TRANSACTION_IN_TRANSFER") }));
    await loaded();
    await pick("Видалити");
    const confirm = screen.getByRole("alertdialog", { name: "Видалити транзакцію?" });
    await act(async () => within(confirm).getByRole("button", { name: "Видалити транзакцію" }).click());
    await waitFor(() => expect(confirm.textContent).toContain("Не вдалося виконати дію"));
    // CMP-21@PoC «Стани»: a failed action inside the dialog says «Помилка».
    expect(plain(confirm.textContent)).toContain("Помилка. Не вдалося виконати дію. Спробуйте ще раз.");
    expect(confirm.textContent).toContain(`Код: ${SUPPORT_ID}`);
    expect(window.location.hash).toBe(DETAIL);
  });

  it("FIN-03@PoC FR 11: a merged record shows «Об’єднано» and «Роз’єднати», which sends DELETE …/merge", async () => {
    let row = tx({ mergedDuplicates: [OTHER] });
    const api = open(
      handlers({
        [`GET /v1/transactions/${TX}`]: () => ({ status: 200, body: row }),
        [`DELETE /v1/transactions/${TX}/merge`]: () => {
          row = tx();
          return { status: 200, body: { transaction: row, restored: [] } };
        },
      }),
    );
    await loaded();
    expect(card().querySelector(".txd-marks")?.textContent).toContain("Об’єднано");
    // The server refuses to delete a record with merged duplicates (TRANSACTION_MERGED): «Видалити» is not offered.
    expect(labels(await menuItems())).toEqual(["Історія змін"]);
    await act(async () => more().click());
    await act(async () => within(card()).getByRole("button", { name: "Роз’єднати" }).click());
    await waitFor(() => expect(within(card()).queryByRole("button", { name: "Роз’єднати" })).toBeNull());
    expect(api.calls.some((c) => c.method === "DELETE" && c.path.endsWith("/merge"))).toBe(true);
  });

  it("FIN-03@PoC FR 20: «Історія змін» — the audit entries oldest first: when, who, what; amounts, dates and names shown, free text only «змінено» (П-10)", async () => {
    const history = {
      items: [
        {
          id: "00000000-0000-4000-8000-000000000101",
          occurredAt: "2026-11-02T09:14:00Z",
          actor: "you",
          channel: "web",
          action: "create",
          changes: [
            { field: "accountId", before: null, after: ACC, masked: false },
            { field: "amount", before: null, after: "-42.80", masked: false },
            { field: "counterparty", before: null, after: "•••", masked: true },
          ],
        },
        {
          id: "00000000-0000-4000-8000-000000000102",
          occurredAt: "2026-11-03T10:00:00Z",
          actor: "you",
          channel: "web",
          action: "update",
          changes: [
            { field: "amount", before: "-40.00", after: "-42.80", masked: false },
            { field: "description", before: "•••", after: "•••", masked: true },
            { field: "transfer.side", before: null, after: "outflow", masked: false },
            { field: "transfer.with", before: null, after: OTHER, masked: false },
          ],
        },
        {
          id: "00000000-0000-4000-8000-000000000103",
          occurredAt: "2026-11-03T11:00:00Z",
          actor: "system",
          channel: "system",
          action: "update",
          changes: [
            { field: "categoryId", before: null, after: FOOD, masked: false },
            { field: "source", before: "none", after: "rule", masked: false },
          ],
        },
      ],
      truncated: false,
    };
    open(handlers({ [`GET /v1/transactions/${TX}/history`]: { status: 200, body: history } }));
    await loaded();
    const dialog = await historyPage();
    await waitFor(() => expect(dialog.querySelectorAll(".txd-history > li").length).toBe(3));
    const entries = [...dialog.querySelectorAll(".txd-history > li")].map((li) => ({
      head: plain(li.querySelector(".txd-history-head")?.textContent),
      lines: [...li.querySelectorAll("ul > li")].map((l) => plain(l.textContent)),
    }));
    expect(entries[0]!.head).toMatch(/^2 лист\. 2026.* · Ви · Створено$/);
    expect(entries[0]!.lines).toEqual(["Рахунок: Поточний ··4417", "Сума: −42,80 €"]);
    expect(entries[1]!.head).toMatch(/ · Ви · Змінено$/);
    expect(entries[1]!.lines).toEqual(["Сума: −40,00 € → −42,80 €", "Опис: змінено", "Переказ: змінено"]);
    expect(entries[2]!.head).toMatch(/ · Система · Змінено$/);
    expect(entries[2]!.lines).toEqual([
      "Категорія: — → Продукти",
      "Джерело категорії: Без категорії → за правилом",
    ]);
    expect(dialog.textContent).not.toContain("•••");
    expect(dialog.textContent).not.toContain(OTHER);
  });

  it("FIN-03@PoC FR 27: «Історія змін» — over the server's cap «Показано лише останні N змін»; none yet — «Змін ще немає.»", async () => {
    const entry = (n: number) => ({
      id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
      occurredAt: "2026-11-03T10:00:00Z",
      actor: "you",
      channel: "web",
      action: "update",
      changes: [{ field: "date", before: "2026-11-01", after: "2026-11-02", masked: false }],
    });
    let answer: unknown = { items: [entry(1), entry(2)], truncated: true };
    open(handlers({ [`GET /v1/transactions/${TX}/history`]: () => ({ status: 200, body: answer }) }));
    await loaded();
    let dialog = await historyPage();
    await waitFor(() => expect(plain(dialog.textContent)).toContain("Показано лише останні 2 змін."));
    expect(plain(dialog.querySelector(".txd-history ul")?.textContent)).toMatch(
      /^Дата: 1 лист\. 2026.* → 2 лист\. 2026/,
    );
    answer = { items: [], truncated: false };
    await act(async () => within(dialog).getByRole("link", { name: "Назад до транзакції" }).click());
    await waitFor(() => expect(window.location.hash).toBe(DETAIL));
    await loaded();
    dialog = await historyPage();
    await waitFor(() => expect(dialog.textContent).toContain("Змін ще немає."));
  });

  it("FIN-03@PoC FR 27: «Історія змін» that failed — «Не вдалося завантажити історію змін.», «Код: …» and «Спробувати ще раз»", async () => {
    let fail = true;
    open(
      handlers({
        [`GET /v1/transactions/${TX}/history`]: () =>
          fail ? problem(503, "INTERNAL") : { status: 200, body: { items: [], truncated: false } },
      }),
    );
    await loaded();
    const dialog = await historyPage();
    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toContain("Не вдалося завантажити історію змін.");
    expect(alert.textContent).toContain(`Код: ${SUPPORT_ID}`);
    fail = false;
    await act(async () => within(alert).getByRole("button", { name: "Спробувати ще раз" }).click());
    await waitFor(() => expect(dialog.textContent).toContain("Змін ще немає."));
  });

  it("FIN-03@PoC AC12: a transaction of another space (404) is «Сторінку не знайдено», nothing of it shown", async () => {
    open(handlers({ [`GET /v1/transactions/${TX}`]: problem(404, "NOT_FOUND") }));
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Сторінку не знайдено"),
    );
    expect(document.body.textContent).not.toContain("Сільпо");
  });

  it("S-047 states: loading — a skeleton under «Транзакція»; error — «✕ Помилка», what failed, «Код: …» and «Спробувати ще раз»; no menu (no disabled or empty state applies)", async () => {
    let release: ((r: Reply) => void) | null = null;
    let fail = true;
    open(
      handlers({
        [`GET /v1/transactions/${TX}`]: () =>
          fail
            ? new Promise<Reply>((resolve) => {
                release = resolve;
              })
            : { status: 200, body: tx() },
      }),
    );
    await waitFor(() => expect(release).not.toBeNull());
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Транзакція");
    expect(document.querySelector(".txd .ws-skeleton, .txd [aria-busy='true']")).toBeTruthy();
    await act(async () => release!(problem(500, "INTERNAL")));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("✕ Помилка");
    expect(alert.textContent).toContain("Не вдалося завантажити транзакцію.");
    expect(alert.textContent).toContain(`Код: ${SUPPORT_ID}`);
    expect(screen.queryByRole("button", { name: "Ще дії" })).toBeNull();
    fail = false;
    await act(async () => within(alert).getByRole("button", { name: "Спробувати ще раз" }).click());
    await loaded();
  });

  it("S-047: a failed «Приховати транзакцію» shows «Не вдалося виконати дію» with «Код: …» in the details", async () => {
    open(
      handlers({
        "GET /v1/duplicate-proposals": { status: 200, body: { items: [PAIR], count: 1, more: false } },
        [`POST /v1/transactions/${TX}/hide`]: problem(409, "TRANSACTION_NOT_HIDEABLE"),
      }),
    );
    await loaded();
    await pick("Приховати транзакцію");
    const alert = await within(card()).findByRole("alert");
    expect(alert.textContent).toContain("✕ Помилка");
    expect(alert.textContent).toContain("Не вдалося виконати дію. Спробуйте ще раз.");
    expect(alert.textContent).toContain(`Код: ${SUPPORT_ID}`);
    // The hide error is the page's own; the delete confirmation opens clean.
    await pick("Видалити");
    const confirm = screen.getByRole("alertdialog", { name: "Видалити транзакцію?" });
    expect(confirm.textContent).not.toContain("Не вдалося виконати дію");
  });
});
