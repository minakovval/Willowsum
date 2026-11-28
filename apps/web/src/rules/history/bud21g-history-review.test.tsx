import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { installMatchMedia } from "@willowsum/ui/test-utils";
import { AuthApiProvider, createAuthClient } from "../../auth/api.ts";
import { App } from "../../App.tsx";
import { configure } from "@testing-library/react";
import { plain, resetAuthState } from "../../auth/testing.tsx";
import { resetNavigationSession } from "../../routing/session.ts";
import { resetReviewCount } from "../../transactions/reviewCount.ts";

/**
 * BUD-21@PoC g) (wave 2, row 239): S-197 «Завантажити файл історії», S-298 and S-299 «Перевірка розпізнавання» (canvas
 * PocMoneyRulesHistory, PocMoneyHistoryUpload, PocMoneyHistoryReview, PocMoneyHistoryReviewError; texts in their «Тексти»
 * boards) on the merged server routes of `import-sessions` (rows 233–234) and `categorization` (row 235). The fake API
 * answers as the server does; reading, matching and deriving are the server's own tests. Synthetic data only.
 */
configure({ asyncUtilTimeout: 5000 });
vi.setConfig({ testTimeout: 20000 });

const BATCH = "00000000-0000-4000-8000-0000000000b1";
const PARSE = "00000000-0000-4000-8000-0000000000b2";
const RUN = "00000000-0000-4000-8000-0000000000d1";
const FUEL = "00000000-0000-4000-8000-0000000000c2";
const FOOD = "00000000-0000-4000-8000-0000000000c1";
const MONO = "00000000-0000-4000-8000-0000000000a1";
const CASH = "00000000-0000-4000-8000-0000000000a2";
const PATH = `#/money/transactions/rules/history/${BATCH}`;

type Reply = { status: number; body?: unknown; headers?: Record<string, string> } | "network";
type Sent = { method: string; path: string; body: unknown; parts: number };
type Handler = Reply | ((call: Sent) => Reply | Promise<Reply>);

function fake(over: Record<string, Handler> = {}) {
  const sent: Sent[] = [];
  const handlers: Record<string, Handler> = {
    "GET /v1/categories": { status: 200, body: { groups: GROUPS } },
    "GET /v1/accounts": {
      status: 200,
      body: {
        items: [
          {
            id: MONO,
            name: "Моно",
            number: { last4: "4417" },
            currencies: [{ currency: "UAH" }],
            status: "active",
          },
          { id: CASH, name: "Гаманець", number: null, currencies: [{ currency: "UAH" }], status: "active" },
        ],
        nextCursor: null,
      },
    },
    "GET /v1/category-rules": { status: 200, body: { items: [] } },
    "GET /v1/category-rule-runs": { status: 200, body: { items: [] } },
    ...over,
  };
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    const multipart = (request.headers.get("content-type") ?? "").startsWith("multipart/form-data");
    const text = request.method === "GET" ? "" : await request.text();
    const call: Sent = {
      method: request.method,
      path: url.pathname,
      body: multipart || !text ? undefined : (JSON.parse(text) as unknown),
      parts: multipart ? (text.match(/name="files"/g) ?? []).length : 0,
    };
    sent.push(call);
    const handler = handlers[`${call.method} ${call.path}`];
    const reply = typeof handler === "function" ? await handler(call) : handler;
    if (reply === undefined) return new Response(null, { status: 599 });
    if (reply === "network") throw new TypeError("Failed to fetch");
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
      status: reply.status,
      headers: { "content-type": "application/json", ...reply.headers },
    });
  };
  return {
    client: createAuthClient(fetchImpl as typeof fetch),
    sent,
    writes: () => sent.filter((s) => s.method !== "GET"),
    of: (method: string, path: string) => sent.filter((s) => s.method === method && s.path === path),
  };
}
type Fake = ReturnType<typeof fake>;

const category = (id: string, name: string, groupId: string) => ({
  id,
  groupId,
  systemKey: null,
  kind: "expense",
  name,
  renamed: false,
  icon: "shapes",
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
    categories: [category(FOOD, "Продукти", "g1"), category(FUEL, "Пальне", "g1")],
  },
];

const decision = (value: unknown, over: Record<string, unknown> = {}) => ({
  chosen: { value, label: String(value), score: 0.9, examples: [] },
  alternatives: [],
  evidence: [],
  flags: [],
  ...over,
});
const COLUMNS = [
  ["Дата", "date"],
  ["Сума", "amount"],
  ["Опис", "description"],
  ["Категорія", "category"],
  ["Підкатегорія", "subcategory"],
].map(([header, role], i) => ({
  column: i + 1,
  header,
  role: decision(role, { evidence: [{ code: "values", count: 600, of: 600 }] }),
}));
const example = (row: number, over: Record<string, unknown> = {}) => ({
  row,
  date: "2025-04-03",
  amount: "-38.10",
  currency: "UAH",
  description: "SILPO 0457 KYIV",
  counterparty: null,
  category: "Їжа",
  subcategory: "Супермаркети",
  transfer: false,
  tags: null,
  account: null,
  ...over,
});
const label = (
  category: string,
  subcategory: string | null,
  rows: number,
  outcome: unknown,
  questions: string[] = [],
) => ({
  category,
  subcategory,
  rows,
  outcome,
  questions,
});
const create = (name: string, group: unknown) => ({
  action: "create",
  name,
  kind: "expense",
  group,
  source: "new",
});
const MAPPING = {
  labels: [
    label("Авто", "Пальне", 55, {
      action: "category",
      categoryId: FUEL,
      name: "Пальне",
      hidden: false,
      show: false,
      source: "name",
    }),
    label("Авто", "Мийка", 9, create("Мийка", { kind: "new", groupId: null, name: "Авто" })),
    label("Їжа", "Супермаркети", 212, create("Супермаркети", { kind: "new", groupId: null, name: "Їжа" })),
    label(
      "Кав'ярні",
      null,
      30,
      create("Кав'ярні", { kind: "history", groupId: null, name: "Категорії з історії · витрати" }),
    ),
  ],
  groups: [
    {
      category: "Авто",
      rows: 64,
      kind: "expense",
      target: { kind: "new", groupId: null, name: "Авто" },
      questions: [],
    },
    {
      category: "Їжа",
      rows: 212,
      kind: "expense",
      target: { kind: "new", groupId: null, name: "Їжа" },
      questions: [],
    },
  ],
  historyGroups: [{ kind: "expense", name: "Категорії з історії · витрати" }],
  more: false,
};
const recognition = (over: Record<string, unknown> = {}) => ({
  table: { headerRow: 1, dataRows: 600, evidence: [] },
  encoding: { chosen: { value: "utf-8", score: 1 }, alternatives: [] },
  delimiter: { chosen: { value: ";", score: 1 }, alternatives: [] },
  columns: COLUMNS,
  dates: decision({ order: "dmy", format: "DD.MM.YYYY" }),
  numbers: decision({ decimalSeparator: ",", thousandsSeparator: " " }),
  sign: decision("as-printed"),
  examples: [
    example(2),
    example(3, { description: "SHELL STATION 22", category: "Авто", subcategory: "Пальне" }),
  ],
  labels: { items: [], more: false },
  transfers: { values: [], more: false },
  accounts: { values: [], more: false },
  summary: { rows: 600, read: 600, transfers: 0, skipped: [], tagsSkipped: 0 },
  missing: [],
  mapping: MAPPING,
  ...over,
});
const batch = (state = "parsed", over: Record<string, unknown> = {}) => ({
  id: BATCH,
  state,
  version: 1,
  createdAt: "2026-11-20T10:00:00Z",
  lastActionAt: "2026-11-20T10:00:00Z",
  deleteAfter: "2026-12-20T10:00:00Z",
  fileName: "istoriya-2025.xlsx",
  format: "xlsx",
  sizeBytes: 1000,
  confirmedAt: null,
  ...over,
});
const view = (rec: unknown = recognition(), over: Record<string, unknown> = {}) => ({
  batch: batch(),
  parseId: PARSE,
  parse: { state: "parsed", refusal: null, engineVersion: "1" },
  confirmed: null,
  recognition: rec,
  canConfirm: true,
  ...over,
});
const get = (v: unknown): Handler => ({ status: 200, body: v });

beforeEach(() => {
  installMatchMedia({ width: 1280 });
  resetAuthState();
  resetNavigationSession();
  resetReviewCount();
});

function open(a: Fake, hash = PATH) {
  window.location.hash = hash;
  return render(
    <AuthApiProvider value={a.client}>
      <App />
    </AuthApiProvider>,
  );
}
const ready = () => screen.findByRole("heading", { level: 1, name: "Перевірка розпізнавання" });
const section = (name: string) => screen.getByRole("region", { name });
const confirmButton = () => screen.getByRole("button", { name: "Підтвердити і вивести правила" });
const reply = (v: unknown, status = 200): Reply => ({ status, body: v });

/** Chooses `name` in a «з пошуком» field (a list of more than 8 choices): open, type, first match, Enter. */
function choose(button: string, name: string) {
  fireEvent.click(screen.getByRole("button", { name: button }));
  const search = screen.getAllByRole("combobox").find((c) => c.tagName === "INPUT")!;
  fireEvent.change(search, { target: { value: name } });
  const options = screen.getAllByRole("option");
  const index = options.findIndex((o) => o.textContent === name);
  for (let i = 0; i <= index; i++) fireEvent.keyDown(search, { key: "ArrowDown" });
  fireEvent.keyDown(search, { key: "Enter" });
}

describe("BUD-21@PoC g) S-299 «Перевірка розпізнавання»", () => {
  it("BUD-21@PoC AC1: without any answer the step shows the roles of all five columns, the examples, the file's categories and «прочитано 600»; nothing is written", async () => {
    const a = fake({ [`GET /v1/import/history-files/${BATCH}`]: get(view()) });
    open(a);
    await ready();
    const read = within(section("Як прочитано файл"));
    for (const name of ["Дата", "Сума", "Опис", "Категорія", "Підкатегорія"])
      expect(read.getByRole("button", { name: `${name} ${name}` })).toBeTruthy();
    expect(read.getAllByText("600 з 600 значень схожі на Дата")).toHaveLength(1);
    const examples = read.getByRole("table", { name: "Приклади рядків так, як їх прочитано" });
    expect(within(examples).getAllByRole("row")).toHaveLength(3);
    expect(plain(examples.textContent)).toContain("SHELL STATION 22");
    expect(
      screen.getByText(
        "Файл історії istoriya-2025.xlsx · 600 рядків. Перевірте, як ми його прочитали. Доки ви не підтвердите, нічого не створюється й не виводиться.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Прочитано рядків: 600")).toBeTruthy();
    expect(within(section("Категорії файлу")).getAllByRole("row").length).toBeGreaterThan(5);
    expect(a.writes()).toEqual([]);
    expect(screen.getByRole("navigation", { name: "Хлібні крихти" }).textContent).toContain("Файл історії");
  });

  it("BUD-21@PoC AC6: «Авто · Пальне» matches the category «Пальне», the three others will be created; no write before the confirmation", async () => {
    const a = fake({ [`GET /v1/import/history-files/${BATCH}`]: get(view()) });
    open(a);
    await ready();
    const tree = within(section("Категорії файлу"));
    const rowOf = (text: string) =>
      tree.getAllByRole("row").find((r) => plain(r.textContent).includes(text))!;
    expect(rowOf("Пальне").textContent).toContain("Збігається з категорією «Пальне»");
    expect(rowOf("Мийка").textContent).toContain("Буде створено категорію «Мийка» у групі «Авто»");
    expect(rowOf("Супермаркети").textContent).toContain(
      "Буде створено категорію «Супермаркети» у групі «Їжа»",
    );
    expect(rowOf("Кав'ярні").textContent).toContain(
      "Буде створено категорію «Кав'ярні» у групі «Категорії з історії · витрати»",
    );
    expect(rowOf("Авто").textContent).toContain("Буде створено групу «Авто»");
    expect(
      screen.getByText("Буде створено категорій: 5. Транзакції, рахунки і бюджет не зміняться."),
    ).toBeTruthy();
    expect(a.writes()).toEqual([]);
  });

  it("BUD-21@PoC AC8: another existing category for «Їжа · Супермаркети» goes in the one confirming request, nothing is created before it", async () => {
    const a = fake({
      [`GET /v1/import/history-files/${BATCH}`]: get(view()),
      [`POST /v1/import/history-files/${BATCH}/confirm`]: reply({
        ...view(recognition(), { confirmed: { at: "2026-11-20T11:00:00Z" } }),
        derivation: { id: RUN, status: "completed", background: false, count: 600, processed: 600 },
      }),
    });
    open(a);
    await ready();
    fireEvent.change(screen.getByRole("combobox", { name: "Змінити зіставлення мітки «Супермаркети»" }), {
      target: { value: "other" },
    });
    expect(a.writes()).toEqual([]);
    await screen.findByRole("option", { name: "Продукти" });
    fireEvent.change(screen.getByRole("combobox", { name: "Категорія для мітки «Супермаркети»" }), {
      target: { value: FOOD },
    });
    expect(
      screen.getByText("Буде створено категорій: 4. Транзакції, рахунки і бюджет не зміняться."),
    ).toBeTruthy();
    await waitFor(() => {
      const row = within(section("Категорії файлу"))
        .getAllByRole("row")
        .find((r) => r.textContent?.includes("Супермаркети"))!;
      expect(plain(row.textContent)).toContain("Збігається з категорією «Продукти»");
    });
    fireEvent.click(confirmButton());
    await screen.findByText(/Розпізнавання підтверджено, правила виведено/);
    const [post] = a.of("POST", `/v1/import/history-files/${BATCH}/confirm`);
    expect(post!.body).toMatchObject({
      parseId: PARSE,
      labels: [{ category: "Їжа", subcategory: "Супермаркети", action: "category", categoryId: FOOD }],
    });
    expect(a.writes()).toHaveLength(1);
  });

  it("BUD-21@PoC AC9: «день-місяць-рік» chosen for the question about the date format reads the file again", async () => {
    const asked = recognition({
      dates: decision(
        { order: "mdy", format: "MM/DD/YYYY" },
        {
          flags: ["date-order-assumed"],
          chosen: {
            value: { order: "mdy", format: "MM/DD/YYYY" },
            label: "mdy",
            score: 0.5,
            examples: [{ cell: "03.04.2025", reads: "2025-03-04" }],
          },
        },
      ),
    });
    let reads = 0;
    const a = fake({
      [`GET /v1/import/history-files/${BATCH}`]: get(view(asked)),
      [`POST /v1/import/history-files/${BATCH}/reading`]: () => (reads++, reply(view(recognition()))),
    });
    open(a);
    await ready();
    const q = within(section("Потрібна ваша відповідь"));
    expect(q.getByText(/Не впевнені у форматі дат: 03.04.2025 — це 3 квітня чи 4 березня\?/)).toBeTruthy();
    fireEvent.click(q.getByRole("radio", { name: "день-місяць-рік" }));
    await waitFor(() => expect(reads).toBe(1));
    expect(a.of("POST", `/v1/import/history-files/${BATCH}/reading`)[0]!.body).toEqual({ dateOrder: "dmy" });
    await waitFor(() => expect(screen.queryByText("Потрібна ваша відповідь")).toBeNull());
  });

  it("BUD-21@PoC FR 6: a column role is corrected in one click and the file is read again with it", async () => {
    const a = fake({
      [`GET /v1/import/history-files/${BATCH}`]: get(view()),
      [`POST /v1/import/history-files/${BATCH}/reading`]: reply(view()),
    });
    open(a);
    await ready();
    choose("Опис Опис", "Контрагент");
    await waitFor(() => expect(a.of("POST", `/v1/import/history-files/${BATCH}/reading`)).toHaveLength(1));
    expect(a.of("POST", `/v1/import/history-files/${BATCH}/reading`)[0]!.body).toEqual({
      columns: [{ column: 3, role: "counterparty" }],
    });
  });

  it("BUD-21@PoC FR 5, FR 6: transfer values, accounts (matched by name or not) and the summary; the choices go in the confirmation", async () => {
    const rec = recognition({
      transfers: {
        values: [
          { value: "переказ", count: 41, suggested: true, transfer: true },
          { value: "витрата", count: 531, suggested: false, transfer: false },
        ],
        more: false,
      },
      accounts: {
        values: [
          { value: "Моно", count: 500, accountId: null },
          { value: "Готівка", count: 100, accountId: null },
        ],
        more: false,
      },
      summary: {
        rows: 612,
        read: 600,
        transfers: 41,
        skipped: [
          { reason: "no-categorisation", count: 9 },
          { reason: "service-category", count: 3 },
        ],
        tagsSkipped: 2,
      },
      columns: [
        ...COLUMNS,
        { column: 6, header: "Тип", role: decision("transfer-flag") },
        { column: 7, header: "Рахунок", role: decision("account") },
      ],
    });
    const a = fake({
      [`GET /v1/import/history-files/${BATCH}`]: get(view(rec)),
      [`POST /v1/import/history-files/${BATCH}/confirm`]: reply({
        ...view(rec, { confirmed: { at: "2026-11-20T11:00:00Z" } }),
        derivation: null,
      }),
    });
    open(a);
    await ready();
    const transfers = within(section("Позначка переказу"));
    expect(
      transfers.getByText(
        "Рядки з цими значеннями колонки «Тип» ми вважаємо переказами. Для переказів категорія не створюється.",
      ),
    ).toBeTruthy();
    expect((transfers.getByRole("checkbox", { name: "«переказ»" }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(transfers.getByRole("checkbox", { name: "«витрата»" }));
    const accounts = within(section("Рахунки"));
    expect(await accounts.findByText("Збіг за назвою")).toBeTruthy();
    expect(accounts.getByText("Не зіставлено")).toBeTruthy();
    expect(accounts.getByText("Умову «Рахунок» для цього значення не пропонуватимемо.")).toBeTruthy();
    expect(
      (accounts.getByRole("combobox", { name: "Рахунок для значення «Моно»" }) as HTMLSelectElement).value,
    ).toBe(MONO);
    fireEvent.change(accounts.getByRole("combobox", { name: "Рахунок для значення «Готівка»" }), {
      target: { value: CASH },
    });
    const summary = within(section("Підсумок"));
    expect(summary.getByText("Пропущено рядків: 12")).toBeTruthy();
    expect(summary.getByText("9 без категорії й без позначки переказу: у рядку немає розбору")).toBeTruthy();
    expect(summary.getByText("3 із категорією «Коригування»: службова категорія")).toBeTruthy();
    expect(
      summary.getByText("У 2 рядках значення тегу довше за 60 символів: теги цих рядків не враховано"),
    ).toBeTruthy();
    fireEvent.click(confirmButton());
    await screen.findByText("Не вдалося вивести правила.");
    expect(a.of("POST", `/v1/import/history-files/${BATCH}/confirm`)[0]!.body).toMatchObject({
      parseId: PARSE,
      transferValues: ["переказ", "витрата"],
      accounts: [
        { value: "Моно", accountId: MONO },
        { value: "Готівка", accountId: CASH },
      ],
    });
  });

  it("BUD-21@PoC FR 6: questions with explicit answers — the hidden category is shown again, the opposite sign opens the mapping", async () => {
    const rec = recognition({
      mapping: {
        ...MAPPING,
        labels: [
          label(
            "Хобі",
            null,
            8,
            { action: "category", categoryId: FOOD, name: "Хобі", hidden: true, show: false, source: "name" },
            ["hidden-category"],
          ),
          label("Їжа", "Повернення", 5, create("Повернення", { kind: "new", groupId: null, name: "Їжа" }), [
            "opposite-sign",
          ]),
        ],
        groups: [
          {
            category: "Їжа",
            rows: 5,
            kind: "expense",
            target: { kind: "new", groupId: null, name: "Їжа" },
            questions: [],
          },
        ],
      },
    });
    const a = fake({
      [`GET /v1/import/history-files/${BATCH}`]: get(view(rec)),
      [`POST /v1/import/history-files/${BATCH}/confirm`]: reply({
        ...view(rec, { confirmed: { at: "x" } }),
        derivation: { id: RUN, status: "completed", background: false, count: 1, processed: 1 },
      }),
    });
    open(a);
    await ready();
    const q = within(section("Потрібна ваша відповідь"));
    expect(q.getByText("Мітка «Хобі» збігається з прихованою категорією. Використаємо її.")).toBeTruthy();
    expect(
      q.getByText(
        "Більшість рядків підкатегорії «Повернення» у групі «Їжа» мають протилежний знак. Що з нею зробити?",
      ),
    ).toBeTruthy();
    fireEvent.click(q.getByRole("radio", { name: "Показати категорію знову" }));
    expect((q.getByRole("radio", { name: "Залишити в групі" }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(q.getByRole("radio", { name: "Зіставити з іншою категорією" }));
    expect(screen.getByRole("combobox", { name: "Категорія для мітки «Повернення»" })).toBeTruthy();
    fireEvent.click(confirmButton());
    await screen.findByText(/правила виведено/);
    expect(a.of("POST", `/v1/import/history-files/${BATCH}/confirm`)[0]!.body).toMatchObject({
      labels: [{ category: "Хобі", subcategory: null, action: "category", categoryId: FOOD, show: true }],
    });
  });

  it("BUD-21@PoC AC3: without a description or counterparty column the derivation is unavailable and the step says what is missing", async () => {
    const a = fake({
      [`GET /v1/import/history-files/${BATCH}`]: get(
        view(recognition({ missing: ["description"] }), { canConfirm: false }),
      ),
    });
    open(a);
    await ready();
    const alert = screen.getByText(
      "Правила вивести не можна: у файлі немає колонки з описом чи контрагентом. Якщо така колонка є, позначте її роль вище.",
    );
    expect(alert.closest("[role=alert]")).toBeTruthy();
    expect(confirmButton().getAttribute("aria-disabled")).toBe("true");
    expect(a.writes()).toEqual([]);
  });

  it("BUD-21@PoC AC4: without a category and a transfer mark the step explains the file has no categorisation; «Позначити колонку» moves focus to the roles", async () => {
    const a = fake({
      [`GET /v1/import/history-files/${BATCH}`]: get(
        view(recognition({ missing: ["categories"], mapping: null }), { canConfirm: false }),
      ),
    });
    open(a);
    await ready();
    expect(
      screen.getAllByText(
        "Правила вивести не можна: у файлі немає розбору. Потрібна колонка категорії або позначки переказу.",
      ).length,
    ).toBeGreaterThan(0);
    expect(confirmButton().getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Позначити колонку" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Дата Дата" }));
  });

  it("BUD-21@PoC FR 24: «Видалити файл» asks first, then deletes the file and returns to «Правила категорій»", async () => {
    const a = fake({
      [`GET /v1/import/history-files/${BATCH}`]: get(view()),
      [`DELETE /v1/import/history-files/${BATCH}`]: reply({ deleted: true }),
    });
    open(a);
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Видалити файл" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Видалити файл історії?" });
    expect(a.writes()).toEqual([]);
    fireEvent.click(within(dialog).getByRole("button", { name: "Видалити файл" }));
    await waitFor(() => expect(a.of("DELETE", `/v1/import/history-files/${BATCH}`)).toHaveLength(1));
    await waitFor(() => expect(window.location.hash).toBe("#/money/transactions/rules"));
  });
});

describe("BUD-21@PoC g) S-299 states", () => {
  it("BUD-21@PoC states: loading shows a skeleton; an error offers «Спробувати ще раз» with the code", async () => {
    let fail = true;
    const a = fake({
      [`GET /v1/import/history-files/${BATCH}`]: () =>
        fail
          ? {
              status: 500,
              body: {
                type: "x",
                title: "x",
                status: 500,
                code: "INTERNAL",
                supportId: "0123456789abcdef0123456789abcdef",
              },
            }
          : reply(view()),
    });
    open(a);
    expect(await screen.findByLabelText("Завантаження файлу історії")).toBeTruthy();
    expect(await screen.findByText("Не вдалося відкрити файл історії.")).toBeTruthy();
    expect(screen.getByText(/Код: 0123456789abcdef/)).toBeTruthy();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Спробувати ще раз" }));
    await ready();
  });

  it("BUD-21@PoC states: a file still being read shows the progress, then the step", async () => {
    let n = 0;
    const a = fake({
      [`GET /v1/import/history-files/${BATCH}`]: () =>
        n++ === 0
          ? reply(
              view(null, {
                batch: batch("processing"),
                parse: { state: "pending", refusal: null, engineVersion: "1" },
              }),
            )
          : reply(view()),
    });
    open(a);
    expect(await screen.findByText("Розпізнаємо файл istoriya-2025.xlsx")).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "Розпізнаємо файл istoriya-2025.xlsx" })).toBeTruthy();
    await ready();
  });

  it("BUD-21@PoC states: a file the server could not read says why (the server's text) and offers «Видалити файл»", async () => {
    const a = fake({
      [`GET /v1/import/history-files/${BATCH}`]: get(
        view(null, {
          batch: batch("failed"),
          parse: {
            state: "failed",
            refusal: { code: "CORRUPTED", message: { uk: "Файл пошкоджено", en: "The file is damaged" } },
            engineVersion: "1",
          },
          canConfirm: false,
        }),
      ),
    });
    open(a);
    expect(await screen.findByText("Файл не вдалося прочитати: Файл пошкоджено")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Видалити файл" })).toBeTruthy();
  });

  it("BUD-21@PoC states: after the confirmation the derivation shows «оброблено X з N рядків», then a retry when it failed", async () => {
    let polls = 0;
    const a = fake({
      [`GET /v1/import/history-files/${BATCH}`]: get(view()),
      [`POST /v1/import/history-files/${BATCH}/confirm`]: reply({
        ...view(recognition(), { confirmed: { at: "x" } }),
        derivation: { id: RUN, status: "running", background: true, count: 3000, processed: 1200 },
      }),
      [`GET /v1/category-rule-derivations/${RUN}`]: () => (
        polls++,
        reply({
          derivation: {
            id: RUN,
            batchId: BATCH,
            status: "failed",
            background: true,
            count: 3000,
            processed: 1500,
            createdAt: "x",
            endedAt: "x",
          },
          suggestions: [],
        })
      ),
      "POST /v1/category-rule-derivations": reply(
        {
          derivation: { id: RUN, status: "completed", background: false, count: 3000, processed: 3000 },
          started: true,
        },
        201,
      ),
    });
    open(a);
    await ready();
    fireEvent.click(confirmButton());
    expect(await screen.findByText("Виводимо правила · оброблено 1200 з 3000 рядків")).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "Виведення правил" })).toBeTruthy();
    await screen.findByText("Не вдалося вивести правила.");
    expect(polls).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "Спробувати ще раз" }));
    await screen.findByText(/Розпізнавання підтверджено, правила виведено/);
    expect(a.of("POST", "/v1/category-rule-derivations")[0]!.body).toEqual({ batchId: BATCH });
  });

  it("BUD-21@PoC FR 6: a read that changed while the user answered (409) asks to check the recognition again", async () => {
    const a = fake({
      [`GET /v1/import/history-files/${BATCH}`]: get(view()),
      [`POST /v1/import/history-files/${BATCH}/confirm`]: {
        status: 409,
        body: { type: "x", title: "x", status: 409, code: "BATCH_STATE_CONFLICT" },
        headers: { "content-type": "application/problem+json" },
      },
    });
    open(a);
    await ready();
    fireEvent.click(confirmButton());
    expect(
      await screen.findByText(
        "Файл перечитано, поки ви відповідали. Перевірте розпізнавання ще раз і підтвердьте.",
      ),
    ).toBeTruthy();
  });

  it("BUD-21@PoC AC1 EC: the controls are real controls — every select has a name, the disabled confirmation says why, focus order follows the page", async () => {
    const a = fake({
      [`GET /v1/import/history-files/${BATCH}`]: get(
        view(recognition({ missing: ["categories"] }), { canConfirm: false }),
      ),
    });
    open(a);
    await ready();
    const lists = [...document.querySelectorAll("button[aria-haspopup=listbox]")];
    expect(lists.length).toBeGreaterThan(4);
    for (const select of lists)
      expect((select.getAttribute("aria-labelledby") ?? "").length).toBeGreaterThan(0);
    const button = confirmButton();
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.getAttribute("aria-describedby")).toBeTruthy();
    expect(document.getElementById(button.getAttribute("aria-describedby")!)!.textContent).toMatch(
      /Правила вивести не можна/,
    );
    button.focus();
    expect(document.activeElement).toBe(button);
  });
});

describe("BUD-21@PoC g) S-197 and S-298 «Завантажити файл історії»", () => {
  const rulesPage = (over: Record<string, Handler> = {}) =>
    fake({
      "GET /v1/category-rules": { status: 200, body: { items: [] } },
      ...over,
    });
  const input = () => document.querySelector<HTMLInputElement>('input[type="file"]')!;
  const pick = (file: File) => fireEvent.change(input(), { target: { files: [file] } });
  const sized = (name: string, bytes: number) => {
    const f = new File(["x"], name);
    Object.defineProperty(f, "size", { value: bytes });
    return f;
  };
  const openDialog = async (a: Fake) => {
    open(a, "#/money/transactions/rules");
    fireEvent.click(await screen.findByRole("button", { name: "Завантажити файл історії" }));
    return screen.findByRole("dialog", { name: "Завантажити файл історії" });
  };

  it("BUD-21@PoC FR 2: «Правила категорій» has the action «Завантажити файл історії» with its hint; it opens the dialog with the drop zone, formats and ceilings", async () => {
    const a = rulesPage();
    open(a, "#/money/transactions/rules");
    const button = await screen.findByRole("button", { name: "Завантажити файл історії" });
    expect(
      document.getElementById(button.closest("[role=group]")!.getAttribute("aria-describedby")!)!.textContent,
    ).toBe("Виведемо правила категорій з вашої таблиці з історією транзакцій і розбором.");
    fireEvent.click(button);
    const dialog = await screen.findByRole("dialog", { name: "Завантажити файл історії" });
    expect(within(dialog).getByText("Перетягніть файл сюди або оберіть його")).toBeTruthy();
    expect(within(dialog).getByText("CSV, TSV, XLSX, XLS · до 25 МБ і 20 000 рядків")).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Обрати файл" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Скасувати" })).toBeTruthy();
    expect(a.writes()).toEqual([]);
  });

  it("BUD-21@PoC AC1: the chosen file is sent as one multipart upload and the step «Перевірка розпізнавання» of its batch opens", async () => {
    const a = rulesPage({
      "POST /v1/import/history-files": reply(
        { batch: batch("processing"), parseId: PARSE, existing: false },
        201,
      ),
    });
    await openDialog(a);
    pick(new File(["x"], "istoriya-2025.xlsx"));
    await waitFor(() => expect(a.of("POST", "/v1/import/history-files")).toHaveLength(1));
    expect(a.of("POST", "/v1/import/history-files")[0]!.parts).toBe(1);
    await waitFor(() => expect(window.location.hash).toBe(PATH));
  });

  it("BUD-21@PoC FR 3: the same file still stored opens its batch with the notice", async () => {
    const a = rulesPage({
      "POST /v1/import/history-files": reply({ batch: batch(), parseId: PARSE, existing: true }, 201),
    });
    await openDialog(a);
    pick(new File(["x"], "istoriya-2025.xlsx"));
    expect(await screen.findByText("Цей файл уже завантажено. Відкриваємо його розпізнавання.")).toBeTruthy();
    await waitFor(() => expect(window.location.hash).toBe(PATH));
  });

  it("BUD-21@PoC AC5: a book with macros is refused with its text, no batch opens, and «Обрати інший файл» is offered", async () => {
    const a = rulesPage({
      "POST /v1/import/history-files": {
        status: 422,
        body: {
          type: "x",
          title: "x",
          status: 422,
          code: "FILE_REJECTED",
          rejection: { code: "UNSUPPORTED_FORMAT" },
        },
        headers: { "content-type": "application/problem+json" },
      },
    });
    window.location.hash = "#/money/transactions/rules";
    const dialog = await openDialog(a);
    pick(new File(["x"], "macros.xlsm"));
    expect(
      await within(dialog).findByText(
        "Файл відхилено: книги з макросами не приймаються. Збережіть таблицю як XLSX без макросів і завантажте знову.",
      ),
    ).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Обрати інший файл" })).toBeTruthy();
    expect(within(dialog).getAllByRole("button", { name: "Закрити" })).toHaveLength(2);
    expect(window.location.hash).toBe("#/money/transactions/rules");
  });

  it("BUD-21@PoC FR 3: a file over 25 MB is refused before sending; an unreadable file gets the general text", async () => {
    const a = rulesPage({
      "POST /v1/import/history-files": {
        status: 500,
        body: { type: "x", title: "x", status: 500, code: "INTERNAL" },
        headers: { "content-type": "application/problem+json" },
      },
    });
    const dialog = await openDialog(a);
    pick(sized("big.csv", 26 * 1024 * 1024));
    expect(
      await within(dialog).findByText("Файл завеликий: приймаємо до 25 МБ і до 20 000 рядків."),
    ).toBeTruthy();
    expect(a.writes()).toEqual([]);
    pick(new File(["x"], "broken.csv"));
    expect(
      await within(dialog).findByText(/Не вдалося прочитати файл\. Перевірте, що це таблиця/),
    ).toBeTruthy();
  });

  it("BUD-21@PoC FR 3: the server's refusal for ceilings (too many rows) says the file is too large", async () => {
    const a = rulesPage({
      "POST /v1/import/history-files": {
        status: 413,
        body: {
          type: "x",
          title: "x",
          status: 413,
          code: "FILE_TOO_LARGE",
          rejection: { code: "TOO_MANY_ROWS" },
        },
        headers: { "content-type": "application/problem+json" },
      },
    });
    const dialog = await openDialog(a);
    pick(new File(["x"], "rows.csv"));
    expect(
      await within(dialog).findByText("Файл завеликий: приймаємо до 25 МБ і до 20 000 рядків."),
    ).toBeTruthy();
  });

  it("BUD-21@PoC states: while the file is sent the dialog shows «Розпізнаємо файл …» with a progress bar and «Скасувати»; Escape closes the dialog and returns focus", async () => {
    let release: (r: Reply) => void = () => undefined;
    const a = rulesPage({ "POST /v1/import/history-files": () => new Promise<Reply>((r) => (release = r)) });
    const dialog = await openDialog(a);
    pick(new File(["x"], "istoriya-2025.xlsx"));
    expect(await within(dialog).findByText("Визначаємо кодування, колонки, формат дат і чисел")).toBeTruthy();
    expect(within(dialog).getByRole("progressbar")).toBeTruthy();
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await act(async () =>
      release(reply({ batch: batch("processing"), parseId: PARSE, existing: false }, 201)),
    );
  });
});
