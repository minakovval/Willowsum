import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { formatDate } from "@willowsum/i18n";
import { installMatchMedia } from "@willowsum/ui/test-utils";
import {
  fakeApi,
  plain,
  renderAt,
  resetAuthState,
  SUPPORT_ID,
  type Call,
  type Reply,
} from "../auth/testing.tsx";
import { resetNavigationSession } from "../routing/session.ts";
import { resetTracked } from "./bulk.ts";
import { resetReviewCount } from "./reviewCount.ts";

/**
 * BUD-12@PoC b) (wave 2, row 121): S-058 «До розбору» — the tab of «Транзакції» (canvas PocMoneyReview,
 * PocMoneyReviewDone; texts PocMoneyReviewTexts) on the merged server parts (row 24 and #491). The fake API answers as
 * the server does. Synthetic data only.
 */
const ACC = "00000000-0000-4000-8000-000000000001";
const CAFE = "00000000-0000-4000-8000-0000000000c1";
const HOME = "00000000-0000-4000-8000-0000000000c2";
const FOOD = "00000000-0000-4000-8000-0000000000c3";
const FUEL = "00000000-0000-4000-8000-0000000000c4";
const RULE = "00000000-0000-4000-8000-0000000000e1";
const txId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const eur = (amount: string) => ({ amount, currency: "EUR" });
/** An accessible name with its numbers kept with their words by no-break spaces. */
const nm = (text: string) =>
  new RegExp(`^${text.replace(/[.*+?^${"$"}{}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s")}$`);

type Tx = ReturnType<typeof tx>;
function tx(n: number, counterparty: string, amount: string, over: Record<string, unknown> = {}) {
  return {
    id: txId(n),
    accountId: ACC,
    amount: eur(amount),
    type: "expense",
    date: `2026-10-${String(n).padStart(2, "0")}`,
    counterparty,
    description: null,
    status: "posted",
    source: "import",
    hidden: false,
    split: null,
    transfer: null,
    mergedInto: null,
    mergedDuplicates: [],
    note: null,
    tags: [],
    review: "queued",
    version: 1,
    recordedAt: "2026-10-30T09:14:00Z",
    ...over,
  };
}

const category = (id: string, name: string, groupId: string) => ({
  id,
  groupId,
  systemKey: null,
  kind: "expense",
  name,
  renamed: false,
  icon: "budget",
  color: "#5872D2",
  iconTone: "white",
  essential: null,
  hidden: false,
  deletable: true,
});
const GROUPS = [
  {
    id: "g1",
    systemKey: null,
    kind: "expense",
    name: "Щоденне",
    renamed: false,
    tone: "#5872D2",
    categories: [category(CAFE, "Кафе і ресторани", "g1"), category(FOOD, "Продукти", "g1")],
  },
  {
    id: "g2",
    systemKey: null,
    kind: "expense",
    name: "Дім і транспорт",
    renamed: false,
    tone: "#0E9161",
    categories: [category(HOME, "Дім", "g2"), category(FUEL, "Пальне", "g2")],
  },
];

function group(
  id: string,
  name: string | null,
  count: number,
  amount: string,
  over: Record<string, unknown> = {},
) {
  return {
    id,
    count,
    counterparty: name ? name.toUpperCase() : null,
    merchant: name
      ? {
          id: `00000000-0000-4000-8000-0000000d${id.length.toString().padStart(4, "0")}`,
          initials: name[0]!,
          intermediary: false,
          name,
        }
      : null,
    mixedCategories: false,
    oldest: "2026-10-01",
    suggestedCategoryId: null,
    totals: [eur(amount)],
    ...over,
  };
}

type Handlers = Record<string, Reply | ((call: Call, url: URL) => Reply | Promise<Reply>)>;

/**
 * A space whose queue holds `queue` (the cards, oldest first) and `groups` (the mode «Мерчанти»); `extra` — more of
 * the queue than the cards (103 in AC8). Confirming removes from the queue; reopening puts back.
 */
function space({
  queue,
  groups,
  extra = 0,
  truncated = false,
  over = {},
}: {
  queue: Tx[];
  groups: ReturnType<typeof group>[];
  extra?: number;
  truncated?: boolean;
  over?: Handlers;
}) {
  const cats = new Map<string, string | null>(queue.map((t) => [t.id, CAFE]));
  const state = { queue: [...queue], extra, groups: [...groups], lists: [] as URLSearchParams[] };
  const left = () => state.queue.length + state.extra;
  const h: Handlers = {
    "GET /v1/transactions": (_call, url) => {
      state.lists.push(url.searchParams);
      const filter = url.searchParams.getAll("filter");
      const items = filter.includes("review.eq:queued") ? state.queue : queue;
      return {
        status: 200,
        body: {
          items,
          page: 1,
          pageSize: 25,
          count: filter.includes("review.eq:queued") ? left() : items.length,
          from: 1,
          to: items.length,
          summary: {
            currency: "EUR",
            income: {
              total: null,
              converted: false,
              approximate: false,
              nearestRateCount: 0,
              partial: false,
              noRateCount: 0,
            },
            expense: {
              total: null,
              converted: false,
              approximate: false,
              nearestRateCount: 0,
              partial: false,
              noRateCount: 0,
            },
            difference: {
              total: null,
              converted: false,
              approximate: false,
              nearestRateCount: 0,
              partial: false,
              noRateCount: 0,
            },
          },
        },
      };
    },
    "GET /v1/accounts": {
      status: 200,
      body: { items: [{ id: ACC, name: "Поточний", number: { last4: "4417" } }], nextCursor: null },
    },
    "GET /v1/categories": { status: 200, body: { groups: GROUPS } },
    "GET /v1/transaction-review": () => ({ status: 200, body: { count: left() } }),
    "GET /v1/transfer-proposals": { status: 200, body: { items: [], count: 0, more: false } },
    "GET /v1/transaction-review/merchant-groups": () => ({
      status: 200,
      body: {
        count: state.groups.length,
        items: state.groups,
        page: 1,
        pageSize: 100,
        transactionCount: left(),
        truncated,
      },
    }),
    "GET /v1/category-suggestions": {
      status: 200,
      body: {
        merchant: null,
        suggestion: null,
        top: { kind: "frequent", merchant: null, categoryIds: [FUEL] },
        merchants: [],
      },
    },
    ...over,
  };
  for (const t of queue) {
    h[`GET /v1/transactions/${t.id}/category`] = () => ({
      status: 200,
      body: { transactionId: t.id, categoryId: cats.get(t.id) ?? null, source: "manual" },
    });
    h[`PUT /v1/transactions/${t.id}/category`] = (call) => {
      const id = (call.body as { categoryId: string | null }).categoryId;
      cats.set(t.id, id);
      return { status: 200, body: { transactionId: t.id, categoryId: id, source: "manual" } };
    };
    h[`POST /v1/transactions/${t.id}/review/confirm`] = (call) => {
      const at = state.queue.findIndex((q) => q.id === t.id);
      const current = state.queue[at]!;
      state.queue.splice(at, 1);
      const body = call.body as { version: number };
      return { status: 200, body: { ...current, version: body.version + 1, review: "confirmed" } };
    };
    h[`POST /v1/transactions/${t.id}/review/reopen`] = (call) => {
      const body = call.body as { version: number };
      const back = { ...t, version: body.version + 1, review: "queued" };
      state.queue.unshift(back);
      return { status: 200, body: back };
    };
    if (!(`GET /v1/transactions/${t.id}` in h)) h[`GET /v1/transactions/${t.id}`] = { status: 200, body: t };
  }
  for (const [k, v] of Object.entries(over)) h[k] = v;
  const api = fakeApi(h);
  return { api, state, cats };
}

const posts = (api: ReturnType<typeof fakeApi>, path: string) =>
  api.calls.filter((c) => c.method === "POST" && c.path === path);
const progress = () => plain(document.querySelector(".ws-progress-text")?.textContent);
const card = () => screen.getByRole("region", { name: /^(Starbucks|Amazon|Shell|Uber)$/ });
const open = (api: ReturnType<typeof fakeApi>) => renderAt("#/money/transactions/review", api.client);

/** The 12 of AC1: Starbucks first (the oldest), then Amazon, then ten more of two merchants. */
function twelve() {
  return [
    tx(1, "Starbucks", "-6.40"),
    tx(2, "Amazon", "-84.99"),
    ...Array.from({ length: 10 }, (_, i) => tx(i + 3, i % 2 ? "Shell" : "Uber", "-10.00")),
  ];
}
const groupsOfTwelve = () => [
  group("g-shell", "Shell", 5, "-50.00", { suggestedCategoryId: FUEL }),
  group("g-uber", "Uber", 5, "-50.00"),
  group("g-star", "Starbucks", 1, "-6.40", { suggestedCategoryId: CAFE }),
  group("g-amzn", "Amazon", 1, "-84.99", { suggestedCategoryId: HOME }),
];

beforeEach(() => {
  installMatchMedia({ width: 1280 });
  resetAuthState();
  resetNavigationSession();
  resetTracked();
  resetReviewCount();
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("BUD-12@PoC b): «До розбору» (S-058)", () => {
  it("BUD-12@PoC AC1: «Розібрати» opens the cards — merchant, amount, date, account and suggested category; progress «0 з 12 · лишилось 12»", async () => {
    const { api, state } = space({ queue: twelve(), groups: groupsOfTwelve() });
    open(api);
    const start = await screen.findByRole("button", { name: "Розібрати" });
    expect(screen.getByRole("tab", { name: nm("До розбору · 12") }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(progress()).toBe("0 з 12 · лишилось 12");
    act(() => start.click());
    const c = await screen.findByRole("region", { name: "Starbucks" });
    expect(plain(c.textContent)).toContain("−6,40 €");
    expect(c.textContent).toContain(formatDate("uk", "2026-10-01"));
    expect(c.textContent).toContain("Поточний ··4417");
    expect(within(c).getByText("Кафе і ресторани")).toBeTruthy();
    expect(within(c).getByText("Запропонована категорія")).toBeTruthy();
    expect(progress()).toBe("0 з 12 · лишилось 12");
    // FR 2: the queue is read oldest first, from the queued transactions only.
    const query = state.lists.at(-1)!;
    expect(query.get("sort")).toBe("date");
    expect(query.getAll("filter")).toEqual(["review.eq:queued"]);
  });

  it("BUD-12@PoC AC2: «Підтвердити» confirms with the card's version and category; «До розбору · 11», the next card, and «Відмінити» in a toast", async () => {
    const { api } = space({ queue: twelve(), groups: groupsOfTwelve() });
    open(api);
    const one = await screen.findByRole("radio", { name: "По одній" });
    act(() => one.click());
    await screen.findByRole("region", { name: "Starbucks" });
    expect(screen.queryByRole("status", { name: /Категорію підтверджено/ })).toBeNull();
    expect(within(card()).getByRole("button", { name: "Пропустити" })).toBeTruthy();
    expect(within(card()).getByRole("button", { name: "Змінити категорію" })).toBeTruthy();
    await act(async () => within(card()).getByRole("button", { name: "Підтвердити" }).click());
    await screen.findByRole("region", { name: "Amazon" });
    const [confirm] = posts(api, `/v1/transactions/${txId(1)}/review/confirm`);
    expect(confirm!.body).toEqual({ version: 1, categoryId: CAFE });
    await screen.findByRole("tab", { name: nm("До розбору · 11") });
    await waitFor(() =>
      expect(screen.getByRole("link", { name: nm("Транзакції, 11 до розбору") })).toBeTruthy(),
    );
    const toast = document.querySelector(".ws-toast")!;
    expect(toast.textContent).toContain("Категорію підтверджено");
    expect(within(toast as HTMLElement).getByRole("button", { name: "Відмінити" })).toBeTruthy();
    expect(progress()).toBe("1 з 12 · лишилось 11");
  });

  it("BUD-12@PoC AC3: «Пропустити» moves the card to the end without a change; «Відмінити» returns the last card only", async () => {
    const { api } = space({ queue: twelve(), groups: groupsOfTwelve() });
    open(api);
    const one = await screen.findByRole("radio", { name: "По одній" });
    act(() => one.click());
    await screen.findByRole("region", { name: "Starbucks" });
    await act(async () => within(card()).getByRole("button", { name: "Підтвердити" }).click());
    await screen.findByRole("region", { name: "Amazon" });
    const before = api.calls.length;
    act(() => within(card()).getByRole("button", { name: "Пропустити" }).click());
    // FR 5: nothing goes to the server; the next card is shown.
    expect(api.calls.slice(before).filter((c) => c.method !== "GET")).toEqual([]);
    expect(screen.queryByRole("region", { name: "Amazon" })).toBeNull();
    expect(document.querySelector(".ws-toast")!.textContent).toContain("Транзакцію пропущено");
    // FR 6: one toast at a time; «Відмінити» undoes the skip only, not the confirmation before it.
    expect(document.querySelectorAll(".ws-toast")).toHaveLength(1);
    act(() =>
      within(document.querySelector<HTMLElement>(".ws-toast")!)
        .getByRole("button", { name: "Відмінити" })
        .click(),
    );
    await screen.findByRole("region", { name: "Amazon" });
    expect(posts(api, `/v1/transactions/${txId(1)}/review/reopen`)).toHaveLength(0);
    expect(document.querySelector(".ws-toast")).toBeNull();
  });

  it("BUD-12@PoC FR 6: «Відмінити» after «Підтвердити» returns the card to the queue with its previous status", async () => {
    const { api } = space({ queue: twelve(), groups: groupsOfTwelve() });
    open(api);
    const one = await screen.findByRole("radio", { name: "По одній" });
    act(() => one.click());
    await screen.findByRole("region", { name: "Starbucks" });
    await act(async () => within(card()).getByRole("button", { name: "Підтвердити" }).click());
    await screen.findByRole("tab", { name: nm("До розбору · 11") });
    await act(async () =>
      within(document.querySelector<HTMLElement>(".ws-toast")!)
        .getByRole("button", { name: "Відмінити" })
        .click(),
    );
    await screen.findByRole("region", { name: "Starbucks" });
    const [reopen] = posts(api, `/v1/transactions/${txId(1)}/review/reopen`);
    expect(reopen!.body).toEqual({ version: 2 });
    await screen.findByRole("tab", { name: nm("До розбору · 12") });
    expect(progress()).toBe("0 з 12 · лишилось 12");
  });

  it("BUD-12@PoC AC5: «Підтвердити» on a card changed in another window is refused; the card shows the data now and «Транзакцію змінено, перевірте ще раз»", async () => {
    const shell = tx(1, "Shell", "-52.10");
    const { api } = space({
      queue: [shell, tx(2, "Amazon", "-84.99")],
      groups: [group("g-shell", "Shell", 1, "-52.10"), group("g-amzn", "Amazon", 1, "-84.99")],
      over: {
        [`POST /v1/transactions/${shell.id}/review/confirm`]: {
          status: 409,
          body: {
            type: "about:blank",
            title: "Conflict",
            status: 409,
            code: "VERSION_CONFLICT",
            supportId: SUPPORT_ID,
            currentVersion: 2,
            currentCategoryId: CAFE,
          },
        },
        [`GET /v1/transactions/${shell.id}`]: {
          status: 200,
          body: { ...shell, amount: eur("-55.10"), version: 2 },
        },
      },
    });
    open(api);
    await screen.findByRole("region", { name: "Shell" });
    await act(async () => within(card()).getByRole("button", { name: "Підтвердити" }).click());
    await waitFor(() =>
      expect(within(card()).getByRole("alert").textContent).toBe("Транзакцію змінено, перевірте ще раз"),
    );
    expect(plain(card().textContent)).toContain("−55,10 €");
    expect(screen.getByRole("tab", { name: nm("До розбору · 2") })).toBeTruthy();
  });

  it("BUD-12@PoC FR 4: the pencil «Змінити категорію» changes the category and confirms it", async () => {
    const { api, cats } = space({
      queue: [tx(1, "Starbucks", "-6.40"), tx(2, "Amazon", "-84.99")],
      groups: [group("g-star", "Starbucks", 1, "-6.40"), group("g-amzn", "Amazon", 1, "-84.99")],
    });
    open(api);
    await screen.findByRole("region", { name: "Starbucks" });
    act(() => within(card()).getByRole("button", { name: "Змінити категорію" }).click());
    const dialog = await screen.findByRole("dialog", { name: "Змінити категорію" });
    act(() =>
      within(dialog)
        .getByRole("button", { name: /^Категорія/ })
        .click(),
    );
    await act(async () => within(dialog).getByRole("option", { name: "Продукти" }).click());
    await screen.findByRole("region", { name: "Amazon" });
    expect(cats.get(txId(1))).toBe(FOOD);
    const [confirm] = posts(api, `/v1/transactions/${txId(1)}/review/confirm`);
    expect(confirm!.body).toEqual({ version: 1, categoryId: FOOD });
    expect(document.querySelector(".ws-toast")!.textContent).toContain("Категорію змінено і підтверджено");
  });

  it("BUD-12@PoC FR 16: the picker has search, «Часто для <мерчанта>» first, the categories by group and «Нова категорія» last", async () => {
    const { api } = space({
      queue: [tx(1, "Shell", "-52.10"), tx(2, "Amazon", "-84.99")],
      groups: [group("g-shell", "Shell", 1, "-52.10"), group("g-amzn", "Amazon", 1, "-84.99")],
    });
    open(api);
    await screen.findByRole("region", { name: "Shell" });
    act(() => within(card()).getByRole("button", { name: "Змінити категорію" }).click());
    const dialog = await screen.findByRole("dialog", { name: "Змінити категорію" });
    await waitFor(() => expect(api.calls.some((c) => c.path === "/v1/category-suggestions")).toBe(true));
    act(() =>
      within(dialog)
        .getByRole("button", { name: /^Категорія/ })
        .click(),
    );
    expect(within(dialog).getByRole("combobox", { name: "Знайти категорію" })).toBeTruthy();
    const groups = within(dialog).getAllByRole("group");
    expect(groups[0]!.textContent).toContain("Часто для «Shell»");
    await waitFor(() => expect(within(groups[0]!).getByRole("option", { name: "Пальне" })).toBeTruthy());
    expect(within(dialog).getByRole("group", { name: "Щоденне" })).toBeTruthy();
    expect(within(dialog).getByRole("group", { name: "Дім і транспорт" })).toBeTruthy();
    const all = within(dialog).getAllByRole("option");
    expect(all[all.length - 1]!.textContent).toContain("Нова категорія");
  });

  it("GRID-02@PoC FR 4: header | progress | the queue 4 + the card 8; the progress «K з N · лишилось M» is always shown, the switch «Мерчанти / По одній» stands above the queue", async () => {
    const { api } = space({ queue: twelve(), groups: groupsOfTwelve() });
    open(api);
    const queue = await screen.findByRole("region", { name: "Черга" });
    const review = document.querySelector(".review")!;
    const [head, groups] = [...review.children];
    // The head of the queue (progress and switch), then the grid of the queue and the card.
    expect(head!.classList.contains("review-head")).toBe(true);
    expect(groups!.classList.contains("review-groups")).toBe(true);
    expect(head!.querySelector(".ws-progress")).not.toBeNull();
    expect(head!.querySelector(".review-mode")).not.toBeNull();
    expect(progress()).toBe("0 з 12 · лишилось 12");
    expect(queue.closest(".review-groups")).toBe(groups);
    expect(queue.className).toContain("review-group-list");
    // One card in the grid after the queue.
    expect(groups!.querySelector(".review-group")).not.toBeNull();
    const css = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "transactions.css"),
      "utf8",
    ).replace(/\s+/g, " ");
    expect(css).toContain(
      "@media (min-width: 1024px) { .review-groups { grid-template-columns: repeat(var(--ws-columns), minmax(0, 1fr)); } .review-groups > .review-group-list { grid-column: span 4; } .review-groups > .review-group { grid-column: span 8; }",
    );
    // «По одній»: the progress stays.
    act(() => screen.getByRole("radio", { name: "По одній" }).click());
    await screen.findByRole("region", { name: "Starbucks" });
    expect(progress()).toBe("0 з 12 · лишилось 12");
  });

  it("BUD-12@PoC FR 14: «Мерчанти» by default when a merchant has more than one transaction; the switch «Мерчанти / По одній» is a radio group", async () => {
    const { api } = space({ queue: twelve(), groups: groupsOfTwelve() });
    open(api);
    const groups = await screen.findByRole("list", { name: "Мерчанти в черзі" });
    const rows = within(groups).getAllByRole("button");
    expect(rows.map((r) => plain(r.textContent))).toEqual([
      "SShell5 транзакцій−50,00 €",
      "UUber5 транзакцій−50,00 €",
      "SStarbucks1 транзакція−6,40 €",
      "AAmazon1 транзакція−84,99 €",
    ]);
    const radios = within(screen.getByRole("group", { name: "Показати" })).getAllByRole("radio");
    expect(radios.map((r) => (r as HTMLInputElement).checked)).toEqual([true, false]);
    expect(screen.getByRole("heading", { name: nm("Shell · 5 транзакцій") })).toBeTruthy();
    act(() => rows[1]!.click());
    expect(screen.getByRole("heading", { name: nm("Uber · 5 транзакцій") })).toBeTruthy();
    expect(rows[1]!.getAttribute("aria-current")).toBe("true");
    const one = await screen.findByRole("radio", { name: "По одній" });
    act(() => one.click());
    await screen.findByRole("region", { name: "Starbucks" });
  });

  it("BUD-12@PoC FR 14: a queue of single transactions opens one by one", async () => {
    const { api } = space({
      queue: [tx(1, "Starbucks", "-6.40"), tx(2, "Amazon", "-84.99")],
      groups: [group("g-star", "Starbucks", 1, "-6.40"), group("g-amzn", "Amazon", 1, "-84.99")],
    });
    open(api);
    await screen.findByRole("region", { name: "Starbucks" });
    expect((screen.getByRole("radio", { name: "По одній" }) as HTMLInputElement).checked).toBe(true);
  });

  it("BUD-12@PoC AC8: «Запам'ятати: Сільпо → Продукти» and «Підтвердити» on the group confirm its 18 and create the rule; «18 з 103 · лишилось 85»", async () => {
    const silpo = Array.from({ length: 18 }, (_, i) => txId(500 + i));
    const confirmBodies: unknown[] = [];
    const { api, state } = space({
      queue: [],
      extra: 103,
      groups: [
        group("g-silpo", "Сільпо", 18, "-312.40", { suggestedCategoryId: FOOD }),
        group("g-other", "Нова пошта", 85, "-21.30"),
      ],
      over: {
        "GET /v1/transaction-review/merchant-groups/g-silpo/transactions": (_c, url) => {
          const cursor = url.searchParams.get("cursor");
          return {
            status: 200,
            body: cursor
              ? { items: silpo.slice(10), nextCursor: null }
              : { items: silpo.slice(0, 10), nextCursor: "c2" },
          };
        },
        "POST /v1/category-rules": { status: 201, body: { id: RULE } },
        "POST /v1/bulk-actions": (call) => {
          const body = call.body as { action: string; selection: { ids: string[] } };
          confirmBodies.push(body);
          state.extra -= body.selection.ids.length;
          state.groups = state.groups.slice(1);
          return {
            status: 201,
            body: {
              id: "a1",
              action: body.action,
              background: false,
              status: "completed",
              count: 18,
              processed: 18,
              changed: 18,
              skipped: { unavailable: 0, unchanged: 0, conflict: 0, invalid: 0 },
              skippedRecords: [],
              undo: { available: true, until: "2026-11-18T12:00:00Z", restored: 0, notRestored: 0 },
              createdAt: "2026-11-17T12:00:00Z",
              endedAt: "2026-11-17T12:00:00Z",
            },
          };
        },
      },
    });
    open(api);
    await screen.findByRole("heading", { name: nm("Сільпо · 18 транзакцій") });
    expect(progress()).toBe("0 з 103 · лишилось 103");
    const remember = screen.getByRole("checkbox", {
      name: "Запам’ятати: Сільпо → Продукти для нових транзакцій",
    });
    expect((remember as HTMLInputElement).checked).toBe(false);
    act(() => remember.click());
    await act(async () => screen.getByRole("button", { name: nm("Підтвердити 18") }).click());
    await waitFor(() => expect(progress()).toBe("18 з 103 · лишилось 85"));
    expect(posts(api, "/v1/category-rules")[0]!.body).toEqual({
      conditions: [{ field: "merchant", operator: "equals", value: "Сільпо" }],
      categoryId: FOOD,
    });
    // One action: the group's own category stays (no «Змінити категорію» first).
    expect(confirmBodies).toEqual([
      { action: "transactions.confirm-category", selection: { kind: "ids", ids: silpo }, params: {} },
    ]);
    expect(plain(document.querySelector(".ws-toast")!.textContent)).toContain(
      "Категорію підтверджено для 18 транзакцій",
    );
    await screen.findByRole("tab", { name: nm("До розбору · 85") });
  });

  it("BUD-12@PoC AC10: in a group of «Shell» of 4 the pencil with «Пальне» from the search sets and confirms «Пальне» for all 4", async () => {
    const shell = [1, 2, 3, 4].map((n) => txId(600 + n));
    const actions: { action: string; ids: string[]; params: unknown }[] = [];
    const { api } = space({
      queue: [],
      extra: 5,
      groups: [
        group("g-shell", "Shell", 4, "-208.40", { suggestedCategoryId: CAFE }),
        group("g-x", "Uber", 1, "-1.00"),
      ],
      over: {
        "GET /v1/transaction-review/merchant-groups/g-shell/transactions": {
          status: 200,
          body: { items: shell, nextCursor: null },
        },
        "POST /v1/bulk-actions": (call) => {
          const body = call.body as { action: string; selection: { ids: string[] }; params: unknown };
          actions.push({ action: body.action, ids: body.selection.ids, params: body.params });
          return {
            status: 201,
            body: {
              id: `a${actions.length}`,
              action: body.action,
              background: false,
              status: "completed",
              count: 4,
              processed: 4,
              changed: 4,
              skipped: { unavailable: 0, unchanged: 0, conflict: 0, invalid: 0 },
              skippedRecords: [],
              undo: { available: true, until: "2026-11-18T12:00:00Z", restored: 0, notRestored: 0 },
              createdAt: "2026-11-17T12:00:00Z",
              endedAt: "2026-11-17T12:00:00Z",
            },
          };
        },
      },
    });
    open(api);
    await screen.findByRole("heading", { name: nm("Shell · 4 транзакції") });
    act(() => screen.getByRole("button", { name: "Змінити категорію" }).click());
    const dialog = await screen.findByRole("dialog", { name: "Змінити категорію" });
    act(() =>
      within(dialog)
        .getByRole("button", { name: /^Категорія/ })
        .click(),
    );
    fireEvent.change(within(dialog).getByRole("combobox", { name: "Знайти категорію" }), {
      target: { value: "Паль" },
    });
    await act(async () => within(dialog).getAllByRole("option", { name: "Пальне" })[0]!.click());
    await waitFor(() => expect(actions).toHaveLength(2));
    expect(actions).toEqual([
      { action: "transactions.set-category", ids: shell, params: { categoryId: FUEL } },
      { action: "transactions.confirm-category", ids: shell, params: {} },
    ]);
  });

  it("BUD-12@PoC FR 14: «Запам'ятати» creates the rule for the category its label shows, also when the pencil confirms the group with another one", async () => {
    const shell = [1, 2, 3, 4].map((n) => txId(700 + n));
    const { api } = space({
      queue: [],
      extra: 5,
      groups: [
        group("g-shell", "Shell", 4, "-208.40", { suggestedCategoryId: FOOD }),
        group("g-x", "Uber", 1, "-1.00"),
      ],
      over: {
        "GET /v1/transaction-review/merchant-groups/g-shell/transactions": {
          status: 200,
          body: { items: shell, nextCursor: null },
        },
        "POST /v1/category-rules": { status: 201, body: { id: RULE } },
        "POST /v1/bulk-actions": (call) => {
          const body = call.body as { action: string };
          return {
            status: 201,
            body: {
              id: "a1",
              action: body.action,
              background: false,
              status: "completed",
              count: 4,
              processed: 4,
              changed: 4,
              skipped: { unavailable: 0, unchanged: 0, conflict: 0, invalid: 0 },
              skippedRecords: [],
              undo: { available: true, until: "2026-11-18T12:00:00Z", restored: 0, notRestored: 0 },
              createdAt: "2026-11-17T12:00:00Z",
              endedAt: "2026-11-17T12:00:00Z",
            },
          };
        },
      },
    });
    open(api);
    await screen.findByRole("heading", { name: nm("Shell · 4 транзакції") });
    act(() =>
      screen.getByRole("checkbox", { name: "Запам’ятати: Shell → Продукти для нових транзакцій" }).click(),
    );
    act(() => screen.getByRole("button", { name: "Змінити категорію" }).click());
    const dialog = await screen.findByRole("dialog", { name: "Змінити категорію" });
    act(() =>
      within(dialog)
        .getByRole("button", { name: /^Категорія/ })
        .click(),
    );
    fireEvent.change(within(dialog).getByRole("combobox", { name: "Знайти категорію" }), {
      target: { value: "Паль" },
    });
    await act(async () => within(dialog).getAllByRole("option", { name: "Пальне" })[0]!.click());
    await waitFor(() => expect(posts(api, "/v1/category-rules")).toHaveLength(1));
    expect(posts(api, "/v1/category-rules")[0]!.body).toEqual({
      conditions: [{ field: "merchant", operator: "equals", value: "Shell" }],
      categoryId: FOOD,
    });
  });

  it("BUD-12@PoC FR 14: a group with different categories gets its suggestion on all of them before it is confirmed", async () => {
    const ids = [txId(701), txId(702)];
    const actions: string[] = [];
    const { api } = space({
      queue: [],
      extra: 2,
      groups: [group("g-mix", "Rozetka", 2, "-188.00", { suggestedCategoryId: HOME, mixedCategories: true })],
      over: {
        "GET /v1/transaction-review/merchant-groups/g-mix/transactions": {
          status: 200,
          body: { items: ids, nextCursor: null },
        },
        "POST /v1/bulk-actions": (call) => {
          const body = call.body as { action: string };
          actions.push(body.action);
          return {
            status: 201,
            body: {
              id: "a1",
              action: body.action,
              background: false,
              status: "completed",
              count: 2,
              processed: 2,
              changed: 2,
              skipped: { unavailable: 0, unchanged: 0, conflict: 0, invalid: 0 },
              skippedRecords: [],
              undo: { available: true, until: "2026-11-18T12:00:00Z", restored: 0, notRestored: 0 },
              createdAt: "2026-11-17T12:00:00Z",
              endedAt: "2026-11-17T12:00:00Z",
            },
          };
        },
      },
    });
    open(api);
    await screen.findByText("У групі різні категорії: «Підтвердити» призначить усім «Дім».");
    await act(async () => screen.getByRole("button", { name: nm("Підтвердити 2") }).click());
    await waitFor(() =>
      expect(actions).toEqual(["transactions.set-category", "transactions.confirm-category"]),
    );
  });

  it("BUD-12@PoC FR 14: on a page read from part of the queue (`truncated`) a group offers no «Підтвердити» and no pencil", async () => {
    const { api } = space({
      queue: twelve(),
      groups: groupsOfTwelve(),
      truncated: true,
    });
    open(api);
    await screen.findByRole("heading", { name: nm("Shell · 5 транзакцій") });
    expect(screen.getByText("Групу показано не повністю. Розберіть її по одній.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Підтвердити/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Змінити категорію" })).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("BUD-12@PoC FR 15: progress counts transactions, not groups", async () => {
    const { api } = space({
      queue: [],
      extra: 103,
      groups: [group("g-silpo", "Сільпо", 18, "-312.40"), group("g-other", "Нова пошта", 85, "-21.30")],
    });
    open(api);
    await screen.findByRole("heading", { name: nm("Сільпо · 18 транзакцій") });
    const bar = screen.getByRole("progressbar", { name: "Розібрано" });
    expect(bar.getAttribute("aria-valuemax")).toBe("103");
    expect(progress()).toBe("0 з 103 · лишилось 103");
    expect(plain(screen.getByText(/за мерчантами/).textContent)).toBe("за мерчантами · 103 транзакції");
  });

  it("BUD-12@PoC FR 13: an empty queue shows «Усе розібрано» with «До транзакцій»", async () => {
    const { api } = space({ queue: [], groups: [] });
    open(api);
    expect(await screen.findByRole("heading", { name: "Усе розібрано" })).toBeTruthy();
    expect(screen.getByText("Нові транзакції з’являться тут після наступного імпорту.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "До транзакцій" }).getAttribute("href")).toBe(
      "#/money/transactions",
    );
    expect(screen.getByRole("tab", { name: "До розбору" })).toBeTruthy();
  });

  it("BUD-12@PoC EC2: after the last card «Усе розібрано» says how many were confirmed", async () => {
    const { api } = space({
      queue: [tx(1, "Starbucks", "-6.40")],
      groups: [group("g-star", "Starbucks", 1, "-6.40")],
    });
    open(api);
    await screen.findByRole("region", { name: "Starbucks" });
    await act(async () => within(card()).getByRole("button", { name: "Підтвердити" }).click());
    expect(await screen.findByRole("heading", { name: "Усе розібрано" })).toBeTruthy();
    expect(plain(screen.getByText(/підтверджено\./).textContent)).toBe(
      "1 транзакцію підтверджено. Нові з’являться тут після наступного імпорту.",
    );
  });

  it("BUD-12@PoC AC9: an empty queue — no counter on «Транзакції», the tab without a number; 7 in the queue — 7 on both", async () => {
    const empty = space({ queue: [], groups: [] });
    const view = open(empty.api);
    await screen.findByRole("heading", { name: "Усе розібрано" });
    expect(screen.getByRole("link", { name: "Транзакції" })).toBeTruthy();
    expect(document.querySelector(".ws-nav-badge")).toBeNull();
    expect(document.querySelector(".tx-totals")).toBeNull();
    view.unmount();
    resetReviewCount();
    const seven = space({
      queue: Array.from({ length: 7 }, (_, i) => tx(i + 1, "Starbucks", "-1.00")),
      groups: [group("g-star", "Starbucks", 7, "-7.00")],
    });
    open(seven.api);
    await screen.findByRole("tab", { name: nm("До розбору · 7") });
    const link = screen.getByRole("link", { name: nm("Транзакції, 7 до розбору") });
    expect(link.querySelector(".ws-nav-badge")!.textContent).toBe("7");
  });

  it("BUD-12@PoC «Стани інтерфейсу»: the skeleton of a card while loading, then «Не вдалося завантажити чергу» with «Спробувати ще раз» and the code", async () => {
    let fail = true;
    const { api } = space({
      queue: [tx(1, "Starbucks", "-6.40")],
      groups: [group("g-star", "Starbucks", 1, "-6.40")],
      over: {
        "GET /v1/transaction-review/merchant-groups": () =>
          fail
            ? {
                status: 500,
                body: {
                  type: "about:blank",
                  title: "Error",
                  status: 500,
                  code: "INTERNAL",
                  supportId: SUPPORT_ID,
                },
              }
            : {
                status: 200,
                body: {
                  count: 1,
                  items: [group("g-star", "Starbucks", 1, "-6.40")],
                  page: 1,
                  pageSize: 100,
                  transactionCount: 1,
                  truncated: false,
                },
              },
      },
    });
    open(api);
    expect(
      document.querySelector(
        ".review[aria-busy='true'] .ws-skeleton, .review [aria-busy] , .review .ws-card",
      ),
    ).toBeTruthy();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Не вдалося завантажити чергу");
    expect(alert.textContent).toContain(`Код: ${SUPPORT_ID}`);
    fail = false;
    act(() => within(alert).getByRole("button", { name: "Спробувати ще раз" }).click());
    await screen.findByRole("region", { name: "Starbucks" });
  });

  it("BUD-12@PoC FR 3: a card offers exactly «Пропустити», «Змінити категорію» and «Підтвердити»; keyboard reaches each with a name", async () => {
    const { api } = space({
      queue: [tx(1, "Starbucks", "-6.40"), tx(2, "Amazon", "-84.99")],
      groups: [group("g-star", "Starbucks", 1, "-6.40"), group("g-amzn", "Amazon", 1, "-84.99")],
    });
    open(api);
    await screen.findByRole("region", { name: "Starbucks" });
    const names = within(card())
      .getAllByRole("button")
      .map((b) => b.getAttribute("aria-label") ?? plain(b.textContent));
    expect(names).toEqual(["Пропустити", "Змінити категорію", "Підтвердити"]);
    for (const b of within(card()).getAllByRole("button")) expect(b.tabIndex).toBe(0);
  });

  /* Рішення ведучого (2026-11-21; власник не схвалював; BUD-12 S-058): the card shows the bank's text under the title. */
  describe("lead decision 2026-11-21: the bank's text on the card", () => {
    const BBVA =
      "COMPRA TARJ. 4999 PAGO CON TARJETA EN SUPERMERCADOS-ALIMENTACION-DE-BARRIO-SIN-ESPACIOS-0123456789 MADRID ES REF 2026111300123 OBSERVACIONES TARJETA 4999";
    const openCard = async (queue: Tx[]) => {
      const { api } = space({ queue, groups: [] });
      open(api);
      const one = await screen.findByRole("radio", { name: "По одній" });
      act(() => one.click());
      return screen.findByRole("region");
    };

    it("BUD-12@PoC FR 2: without a merchant the description is always shown under the title", async () => {
      const c = await openCard([tx(1, null as unknown as string, "-0.01", { description: BBVA })]);
      const line = c.querySelector<HTMLElement>(".review-card-text")!;
      expect(line.textContent).toBe(BBVA);
      expect(within(c).getByRole("heading", { name: "Без мерчанта" })).toBeTruthy();
    });

    it("BUD-12@PoC FR 2: with a merchant the description is shown only when it differs from the merchant", async () => {
      const same = await openCard([tx(1, "Starbucks", "-6.40", { description: " starbucks " })]);
      expect(same.querySelector(".review-card-text")).toBeNull();
      cleanup();
      const other = await openCard([tx(1, "Starbucks", "-6.40", { description: "STARBUCKS 0457 MADRID" })]);
      expect(other.querySelector(".review-card-text")!.textContent).toBe("STARBUCKS 0457 MADRID");
    });

    it("BUD-12@PoC FR 2: no description, no line; the title links to the transaction details (S-047)", async () => {
      const c = await openCard([tx(1, "Starbucks", "-6.40")]);
      expect(c.querySelector(".review-card-text")).toBeNull();
      const link = within(c).getByRole("link", { name: "Starbucks" });
      expect(link.getAttribute("href")).toBe(`#/money/transactions/${txId(1)}`);
    });
  });
});
