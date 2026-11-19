import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { I18nProvider } from "@willowsum/i18n";
import { installMatchMedia } from "@willowsum/ui/test-utils";
import { AuthApiProvider } from "../auth/api.ts";
import { fakeApi, plain, problem, resetAuthState, type Reply } from "../auth/testing.tsx";
import { canonicalPath, resolveRoute } from "../routing/routes.ts";
import { BudgetPage } from "./BudgetPage.tsx";
import { BudgetSettingsPage } from "./budget/SettingsPage.tsx";

/**
 * BUD-02@PoC f) (wave 2, row 125): S-128 «Налаштування бюджету · Рахунки бюджету» and S-288 «Загальне». The page alone,
 * on the budget API (`GET /v1/budget`, `GET|PUT /v1/budget/accounts`, `DELETE /v1/budget`) and `GET /v1/accounts`.
 * Boards: PocPlanBudgetAccounts, PocPlanBudgetSettingsGeneral, PocPlanBudgetTexts. The accounts are synthetic.
 */
const id = (n: number) => `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const eur = (amount: string) => ({ amount, currency: "EUR" });

const account = (n: number, name: string, kind: string, amount: string, last4: string | null) => ({
  id: id(n),
  kind,
  group: kind === "credit-card" ? "credit" : "cash",
  name,
  institution: null,
  number: last4 ? { last4, masked: `··${last4}` } : null,
  status: "active",
  closedOn: null,
  source: "manual",
  updatedOn: "2026-11-18",
  favourite: false,
  inProfileCurrency: { total: eur(amount), approximate: false, unavailableCount: 0 },
  currencies: [
    {
      currency: "EUR",
      amount: eur(amount),
      equivalent: null,
      rateDate: null,
      approximate: false,
      restricted: false,
    },
  ],
  creditCard: null,
});

const ACCOUNTS = [
  account(1, "Поточний", "current", "5200.00", "4417"),
  account(2, "Кредитна", "credit-card", "-640.00", "9021"),
  account(3, "Гаманець", "cash", "180.00", null),
  account(4, "Ощадний", "savings", "18400.00", "1180"),
];
const SWITCHES = [
  { accountId: id(1), kind: "current", status: "active", included: true },
  { accountId: id(2), kind: "credit-card", status: "active", included: true },
  { accountId: id(3), kind: "cash", status: "active", included: true },
  { accountId: id(4), kind: "savings", status: "active", included: false },
];
const BUDGET = {
  budget: {
    id: "b0000000-0000-4000-8000-000000000001",
    currency: "EUR",
    firstPeriod: "2026-11",
    incomePlan: eur("5600.00"),
    limits: [],
    createdOn: "2026-11-01",
    proportional: null,
    version: 1,
  },
};

function mount(tab: "accounts" | "general", over: Record<string, Reply> = {}) {
  const api = fakeApi({
    "GET /v1/budget": { status: 200, body: BUDGET },
    "GET /v1/budget/accounts": { status: 200, body: { accounts: SWITCHES } },
    "GET /v1/accounts": { status: 200, body: { items: ACCOUNTS, nextCursor: null } },
    ...over,
  });
  render(
    <I18nProvider>
      <AuthApiProvider value={api.client}>
        <BudgetSettingsPage tab={tab} />
      </AuthApiProvider>
    </I18nProvider>,
  );
  return api;
}

beforeEach(() => {
  installMatchMedia({ width: 1280 });
  resetAuthState();
  window.location.hash = "#/planning/budget/settings/accounts";
});
afterEach(cleanup);

const switchOf = (name: string) => screen.getByRole("switch", { name: `У бюджеті: ${name}` });

describe("BUD-02@PoC f) S-128 «Рахунки бюджету»", () => {
  it("BUD-02@PoC AC15: the page has only the tabs «Рахунки бюджету» and «Загальне»; the accounts are grouped «У бюджеті» and «Не в бюджеті» with the API's balances", async () => {
    mount("accounts");
    await screen.findByRole("table");
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Рахунки бюджету", "Загальне"]);
    expect(screen.getByText("Бюджет · EUR")).toBeTruthy();
    const groups = [...document.querySelectorAll(".bud-group-row")].map((r) => plain(r.textContent));
    expect(groups).toEqual(["У бюджеті 3", "Не в бюджеті 1"]);
    const rows = [...document.querySelectorAll("tbody tr:not(.bud-group-row)")].map((r) =>
      plain(r.textContent),
    );
    expect(rows[0]).toContain("Поточний");
    expect(rows[0]).toContain("5 200,00 €");
    expect(rows[1]).toContain("−640,00 €");
    expect((switchOf("Поточний") as HTMLInputElement).checked).toBe(true);
    expect((switchOf("Ощадний") as HTMLInputElement).checked).toBe(false);
    // AC14: no change of method or period on this page.
    expect(screen.queryByText(/Режим без бюджету|Новий старт|Метод|Період/)).toBeNull();
  });

  it("BUD-02@PoC AC14: «Зберегти зміни» sends one PUT per changed account and nothing else; «Скасувати» drops the draft", async () => {
    const api = mount("accounts", {
      [`PUT /v1/budget/accounts/${id(4)}`]: { status: 200, body: { ...SWITCHES[3], included: true } },
      [`PUT /v1/budget/accounts/${id(2)}`]: { status: 200, body: { ...SWITCHES[1], included: false } },
    });
    await screen.findByRole("table");
    const save = screen.getByRole("button", { name: "Зберегти зміни" });
    expect(save.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(switchOf("Ощадний"));
    fireEvent.click(switchOf("Кредитна"));
    fireEvent.click(screen.getByRole("button", { name: "Скасувати" }));
    expect((switchOf("Ощадний") as HTMLInputElement).checked).toBe(false);
    fireEvent.click(switchOf("Ощадний"));
    fireEvent.click(switchOf("Кредитна"));
    fireEvent.click(screen.getByRole("button", { name: "Зберегти зміни" }));
    await screen.findByText("Зміни збережено");
    const puts = api.calls.filter((c) => c.method === "PUT");
    expect(puts.map((c) => [c.path, c.body])).toEqual([
      [`/v1/budget/accounts/${id(2)}`, { included: false }],
      [`/v1/budget/accounts/${id(4)}`, { included: true }],
    ]);
  });

  it("BUD-02@PoC AC14: a refused save says so and keeps the unsaved switch in the draft", async () => {
    mount("accounts", { ["PUT /v1/budget/accounts/" + id(4)]: problem(403, "FORBIDDEN") });
    await screen.findByRole("table");
    fireEvent.click(switchOf("Ощадний"));
    fireEvent.click(screen.getByRole("button", { name: "Зберегти зміни" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Не вдалося зберегти зміни");
    expect((await screen.findByRole("alert")).textContent).toContain("Ощадний");
    expect((switchOf("Ощадний") as HTMLInputElement).checked).toBe(true);
  });

  it("BUD-02@PoC AC14: a failed load shows the error state with «Спробувати ще раз» and the code", async () => {
    mount("accounts", { "GET /v1/budget/accounts": problem(503, "MODULE_UNAVAILABLE") });
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByRole("button", { name: "Спробувати ще раз" })).toBeTruthy();
    expect(alert.textContent).toContain("Код:");
  });

  it("BUD-02@PoC AC14: the loading state is a skeleton, and a space without a budget says so", async () => {
    mount("accounts", { "GET /v1/budget": { status: 200, body: { budget: null } } });
    expect(document.querySelector("[aria-busy='true']")).not.toBeNull();
    expect(await screen.findByText("Бюджету ще немає")).toBeTruthy();
  });
});

describe("BUD-02@PoC f) S-288 «Загальне»", () => {
  it("BUD-02@PoC FR 17: BUD-02@PoC AC13: the tab holds only the danger zone «Видалити бюджет» — no «Режим без бюджету», no «Новий старт»", async () => {
    mount("general");
    expect(await screen.findByRole("heading", { name: "Видалити бюджет" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Видалити бюджет…" })).toBeTruthy();
    expect(document.body.textContent).toContain("Транзакції, рахунки й цілі залишаться");
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByText(/Режим без бюджету|Новий старт/)).toBeNull();
  });

  it("BUD-02@PoC AC13: «Видалити бюджет» asks first, then sends DELETE /v1/budget and returns to «Бюджет»", async () => {
    const api = mount("general", { "DELETE /v1/budget": { status: 200, body: { deleted: true } } });
    fireEvent.click(await screen.findByRole("button", { name: "Видалити бюджет…" }));
    expect(api.calls.some((c) => c.method === "DELETE")).toBe(false);
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Видалити бюджет" }));
    await waitFor(() => expect(window.location.hash).toBe("#/planning/budget"));
    expect(api.calls.filter((c) => c.method === "DELETE").length).toBe(1);
  });

  it("BUD-02@PoC AC13: «Скасувати» in the confirmation deletes nothing and stays on the page", async () => {
    const api = mount("general", { "DELETE /v1/budget": { status: 200, body: { deleted: true } } });
    fireEvent.click(await screen.findByRole("button", { name: "Видалити бюджет…" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Скасувати" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(api.calls.some((c) => c.method === "DELETE")).toBe(false);
    expect(window.location.hash).toBe("#/planning/budget/settings/accounts");
  });

  it("BUD-02@PoC AC13: a refused delete keeps the dialog open with the reason", async () => {
    mount("general", { "DELETE /v1/budget": problem(403, "FORBIDDEN") });
    fireEvent.click(await screen.findByRole("button", { name: "Видалити бюджет…" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Видалити бюджет" }));
    // CMP-21@PoC AC6: the message inside the dialog starts with «Помилка».
    expect((await within(dialog).findByText(/Не вдалося видалити бюджет/)).textContent).toMatch(/^Помилка/);
    expect(window.location.hash).toBe("#/planning/budget/settings/accounts");
  });
});

describe("BUD-02@PoC f) the way in", () => {
  it("BUD-02@PoC FR 17: the gear «Налаштування бюджету» in the heading of «Бюджет» opens «Загальне» as on the board", async () => {
    const api = fakeApi({
      "GET /v1/budget": { status: 200, body: BUDGET },
      "GET /v1/categories": { status: 200, body: { groups: [] } },
      "GET /v1/budget/periods/2026-11": problem(404, "BUDGET_PERIOD_BEFORE_START"),
    });
    render(
      <I18nProvider>
        <AuthApiProvider value={api.client}>
          <BudgetPage today="2026-11-18" />
        </AuthApiProvider>
      </I18nProvider>,
    );
    const gear = await screen.findByRole("link", { name: "Налаштування бюджету: рахунки, загальне" });
    expect(gear.getAttribute("href")).toBe("#/planning/budget/settings/general");
  });

  it("BUD-02@PoC FR 17: «Налаштування бюджету» has two addresses under «Бюджет», one per tab", () => {
    for (const [path, id] of [
      ["/planning/budget/settings/accounts", "budgetAccounts"],
      ["/planning/budget/settings/general", "budgetGeneral"],
    ] as const) {
      const route = resolveRoute(path);
      expect(route.kind === "child" && route.child.id, path).toBe(id);
    }
  });

  it("BUD-02@PoC FR 17: the first addresses /planning/budget/{accounts,general} redirect to the screen map's /settings/ ones", () => {
    expect(canonicalPath("/planning/budget/accounts")).toBe("/planning/budget/settings/accounts");
    expect(canonicalPath("/planning/budget/general")).toBe("/planning/budget/settings/general");
    expect(canonicalPath("/planning/budget/settings/accounts")).toBe("/planning/budget/settings/accounts");
  });

  it("BUD-02@PoC AC14: a failed PUT keeps the failed and the unsent switches in the draft, names those accounts, sends nothing after the failure, and a retry sends only them", async () => {
    let refuse = true;
    const api = mount("accounts", {
      [`PUT /v1/budget/accounts/${id(2)}`]: (() =>
        refuse
          ? problem(500, "INTERNAL")
          : { status: 200, body: { ...SWITCHES[1], included: false } }) as never,
      [`PUT /v1/budget/accounts/${id(4)}`]: { status: 200, body: { ...SWITCHES[3], included: true } },
    });
    await screen.findByRole("table");
    fireEvent.click(switchOf("Кредитна"));
    fireEvent.click(switchOf("Ощадний"));
    fireEvent.click(screen.getByRole("button", { name: "Зберегти зміни" }));
    const alert = (await screen.findByRole("alert")).textContent ?? "";
    expect(alert).toContain("Не збережено для рахунків: Кредитна, Ощадний");
    expect(api.calls.filter((c) => c.method === "PUT")).toHaveLength(1);
    await waitFor(() => expect((switchOf("Кредитна") as HTMLInputElement).checked).toBe(false));
    expect((switchOf("Ощадний") as HTMLInputElement).checked).toBe(true);
    refuse = false;
    fireEvent.click(screen.getByRole("button", { name: "Зберегти зміни" }));
    await screen.findByText("Зміни збережено");
    expect(api.calls.filter((c) => c.method === "PUT").map((c) => c.path)).toEqual([
      `/v1/budget/accounts/${id(2)}`,
      `/v1/budget/accounts/${id(2)}`,
      `/v1/budget/accounts/${id(4)}`,
    ]);
  });

  it("BUD-02@PoC AC14: when the first PUT succeeds and the second fails, only the second account is named and stays in the draft", async () => {
    mount("accounts", {
      [`PUT /v1/budget/accounts/${id(2)}`]: { status: 200, body: { ...SWITCHES[1], included: false } },
      [`PUT /v1/budget/accounts/${id(4)}`]: problem(500, "INTERNAL"),
    });
    await screen.findByRole("table");
    fireEvent.click(switchOf("Кредитна"));
    fireEvent.click(switchOf("Ощадний"));
    fireEvent.click(screen.getByRole("button", { name: "Зберегти зміни" }));
    const alert = (await screen.findByRole("alert")).textContent ?? "";
    expect(alert).toContain("Не збережено для рахунків: Ощадний");
    expect(alert).not.toContain("Кредитна");
    await waitFor(() => expect((switchOf("Ощадний") as HTMLInputElement).checked).toBe(true));
  });

  it("BUD-02@PoC AC14: the «Не збережено для рахунків» alert goes away when the draft changes or «Скасувати» is pressed", async () => {
    mount("accounts", {
      [`PUT /v1/budget/accounts/${id(2)}`]: problem(500, "INTERNAL"),
    });
    await screen.findByRole("table");
    const fail = async () => {
      fireEvent.click(switchOf("Кредитна"));
      fireEvent.click(screen.getByRole("button", { name: "Зберегти зміни" }));
      await screen.findByText(/Не збережено для рахунків/);
    };
    await fail();
    fireEvent.click(switchOf("Ощадний"));
    expect(screen.queryByText(/Не збережено для рахунків/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Скасувати" }));
    await waitFor(() => expect((switchOf("Ощадний") as HTMLInputElement).checked).toBe(false));
    await fail();
    fireEvent.click(screen.getByRole("button", { name: "Скасувати" }));
    expect(screen.queryByText(/Не збережено для рахунків/)).toBeNull();
  });

  it("BUD-02@PoC AC15: the groups follow the saved state, not the draft: a switched row stays in its group until it is saved", async () => {
    mount("accounts");
    await screen.findByRole("table");
    fireEvent.click(switchOf("Ощадний"));
    const groups = [...document.querySelectorAll(".bud-group-row")].map((r) => plain(r.textContent));
    expect(groups).toEqual(["У бюджеті 3", "Не в бюджеті 1"]);
    expect((switchOf("Ощадний") as HTMLInputElement).checked).toBe(true);
  });

  it("BUD-02@PoC AC15: the balance is the account's total in the profile currency, not the amount in its own currency (and a dash when there is none)", async () => {
    const usd = {
      ...account(3, "Гаманець", "cash", "180.00", null),
      inProfileCurrency: { total: eur("165.00"), approximate: true, unavailableCount: 0 },
      currencies: [
        {
          currency: "USD",
          amount: { amount: "180.00", currency: "USD" },
          equivalent: eur("165.00"),
          rateDate: "2026-11-18",
          approximate: true,
          restricted: false,
        },
      ],
    };
    const none = {
      ...account(1, "Поточний", "current", "5200.00", "4417"),
      inProfileCurrency: { total: null, approximate: false, unavailableCount: 1 },
    };
    mount("accounts", {
      "GET /v1/accounts": {
        status: 200,
        body: { items: [none, ACCOUNTS[1], usd, ACCOUNTS[3]], nextCursor: null },
      },
    });
    await screen.findByRole("table");
    const rows = [...document.querySelectorAll("tbody tr:not(.bud-group-row)")].map((r) =>
      plain(r.textContent),
    );
    const row = (name: string) => rows.find((r) => r.includes(name)) ?? "";
    expect(row("Гаманець")).toContain("165,00 €");
    expect(row("Гаманець")).not.toContain("180");
    expect(row("Поточний")).toContain("—");
    expect(row("Поточний")).not.toContain("5 200");
  });

  it("BUD-02@PoC FR 10: closed accounts are requested, and a closed one still in the budget is listed so it can be switched off; a closed one outside the budget is not", async () => {
    const closed = (n: number, name: string) => ({
      ...account(n, name, "current", "0.00", null),
      status: "closed",
      closedOn: "2026-10-01",
    });
    let asked: string | null = null;
    const api = mount("accounts", {
      "GET /v1/budget/accounts": {
        status: 200,
        body: {
          accounts: [
            ...SWITCHES,
            { accountId: id(5), kind: "current", status: "closed", included: true },
            { accountId: id(6), kind: "current", status: "closed", included: false },
          ],
        },
      },
      "GET /v1/accounts": ((_c: never, u: URL) => {
        asked = u.searchParams.get("includeClosed");
        return {
          status: 200,
          body: {
            items: [...ACCOUNTS, closed(5, "Старий"), closed(6, "Закритий осторонь")],
            nextCursor: null,
          },
        };
      }) as never,
      [`PUT /v1/budget/accounts/${id(5)}`]: { status: 200, body: { accountId: id(5), included: false } },
    });
    await screen.findByRole("table");
    expect(asked).toBe("true");
    expect(screen.queryByRole("switch", { name: "У бюджеті: Закритий осторонь" })).toBeNull();
    fireEvent.click(switchOf("Старий"));
    fireEvent.click(screen.getByRole("button", { name: "Зберегти зміни" }));
    await screen.findByText("Зміни збережено");
    expect(api.calls.filter((c) => c.method === "PUT").map((c) => [c.path, c.body])).toEqual([
      [`/v1/budget/accounts/${id(5)}`, { included: false }],
    ]);
  });
});
