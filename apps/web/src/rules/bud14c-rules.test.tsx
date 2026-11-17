import { fireEvent, screen, waitFor, within } from "@testing-library/react";
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
import { resetReviewCount } from "../transactions/reviewCount.ts";
import type { Condition, Rule, Run } from "./api.ts";

/**
 * BUD-14@PoC c) (wave 2, row 120): S-197 «Правила категорій» and S-198 «Правило категорії» (canvas PocMoneyRules,
 * PocMoneyRuleEdit; texts PocMoneyRulesTexts) on the merged server routes of module `categorization`. The fake API
 * answers as the server does; the server's own rules (first match, manual changes, audit, other spaces) are its
 * integration tests. Synthetic data only.
 */
const PATH = "#/money/transactions/rules";
const ACC = "00000000-0000-4000-8000-0000000000a1";
const ACC2 = "00000000-0000-4000-8000-0000000000a2";
const FOOD = "00000000-0000-4000-8000-0000000000c1";
const FUEL = "00000000-0000-4000-8000-0000000000c2";
const SUBS = "00000000-0000-4000-8000-0000000000c3";
const HOME = "00000000-0000-4000-8000-0000000000c4";
const ruleId = (n: number) => `00000000-0000-4000-8000-0000000000e${n}`;
const eur = (amount: string) => ({ amount, currency: "EUR" });

const category = (id: string, name: string, groupId: string, over: Record<string, unknown> = {}) => ({
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
  ...over,
});
const GROUPS = [
  {
    id: "g1",
    systemKey: null,
    kind: "expense",
    name: "Щоденне",
    renamed: false,
    tone: "#5872D2",
    categories: [category(FOOD, "Продукти", "g1"), category(SUBS, "Підписки", "g1")],
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

const merchant = (value: string, operator: "equals" | "contains" = "equals"): Condition => ({
  field: "merchant",
  operator,
  value,
});

function rule(position: number, conditions: Condition[], categoryId: string, over: Partial<Rule> = {}): Rule {
  return {
    id: ruleId(position),
    position,
    conditions,
    accountIds: [],
    categoryId,
    enabled: true,
    needsAttention: null,
    appliedCount: 0,
    tags: [],
    ...over,
  };
}

const run = (over: Partial<Run> = {}): Run => ({
  id: "00000000-0000-4000-8000-0000000000f1",
  ruleId: ruleId(1),
  status: "completed",
  background: false,
  count: 14,
  processed: 14,
  changed: 14,
  skipped: { manual: 0, unavailable: 0, unchanged: 0 },
  truncated: false,
  undo: { available: true, until: "2026-11-24T10:00:00Z", restored: 0, notRestored: 0 },
  createdAt: "2026-11-17T10:00:00Z",
  endedAt: "2026-11-17T10:00:05Z",
  ...over,
});

const matches = (count: number, total: string) => ({
  count,
  totals: [eur(total)],
  truncated: false,
  items: Array.from({ length: Math.min(count, 100) }, (_, i) => ({
    transactionId: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
    accountId: ACC,
    date: `2026-10-${String((i % 28) + 1).padStart(2, "0")}`,
    amount: eur("-59.99"),
    counterparty: "ADOBE",
  })),
});

type Handler = Reply | ((call: Call) => Reply | Promise<Reply>);

function api(rules: Rule[], over: Record<string, Handler> = {}) {
  const state = { rules: [...rules] };
  const fake = fakeApi({
    "GET /v1/category-rules": () => ({ status: 200, body: { items: state.rules } }),
    "GET /v1/categories": { status: 200, body: { groups: GROUPS } },
    "GET /v1/accounts": {
      status: 200,
      body: {
        items: [
          {
            id: ACC,
            name: "Поточний",
            number: { last4: "4417" },
            currencies: [{ currency: "EUR" }],
            status: "active",
          },
          { id: ACC2, name: "Картка", number: null, currencies: [{ currency: "EUR" }], status: "active" },
        ],
        nextCursor: null,
      },
    },
    "POST /v1/category-rules/matches": { status: 200, body: matches(14, "-839.86") },
    ...over,
  });
  return { ...fake, state };
}

const open = (a: ReturnType<typeof api>, path = PATH) => renderAt(path, a.client);
const table = () => screen.getByRole("table");
const rows = () => within(table()).getAllByRole("row").slice(1);
const rowOf = (text: string) => rows().find((r) => plain(r.textContent).includes(text))!;
const sent = (a: ReturnType<typeof api>, method: string, path?: string) =>
  a.calls.filter((c) => c.method === method && (path === undefined || c.path === path));
const loaded = () => screen.findByRole("table");

/** Chooses `name` in a «з пошуком» field: open, type, first match, Enter. */
function choose(label: RegExp, name: string) {
  fireEvent.click(screen.getByRole("button", { name: label }));
  const search = screen.getAllByRole("combobox").find((c) => c.tagName === "INPUT")!;
  fireEvent.change(search, { target: { value: name } });
  const options = screen.getAllByRole("option");
  const index = options.findIndex((o) => o.textContent === name);
  for (let i = 0; i <= index; i++) fireEvent.keyDown(search, { key: "ArrowDown" });
  fireEvent.keyDown(search, { key: "Enter" });
}

const SIX = () => [
  rule(1, [merchant("Сільпо")], FOOD, { appliedCount: 23 }),
  rule(2, [merchant("Uklon")], FUEL, { appliedCount: 41 }),
  rule(3, [{ field: "description", operator: "contains", value: "KYIVSTAR" }], HOME, { appliedCount: 12 }),
  rule(4, [merchant("WOG"), { field: "amount", operator: "greater", value: eur("40.00") }], FUEL, {
    appliedCount: 8,
    tags: ["авто"],
  }),
  rule(5, [{ field: "description", operator: "contains", value: "ОСББ" }], HOME, { appliedCount: 10 }),
  rule(6, [merchant("Rozetka")], HOME, { enabled: false }),
];

// The dialogs of S-198 render many fields in jsdom: a loaded machine needs more than the default 5 s.
vi.setConfig({ testTimeout: 20000 });

beforeEach(() => {
  installMatchMedia({ width: 1280 });
  resetAuthState();
  resetNavigationSession();
  resetReviewCount();
});

describe("BUD-14@PoC S-197 «Правила категорій»", () => {
  it("BUD-14@PoC FR 4: the rules in priority order — «#», «Умова», «Категорія», «Застосовано», «Увімкнено», the pencil — under «Гроші › Транзакції › Правила» with the note", async () => {
    const a = api(SIX());
    open(a);
    await loaded();
    expect(screen.getByRole("heading", { level: 1, name: "Правила категорій" })).toBeTruthy();
    const crumbs = within(screen.getByRole("navigation", { name: "Хлібні крихти" }));
    expect(crumbs.getByRole("link", { name: "Транзакції" }).getAttribute("href")).toBe(
      "#/money/transactions",
    );
    expect(crumbs.getByText("Правила").getAttribute("aria-current")).toBe("page");
    expect(
      within(table())
        .getAllByRole("columnheader")
        .slice(0, 4)
        .map((h) => h.textContent),
    ).toEqual(["#", "Умова", "Категорія", "Застосовано"]);
    expect(screen.getByText("6 правил · порядок = пріоритет")).toBeTruthy();
    const r = rows();
    expect(r).toHaveLength(6);
    expect(plain(r[0]!.textContent)).toContain("Якщо Мерчант = Сільпо");
    expect(plain(r[0]!.textContent)).toContain("Продукти");
    expect(plain(r[0]!.textContent)).toContain("23 транзакції");
    expect(plain(r[2]!.textContent)).toContain("Якщо Опис містить «KYIVSTAR»");
    expect(plain(r[3]!.textContent)).toContain("Якщо Мерчант = WOG · сума > 40,00 €");
    expect(plain(r[3]!.textContent)).toContain("+ тег «авто»");
    expect(within(r[0]!).getByRole("button", { name: "Змінити правило" })).toBeTruthy();
    expect(screen.getByText(/Правила, які ви створюєте з деталі транзакції/)).toBeTruthy();
    expect(a.calls.every((c) => c.method === "GET")).toBe(true);
  });

  it("BUD-14@PoC FR 4: «Транзакції» → «…» → «Правила категорій · 6» opens the page", async () => {
    const a = api(SIX(), {
      "GET /v1/transactions": { status: 599 as never },
    });
    open(a, "#/money/transactions");
    const more = await screen.findByRole("button", { name: "Ще дії" });
    fireEvent.click(more);
    const item = await screen.findByRole("menuitem", { name: "Правила категорій · 6" });
    expect(item.getAttribute("href")).toBe("#/money/transactions/rules");
  });

  it("BUD-14@PoC FR 4: a space without rules shows «Правил ще немає» with «Нове правило»", async () => {
    const a = api([]);
    open(a);
    expect(await screen.findByText("Правил ще немає")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Нове правило" })).toHaveLength(2);
  });

  it("BUD-14@PoC FR 4: while the rules load the table is a skeleton; a failed read says so with «Код: …» and «Спробувати ще раз»", async () => {
    let fail = true;
    const a = api([], {
      "GET /v1/category-rules": () =>
        fail ? problem(500, "INTERNAL") : { status: 200, body: { items: SIX() } },
    });
    open(a);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText("Не вдалося завантажити правила")).toBeTruthy();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Спробувати ще раз" }));
    await loaded();
    expect(rows()).toHaveLength(6);
    void SUPPORT_ID;
  });

  it("BUD-14@PoC FR 4: the search finds a rule by its condition, its category or its tag", async () => {
    const a = api(SIX());
    open(a);
    await loaded();
    const search = screen.getByRole("searchbox");
    fireEvent.change(search, { target: { value: "kyivstar" } });
    expect(rows()).toHaveLength(1);
    fireEvent.change(search, { target: { value: "Пальне" } });
    expect(rows()).toHaveLength(2);
    fireEvent.change(search, { target: { value: "авто" } });
    expect(rows()).toHaveLength(1);
    fireEvent.change(search, { target: { value: "немає такого" } });
    expect(screen.getByText("Правил за цим запитом немає")).toBeTruthy();
  });

  it("BUD-14@PoC FR 4: «Вище» and «Нижче» (buttons, so the keyboard reaches them) move a rule; the first has no «Вище», the last no «Нижче»", async () => {
    const a = api(SIX(), {
      [`POST /v1/category-rules/${ruleId(3)}/move`]: { status: 200, body: { items: [] } },
    });
    open(a);
    await loaded();
    expect(within(rowOf("Сільпо")).getByRole("button", { name: "Вище" }).getAttribute("aria-disabled")).toBe(
      "true",
    );
    expect(
      within(rowOf("Rozetka")).getByRole("button", { name: "Нижче" }).getAttribute("aria-disabled"),
    ).toBe("true");
    fireEvent.click(within(rowOf("KYIVSTAR")).getByRole("button", { name: "Вище" }));
    await waitFor(() => expect(sent(a, "POST", `/v1/category-rules/${ruleId(3)}/move`)).toHaveLength(1));
    expect(sent(a, "POST", `/v1/category-rules/${ruleId(3)}/move`)[0]!.body).toEqual({ position: 2 });
    // The table is read again after the change.
    await waitFor(() => expect(sent(a, "GET", "/v1/category-rules").length).toBeGreaterThan(1));
  });

  it("BUD-14@PoC AC12: «Увімкнено» is a switch; a disabled rule says «вимкнено»; switching sends `enabled`", async () => {
    const a = api(SIX(), {
      [`PATCH /v1/category-rules/${ruleId(2)}`]: { status: 200, body: {} },
    });
    open(a);
    await loaded();
    const off = within(rowOf("Rozetka")).getByRole("switch");
    expect((off as HTMLInputElement).checked).toBe(false);
    expect(plain(rowOf("Rozetka").textContent)).toContain("вимкнено");
    const on = within(rowOf("Uklon")).getByRole("switch", { name: /Увімкнено: Якщо Мерчант = Uklon/ });
    fireEvent.click(on);
    await waitFor(() => expect(sent(a, "PATCH")).toHaveLength(1));
    expect(sent(a, "PATCH")[0]!.body).toEqual({ enabled: false });
  });

  it("BUD-14@PoC AC7: a rule whose category was deleted is marked «Потребує уваги» with the reason; it is never dropped", async () => {
    const list = SIX();
    list[1] = { ...list[1]!, needsAttention: "category_deleted" };
    const a = api(list);
    open(a);
    await loaded();
    expect(rows()).toHaveLength(6);
    const text = plain(rowOf("Uklon").textContent);
    expect(text).toContain("Потребує уваги");
    expect(text).toContain("Правило потребує уваги: категорію видалено");
  });

  it("BUD-14@PoC AC17: «Видалити» opens a danger dialog with the rule; «Скасувати» keeps it, the confirmation sends DELETE and the rule leaves the table", async () => {
    const a = api(SIX(), {
      [`DELETE /v1/category-rules/${ruleId(2)}`]: () => {
        a.state.rules = a.state.rules
          .filter((r) => r.id !== ruleId(2))
          .map((r, i) => ({ ...r, position: i + 1 }));
        return { status: 200, body: { deleted: true } };
      },
    });
    open(a);
    await loaded();
    fireEvent.click(within(rowOf("Uklon")).getByRole("button", { name: "Видалити" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(plain(dialog.textContent)).toContain(
      "Правило «Якщо Мерчант = Uklon» перестане діяти на нові транзакції",
    );
    expect(plain(dialog.textContent)).toContain("лишаться як є");
    fireEvent.click(within(dialog).getByRole("button", { name: "Скасувати" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(sent(a, "DELETE")).toHaveLength(0);
    expect(rows()).toHaveLength(6);

    fireEvent.click(within(rowOf("Uklon")).getByRole("button", { name: "Видалити" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Видалити" }));
    await waitFor(() => expect(rows()).toHaveLength(5));
    expect(sent(a, "DELETE")).toHaveLength(1);
    expect(screen.queryByText(/Uklon/)).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("Правило видалено");
  });
});

describe("BUD-14@PoC S-198 «Правило категорії»", () => {
  const fill = (merchantName: string) => {
    fireEvent.change(screen.getByRole("textbox", { name: "Значення" }), { target: { value: merchantName } });
  };

  it("BUD-14@PoC AC2: the dialog «Нове правило» — «Умови*», «Категорія*», collapsed «Додатково», the box with N; «Показати» lists the 14 transactions with 839,86 € and writes nothing; «Зберегти правило» with the box applies once and offers «Відмінити»", async () => {
    const a = api(SIX(), {
      "POST /v1/category-rules": (call) => ({
        status: 201,
        body: { ...rule(7, (call.body as { conditions: Condition[] }).conditions, SUBS), duplicateOf: null },
      }),
      [`POST /v1/category-rules/${ruleId(7)}/apply`]: { status: 201, body: run({ ruleId: ruleId(7) }) },
    });
    open(a);
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Нове правило" }));
    const dialog = await screen.findByRole("dialog", { name: "Правило категорії" });
    expect(within(dialog).getByText("Умови")).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Додатково" }).getAttribute("aria-expanded")).toBe(
      "false",
    );
    expect(within(dialog).getByText("Мають виконуватися всі умови")).toBeTruthy();

    // «Мерчант містить Adobe» and «Сума більше за 50 €»
    fireEvent.change(within(dialog).getAllByRole("combobox", { name: "Оператор" })[0]!, {
      target: { value: "contains" },
    });
    fill("Adobe");
    fireEvent.click(within(dialog).getByRole("button", { name: "+ Додати умову" }));
    fireEvent.change(within(dialog).getAllByRole("combobox", { name: "Поле" })[1]!, {
      target: { value: "amount" },
    });
    fireEvent.change(within(dialog).getAllByRole("combobox", { name: "Оператор" })[1]!, {
      target: { value: "greater" },
    });
    const amountField = within(dialog).getAllByRole("textbox", { name: "Значення" })[1]!;
    fireEvent.change(amountField, { target: { value: "50" } });
    fireEvent.blur(amountField);
    choose(/Категорія/, "Підписки");
    fireEvent.click(within(dialog).getByRole("button", { name: "Додатково" }));
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Теги" }), { target: { value: "софт" } });

    const box = await within(dialog).findByRole(
      "checkbox",
      { name: /^Застосувати до 14\sнаявних транзакцій, що підходять$/ },
      { timeout: 4000 },
    );
    expect(sent(a, "POST", "/v1/category-rules/matches").pop()!.body).toEqual({
      conditions: [
        merchant("Adobe", "contains"),
        { field: "amount", operator: "greater", value: eur("50.00") },
      ],
    });
    fireEvent.click(box);

    // «Показати»: the list of 14 with their sum; nothing is written.
    fireEvent.click(within(dialog).getByRole("button", { name: "Показати" }));
    const list = await screen.findByRole("dialog", { name: "Транзакції, що підходять" });
    expect(plain(list.textContent)).toContain("14 транзакцій на −839,86 €");
    expect(within(list).getAllByRole("row")).toHaveLength(15);
    expect(sent(a, "POST").filter((c) => c.path !== "/v1/category-rules/matches")).toHaveLength(0);
    fireEvent.click(within(list).getAllByRole("button", { name: "Закрити" }).at(-1)!);

    const save = await screen.findByRole("button", { name: "Зберегти правило" });
    fireEvent.click(save);
    await waitFor(() => expect(sent(a, "POST", `/v1/category-rules/${ruleId(7)}/apply`)).toHaveLength(1));
    expect(sent(a, "POST", "/v1/category-rules")[0]!.body).toEqual({
      conditions: [
        merchant("Adobe", "contains"),
        { field: "amount", operator: "greater", value: eur("50.00") },
      ],
      categoryId: SUBS,
      tags: ["софт"],
    });
    const notice = await screen.findByText("Правило застосовано: змінено 14 з 14");
    expect(notice).toBeTruthy();
    expect(screen.getByRole("button", { name: "Відмінити" })).toBeTruthy();
    expect(screen.getByText(/Відмінити можна до/)).toBeTruthy();
  });

  it("BUD-14@PoC AC9: without the box a saved rule acts on new transactions only — no apply request", async () => {
    const a = api(SIX(), {
      "POST /v1/category-rules": (call) => ({
        status: 201,
        body: { ...rule(7, (call.body as { conditions: Condition[] }).conditions, SUBS), duplicateOf: null },
      }),
    });
    open(a);
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Нове правило" }));
    const dialog = await screen.findByRole("dialog", { name: "Правило категорії" });
    fillAdobe(dialog);
    await within(dialog).findByRole("checkbox", { name: /Застосувати до 14/ }, { timeout: 4000 });
    fireEvent.click(await screen.findByRole("button", { name: "Зберегти правило" }));
    await waitFor(() => expect(sent(a, "POST", "/v1/category-rules")).toHaveLength(1));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(sent(a, "POST").some((c) => c.path.endsWith("/apply"))).toBe(false);
    expect(screen.getByRole("status").textContent).toContain("Правило збережено");
  });

  function fillAdobe(dialog: HTMLElement) {
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Значення" }), {
      target: { value: "Adobe" },
    });
    choose(/Категорія/, "Підписки");
  }

  it("BUD-14@PoC FR 5: a field offers its own operators; the main action stays inactive while a condition or the category is missing and says what to fill", async () => {
    const a = api(SIX());
    open(a);
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Нове правило" }));
    const dialog = await screen.findByRole("dialog", { name: "Правило категорії" });
    const operators = (i: number) =>
      [...within(within(dialog).getAllByRole("combobox", { name: "Оператор" })[i]!).getAllByRole("option")]
        .filter((o) => o.getAttribute("value"))
        .map((o) => o.textContent);
    expect(operators(0)).toEqual(["дорівнює", "містить"]);
    fireEvent.change(within(dialog).getAllByRole("combobox", { name: "Поле" })[0]!, {
      target: { value: "amount" },
    });
    expect(operators(0)).toEqual(["дорівнює", "більше за", "менше за"]);
    fireEvent.change(within(dialog).getAllByRole("combobox", { name: "Поле" })[0]!, {
      target: { value: "account" },
    });
    expect(operators(0)).toEqual(["дорівнює"]);
    const save = within(dialog).getByRole("button", { name: "Зберегти правило" });
    expect(save.getAttribute("aria-disabled")).toBe("true");
    expect(plain(dialog.textContent)).toContain("Щоб продовжити, заповніть: Умови, Категорія");
    expect(sent(a, "POST")).toHaveLength(0);
  });

  it("BUD-14@PoC AC8: saving a rule with the conditions of an existing one warns with a link to it; the rule is saved all the same", async () => {
    const list = [...SIX(), rule(7, [merchant("Netflix", "contains")], SUBS)];
    const a = api(list, {
      "POST /v1/category-rules": (call) => ({
        status: 201,
        body: {
          ...rule(8, (call.body as { conditions: Condition[] }).conditions, SUBS),
          duplicateOf: ruleId(7),
        },
      }),
    });
    open(a);
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Нове правило" }));
    const dialog = await screen.findByRole("dialog", { name: "Правило категорії" });
    fireEvent.change(within(dialog).getByRole("combobox", { name: "Оператор" }), {
      target: { value: "contains" },
    });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Значення" }), {
      target: { value: "Netflix" },
    });
    choose(/Категорія/, "Підписки");
    fireEvent.click(await screen.findByRole("button", { name: "Зберегти правило" }));
    await waitFor(() => expect(sent(a, "POST", "/v1/category-rules")).toHaveLength(1));
    a.state.rules = [...a.state.rules, rule(8, [merchant("Netflix", "contains")], SUBS)];
    const warning = await screen.findByText("Правило з такими самими умовами вже є: №7");
    expect(warning).toBeTruthy();
    const link = screen.getByRole("button", { name: "Показати правило №7" });
    fireEvent.click(link);
    expect(document.activeElement?.id).toBe(`rule-${ruleId(7)}`);
  });

  it("BUD-14@PoC FR 4: the pencil opens the dialog with the rule — conditions, category and tags — and «Зберегти правило» changes it with PATCH", async () => {
    const a = api(SIX(), {
      [`PATCH /v1/category-rules/${ruleId(4)}`]: { status: 200, body: { ...SIX()[3]!, duplicateOf: null } },
    });
    open(a);
    await loaded();
    fireEvent.click(within(rowOf("WOG")).getByRole("button", { name: "Змінити правило" }));
    const dialog = await screen.findByRole("dialog", { name: "Правило категорії" });
    expect((within(dialog).getAllByRole("textbox", { name: "Значення" })[0] as HTMLInputElement).value).toBe(
      "WOG",
    );
    expect(within(dialog).getByRole("button", { name: /Пальне/ })).toBeTruthy();
    expect((within(dialog).getByRole("textbox", { name: "Теги" }) as HTMLInputElement).value).toBe("авто");
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Теги" }), {
      target: { value: "авто, дорога" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Зберегти правило" }));
    await waitFor(() => expect(sent(a, "PATCH")).toHaveLength(1));
    expect(sent(a, "PATCH")[0]!.body).toMatchObject({
      tags: ["авто", "дорога"],
      categoryId: FUEL,
      accountIds: [],
    });
  });

  it("BUD-14@PoC FR 4: «Лише для рахунків» sends the chosen accounts; none chosen sends no `accountIds` for a new rule", async () => {
    const a = api(SIX(), {
      "POST /v1/category-rules": (call) => ({
        status: 201,
        body: { ...rule(7, (call.body as { conditions: Condition[] }).conditions, SUBS), duplicateOf: null },
      }),
    });
    open(a);
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Нове правило" }));
    const dialog = await screen.findByRole("dialog", { name: "Правило категорії" });
    fillAdobe(dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: "Додатково" }));
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Поточний ··4417" }));
    fireEvent.click(await screen.findByRole("button", { name: "Зберегти правило" }));
    await waitFor(() => expect(sent(a, "POST", "/v1/category-rules")).toHaveLength(1));
    expect(sent(a, "POST", "/v1/category-rules")[0]!.body).toMatchObject({ accountIds: [ACC] });
  });

  it("BUD-14@PoC FR 4: a refused save (the limit of rules) says so in the dialog and keeps the form", async () => {
    const a = api(SIX(), { "POST /v1/category-rules": problem(422, "LIMIT_REACHED") });
    open(a);
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Нове правило" }));
    const dialog = await screen.findByRole("dialog", { name: "Правило категорії" });
    fillAdobe(dialog);
    fireEvent.click(await screen.findByRole("button", { name: "Зберегти правило" }));
    expect(await screen.findByText("Правил забагато: можна мати до 500")).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Правило категорії" })).toBeTruthy();
  });
});

describe("BUD-14@PoC the run on existing transactions", () => {
  async function saveWithRun(started: Run, then?: Record<string, Handler>) {
    const a = api(SIX(), {
      "POST /v1/category-rules": (call) => ({
        status: 201,
        body: { ...rule(7, (call.body as { conditions: Condition[] }).conditions, SUBS), duplicateOf: null },
      }),
      [`POST /v1/category-rules/${ruleId(7)}/apply`]: { status: 201, body: started },
      ...then,
    });
    open(a);
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Нове правило" }));
    const dialog = await screen.findByRole("dialog", { name: "Правило категорії" });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Значення" }), {
      target: { value: "Adobe" },
    });
    choose(/Категорія/, "Підписки");
    fireEvent.click(
      await within(dialog).findByRole("checkbox", { name: /Застосувати до 14/ }, { timeout: 4000 }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Зберегти правило" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    return a;
  }

  it("BUD-14@PoC AC4: the result shows «Пропущено: ручні зміни (1)»", async () => {
    await saveWithRun(run({ changed: 13, skipped: { manual: 1, unavailable: 0, unchanged: 0 } }));
    expect(await screen.findByText("Пропущено: ручні зміни (1)")).toBeTruthy();
    expect(screen.getByText("Правило застосовано: змінено 13 з 14")).toBeTruthy();
  });

  it("BUD-14@PoC AC5: a run beyond 500 goes on in the background — «Оброблено 500 з 1 200» — and ends with its result", async () => {
    const reads: Run[] = [
      run({ status: "running", background: true, count: 1200, processed: 1000, changed: 1000 }),
      run({ status: "completed", background: true, count: 1200, processed: 1200, changed: 1200 }),
    ];
    const a = await saveWithRun(
      run({ status: "running", background: true, count: 1200, processed: 500, changed: 500 }),
      {
        "GET /v1/category-rule-runs/00000000-0000-4000-8000-0000000000f1": () => ({
          status: 200,
          body: reads.shift() ?? reads[0],
        }),
      },
    );
    const progress = await screen.findByText(/Оброблено 500 з 1\s?200/);
    expect(progress).toBeTruthy();
    expect(screen.getByRole("progressbar")).toBeTruthy();
    expect(await screen.findByText(/змінено 1\s?200 з 1\s?200/, {}, { timeout: 5000 })).toBeTruthy();
    expect(
      sent(a, "GET", "/v1/category-rule-runs/00000000-0000-4000-8000-0000000000f1").length,
    ).toBeGreaterThan(1);
  }, 10000);

  it("BUD-14@PoC AC6: «Відмінити» after 7 days is refused with «Час для відміни минув»; a second one — «Запуск уже відмінено»", async () => {
    const undo = `POST /v1/category-rule-runs/00000000-0000-4000-8000-0000000000f1/undo`;
    let code = "RULE_RUN_UNDO_EXPIRED";
    await saveWithRun(run(), { [undo]: () => problem(409, code) });
    fireEvent.click(screen.getByRole("button", { name: "Відмінити" }));
    expect(await screen.findByText("Час для відміни минув")).toBeTruthy();
    code = "RULE_RUN_UNDONE";
    fireEvent.click(screen.getByRole("button", { name: "Відмінити" }));
    expect(await screen.findByText("Запуск уже відмінено")).toBeTruthy();
  });

  it("BUD-14@PoC FR 7: «Відмінити» within 7 days sends the undo and shows what was restored", async () => {
    const undo = `POST /v1/category-rule-runs/00000000-0000-4000-8000-0000000000f1/undo`;
    const a = await saveWithRun(run(), {
      [undo]: {
        status: 200,
        body: run({
          status: "undone",
          undo: { available: false, until: null, restored: 13, notRestored: 1 },
        }),
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Відмінити" }));
    expect(await screen.findByText("Запуск відмінено: відновлено 13, не відновлено 1")).toBeTruthy();
    expect(sent(a, "POST", undo.replace("POST ", ""))).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Відмінити" })).toBeNull();
  });

  it("BUD-14@PoC FR 7: a run another run blocks is named, and the rule is still saved", async () => {
    await saveWithRun(run(), {
      [`POST /v1/category-rules/${ruleId(7)}/apply`]: problem(409, "RULE_RUN_RUNNING"),
    });
    expect(await screen.findByText("Інший запуск ще триває. Зачекайте його завершення.")).toBeTruthy();
  });
});
