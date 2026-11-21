import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { I18nProvider } from "@willowsum/i18n";
import { installMatchMedia } from "@willowsum/ui/test-utils";
import { AuthApiProvider } from "../auth/api.ts";
import {
  fakeApi,
  plain,
  problem,
  renderAt,
  resetAuthState,
  type Call,
  type Reply,
} from "../auth/testing.tsx";
import { BudgetWizardPage } from "./budget/WizardPage.tsx";

/**
 * BUD-02@PoC i) (owner, 2026-11-21: «1 а», «2 а», «3 а»; web part of #697): the income plan by income categories in the
 * wizard (FR 21), the actions of a category in the wizard and on «Бюджет» (FR 7, FR 22, FR 23), the deficit that may stay
 * (FR 15, AC7, AC17), the banner «План з дефіцитом N €» and the card «Дохід» by category (FR 9, AC18). Boards:
 * PocPlanBudgetWiz3, Wiz4Deficit, PocPlanBudget, PocPlanBudgetDeficit, PocPlanBudgetTexts. The figures are synthetic and
 * the server's: the screen adds up only the typed income rows for «сума категорій доходу».
 */
const id = (n: number) => `c0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const eur = (amount: string) => ({ amount, currency: "EUR" });
const G_DAILY = id(100);
const G_INCOME = id(101);

type Cat = { id: string; name: string; kind: "expense" | "income"; deletable: boolean; hidden?: boolean };
const category = (c: Cat, groupId: string) => ({
  id: c.id,
  groupId,
  systemKey: null,
  kind: c.kind,
  name: c.name,
  renamed: false,
  icon: "tag",
  color: "#112233",
  iconTone: "white",
  essential: null,
  hidden: c.hidden ?? false,
  deletable: c.deletable,
});
const tree = (cats: readonly Cat[]) => ({
  groups: [
    {
      id: G_DAILY,
      systemKey: null,
      kind: "expense",
      name: "Щоденне",
      renamed: false,
      tone: "x",
      categories: cats.filter((c) => c.kind === "expense").map((c) => category(c, G_DAILY)),
    },
    {
      id: G_INCOME,
      systemKey: null,
      kind: "income",
      name: "Доходи",
      renamed: false,
      tone: "x",
      categories: cats.filter((c) => c.kind === "income").map((c) => category(c, G_INCOME)),
    },
  ],
});
const PRODUCTS: Cat = { id: id(1), name: "Продукти", kind: "expense", deletable: true };
const TRANSPORT: Cat = { id: id(2), name: "Транспорт", kind: "expense", deletable: false };
const SALARY: Cat = { id: id(3), name: "Зарплата", kind: "income", deletable: false };
const FREELANCE: Cat = { id: id(4), name: "Фриланс", kind: "income", deletable: true };
const CATS = [PRODUCTS, TRANSPORT, SALARY, FREELANCE];
const CAT_BASE = { kind: "income" as const, deletable: true };

const wizard = (over: { available?: boolean } = {}) => ({
  today: "2026-11-01",
  midPeriod: false,
  starts: [
    {
      start: "period-start",
      firstPeriod: "2026-11",
      from: "2026-11-01",
      to: "2026-11-30",
      days: null,
      daysInPeriod: null,
    },
  ],
  fromSpending: {
    available: over.available !== false,
    historyMonths: 7,
    incomePlan: eur("5600.00"),
    incomeIrregular: false,
    categories: [
      { categoryId: PRODUCTS.id, average: eur("405.00"), limit: eur("400.00") },
      { categoryId: TRANSPORT.id, average: eur("158.20"), limit: eur("160.00") },
    ],
    incomes: [
      { categoryId: SALARY.id, average: eur("5000.00"), plan: eur("5000.00"), irregular: false },
      { categoryId: FREELANCE.id, average: eur("598.30"), plan: eur("600.00"), irregular: false },
    ],
  },
});
const balance = (kind: "surplus" | "deficit", amount: string) => ({
  recurringOutsideLimits: eur("0.00"),
  unallocated: eur("2740.00"),
  debtMinimums: eur("0.00"),
  difference: eur(kind === "deficit" ? `-${amount}` : amount),
  kind,
  amount: eur(amount),
});
const answer = (kind: "surplus" | "deficit", amount: string, choice: unknown = null) => ({
  period: "2026-11",
  incomePlan: eur("2500.00"),
  limits: eur("2860.00"),
  balance: balance(kind, amount),
  choice,
  spendable: { period: "2026-11", amount: eur("-360.00"), missing: [] },
});

/** The server's tree as it is now: a category action changes it, the next `GET /v1/categories` shows that. */
function mount(
  over: Record<string, Reply | ((call: Call, url: URL) => Reply | Promise<Reply>)> = {},
  cats: Cat[] = [...CATS],
  available = true,
) {
  const state = { cats };
  const api = fakeApi({
    "GET /v1/budget": { status: 200, body: { budget: null } },
    "GET /v1/budget/wizard": { status: 200, body: wizard({ available }) },
    "GET /v1/categories": () => ({ status: 200, body: tree(state.cats) }),
    "GET /v1/space": { status: 200, body: { name: "Дім", dataRegion: "eu", reportingCurrency: "EUR" } },
    "POST /v1/budget": { status: 201, body: { id: "b1" } },
    "POST /v1/budget/allocation": { status: 200, body: answer("surplus", "2740.00") },
    "GET /v1/goals": { status: 200, body: { goals: [] } },
    "GET /v1/debts": { status: 200, body: { debts: [] } },
    "GET /v1/accounts": { status: 200, body: { items: [], nextCursor: null } },
    "GET /v1/me/features": { status: 200, body: { features: ["budget.period", "budget.plan"] } },
    ...over,
  });
  render(
    <I18nProvider>
      <AuthApiProvider value={api.client}>
        <BudgetWizardPage />
      </AuthApiProvider>
    </I18nProvider>,
  );
  return { ...api, state };
}

beforeEach(() => {
  installMatchMedia({ width: 1280 });
  resetAuthState();
  window.location.hash = "#/planning/budget/new";
});
afterEach(cleanup);

const next = () => fireEvent.click(screen.getByRole("button", { name: /Далі/ }));
const toLimits = async () => {
  await screen.findByRole("heading", { name: "Як створити бюджет?" });
  next();
  await screen.findByRole("heading", { name: "Період бюджету" });
  next();
  await screen.findByRole("heading", { name: "Ліміти категорій" });
};
const type = (name: RegExp | string, value: string) => {
  const input = screen.getByRole("textbox", { name });
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
};
const rowOf = (name: string) => screen.getByRole("rowheader", { name }).closest("tr")!;
const incomeSum = () => plain(document.querySelector(".bud-wiz-income-sum")?.textContent);
const postBody = (calls: readonly Call[], path = "/v1/budget") =>
  calls.find((c) => c.method === "POST" && c.path === path)?.body as {
    incomePlan?: unknown;
    incomePlans?: { categoryId: string; amount: { amount: string } }[];
    limits: { categoryId: string; amount: { amount: string } }[];
    allocation?: unknown;
  };
const openMenu = (name: string) => {
  fireEvent.click(within(rowOf(name)).getByRole("button", { name: `Ще дії: ${name}` }));
  return screen.getByRole("menu", { name: `Дії категорії «${name}»` });
};
const menuItems = (menu: HTMLElement) =>
  [...menu.querySelectorAll('[role^="menuitem"]')].map((i) => plain(i.textContent));

describe("BUD-02@PoC i) wizard «Ліміти»: «План доходу» by income categories", () => {
  it("BUD-02@PoC FR 21: «Створити за моїми витратами» lists the income categories with their average and plan; the plan is their sum and goes as `incomePlans`", async () => {
    const { calls } = mount();
    await toLimits();
    const section = document.querySelector<HTMLElement>(".bud-wiz-income")!;
    expect(within(section).getByRole("heading", { name: "План доходу" })).toBeTruthy();
    expect(incomeSum()).toBe("сума категорій доходу 5 600,00 €");
    expect(plain(rowOf("Зарплата").textContent)).toContain("5 000,00 €");
    expect(plain(rowOf("Фриланс").textContent)).toContain("598,30 €");
    expect((within(rowOf("Фриланс")).getByRole("textbox") as HTMLInputElement).value).toContain("600");
    expect(within(section).getByRole("button", { name: "Додати категорію доходу" })).toBeTruthy();
    expect(screen.getByText("категорія доходу без плану або «Нова категорія доходу…»")).toBeTruthy();

    type(/План доходу: Фриланс/, "700");
    expect(incomeSum()).toBe("сума категорій доходу 5 700,00 €");
    next();
    await screen.findByRole("heading", { name: "Розподіл профіциту" });
    const create = screen.getByRole("button", { name: "Створити бюджет" });
    await waitFor(() => expect(create.getAttribute("aria-disabled")).not.toBe("true"));
    fireEvent.click(create);
    await waitFor(() => expect(postBody(calls)).toBeTruthy());
    const body = postBody(calls);
    expect(body.incomePlan).toBeUndefined();
    expect(body.incomePlans).toEqual([
      { categoryId: SALARY.id, amount: eur("5000.00") },
      { categoryId: FREELANCE.id, amount: eur("700.00") },
    ]);
  });

  it("BUD-02@PoC FR 21: «Прибрати» (✕) takes a row out of the list and out of the plan", async () => {
    const { calls } = mount();
    await toLimits();
    fireEvent.click(within(rowOf("Фриланс")).getByRole("button", { name: "Прибрати: Фриланс" }));
    expect(screen.queryByRole("rowheader", { name: "Фриланс" })).toBeNull();
    expect(incomeSum()).toBe("сума категорій доходу 5 000,00 €");
    await waitFor(() => {
      const preview = [...calls].reverse().find((c) => c.path === "/v1/budget/allocation");
      expect((preview?.body as { incomePlans: unknown[] }).incomePlans).toHaveLength(1);
    });
  });

  it("BUD-02@PoC FR 21: «Почати з нуля» leaves the list empty (the plan 0,00 €) and no `incomePlans` is sent", async () => {
    const { calls } = mount({}, [...CATS], false);
    await toLimits();
    expect(incomeSum()).toBe("сума категорій доходу 0,00 €");
    expect(screen.queryByRole("rowheader", { name: "Зарплата" })).toBeNull();
    next();
    await screen.findByRole("heading", { name: "Розподіл профіциту" });
    const create = screen.getByRole("button", { name: "Створити бюджет" });
    await waitFor(() => expect(create.getAttribute("aria-disabled")).not.toBe("true"));
    fireEvent.click(create);
    await waitFor(() => expect(postBody(calls)).toBeTruthy());
    expect(Object.keys(postBody(calls)).sort()).toEqual(["firstPeriod", "limits", "proportional"]);
  });

  it("BUD-02@PoC FR 21: «Додати категорію доходу» adds an editable row — a list of income categories without a plan, then «Нова категорія доходу…», a sum, ✓ and ✕", async () => {
    mount();
    await toLimits();
    fireEvent.click(within(rowOf("Фриланс")).getByRole("button", { name: "Прибрати: Фриланс" }));
    fireEvent.click(screen.getByRole("button", { name: "Додати категорію доходу" }));
    const select = screen.getByRole("combobox", { name: "Категорія доходу" }) as HTMLSelectElement;
    expect([...select.options].filter((o) => o.value !== "").map((o) => o.textContent)).toEqual([
      "Фриланс",
      "Нова категорія доходу…",
    ]);
    // ✕ closes the row without a change.
    fireEvent.click(
      within(select.closest<HTMLElement>(".bud-wiz-income-add")!).getByRole("button", { name: "Скасувати" }),
    );
    expect(screen.queryByRole("combobox", { name: "Категорія доходу" })).toBeNull();
    expect(incomeSum()).toBe("сума категорій доходу 5 000,00 €");

    fireEvent.click(screen.getByRole("button", { name: "Додати категорію доходу" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Категорія доходу" }), {
      target: { value: FREELANCE.id },
    });
    type(/План на місяць/, "450");
    fireEvent.click(screen.getByRole("button", { name: "Додати" }));
    expect(plain(rowOf("Фриланс").textContent)).toContain("450");
    expect(incomeSum()).toBe("сума категорій доходу 5 450,00 €");
  });

  it("BUD-02@PoC AC18: «Нова категорія доходу…» creates an income category of the space in the chosen income group and puts it in the row with its plan", async () => {
    const created = { id: id(9), name: "Репетиторство" };
    const { calls, state } = mount({
      "POST /v1/categories": (call) => {
        state.cats.push({
          id: created.id,
          name: (call.body as { name: string }).name,
          kind: "income",
          deletable: true,
        });
        return { status: 201, body: { id: created.id } };
      },
    });
    await toLimits();
    fireEvent.click(screen.getByRole("button", { name: "Додати категорію доходу" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Категорія доходу" }), {
      target: { value: "__new" },
    });
    const dialog = await screen.findByRole("dialog", { name: "Нова категорія" });
    const group = within(dialog).getByRole("combobox", { name: /Група/ }) as HTMLSelectElement;
    // Only the groups of income: an income plan takes income categories.
    expect([...group.options].filter((o) => o.value !== "").map((o) => o.textContent)).toEqual(["Доходи"]);
    fireEvent.change(within(dialog).getByRole("textbox", { name: /Назва/ }), {
      target: { value: "Репетиторство" },
    });
    fireEvent.change(group, { target: { value: G_INCOME } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Додати категорію" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() =>
      expect((screen.getByRole("combobox", { name: "Категорія доходу" }) as HTMLSelectElement).value).toBe(
        created.id,
      ),
    );
    expect(calls.find((c) => c.method === "POST" && c.path === "/v1/categories")?.body).toEqual({
      name: "Репетиторство",
      groupId: G_INCOME,
    });
    type(/План на місяць/, "300");
    fireEvent.click(screen.getByRole("button", { name: "Додати" }));
    expect(incomeSum()).toBe("сума категорій доходу 5 900,00 €");
  });
});

describe("BUD-02@PoC i) the actions of a category in the wizard", () => {
  it("BUD-02@PoC FR 22: every row has «…» with «Перейменувати», «Прибрати з бюджету» and «Видалити категорію…»; «Прибрати з бюджету» empties the limit", async () => {
    const { calls } = mount();
    await toLimits();
    expect(menuItems(openMenu("Продукти"))).toEqual([
      "Обов’язкова",
      "Перейменувати",
      "Прибрати з бюджету",
      "Видалити категорію…",
    ]);
    expect((within(rowOf("Продукти")).getByRole("textbox") as HTMLInputElement).value).toContain("400");
    fireEvent.click(screen.getByRole("menuitem", { name: "Прибрати з бюджету" }));
    expect((within(rowOf("Продукти")).getByRole("textbox") as HTMLInputElement).value).toBe("");
    next();
    await screen.findByRole("heading", { name: "Розподіл профіциту" });
    const create = screen.getByRole("button", { name: "Створити бюджет" });
    await waitFor(() => expect(create.getAttribute("aria-disabled")).not.toBe("true"));
    fireEvent.click(create);
    await waitFor(() => expect(postBody(calls)).toBeTruthy());
    expect(postBody(calls).limits.map((l) => l.categoryId)).toEqual([TRANSPORT.id]);
  });

  it("BUD-02@PoC FR 22: «Обов’язкова» of the menu opens a popover from the row (no modal dialog) and saves the attribute on the category", async () => {
    const { calls } = mount({
      "PATCH /v1/categories/c0000000-0000-4000-8000-000000000001": { status: 200, body: {} },
    });
    await toLimits();
    fireEvent.click(within(openMenu("Продукти")).getByRole("menuitem", { name: "Обов’язкова" }));
    const popover = await screen.findByRole("dialog", { name: "Обов’язкова: Продукти" });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    const box = within(popover).getByRole("checkbox", { name: "Обов’язкова" }) as HTMLInputElement;
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    fireEvent.click(within(popover).getByRole("button", { name: "Зберегти" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({ essential: true });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Обов’язкова: Продукти" })).toBeNull());
  });

  it("BUD-02@PoC FR 22: «Скасувати» of the «Обов’язкова» popover saves nothing; a refused save says so and keeps the popover", async () => {
    const { calls } = mount({
      "PATCH /v1/categories/c0000000-0000-4000-8000-000000000001": problem(503, "MODULE_UNAVAILABLE"),
    });
    await toLimits();
    fireEvent.click(within(openMenu("Продукти")).getByRole("menuitem", { name: "Обов’язкова" }));
    let popover = await screen.findByRole("dialog", { name: "Обов’язкова: Продукти" });
    fireEvent.click(within(popover).getByRole("button", { name: "Скасувати" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Обов’язкова: Продукти" })).toBeNull());
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
    fireEvent.click(within(openMenu("Продукти")).getByRole("menuitem", { name: "Обов’язкова" }));
    popover = await screen.findByRole("dialog", { name: "Обов’язкова: Продукти" });
    fireEvent.click(within(popover).getByRole("checkbox", { name: "Обов’язкова" }));
    fireEvent.click(within(popover).getByRole("button", { name: "Зберегти" }));
    expect(await within(popover).findByRole("alert")).toBeTruthy();
  });

  it("BUD-02@PoC FR 22: the buttons of a row say whose they are — «Ще дії: {name}», «Прибрати: {name}» — and the group's «Додати категорію» is not part of its heading cell", async () => {
    mount();
    await toLimits();
    expect(screen.getByRole("button", { name: "Ще дії: Транспорт" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Прибрати: Зарплата" })).toBeTruthy();
    const heading = screen.getByRole("rowheader", { name: "Щоденне" });
    expect(heading.querySelector("button")).toBeNull();
    expect(within(heading.closest("tr")!).getByRole("button", { name: "Додати категорію" })).toBeTruthy();
  });

  it("BUD-02@PoC FR 22: «Додати категорію» in the group heading offers «Нова категорія…»; the new category gets its row with the limit typed (AC20)", async () => {
    const { calls, state } = mount({
      "POST /v1/categories": (call) => {
        state.cats.push({
          id: id(10),
          name: (call.body as { name: string }).name,
          kind: "expense",
          deletable: true,
        });
        return { status: 201, body: { id: id(10) } };
      },
    });
    await toLimits();
    fireEvent.click(screen.getByRole("button", { name: "Додати категорію" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Нова категорія…" }));
    const dialog = await screen.findByRole("dialog", { name: "Нова категорія" });
    // The group it was added from is chosen, and only the groups of expenses are offered.
    expect((within(dialog).getByRole("combobox", { name: /Група/ }) as HTMLSelectElement).value).toBe(
      G_DAILY,
    );
    fireEvent.change(within(dialog).getByRole("textbox", { name: /Назва/ }), {
      target: { value: "Обіди на роботі" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Додати категорію" }));
    await screen.findByRole("rowheader", { name: "Обіди на роботі" });
    expect(calls.find((c) => c.method === "POST" && c.path === "/v1/categories")?.body).toEqual({
      name: "Обіди на роботі",
      groupId: G_DAILY,
    });
    type(/Ліміт: Обіди на роботі/, "120");
    next();
    await screen.findByRole("heading", { name: "Розподіл профіциту" });
    const create = screen.getByRole("button", { name: "Створити бюджет" });
    await waitFor(() => expect(create.getAttribute("aria-disabled")).not.toBe("true"));
    fireEvent.click(create);
    await waitFor(() => expect(postBody(calls)).toBeTruthy());
    expect(postBody(calls).limits).toContainEqual({ categoryId: id(10), amount: eur("120.00") });
  });

  it("BUD-02@PoC FR 23: «Перейменувати» changes the name of the category; a taken name is refused with «Така назва вже існує»", async () => {
    const { calls, state } = mount({
      [`PATCH /v1/categories/${PRODUCTS.id}`]: (call) => {
        const name = (call.body as { name: string }).name;
        if (name === "Транспорт") return problem(409, "CATEGORY_NAME_TAKEN");
        PRODUCTS.name = name;
        return { status: 200, body: {} };
      },
    });
    await toLimits();
    fireEvent.click(within(openMenu("Продукти")).getByRole("menuitem", { name: "Перейменувати" }));
    const dialog = await screen.findByRole("dialog", { name: "Перейменувати «Продукти»" });
    fireEvent.change(within(dialog).getByRole("textbox", { name: /Назва/ }), {
      target: { value: "Транспорт" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Зберегти" }));
    expect(await within(dialog).findByText("Така назва вже існує")).toBeTruthy();
    fireEvent.change(within(dialog).getByRole("textbox", { name: /Назва/ }), {
      target: { value: "Кава з собою" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Зберегти" }));
    await screen.findByRole("rowheader", { name: "Кава з собою" });
    state.cats[0]!.name = "Кава з собою";
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(2);
    PRODUCTS.name = "Продукти";
  });

  it("BUD-02@PoC FR 23: «Видалити категорію…» of an empty custom category asks to confirm, deletes it, and its row is gone with its limit", async () => {
    const { calls, state } = mount({
      [`DELETE /v1/categories/${PRODUCTS.id}`]: () => {
        state.cats = state.cats.filter((c) => c.id !== PRODUCTS.id);
        return { status: 200, body: {} };
      },
    });
    await toLimits();
    fireEvent.click(within(openMenu("Продукти")).getByRole("menuitem", { name: "Видалити категорію…" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Видалити категорію «Продукти»?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Видалити" }));
    await waitFor(() => expect(screen.queryByRole("rowheader", { name: "Продукти" })).toBeNull());
    expect(calls.some((c) => c.method === "DELETE" && c.path === `/v1/categories/${PRODUCTS.id}`)).toBe(true);
    next();
    await screen.findByRole("heading", { name: "Розподіл профіциту" });
    const create = screen.getByRole("button", { name: "Створити бюджет" });
    await waitFor(() => expect(create.getAttribute("aria-disabled")).not.toBe("true"));
    fireEvent.click(create);
    await waitFor(() => expect(postBody(calls)).toBeTruthy());
    // The limit of a category that is gone is not sent (the server would refuse `not_found`).
    expect(postBody(calls).limits.map((l) => l.categoryId)).toEqual([TRANSPORT.id]);
  });

  it("BUD-02@PoC AC19: «Видалити категорію…» of a category with transactions offers «Приховати» and «Об’єднати з іншою…»; hiding takes it out of the step", async () => {
    const { calls, state } = mount({
      [`PATCH /v1/categories/${TRANSPORT.id}`]: () => {
        state.cats = state.cats.map((c) => (c.id === TRANSPORT.id ? { ...c, hidden: true } : c));
        return { status: 200, body: {} };
      },
    });
    await toLimits();
    fireEvent.click(within(openMenu("Транспорт")).getByRole("menuitem", { name: "Видалити категорію…" }));
    const dialog = await screen.findByRole("dialog", { name: "Видалити категорію «Транспорт»?" });
    expect(within(dialog).getByText(/не можна видалити/)).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Об’єднати з іншою…" })).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: "Видалити" })).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Приховати" }));
    await waitFor(() => expect(screen.queryByRole("rowheader", { name: "Транспорт" })).toBeNull());
    expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({ hidden: true });
  });

  it("BUD-02@PoC AC19: «Об’єднати з іншою…» of the dialog opens the merge of BUD-01 into the chosen category", async () => {
    mount();
    await toLimits();
    fireEvent.click(within(openMenu("Транспорт")).getByRole("menuitem", { name: "Видалити категорію…" }));
    const dialog = await screen.findByRole("dialog", { name: "Видалити категорію «Транспорт»?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Об’єднати з іншою…" }));
    expect(
      await screen.findByRole("dialog", { name: "Об’єднати «Транспорт» з іншою категорією" }),
    ).toBeTruthy();
  });
});

describe("BUD-02@PoC i) «Розподіл»: the deficit may stay", () => {
  it("BUD-02@PoC AC7: a deficit offers «Лишити дефіцит» and «Створити бюджет» is active when nothing covers it; the budget is created with no rows", async () => {
    const { calls } = mount({
      "POST /v1/budget/allocation": { status: 200, body: answer("deficit", "360.00") },
    });
    await toLimits();
    next();
    await screen.findByRole("heading", { name: /Звідки візьмуться 360,00/ });
    expect(screen.getByText("Лишити дефіцит")).toBeTruthy();
    expect(
      screen.getByText("непокрита частина лишиться в плані; «Можна витратити» може стати від’ємним"),
    ).toBeTruthy();
    expect(screen.getByText("решта")).toBeTruthy();
    expect(plain(document.body.textContent)).toContain(
      "з дефіцитом сторінка «Бюджет» покаже банер «План з дефіцитом 360,00 €»",
    );
    const create = screen.getByRole("button", { name: "Створити бюджет" });
    await waitFor(() => expect(create.getAttribute("aria-disabled")).not.toBe("true"));
    fireEvent.click(create);
    await waitFor(() => expect(postBody(calls)).toBeTruthy());
    expect(postBody(calls).allocation).toBeUndefined();
  });

  it("BUD-02@PoC AC17: «Створити бюджет» is active also when the chosen sources cover less than the deficit; the covered rows go, the rest stays the plan's deficit", async () => {
    const { calls } = mount({
      "POST /v1/budget/allocation": (call) => ({
        status: 200,
        body: (call.body as { allocation?: unknown[] }).allocation
          ? answer("deficit", "360.00", { chosen: eur("100.00"), rest: eur("260.00"), status: "short" })
          : answer("deficit", "360.00"),
      }),
      "GET /v1/goals": {
        status: 200,
        body: {
          goals: [
            {
              id: id(70),
              name: "Подушка безпеки",
              achieved: false,
              target: eur("2000.00"),
              collected: eur("1400.00"),
              requiredMonthly: eur("300.00"),
              template: "savings",
              targetDate: null,
            },
          ],
        },
      },
    });
    await toLimits();
    next();
    await screen.findByRole("heading", { name: /Звідки візьмуться 360,00/ });
    type(/Сума: З цілі «Подушка безпеки»/, "100");
    await screen.findByText("Покрито 100,00 € з 360,00 €");
    expect(screen.getByText(/260,00 €\s+лишилось/)).toBeTruthy();
    const create = screen.getByRole("button", { name: "Створити бюджет" });
    await waitFor(() => expect(create.getAttribute("aria-disabled")).not.toBe("true"));
    fireEvent.click(create);
    await waitFor(() => expect(postBody(calls)).toBeTruthy());
    expect(postBody(calls).allocation).toEqual([
      { kind: "from-goal", goalId: id(70), amount: eur("100.00") },
    ]);
  });
});

describe("BUD-02@PoC i) «Бюджет»", () => {
  const PAGE = "#/planning/budget";
  const money = eur;
  const rows = [
    {
      categoryId: id(1),
      limit: money("400.00"),
      mandatory: false,
      spent: money("100.00"),
      remaining: money("300.00"),
    },
    {
      categoryId: id(2),
      limit: money("160.00"),
      mandatory: false,
      spent: money("10.00"),
      remaining: money("150.00"),
    },
  ];
  const period = (over: Record<string, unknown> = {}) => ({
    period: "2026-11",
    mode: "current",
    currency: "EUR",
    approximate: { nearestRateCount: 0, unavailableCount: 0 },
    groups: [{ groupId: G_DAILY, categories: rows.map((r) => ({ ...r, groupId: G_DAILY })) }],
    incomeActual: money("5600.00"),
    incomePlan: money("5600.00"),
    incomeCategories: [
      { categoryId: SALARY.id, plan: money("5000.00"), actual: money("5600.00") },
      { categoryId: FREELANCE.id, plan: money("600.00"), actual: money("0.00") },
    ],
    outsidePlan: { categories: [{ categoryId: id(5), spent: money("96.00") }], total: money("96.00") },
    plannedSavings: money("0.00"),
    proportional: null,
    totals: { limits: money("560.00"), spent: money("110.00"), remaining: money("450.00") },
    ...over,
  });
  const budget = {
    budget: {
      id: "b0000000-0000-4000-8000-000000000001",
      createdOn: "2026-09-03",
      currency: "EUR",
      firstPeriod: "2026-09",
      incomePlan: money("5600.00"),
      incomePlans: [],
      limits: [],
      proportional: null,
      version: 7,
    },
  };
  const grid = (kind: "deficit" | "unallocated") => ({
    months: [{ period: "2026-11", inBudget: true, mode: "current" }],
    unallocated: [{ amount: money("200.00"), kind }],
  });
  const TRAVEL: Cat = { id: id(5), name: "Подорожі", kind: "expense", deletable: true };

  function open(over: Record<string, Reply | ((call: Call, url: URL) => Reply | Promise<Reply>)> = {}) {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-18T10:00:00Z"));
    const api = fakeApi({
      "GET /v1/budget": { status: 200, body: budget },
      "GET /v1/categories": { status: 200, body: tree([...CATS, TRAVEL]) },
      "GET /v1/budget/periods/2026-11": { status: 200, body: period() },
      "GET /v1/budget/plan-grid": { status: 200, body: grid("unallocated") },
      ...over,
    });
    renderAt(PAGE, api.client);
    return api;
  }
  afterEach(() => vi.useRealTimers());

  it("BUD-02@PoC AC17: a plan with a deficit shows the banner «План з дефіцитом N €» with the server's figure and a way to «План»", async () => {
    open({ "GET /v1/budget/plan-grid": { status: 200, body: grid("deficit") } });
    const banner = await screen.findByText("План з дефіцитом 200,00 €");
    const box = banner.closest(".bud-banner") as HTMLElement;
    expect(plain(box.textContent)).toContain(
      "ліміти й заплановані внески більші за план доходу; «Можна витратити» може стати від’ємним",
    );
    expect(within(box).getByRole("link", { name: "Відкрити «План»" }).getAttribute("href")).toBe(
      "#/planning/budget/plan",
    );
  });

  it("BUD-02@PoC AC17: without a deficit, or when «План» is off, there is no banner", async () => {
    open({ "GET /v1/budget/plan-grid": { status: 404, body: undefined } });
    await screen.findByRole("table");
    await waitFor(() => expect(screen.queryByText(/План з дефіцитом/)).toBeNull());
  });

  it("BUD-02@PoC FR 9: «Дохід» shows the plan and the fact of each income category, the mark of its row and «план виконано в 1 з 2 категорій»", async () => {
    open();
    await screen.findByRole("table");
    const card = document.querySelector<HTMLElement>("[data-plan-region='income']")!;
    expect(plain(card.textContent)).toContain("план виконано в 1 з 2 категорій");
    const [salary, freelance] = [...card.querySelectorAll("li")];
    expect(plain(salary!.textContent)).toContain("Зарплата");
    expect(plain(salary!.textContent)).toContain("5 600,00 €");
    expect(plain(salary!.textContent)).toContain("з 5 000,00 €");
    expect(within(salary as HTMLElement).getByRole("img", { name: "План досягнуто" })).toBeTruthy();
    expect(plain(freelance!.textContent)).toContain("з 600,00 €");
    expect(within(freelance as HTMLElement).getByRole("img", { name: "Очікується" })).toBeTruthy();
  });

  it("BUD-02@PoC AC18: the income of a category without a plan comes with plan 0, and a future month shows the plans only", async () => {
    open({
      "GET /v1/budget/periods/2026-11": {
        status: 200,
        body: period({
          incomeCategories: [{ categoryId: SALARY.id, plan: money("0.00"), actual: money("120.00") }],
        }),
      },
    });
    await screen.findByRole("table");
    const card = document.querySelector<HTMLElement>("[data-plan-region='income']")!;
    expect(plain(card.textContent)).toContain("з 0,00 €");
    // A category without a plan is not counted in «план виконано».
    expect(plain(card.textContent)).not.toContain("план виконано");
  });

  it("BUD-02@PoC FR 7: every limited row has «…» with «Перейменувати», «Прибрати з бюджету» and «Видалити категорію…»; a row of «Поза планом» has no «Прибрати з бюджету»", async () => {
    open();
    await screen.findByRole("table");
    const rowFor = (name: string) =>
      [...document.querySelectorAll<HTMLElement>(".bud-table tbody tr")].find(
        (r) => r.querySelector(".bud-name")?.firstChild?.textContent === name,
      )!;
    fireEvent.click(within(rowFor("Продукти")).getByRole("button", { name: "Ще дії: Продукти" }));
    expect(menuItems(screen.getByRole("menu", { name: "Дії категорії «Продукти»" }))).toEqual([
      "Обов’язкова",
      "Перейменувати",
      "Прибрати з бюджету",
      "Видалити категорію…",
    ]);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    fireEvent.click(within(rowFor("Подорожі")).getByRole("button", { name: "Ще дії: Подорожі" }));
    expect(menuItems(screen.getByRole("menu", { name: "Дії категорії «Подорожі»" }))).toEqual([
      "Обов’язкова",
      "Перейменувати",
      "Видалити категорію…",
    ]);
  });

  it("BUD-02@PoC AC19: «Прибрати з бюджету» sends the removal of the limit with the version of the budget and reads the page again", async () => {
    const api = open({
      "PATCH /v1/budget/plan": { status: 200, body: budget.budget },
    });
    await screen.findByRole("table");
    const row = [...document.querySelectorAll<HTMLElement>(".bud-table tbody tr")].find(
      (r) => r.querySelector(".bud-name")?.firstChild?.textContent === "Продукти",
    )!;
    fireEvent.click(within(row).getByRole("button", { name: "Ще дії: Продукти" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Прибрати з бюджету" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(api.calls.find((c) => c.method === "PATCH")?.body).toEqual({
      version: 7,
      limits: [{ categoryId: PRODUCTS.id, amount: null }],
    });
    await waitFor(() =>
      expect(
        api.calls.filter((c) => c.method === "GET" && c.path === "/v1/budget/periods/2026-11"),
      ).toHaveLength(2),
    );
  });

  it("BUD-02@PoC FR 7: «Обов’язкова» of a limited row opens a popover from the row, saves the attribute on the category and reads the page again", async () => {
    const api = open({ [`PATCH /v1/categories/${PRODUCTS.id}`]: { status: 200, body: {} } });
    await screen.findByRole("table");
    const row = [...document.querySelectorAll<HTMLElement>(".bud-table tbody tr")].find(
      (r) => r.querySelector(".bud-name")?.firstChild?.textContent === "Продукти",
    )!;
    fireEvent.click(within(row).getByRole("button", { name: "Ще дії: Продукти" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Обов’язкова" }));
    const popover = await screen.findByRole("dialog", { name: "Обов’язкова: Продукти" });
    fireEvent.click(within(popover).getByRole("checkbox", { name: "Обов’язкова" }));
    fireEvent.click(within(popover).getByRole("button", { name: "Зберегти" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(api.calls.find((c) => c.method === "PATCH")?.body).toEqual({ essential: true });
    await waitFor(() =>
      expect(
        api.calls.filter((c) => c.method === "GET" && c.path === "/v1/budget/periods/2026-11"),
      ).toHaveLength(2),
    );
  });

  it("BUD-02@PoC FR 9: the banner is above the top row of cards, not in the card «Категорії»", async () => {
    open({ "GET /v1/budget/plan-grid": { status: 200, body: grid("deficit") } });
    const banner = (await screen.findByText("План з дефіцитом 200,00 €")).closest(".bud-banner")!;
    const cards = document.querySelector<HTMLElement>("[data-plan-region='income']")!;
    expect(banner.compareDocumentPosition(cards) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(banner.closest(".bud-card")).toBeNull();
  });

  it("BUD-02@PoC FR 9: when the income categories do not fit the card, the last row is «Інші · N» and the tooltip lists them", async () => {
    const many = ["Зарплата", "Фриланс", "Оренда", "Відсотки", "Подарунки", "Кешбек"].map((name, i) => ({
      categoryId: i < 2 ? (i === 0 ? SALARY.id : FREELANCE.id) : id(30 + i),
      plan: money(`${(6 - i) * 100}.00`),
      actual: money("0.00"),
      name,
    }));
    const extra = many.slice(2).map((m) => ({ ...CAT_BASE, id: m.categoryId, name: m.name }));
    open({
      "GET /v1/categories": {
        status: 200,
        body: tree([...CATS, TRAVEL, ...extra]),
      },
      "GET /v1/budget/periods/2026-11": {
        status: 200,
        body: period({
          incomeCategories: many.map((m) => ({ categoryId: m.categoryId, plan: m.plan, actual: m.actual })),
        }),
      },
    });
    await screen.findByRole("table");
    const card = document.querySelector<HTMLElement>("[data-plan-region='income']")!;
    expect(card.querySelectorAll("li:not(.bud-income-others)")).toHaveLength(3);
    const others = within(card).getByRole("button", { name: "Інші · 3" });
    fireEvent.focus(others);
    const tip = await screen.findByRole("tooltip");
    for (const name of ["Відсотки", "Подарунки", "Кешбек"]) expect(plain(tip.textContent)).toContain(name);
    expect(plain(tip.textContent)).not.toContain("Оренда");
  });

  it("BUD-02@PoC FR 9: up to four income categories are all shown, with no «Інші»", async () => {
    open();
    await screen.findByRole("table");
    expect(screen.queryByRole("button", { name: /Інші/ })).toBeNull();
  });

  it("BUD-02@PoC AC19: a refused removal says so and changes nothing on the screen", async () => {
    open({ "PATCH /v1/budget/plan": problem(503, "MODULE_UNAVAILABLE") });
    await screen.findByRole("table");
    const row = [...document.querySelectorAll<HTMLElement>(".bud-table tbody tr")].find(
      (r) => r.querySelector(".bud-name")?.firstChild?.textContent === "Продукти",
    )!;
    fireEvent.click(within(row).getByRole("button", { name: "Ще дії: Продукти" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Прибрати з бюджету" }));
    expect(await screen.findByText("Не вдалося змінити бюджет. Спробуйте ще раз")).toBeTruthy();
  });
  const rowFor = (name: string) =>
    [...document.querySelectorAll<HTMLElement>(".bud-table tbody tr")].find(
      (r) => r.querySelector(".bud-name")?.firstChild?.textContent === name,
    )!;
  const FUN: Cat = { id: id(6), name: "Розваги", kind: "expense", deletable: true };
  const HIDDEN: Cat = {
    id: id(7),
    name: "Синтетичне приховане",
    kind: "expense",
    deletable: true,
    hidden: true,
  };
  const averages = {
    status: 200,
    body: {
      ...wizard(),
      fromSpending: {
        ...wizard().fromSpending,
        categories: [{ categoryId: FUN.id, average: money("112.30"), limit: money("110.00") }],
      },
    },
  };

  it("BUD-02@PoC AC19: «Видалити категорію…» of «Транспорт» with 12 transactions shows «12 транзакцій» in the explanation and offers «Приховати» and «Об’єднати з іншою…»", async () => {
    const api = open({
      [`GET /v1/categories/${TRANSPORT.id}/usage`]: { status: 200, body: { transactions: 12 } },
    });
    await screen.findByRole("table");
    fireEvent.click(within(rowFor("Транспорт")).getByRole("button", { name: "Ще дії: Транспорт" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Видалити категорію…" }));
    const dialog = await screen.findByRole("dialog", { name: "Видалити категорію «Транспорт»?" });
    await waitFor(() =>
      expect(plain(dialog.textContent)).toContain(
        "Категорія має 12 транзакцій — її не можна видалити. Приховайте її або об’єднайте з іншою: транзакції перейдуть в обрану категорію.",
      ),
    );
    expect(within(dialog).getByRole("button", { name: "Приховати" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Об’єднати з іншою…" })).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: "Видалити" })).toBeNull();
    expect(api.calls.some((c) => c.path === `/v1/categories/${TRANSPORT.id}/usage`)).toBe(true);
  });

  it("BUD-02@PoC FR 23: the count takes the form of the language — «має 1 транзакцію», «має 3 транзакції»; a failed count leaves the explanation without a number and both ways out", async () => {
    let count: number | null = 1;
    open({
      [`GET /v1/categories/${TRANSPORT.id}/usage`]: () =>
        count === null ? problem(503, "MODULE_UNAVAILABLE") : { status: 200, body: { transactions: count } },
    });
    await screen.findByRole("table");
    const ask = async () => {
      fireEvent.click(within(rowFor("Транспорт")).getByRole("button", { name: "Ще дії: Транспорт" }));
      fireEvent.click(screen.getByRole("menuitem", { name: "Видалити категорію…" }));
      return screen.findByRole("dialog", { name: "Видалити категорію «Транспорт»?" });
    };
    let dialog = await ask();
    await waitFor(() =>
      expect(plain(dialog.textContent)).toContain("Категорія має 1 транзакцію — її не можна видалити."),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Скасувати" }));
    count = 3;
    dialog = await ask();
    await waitFor(() =>
      expect(plain(dialog.textContent)).toContain("Категорія має 3 транзакції — її не можна видалити."),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Скасувати" }));
    count = null;
    dialog = await ask();
    expect(within(dialog).getByRole("button", { name: "Приховати" })).toBeTruthy();
    expect(plain(dialog.textContent)).toContain("Цю категорію не можна видалити");
    expect(plain(dialog.textContent)).not.toContain("Категорія має");
  });

  it("BUD-02@PoC AC12: the pencil «Змінити ліміт» of «Продукти» opens the limit popover from the row, with no modal dialog; the new limit is saved with the budget's version and the page is read again", async () => {
    const api = open({ "PATCH /v1/budget/plan": { status: 200, body: budget.budget } });
    await screen.findByRole("table");
    const pencil = within(rowFor("Продукти")).getByRole("button", { name: "Змінити ліміт «Продукти»" });
    expect(pencil.getAttribute("title")).toBe("Змінити ліміт");
    fireEvent.click(pencil);
    const popover = await screen.findByRole("dialog", { name: "Змінити ліміт «Продукти»" });
    // From the row: the popover sits in the row's cell, not in a modal layer.
    expect(rowFor("Продукти").contains(popover)).toBe(true);
    expect(popover.getAttribute("aria-modal")).toBeNull();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    const field = within(popover).getByRole("textbox", { name: "Ліміт" }) as HTMLInputElement;
    expect(plain(field.value)).toBe("400,00");
    fireEvent.change(field, { target: { value: "450" } });
    fireEvent.click(within(popover).getByRole("button", { name: "Зберегти" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(api.calls.find((c) => c.method === "PATCH")?.body).toEqual({
      version: 7,
      limits: [{ categoryId: PRODUCTS.id, amount: money("450.00") }],
    });
    await waitFor(() =>
      expect(
        api.calls.filter((c) => c.method === "GET" && c.path === "/v1/budget/periods/2026-11"),
      ).toHaveLength(2),
    );
  });

  it("BUD-02@PoC FR 7: a row of «Поза планом» has «Задати ліміт»; the limit set moves it out of «Поза планом» on the next read; a refused save says so and keeps the popover", async () => {
    let refuse = true;
    const api = open({
      "PATCH /v1/budget/plan": () =>
        refuse ? problem(503, "MODULE_UNAVAILABLE") : { status: 200, body: budget.budget },
    });
    await screen.findByRole("table");
    fireEvent.click(within(rowFor("Подорожі")).getByRole("button", { name: "Задати ліміт «Подорожі»" }));
    const popover = await screen.findByRole("dialog", { name: "Задати ліміт «Подорожі»" });
    fireEvent.change(within(popover).getByRole("textbox", { name: "Ліміт" }), { target: { value: "150" } });
    fireEvent.click(within(popover).getByRole("button", { name: "Зберегти" }));
    expect(await within(popover).findByText("Не вдалося змінити бюджет. Спробуйте ще раз")).toBeTruthy();
    refuse = false;
    fireEvent.click(within(popover).getByRole("button", { name: "Зберегти" }));
    await waitFor(() =>
      expect(
        api.calls.filter((c) => c.method === "GET" && c.path === "/v1/budget/periods/2026-11"),
      ).toHaveLength(2),
    );
    expect(api.calls.filter((c) => c.method === "PATCH").at(-1)?.body).toEqual({
      version: 7,
      limits: [{ categoryId: TRAVEL.id, amount: money("150.00") }],
    });
  });

  it("BUD-02@PoC FR 7: «Додати категорію» in the heading of a group adds an editable row at its bottom — the list («Поза планом · є витрати», then the categories without a limit, then «Нова категорія…»), the limit with the 3-month average in the field, «обов’язкова», ✓ and ✕", async () => {
    const api = open({
      "GET /v1/categories": { status: 200, body: tree([...CATS, TRAVEL, FUN, HIDDEN]) },
      "GET /v1/budget/wizard": averages,
      "PATCH /v1/budget/plan": { status: 200, body: budget.budget },
      [`PATCH /v1/categories/${FUN.id}`]: { status: 200, body: {} },
    });
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: "Додати категорію: Щоденне" }));
    const row = document.querySelector<HTMLElement>(".bud-add-row")!;
    // At the bottom of its group.
    expect(row.parentElement!.lastElementChild).toBe(row);
    expect(row.closest("tbody")!.getAttribute("data-group")).toBe(G_DAILY);
    const list = within(row).getByRole("combobox", { name: "Категорія" }) as HTMLSelectElement;
    const groups = [...list.querySelectorAll("optgroup")].map((g) => [
      g.label,
      [...g.querySelectorAll("option")].map((o) => plain(o.textContent)),
    ]);
    expect(groups).toEqual([
      ["Поза планом · є витрати", ["Подорожі · 96,00 € цього місяця"]],
      ["Без ліміту", ["Розваги"]],
    ]);
    expect(plain(list.options[list.options.length - 1]!.textContent)).toBe("Нова категорія…");
    fireEvent.change(list, { target: { value: FUN.id } });
    const limit = within(row).getByRole("textbox", { name: "Ліміт" }) as HTMLInputElement;
    await waitFor(() => expect(plain(limit.placeholder)).toBe("сер. 112,30 €"));
    fireEvent.change(limit, { target: { value: "110" } });
    fireEvent.click(within(row).getByRole("checkbox", { name: "обов’язкова" }));
    fireEvent.click(within(row).getByRole("button", { name: "Додати" }));
    await waitFor(() => expect(api.calls.filter((c) => c.method === "PATCH")).toHaveLength(2));
    const patches = api.calls.filter((c) => c.method === "PATCH");
    expect(patches[0]).toMatchObject({
      path: "/v1/budget/plan",
      body: { version: 7, limits: [{ categoryId: FUN.id, amount: money("110.00") }] },
    });
    expect(patches[1]).toMatchObject({ path: `/v1/categories/${FUN.id}`, body: { essential: true } });
    await waitFor(() => expect(document.querySelector(".bud-add-row")).toBeNull());
  });

  it("BUD-02@PoC FR 7: ✓ of the add row does nothing until a category and a limit are chosen; ✕ closes the row and writes nothing", async () => {
    const api = open({ "GET /v1/categories": { status: 200, body: tree([...CATS, TRAVEL, FUN]) } });
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: "Додати категорію: Щоденне" }));
    const row = document.querySelector<HTMLElement>(".bud-add-row")!;
    const confirm = within(row).getByRole("button", { name: "Додати" });
    expect(confirm.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(confirm);
    fireEvent.change(within(row).getByRole("combobox", { name: "Категорія" }), {
      target: { value: TRAVEL.id },
    });
    expect(confirm.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(within(row).getByRole("button", { name: "Скасувати" }));
    expect(document.querySelector(".bud-add-row")).toBeNull();
    expect(api.calls.some((c) => c.method === "PATCH")).toBe(false);
  });

  it("BUD-02@PoC FR 23: «Нова категорія…» of the add row creates a custom expense category in that group and chooses it in the row at once", async () => {
    const NEW_ID = id(20);
    const NEW_CAT = {
      ...category({ id: NEW_ID, name: "Обіди на роботі", kind: "expense", deletable: true }, G_DAILY),
    };
    const api = open({
      "POST /v1/categories": { status: 201, body: NEW_CAT },
      [`GET /v1/categories/${NEW_ID}`]: { status: 200, body: NEW_CAT },
      "PATCH /v1/budget/plan": { status: 200, body: budget.budget },
    });
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: "Додати категорію: Щоденне" }));
    const row = document.querySelector<HTMLElement>(".bud-add-row")!;
    fireEvent.change(within(row).getByRole("combobox", { name: "Категорія" }), {
      target: { value: "__new" },
    });
    const dialog = await screen.findByRole("dialog", { name: "Нова категорія" });
    expect((within(dialog).getByRole("combobox", { name: /Група/ }) as HTMLSelectElement).value).toBe(
      G_DAILY,
    );
    fireEvent.change(within(dialog).getByRole("textbox", { name: /Назва/ }), {
      target: { value: "Обіди на роботі" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Додати категорію" }));
    const list = within(row).getByRole("combobox", { name: "Категорія" }) as HTMLSelectElement;
    await waitFor(() => expect(list.value).toBe(NEW_ID));
    fireEvent.change(within(row).getByRole("textbox", { name: "Ліміт" }), { target: { value: "120" } });
    fireEvent.click(within(row).getByRole("button", { name: "Додати" }));
    await waitFor(() =>
      expect(api.calls.find((c) => c.method === "PATCH")?.body).toEqual({
        version: 7,
        limits: [{ categoryId: NEW_ID, amount: money("120.00") }],
      }),
    );
  });

  it("BUD-02@PoC FR 16: a past month shows the plan of its snapshot — no pencil, no «Задати ліміт», no «Додати категорію»", async () => {
    open({
      "GET /v1/budget/periods/2026-11": { status: 200, body: period({ mode: "past" }) },
    });
    await screen.findByRole("table");
    expect(screen.queryByRole("button", { name: /Змінити ліміт/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Задати ліміт/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Додати категорію/ })).toBeNull();
  });
});
