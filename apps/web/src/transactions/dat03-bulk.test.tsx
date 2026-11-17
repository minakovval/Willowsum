import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
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
import { resetNavigationSession } from "../routing/session.ts";
import { resetTracked } from "./bulk.ts";

/**
 * DAT-03@PoC b) (wave 2, row 118), CMP-73@PoC: the selection panel of «Транзакції» (S-046) and the bulk actions of
 * S-036 (canvas PocMoneyTx, PocBulk, PocBulkProgress, PocBulkReport). The server counts, previews and runs the action
 * (row 17); the fake API answers as it does. Synthetic data only.
 */
const ACC = "00000000-0000-4000-8000-000000000001";
const FOOD = "00000000-0000-4000-8000-0000000000c1";
const ACTION = "00000000-0000-4000-8000-0000000000a1";
const txId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const eur = (amount: string) => ({ amount, currency: "EUR" });
/** «Вибрати всі 42 за фільтром»: numbers are kept with their word by a no-break space. */
const nm = (text: string) => new RegExp(`^${text.replace(/ /g, "\\s")}$`);

function tx(n: number) {
  return {
    id: txId(n),
    accountId: ACC,
    amount: eur(`-${n}.50`),
    type: "expense",
    date: "2026-10-30",
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
    recordedAt: "2026-10-30T09:14:00Z",
  };
}

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
  income: total("0.00"),
  expense: total("-1000.00"),
  difference: total("-1000.00"),
};
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

function report(over: Record<string, unknown> = {}) {
  return {
    id: ACTION,
    action: "transactions.set-category",
    background: false,
    status: "completed",
    count: 12,
    processed: 12,
    changed: 10,
    skipped: { unavailable: 0, unchanged: 2, conflict: 0, invalid: 0 },
    skippedRecords: [
      { id: txId(1), reason: "unchanged", issue: null },
      { id: txId(2), reason: "unchanged", issue: null },
    ],
    undo: { available: true, until: "2026-11-18T12:00:00Z", restored: 0, notRestored: 0 },
    createdAt: "2026-11-17T12:00:00Z",
    endedAt: "2026-11-17T12:00:00Z",
    ...over,
  };
}

function preview(over: Record<string, unknown> = {}) {
  return {
    action: "transactions.set-category",
    count: 12,
    changes: 10,
    skipped: { unavailable: 0, unchanged: 2, conflict: 0, invalid: 0 },
    examples: [
      { id: txId(1), reason: "unchanged", issue: null },
      { id: txId(2), reason: "unchanged", issue: null },
    ],
    background: false,
    undoable: true,
    ...over,
  };
}

type Handlers = Record<string, Reply | ((call: Call, url: URL) => Reply | Promise<Reply>)>;

function open(count = 42, over: Handlers = {}) {
  const rows = Array.from({ length: count }, (_, i) => tx(i + 1));
  const h: Handlers = {
    "GET /v1/transactions": (_call, url) => {
      const page = Number(url.searchParams.get("page") ?? "1");
      const size = Number(url.searchParams.get("pageSize") ?? "25");
      const search = (url.searchParams.get("filter") ?? "").replace(/^search\.has:/, "");
      const shown = search ? rows.filter((r) => r.counterparty.includes(search)) : rows;
      const items = shown.slice((page - 1) * size, page * size);
      return {
        status: 200,
        body: {
          items,
          page,
          pageSize: size,
          count: shown.length,
          from: (page - 1) * size + 1,
          to: (page - 1) * size + items.length,
          summary: SUMMARY,
        },
      };
    },
    "GET /v1/accounts": { status: 200, body: { items: [], nextCursor: null } },
    "GET /v1/categories": { status: 200, body: { groups: GROUPS } },
    "GET /v1/transaction-review": { status: 200, body: { count: 0 } },
    "GET /v1/transfer-proposals": { status: 200, body: { items: [], count: 0, more: false } },
    "GET /v1/transaction-tags": { status: 200, body: { items: [] } },
    "GET /v1/merchants": { status: 200, body: { items: [] } },
    "POST /v1/transactions/selection-summary": (call) => {
      const ids = (call.body as { ids: string[] }).ids;
      const sum = ids.reduce((s, id) => s + Number(id.slice(-4)) * 100 + 50, 0);
      return {
        status: 200,
        body: {
          count: ids.length,
          currency: "EUR",
          sum: eur(`-${(sum / 100).toFixed(2)}`),
          approximate: false,
          nearestRateCount: 0,
          noRateCount: 0,
          convertedCount: 0,
        },
      };
    },
    "POST /v1/bulk-actions/preview": { status: 200, body: preview() },
    "POST /v1/bulk-actions": { status: 201, body: report() },
    [`GET /v1/bulk-actions/${ACTION}`]: { status: 200, body: report() },
    ...over,
  };
  for (const r of rows)
    h[`GET /v1/transactions/${r.id}/category`] = {
      status: 200,
      body: { transactionId: r.id, categoryId: FOOD, source: "manual" },
    };
  const api = fakeApi(h);
  renderAt("#/money/transactions", api.client);
  return api;
}

const loaded = () =>
  waitFor(() => expect(screen.getAllByRole("link", { name: /^Мерчант 3,/ }).length).toBe(1));
const check = (n: number) => screen.getByRole("checkbox", { name: `Вибрати Мерчант ${n}` });
const tickRows = (...ns: number[]) => {
  for (const n of ns) act(() => check(n).click());
};
const bar = () => screen.getByRole("toolbar", { name: "Дії з вибраними записами" });
const queryBar = () => screen.queryByRole("toolbar", { name: "Дії з вибраними записами" });
const headCheck = () => screen.getByRole("checkbox", { name: "Вибрати сторінку" });
const dialog = () => screen.getByRole("dialog");
async function openAction(name: string) {
  await act(async () => within(bar()).getByRole("button", { name: "Дії з вибраними" }).click());
  await act(async () => screen.getByRole("menuitem", { name }).click());
}
async function chooseFood() {
  await act(async () =>
    within(dialog())
      .getByRole("button", { name: /^Нова категорія/ })
      .click(),
  );
  await act(async () => within(dialog()).getByRole("option", { name: "Продукти" }).click());
}
const posts = (api: ReturnType<typeof fakeApi>, path: string) =>
  api.calls.filter((c) => c.method === "POST" && c.path === path);

beforeEach(() => {
  installMatchMedia({ width: 1280 });
  resetAuthState();
  resetNavigationSession();
  resetTracked();
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("DAT-03@PoC b): the selection panel of «Транзакції»", () => {
  it("DAT-03@PoC AC12: with 3 transactions ticked «Дії з вибраними» has exactly «Змінити категорію», «Додати теги», «Підтвердити категорії», and the panel has no separate action buttons", async () => {
    open();
    await loaded();
    expect(queryBar()).toBeNull();
    tickRows(3, 4, 5);
    const buttons = within(bar())
      .getAllByRole("button")
      .map((b) => b.getAttribute("aria-label") ?? b.textContent);
    expect(buttons).toEqual(["Дії з вибраними", "Зняти вибір"]);
    await act(async () => within(bar()).getByRole("button", { name: "Дії з вибраними" }).click());
    expect(screen.getAllByRole("menuitem").map((i) => i.textContent)).toEqual([
      "Змінити категорію",
      "Додати теги",
      "Підтвердити категорії",
    ]);
  });

  it("CMP-73@PoC AC1: two ticked transactions show «Вибрано 2 · Сума −8,00 €» from the server's sum of the selection, with «Дії з вибраними» and «×»", async () => {
    const api = open();
    await loaded();
    tickRows(3, 4);
    await waitFor(() => expect(plain(bar().textContent)).toContain("Вибрано 2· Сума −8,00 €"));
    expect(posts(api, "/v1/transactions/selection-summary").at(-1)!.body).toEqual({
      ids: [txId(3), txId(4)],
    });
  });

  it("DAT-03@PoC FR 1, CMP-73@PoC AC2, AC9: «Вибрати сторінку» ticks the 25 rows; «Вибрати всі 42 за фільтром» → «Вибрано всі 42 за фільтром»; unticking 2 rows → «Вибрано 40 за фільтром», the sum without them; the action gets the filter and the unticked rows, not ids", async () => {
    const api = open();
    await loaded();
    act(() => headCheck().click());
    expect(plain(bar().textContent)).toContain("Вибрано 25");
    await act(async () =>
      within(bar())
        .getByRole("button", { name: nm("Вибрати всі 42 за фільтром") })
        .click(),
    );
    expect(plain(bar().textContent)).toContain("Вибрано всі 42 за фільтром");
    // «Різниця» of the list is the sum of all by the filter.
    await waitFor(() => expect(plain(bar().textContent)).toContain("Сума −1 000,00 €"));
    tickRows(1, 2);
    expect(plain(bar().textContent)).toContain("Вибрано 40 за фільтром");
    // −1 000,00 less (−1,50 − 2,50).
    await waitFor(() => expect(plain(bar().textContent)).toContain("Сума −996,00 €"));
    await openAction("Підтвердити категорії");
    await waitFor(() => expect(posts(api, "/v1/bulk-actions/preview").length).toBe(1));
    expect(posts(api, "/v1/bulk-actions/preview")[0]!.body).toEqual({
      action: "transactions.confirm-category",
      selection: { kind: "filter", filter: [], excluded: [txId(1), txId(2)] },
      params: {},
    });
  });

  it("DAT-03@PoC FR 1, CMP-73@PoC AC4: a change of the list's conditions (the search) clears the selection and the panel goes", async () => {
    open();
    await loaded();
    tickRows(3);
    expect(queryBar()).not.toBeNull();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Мерчант 1" } });
    await waitFor(() => expect(queryBar()).toBeNull());
  });

  it("CMP-73@PoC AC5: Enter on «×» clears the selection, the panel goes and focus is on the header checkbox", async () => {
    open();
    await loaded();
    tickRows(3, 4);
    const clear = within(bar()).getByRole("button", { name: "Зняти вибір" });
    act(() => clear.focus());
    fireEvent.keyDown(clear, { key: "Enter" });
    act(() => clear.click());
    expect(queryBar()).toBeNull();
    expect(document.activeElement).toBe(headCheck());
    expect((check(3) as HTMLInputElement).checked).toBe(false);
  });

  it("CMP-73@PoC AC6: five ticked with two in złoty — the reader politely hears «Вибрано 5 · Сума …», the hint of the sum says «2 транзакції конвертовано»", async () => {
    open(42, {
      "POST /v1/transactions/selection-summary": {
        status: 200,
        body: {
          count: 5,
          currency: "EUR",
          sum: eur("-120.40"),
          approximate: false,
          nearestRateCount: 0,
          noRateCount: 0,
          convertedCount: 2,
        },
      },
    });
    await loaded();
    tickRows(3, 4, 5, 6, 7);
    const status = within(bar()).getByRole("status");
    await waitFor(() => expect(plain(status.textContent)).toBe("Вибрано 5 · Сума −120,40 €"));
    const sum = within(bar()).getByText(/^Сума/);
    act(() => sum.focus());
    expect(plain(screen.getByRole("tooltip").textContent)).toBe("2 транзакції конвертовано");
  });

  it("CMP-73@PoC AC8: one of four without a rate of its date — the sum is «приблизно» and its hint says «1 транзакція за найближчим курсом»", async () => {
    open(42, {
      "POST /v1/transactions/selection-summary": {
        status: 200,
        body: {
          count: 4,
          currency: "EUR",
          sum: eur("-60.00"),
          approximate: true,
          nearestRateCount: 1,
          noRateCount: 0,
          convertedCount: 1,
        },
      },
    });
    await loaded();
    tickRows(3, 4, 5, 6);
    await waitFor(() => expect(plain(bar().textContent)).toContain("Сума приблизно −60,00 €"));
    act(() => within(bar()).getByText(/^Сума/).focus());
    expect(plain(screen.getByRole("tooltip").textContent)).toBe(
      "1 транзакція за найближчим курсом · 1 транзакцію конвертовано",
    );
  });
});

describe("DAT-03@PoC b): S-036 «Дії з вибраними»", () => {
  it("DAT-03@PoC AC1, FR 3: 12 ticked, 2 already «Продукти» — before anything runs the summary says «Зміниться 10, пропущено 2: без змін» with the examples, that the action runs at once and can be undone", async () => {
    const api = open();
    await loaded();
    tickRows(...Array.from({ length: 12 }, (_, i) => i + 1));
    await openAction("Змінити категорію");
    expect(dialog().getAttribute("aria-labelledby")).not.toBeNull();
    expect(screen.getByRole("heading", { name: nm("Змінити категорію для 12 транзакцій") })).not.toBeNull();
    await chooseFood();
    await waitFor(() => expect(plain(dialog().textContent)).toContain("Зміниться 10, пропущено 2: без змін"));
    expect(plain(dialog().textContent)).toContain("«Мерчант 1» — без змін; «Мерчант 2» — без змін");
    expect(plain(dialog().textContent)).toContain(
      "Дія виконається одразу. Відмінити її можна протягом 24 годин",
    );
    expect(posts(api, "/v1/bulk-actions")).toHaveLength(0);
    expect(posts(api, "/v1/bulk-actions/preview").at(-1)!.body).toMatchObject({
      action: "transactions.set-category",
      selection: { kind: "ids" },
      params: { categoryId: FOOD },
    });
    expect(within(dialog()).getByRole("button", { name: "Скасувати" })).not.toBeNull();
    await act(async () => within(dialog()).getByRole("button", { name: "Змінити категорію" }).click());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // DAT-03 FR 8: the report — changed and skipped with reasons, «Відмінити» with the time left.
    expect(plain(screen.getByText(/^Категорію змінено/).textContent)).toBe(
      "Категорію змінено для 10 з 12 транзакцій",
    );
    expect(queryBar()).toBeNull();
  });

  it(
    "DAT-03@PoC AC2, FR 6: «Додати теги» on all 300 by the filter runs in the background — «Оброблено X з 300» refreshes, and the strip is there after the user went to another screen and came back",
    { timeout: 20000 },
    async () => {
      let processed = 0;
      const running = () => ({
        status: 200,
        body: report({
          action: "transactions.add-tags",
          background: true,
          status: "running",
          count: 300,
          processed,
          changed: processed,
          endedAt: null,
          skipped: { unavailable: 0, unchanged: 0, conflict: 0, invalid: 0 },
          skippedRecords: [],
        }),
      });
      const api = open(300, {
        "POST /v1/bulk-actions/preview": {
          status: 200,
          body: preview({ action: "transactions.add-tags", count: 300, changes: 300, background: true }),
        },
        "POST /v1/bulk-actions": () => ({ ...running(), status: 201 }),
        [`GET /v1/bulk-actions/${ACTION}`]: running,
      });
      await loaded();
      act(() => headCheck().click());
      await act(async () =>
        within(bar())
          .getByRole("button", { name: nm("Вибрати всі 300 за фільтром") })
          .click(),
      );
      await openAction("Додати теги");
      fireEvent.change(within(dialog()).getByRole("textbox", { name: /^Теги/ }), {
        target: { value: "відпустка, родина" },
      });
      await waitFor(() => expect(dialog().textContent).toContain("Дія виконається у фоні"));
      expect(posts(api, "/v1/bulk-actions/preview").at(-1)!.body).toMatchObject({
        params: { tags: ["відпустка", "родина"] },
      });
      await act(async () => within(dialog()).getByRole("button", { name: "Додати теги" }).click());
      await waitFor(() =>
        expect(plain(screen.getByRole("status", { name: "Масова дія" }).textContent)).toContain(
          "Оброблено 0 з 300",
        ),
      );
      expect(screen.getByRole("status", { name: "Масова дія" }).textContent).toContain(
        "Можна продовжувати роботу",
      );
      processed = 120;
      await waitFor(
        () =>
          expect(plain(screen.getByRole("status", { name: "Масова дія" }).textContent)).toContain(
            "Оброблено 120 з 300",
          ),
        { timeout: 3000 },
      );
      act(() => {
        window.location.hash = "#/money/accounts";
        window.dispatchEvent(new HashChangeEvent("hashchange"));
      });
      act(() => {
        window.location.hash = "#/money/transactions";
        window.dispatchEvent(new HashChangeEvent("hashchange"));
      });
      await waitFor(() =>
        expect(plain(screen.getByRole("status", { name: "Масова дія" }).textContent)).toContain(
          "Оброблено 120 з 300",
        ),
      );
      // FR 6: while it runs another action cannot start: «Дії з вибраними» is inactive with the reason.
      await loaded();
      tickRows(3);
      expect(
        within(bar()).getByRole("button", { name: "Дії з вибраними" }).getAttribute("aria-disabled"),
      ).toBe("true");
    },
  );

  it("DAT-03@PoC AC3, FR 9: «Відмінити» within 24 h — the report says 9 restored and 1 «не відновлено»", async () => {
    vi.useFakeTimers({ now: Date.parse("2026-11-17T15:00:00Z"), shouldAdvanceTime: true });
    const api = open(42, {
      // 21 h and a few seconds are left of the window: the time shown is whole minutes, rounded down.
      [`GET /v1/bulk-actions/${ACTION}`]: {
        status: 200,
        body: report({
          undo: { available: true, until: "2026-11-18T12:00:30Z", restored: 0, notRestored: 0 },
        }),
      },
      [`POST /v1/bulk-actions/${ACTION}/undo`]: {
        status: 200,
        body: report({
          status: "undone",
          undo: { available: false, until: null, restored: 9, notRestored: 1 },
        }),
      },
    });
    sessionStorage.setItem("ws.bulkAction", JSON.stringify({ id: ACTION }));
    resetTracked();
    await loaded();
    await waitFor(() => expect(screen.getByText(/^Категорію змінено/)).not.toBeNull());
    expect(plain(screen.getByText(/^Пропущено/).textContent)).toBe(
      "Пропущено 2: без змін. Відмінити можна ще 21 год 0 хв.",
    );
    await act(async () => screen.getByRole("button", { name: "Відмінити" }).click());
    await waitFor(() =>
      expect(screen.getByText(/^Дію відмінено/).textContent).toBe(
        "Дію відмінено: відновлено 9, не відновлено 1.",
      ),
    );
    expect(posts(api, `/v1/bulk-actions/${ACTION}/undo`)).toHaveLength(1);
    vi.useRealTimers();
  });

  it("DAT-03@PoC AC4: the report of an action finished 25 h ago — «Відмінити» is inactive", async () => {
    vi.useFakeTimers({ now: Date.parse("2026-11-18T13:00:00Z"), shouldAdvanceTime: true });
    open(42, {
      [`GET /v1/bulk-actions/${ACTION}`]: {
        status: 200,
        body: report({
          undo: { available: false, until: "2026-11-18T12:00:00Z", restored: 0, notRestored: 0 },
        }),
      },
    });
    sessionStorage.setItem("ws.bulkAction", JSON.stringify({ id: ACTION }));
    resetTracked();
    await loaded();
    const undo = await screen.findByRole("button", { name: "Відмінити" });
    expect(undo.getAttribute("aria-disabled") ?? String((undo as HTMLButtonElement).disabled)).toBe("true");
    expect(document.body.textContent).toContain("Час, щоб відмінити дію, минув.");
    vi.useRealTimers();
  });

  it("DAT-03@PoC AC5: «Деталі» lists a record of another space as «Недоступний запис» — no name, no link", async () => {
    open(42, {
      [`GET /v1/bulk-actions/${ACTION}`]: {
        status: 200,
        body: report({
          skipped: { unavailable: 1, unchanged: 1, conflict: 0, invalid: 0 },
          skippedRecords: [
            { id: "00000000-0000-4000-8000-00000000ffff", reason: "unavailable", issue: null },
            { id: txId(2), reason: "unchanged", issue: null },
          ],
        }),
      },
    });
    sessionStorage.setItem("ws.bulkAction", JSON.stringify({ id: ACTION }));
    resetTracked();
    await loaded();
    await act(async () => (await screen.findByRole("button", { name: "Деталі" })).click());
    const items = within(dialog()).getAllByRole("listitem");
    expect(plain(items[0]!.textContent)).toBe("Недоступний запис — недоступний");
    expect(within(items[0]!).queryByRole("link")).toBeNull();
    expect(within(items[1]!).getByRole("link", { name: "Відкрити" }).getAttribute("href")).toBe(
      `#/money/transactions/${txId(2)}`,
    );
  });

  it("DAT-03@PoC AC7: a second action while one runs is refused with «Інша масова дія ще виконується»", async () => {
    open(42, { "POST /v1/bulk-actions": problem(409, "BULK_ACTION_RUNNING") });
    await loaded();
    tickRows(3);
    await openAction("Підтвердити категорії");
    await waitFor(() => expect(dialog().textContent).toContain("Зміниться 10"));
    await act(async () => within(dialog()).getByRole("button", { name: "Підтвердити категорії" }).click());
    await waitFor(() => expect(dialog().textContent).toContain("Інша масова дія ще виконується"));
  });

  it(
    "DAT-03@PoC AC10: 600 by the filter — the action is refused with the maximum of 500 records",
    { timeout: 20000 },
    async () => {
      const limit: Reply = {
        status: 422,
        body: {
          type: "urn:willowsum:problem:limit_reached",
          title: "",
          status: 422,
          code: "LIMIT_REACHED",
          limit: 500,
        },
        headers: { "content-type": "application/problem+json" },
      };
      const api = open(600, { "POST /v1/bulk-actions/preview": limit });
      await loaded();
      act(() => headCheck().click());
      await act(async () =>
        within(bar())
          .getByRole("button", { name: nm("Вибрати всі 600 за фільтром") })
          .click(),
      );
      await openAction("Підтвердити категорії");
      await waitFor(() =>
        expect(plain(dialog().textContent)).toContain(
          "За одну дію — не більше 500 записів. Звузьте вибір фільтром.",
        ),
      );
      const run = within(dialog()).getByRole("button", { name: "Підтвердити категорії" });
      expect(run.getAttribute("aria-disabled") ?? String((run as HTMLButtonElement).disabled)).toBe("true");
      expect(posts(api, "/v1/bulk-actions")).toHaveLength(0);
    },
  );

  it("DAT-03@PoC FR 10: an interrupted action shows «Перервано» with «Продовжити», which runs the rest", async () => {
    const api = open(42, {
      [`GET /v1/bulk-actions/${ACTION}`]: {
        status: 200,
        body: report({ status: "interrupted", background: true, count: 400, processed: 120, changed: 120 }),
      },
      [`POST /v1/bulk-actions/${ACTION}/resume`]: {
        status: 200,
        body: report({ status: "running", background: true, count: 400, processed: 120, endedAt: null }),
      },
    });
    sessionStorage.setItem("ws.bulkAction", JSON.stringify({ id: ACTION }));
    resetTracked();
    await loaded();
    await waitFor(() => expect(screen.getByText("Перервано")).not.toBeNull());
    expect(plain(document.body.textContent)).toContain("Оброблено 120 з 400");
    await act(async () => screen.getByRole("button", { name: "Продовжити" }).click());
    expect(posts(api, `/v1/bulk-actions/${ACTION}/resume`)).toHaveLength(1);
    await waitFor(() => expect(screen.getByRole("status", { name: "Масова дія" })).not.toBeNull());
  });

  it("DAT-03@PoC «Стани інтерфейсу» «Помилка»: a failed start shows «Дію не виконано», «Спробувати ще раз» and the code; the retry sends the action again", async () => {
    let fail = true;
    const api = open(42, {
      "POST /v1/bulk-actions": () => (fail ? problem(500, "INTERNAL") : { status: 201, body: report() }),
    });
    await loaded();
    tickRows(3);
    await openAction("Підтвердити категорії");
    await waitFor(() => expect(dialog().textContent).toContain("Зміниться 10"));
    await act(async () => within(dialog()).getByRole("button", { name: "Підтвердити категорії" }).click());
    await waitFor(() => expect(dialog().textContent).toContain("Дію не виконано"));
    expect(dialog().textContent).toContain(`Код: ${SUPPORT_ID}`);
    fail = false;
    await act(async () => within(dialog()).getByRole("button", { name: "Спробувати ще раз" }).click());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(posts(api, "/v1/bulk-actions")).toHaveLength(2);
  });
});
