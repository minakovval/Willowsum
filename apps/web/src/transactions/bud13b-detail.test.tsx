import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { contrastRatio, colors } from "@willowsum/ui";
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
import { hrefFor } from "../routing/useHashPath.ts";
import { filteredTransactionsPath } from "./filters.ts";

/**
 * BUD-13@PoC b), FIN-03@PoC e) (wave 2, row 117, part b2): in S-047 «Деталь транзакції» — «Теги», «Нотатка», «Розділити»
 * opening S-049 and its result, «Об’єднати назад», «Схожі транзакції» (canvas PocMoneyTxDetail). Synthetic data only.
 */
const ACC = "00000000-0000-4000-8000-000000000001";
const FOOD = "00000000-0000-4000-8000-0000000000c1";
const HOME = "00000000-0000-4000-8000-0000000000c2";
const CAR = "00000000-0000-4000-8000-0000000000c3";
const SALARY = "00000000-0000-4000-8000-0000000000c4";
const TX = "00000000-0000-4000-8000-0000000000aa";
const DETAIL = `#/money/transactions/${TX}`;
const ATTRS = `PATCH /v1/transactions/${TX}/attributes`;
const SPLIT = `POST /v1/transactions/${TX}/split`;
const UNSPLIT = `DELETE /v1/transactions/${TX}/split`;

type Tx = Record<string, unknown> & { tags: { id: string; name: string }[]; note: string | null };
function tx(over: Record<string, unknown> = {}): Tx {
  return {
    id: TX,
    accountId: ACC,
    amount: { amount: "-240.00", currency: "EUR" },
    type: "expense",
    date: "2026-03-01",
    counterparty: "Leroy Merlin",
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
    review: null,
    version: 1,
    recordedAt: "2026-03-01T09:14:00Z",
    ...over,
  } as Tx;
}

const category = (id: string, name: string, kind: "expense" | "income", hidden = false) => ({
  id,
  groupId: kind,
  systemKey: null,
  kind,
  name,
  renamed: false,
  icon: "budget",
  color: "#5872D2",
  iconTone: "white",
  essential: null,
  hidden,
  deletable: true,
});
const GROUPS = [
  {
    id: "expense",
    systemKey: null,
    kind: "expense",
    name: "Витрати",
    renamed: false,
    tone: "#5872D2",
    categories: [
      category(FOOD, "Продукти", "expense"),
      category(HOME, "Дім", "expense"),
      category(CAR, "Страховка авто", "expense"),
      category("00000000-0000-4000-8000-0000000000c9", "Прихована", "expense", true),
    ],
  },
  {
    id: "income",
    systemKey: null,
    kind: "income",
    name: "Доходи",
    renamed: false,
    tone: "#2E7D5B",
    categories: [category(SALARY, "Зарплата", "income")],
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
  updatedOn: "2026-03-01",
  favourite: false,
  inProfileCurrency: { total: { amount: "1.00", currency: "EUR" }, approximate: false, unavailableCount: 0 },
  currencies: [],
  creditCard: null,
  loan: null,
};

const tag = (n: number, name: string) => ({
  id: `00000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`,
  name,
});

type Handlers = Record<string, Reply | ((call: { body?: unknown }) => Reply | Promise<Reply>)>;
function handlers(row: () => Tx, over: Handlers = {}): Handlers {
  return {
    [`GET /v1/transactions/${TX}`]: () => ({ status: 200, body: row() }),
    [`GET /v1/transactions/${TX}/category`]: {
      status: 200,
      body: { transactionId: TX, categoryId: HOME, source: "bank" },
    },
    "GET /v1/categories": { status: 200, body: { groups: GROUPS } },
    [`GET /v1/accounts/${ACC}`]: { status: 200, body: ACCOUNT },
    "GET /v1/duplicate-proposals": { status: 200, body: { items: [], count: 0, more: false } },
    "GET /v1/transaction-review": { status: 200, body: { count: 0 } },
    "GET /v1/transaction-tags": {
      status: 200,
      body: {
        items: [
          { ...tag(1, "ремонт-кухні"), count: 3 },
          { ...tag(2, "повернути"), count: 1 },
        ],
      },
    },
    ...over,
  };
}

/** The server's PATCH: the fields sent change; tags by name, a new one gets an id. */
function attributesServer(state: { row: Tx }) {
  return (call: { body?: unknown }): Reply => {
    const body = call.body as { note?: string | null; tags?: string[] };
    const tags =
      body.tags === undefined
        ? state.row.tags
        : body.tags.map((name, i) => state.row.tags.find((x) => x.name === name) ?? tag(50 + i, name));
    state.row = { ...state.row, tags, note: body.note === undefined ? state.row.note : body.note };
    return { status: 200, body: state.row };
  };
}

function open(h: Handlers) {
  const api = fakeApi(h as Parameters<typeof fakeApi>[0]);
  renderAt(DETAIL, api.client);
  return api;
}

const card = () => screen.getByRole("heading", { level: 1 }).closest<HTMLElement>("section")!;
const loaded = (name = "Leroy Merlin") =>
  waitFor(() => expect(screen.getByRole("heading", { level: 1, name })).toBeTruthy());
const row = (label: string) =>
  [...card().querySelectorAll<HTMLElement>(".txd-facts > div")].find(
    (d) => d.querySelector("dt")?.textContent === label,
  );
const button = (name: string | RegExp) => within(card()).getByRole("button", { name });
const calls = (api: ReturnType<typeof fakeApi>, key: string) =>
  api.calls.filter((c) => `${c.method} ${c.path}` === key);

async function addTag(name: string) {
  await act(async () => button(/^(\+ Тег|Додайте тег)$/).click());
  const input = await waitFor(() => within(card()).getByRole("combobox", { name: "Новий тег" }));
  fireEvent.change(input, { target: { value: name } });
  await act(async () => fireEvent.keyDown(input, { key: "Enter" }));
}

beforeEach(() => {
  installMatchMedia({ width: 1280 });
  resetAuthState();
  resetNavigationSession();
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("BUD-13@PoC b): attributes in S-047 «Деталь транзакції»", () => {
  it("BUD-13@PoC FR 1: the details have «Нотатка», «Теги», «Розділити» and «Схожі транзакції»; empty — «Додайте нотатку», «Додайте тег»", async () => {
    const state = { row: tx() };
    open(handlers(() => state.row));
    await loaded();
    expect(row("Теги")).toBeTruthy();
    expect(row("Нотатка")).toBeTruthy();
    expect(within(row("Теги")!).getByRole("button", { name: "Додайте тег" })).toBeTruthy();
    expect(within(row("Нотатка")!).getByRole("button", { name: "Додайте нотатку" })).toBeTruthy();
    expect(button("Розділити")).toBeTruthy();
    expect(within(card()).getByRole("link", { name: "Схожі транзакції" })).toBeTruthy();
  });

  it("BUD-13@PoC AC1: the note «фарба і валики» and the space's tags «ремонт-кухні», «повернути» are saved and shown in the details", async () => {
    const state = { row: tx() };
    const api = open(handlers(() => state.row, { [ATTRS]: attributesServer(state) }));
    await loaded();

    await act(async () => button("Додайте нотатку").click());
    const area = within(card()).getByRole("textbox", { name: "Нотатка" });
    expect(document.activeElement).toBe(area);
    fireEvent.change(area, { target: { value: "фарба і валики" } });
    await act(async () => button("Зберегти").click());
    await waitFor(() => expect(within(row("Нотатка")!).getByText("фарба і валики")).toBeTruthy());
    expect(document.activeElement).toBe(button("Змінити нотатку"));

    await addTag("ремонт-кухні");
    await waitFor(() =>
      expect(within(row("Теги")!).getByRole("listitem").textContent).toContain("ремонт-кухні"),
    );
    // The space's tags are offered while typing (BUD-13@PoC FR 2: shared by the space).
    await act(async () => button("+ Тег").click());
    const options = [...card().querySelectorAll("datalist option")].map((o) => o.getAttribute("value"));
    expect(options).toEqual(["повернути"]);
    const input = within(card()).getByRole("combobox", { name: "Новий тег" });
    fireEvent.change(input, { target: { value: "повернути" } });
    await act(async () => fireEvent.keyDown(input, { key: "Enter" }));
    await waitFor(() =>
      expect(
        within(row("Теги")!)
          .getAllByRole("listitem")
          .map((li) => li.textContent),
      ).toEqual(["•ремонт-кухні", "•повернути"]),
    );

    expect(calls(api, ATTRS).map((c) => c.body)).toEqual([
      { note: "фарба і валики" },
      { tags: ["ремонт-кухні"] },
      { tags: ["ремонт-кухні", "повернути"] },
    ]);
    // The saved transaction replaces the shown one: the details are not read again.
    expect(calls(api, `GET /v1/transactions/${TX}`)).toHaveLength(1);
  });

  it("BUD-13@PoC FR 2: a tag already on the transaction in another case is not sent again; «Прибрати тег» removes one", async () => {
    const state = { row: tx({ tags: [tag(1, "Ремонт"), tag(2, "родина")] }) };
    const api = open(handlers(() => state.row, { [ATTRS]: attributesServer(state) }));
    await loaded();
    await addTag("  ремонт ");
    expect(calls(api, ATTRS)).toHaveLength(0);
    expect(document.activeElement).toBe(button("+ Тег"));
    await act(async () => button("Прибрати тег «Ремонт»").click());
    await waitFor(() =>
      expect(
        within(row("Теги")!)
          .getAllByRole("listitem")
          .map((li) => li.textContent),
      ).toEqual(["•родина"]),
    );
    expect(calls(api, ATTRS).map((c) => c.body)).toEqual([{ tags: ["родина"] }]);
  });

  it("BUD-13@PoC FR 2: at 20 tags «+ Тег» is gone and «Досягнуто 20 тегів» is shown", async () => {
    const twenty = Array.from({ length: 20 }, (_, i) => tag(i + 1, `тег ${String(i + 1)}`));
    const state = { row: tx({ tags: twenty }) };
    open(handlers(() => state.row));
    await loaded();
    expect(within(row("Теги")!).queryByRole("button", { name: "+ Тег" })).toBeNull();
    expect(within(row("Теги")!).getByText("Досягнуто 20 тегів")).toBeTruthy();
  });

  it("S-047 states: «Зберігаємо…» while a note is saved; a refused save — «Помилка», what failed and «Код: …», the note field stays open", async () => {
    const state = { row: tx() };
    let answer: (r: Reply) => void = () => undefined;
    let first = true;
    open(
      handlers(() => state.row, {
        [ATTRS]: () => {
          if (first) {
            first = false;
            return new Promise<Reply>((r) => (answer = r));
          }
          return problem(409, "ACCOUNT_CLOSED");
        },
      }),
    );
    await loaded();
    await act(async () => button("Додайте нотатку").click());
    fireEvent.change(within(card()).getByRole("textbox", { name: "Нотатка" }), { target: { value: "x" } });
    await act(async () => button("Зберегти").click());
    expect(within(card()).getByRole("status").textContent).toBe("Зберігаємо…");
    await act(async () => answer(problem(503, "MODULE_UNAVAILABLE")));
    await waitFor(() => expect(within(card()).queryByRole("status")).toBeNull());
    await act(async () => button("Зберегти").click());
    const alert = await waitFor(() => within(card()).getByRole("alert"));
    expect(plain(alert.textContent)).toContain("Помилка");
    expect(plain(alert.textContent)).toContain(`Код: ${SUPPORT_ID}`);
    expect(within(card()).getByRole("textbox", { name: "Нотатка" })).toBeTruthy();
  });

  it("S-047 keyboard: Escape closes the note field without saving, focus back on «Додайте нотатку»", async () => {
    const state = { row: tx() };
    const api = open(handlers(() => state.row, { [ATTRS]: attributesServer(state) }));
    await loaded();
    await act(async () => button("Додайте нотатку").click());
    const area = within(card()).getByRole("textbox", { name: "Нотатка" });
    fireEvent.change(area, { target: { value: "чернетка" } });
    await act(async () => fireEvent.keyDown(area, { key: "Escape" }));
    expect(within(card()).queryByRole("textbox", { name: "Нотатка" })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(button("Додайте нотатку")));
    expect(calls(api, ATTRS)).toHaveLength(0);
  });

  it("FIN-03@PoC FR 11: a merged duplicate's attributes cannot be changed — no «Додайте …», no «Розділити»", async () => {
    const state = {
      row: tx({ mergedInto: "00000000-0000-4000-8000-0000000000bb", note: "стара", tags: [tag(1, "дім")] }),
    };
    open(handlers(() => state.row));
    await loaded();
    expect(
      within(card()).queryByRole("button", { name: /Додайте|Змінити нотатку|\+ Тег|Прибрати тег/ }),
    ).toBeNull();
    expect(within(card()).queryByRole("button", { name: "Розділити" })).toBeNull();
    expect(within(row("Нотатка")!).getByText("стара")).toBeTruthy();
  });
});

describe("BUD-13@PoC b): «Розділити» from S-047 and the split in the details", () => {
  it("BUD-13@PoC AC2: «Розділити» opens S-049; 6 months from March are saved — «розділено на 6 міс.», the full schedule in the details, focus back on «Розділити»", async () => {
    const months = ["03", "04", "05", "06", "07", "08"];
    const state = {
      row: tx({ amount: { amount: "-1200.00", currency: "EUR" }, counterparty: "Страховка авто" }),
    };
    const api = open(
      handlers(() => state.row, {
        [SPLIT]: () => {
          state.row = {
            ...state.row,
            split: {
              mode: "months",
              needsReview: false,
              parts: months.map((m) => ({
                categoryId: CAR,
                month: `2026-${m}`,
                amount: { amount: "-200.00", currency: "EUR" },
              })),
            },
          };
          return { status: 200, body: state.row };
        },
      }),
    );
    await loaded("Страховка авто");
    const opener = button("Розділити");
    opener.focus();
    await act(async () => opener.click());
    const dialog = screen.getByRole("dialog", { name: "Розділити транзакцію" });
    expect(plain(within(dialog).getByText(/Страховка авто ·/).textContent)).toBe(
      "Страховка авто · −1 200,00 € · 1 бер. 2026 р. · Поточний ··4417",
    );
    // Only the space's visible categories of the transaction's type are offered (BUD-01 FR 6).
    const choices = within(dialog).getAllByRole("combobox")[0]!.querySelectorAll("option");
    expect([...choices].map((o) => o.textContent)).toEqual([
      "Оберіть категорію",
      "Продукти",
      "Дім",
      "Страховка авто",
    ]);
    fireEvent.click(within(dialog).getByRole("radio", { name: "На кілька місяців" }));
    fireEvent.change(within(dialog).getByLabelText(/^Місяців/), { target: { value: "6" } });
    fireEvent.change(within(dialog).getByLabelText(/^Категорія$/), { target: { value: CAR } });
    await act(async () => within(dialog).getByRole("button", { name: "Зберегти" }).click());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(calls(api, SPLIT)[0]?.body).toEqual({
      mode: "months",
      startMonth: "2026-03",
      months: 6,
      categoryId: CAR,
    });
    expect(plain(card().querySelector(".txd-marks")?.textContent)).toContain("розділено на 6 міс.");
    const parts = within(row("Розділення")!)
      .getAllByRole("listitem")
      .map((li) => plain(li.textContent));
    expect(parts).toEqual(
      ["Березень", "Квітень", "Травень", "Червень", "Липень", "Серпень"].map((m) => `${m} 2026−200,00 €`),
    );
    expect(within(row("Розділення")!).getByText("Страховка авто")).toBeTruthy();
    expect(document.activeElement).toBe(button("Розділити"));
  });

  it("BUD-13@PoC FR 6: the full schedule of 36 months is in the details after saving, every share with its month", async () => {
    const parts = Array.from({ length: 36 }, (_, k) => ({
      categoryId: CAR,
      month: `${String(2026 + Math.floor((k + 2) / 12))}-${String(((k + 2) % 12) + 1).padStart(2, "0")}`,
      amount: { amount: k === 35 ? "-33.45" : "-33.33", currency: "EUR" },
    }));
    const state = {
      row: tx({
        amount: { amount: "-1200.00", currency: "EUR" },
        split: { mode: "months", needsReview: false, parts },
      }),
    };
    open(handlers(() => state.row));
    await loaded();
    const items = within(row("Розділення")!)
      .getAllByRole("listitem")
      .map((li) => plain(li.textContent));
    expect(items).toHaveLength(36);
    expect(items[0]).toBe("Березень 2026−33,33 €");
    expect(items[35]).toBe("Лютий 2029−33,45 €");
  });

  it("BUD-13@PoC FR 8: a split by categories shows every part in the details; «Об’єднати назад» sends DELETE …/split and the transaction is whole again", async () => {
    const state = {
      row: tx({
        amount: { amount: "-132.40", currency: "EUR" },
        split: {
          mode: "categories",
          needsReview: false,
          parts: [
            { categoryId: FOOD, month: null, amount: { amount: "-85.00", currency: "EUR" } },
            { categoryId: HOME, month: null, amount: { amount: "-35.00", currency: "EUR" } },
            { categoryId: CAR, month: null, amount: { amount: "-12.40", currency: "EUR" } },
          ],
        },
      }),
    };
    const api = open(
      handlers(() => state.row, {
        [UNSPLIT]: () => {
          state.row = { ...state.row, split: null };
          return { status: 200, body: state.row };
        },
      }),
    );
    await loaded();
    expect(card().querySelector(".txd-marks")?.textContent).toContain("розділено");
    expect(
      within(row("Розділення")!)
        .getAllByRole("listitem")
        .map((li) => plain(li.textContent)),
    ).toEqual(["Продукти−85,00 €", "Дім−35,00 €", "Страховка авто−12,40 €"]);
    await act(async () => button("Об’єднати назад").click());
    await waitFor(() => expect(row("Розділення")).toBeUndefined());
    expect(calls(api, UNSPLIT)).toHaveLength(1);
    expect(card().querySelector(".txd-marks")).toBeNull();
    expect(within(card()).queryByRole("button", { name: "Об’єднати назад" })).toBeNull();
  });

  it("BUD-13@PoC EC4: a split whose original amount changed on re-import is marked «потребує перегляду»", async () => {
    const state = {
      row: tx({
        review: "queued",
        split: {
          mode: "categories",
          needsReview: true,
          parts: [
            { categoryId: FOOD, month: null, amount: { amount: "-200.00", currency: "EUR" } },
            { categoryId: HOME, month: null, amount: { amount: "-40.00", currency: "EUR" } },
          ],
        },
      }),
    };
    open(handlers(() => state.row));
    await loaded();
    expect(within(row("Розділення")!).getByText("потребує перегляду")).toBeTruthy();
  });

  it("BUD-13@PoC EC6: a side of a transfer between own accounts has no «Розділити»", async () => {
    const state = {
      row: tx({
        transfer: {
          pairId: "00000000-0000-4000-8000-0000000000dd",
          counterpartId: "00000000-0000-4000-8000-0000000000bb",
        },
      }),
    };
    open(handlers(() => state.row));
    await loaded();
    expect(within(card()).queryByRole("button", { name: "Розділити" })).toBeNull();
    expect(within(card()).getByRole("link", { name: "Схожі транзакції" })).toBeTruthy();
  });

  it("S-047: a refused «Об’єднати назад» shows «Помилка» with «Код: …»; the split stays", async () => {
    const state = {
      row: tx({
        split: {
          mode: "categories",
          needsReview: false,
          parts: [
            { categoryId: FOOD, month: null, amount: { amount: "-200.00", currency: "EUR" } },
            { categoryId: HOME, month: null, amount: { amount: "-40.00", currency: "EUR" } },
          ],
        },
      }),
    };
    open(handlers(() => state.row, { [UNSPLIT]: problem(409, "ACCOUNT_CLOSED") }));
    await loaded();
    await act(async () => button("Об’єднати назад").click());
    const alert = await waitFor(() => within(card()).getByRole("alert"));
    expect(plain(alert.textContent)).toContain(`Код: ${SUPPORT_ID}`);
    expect(row("Розділення")).toBeTruthy();
  });

  it("BUD-13@PoC FR 10: «Схожі транзакції» opens «Транзакції» with the filter «Мерчант: <назва>»", async () => {
    const state = { row: tx() };
    open(handlers(() => state.row));
    await loaded();
    const link = within(card()).getByRole("link", { name: "Схожі транзакції" });
    expect(link.getAttribute("href")).toBe(hrefFor(filteredTransactionsPath({ merchant: "Leroy Merlin" })));
  });
});

describe("BUD-13@PoC b): S-047 attribute accessibility", () => {
  it("NFR-08@PoC: the tag chip (ink on surface-300) and «+ Тег» (link on surface-100) meet 4.5 : 1", () => {
    expect(contrastRatio(colors.ink.light, colors["surface-300"].light)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colors.link.light, colors["surface-100"].light)).toBeGreaterThanOrEqual(4.5);
  });
});
