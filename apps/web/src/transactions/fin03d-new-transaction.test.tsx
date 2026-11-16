import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { I18nProvider } from "@willowsum/i18n";
import { installMatchMedia } from "@willowsum/ui/test-utils";
import { AuthApiProvider } from "../auth/api.ts";
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
import { NewTransactionDialog } from "./NewTransactionDialog.tsx";
import type { Account, CategoryGroup, Merchant } from "./newTransaction.ts";

/**
 * FIN-03@PoC d): S-048 «Нова транзакція» and its entry points — «+ Додати → Транзакція» (S-025), «Нова транзакція» in
 * the header of «Транзакції», `/money/transactions/new` (canvas PocMoneyNewTx, PocMoneyNewTxStep2, PocMoneyNewTxStep3,
 * PocMoneyNewTxAcc, PocMoneyNewTxCat, PocMoneyNewTxDate, PocMoneyNewTxNoAcc, PocAdd and the «Тексти» boards
 * PocMoneyNewTxTexts, PocAddTexts). Synthetic data only.
 */
const TODAY = "2026-11-02";
const ACC = "00000000-0000-4000-8000-000000000001";
const ACC2 = "00000000-0000-4000-8000-000000000002";
const TX = "00000000-0000-4000-8000-0000000000aa";
const GROCERIES = "00000000-0000-4000-8000-0000000000c1";

const eur = (amount: string) => ({ amount, currency: "EUR" });
function account(id: string, name: string, over: Partial<Account> = {}): Account {
  return {
    id,
    kind: "current",
    group: "cash",
    name,
    institution: null,
    number: { last4: "4417", masked: "••4417" },
    status: "active",
    closedOn: null,
    source: "manual",
    updatedOn: TODAY,
    inProfileCurrency: { total: eur("1000.00"), approximate: false, unavailableCount: 0 },
    currencies: [
      {
        currency: "EUR",
        amount: eur("1000.00"),
        equivalent: eur("1000.00"),
        rateDate: null,
        approximate: false,
        restricted: false,
      },
    ],
    creditCard: null,
    loan: null,
    ...over,
  } as Account;
}
const CURRENT = account(ACC, "Поточний");
const CARD = account(ACC2, "Кредитна", {
  kind: "credit-card",
  group: "credit",
  number: { last4: "9021", masked: "••9021" },
});
const MERCHANTS: Merchant[] = [
  { id: "m1", name: "Сільпо", initials: "С", intermediary: false, mergedInto: null, transactionCount: 23 },
  {
    id: "m2",
    name: "Сільська аптека",
    initials: "СА",
    intermediary: false,
    mergedInto: null,
    transactionCount: 2,
  },
];
const category = (id: string, name: string, groupId: string, kind: "expense" | "income") => ({
  id,
  groupId,
  systemKey: null,
  kind,
  name,
  renamed: false,
  icon: "shopping-cart",
  color: "#5872D2",
  iconTone: "white" as const,
  essential: null,
  hidden: false,
  deletable: true,
});
const GROUPS: CategoryGroup[] = [
  {
    id: "g1",
    systemKey: null,
    kind: "expense",
    name: "Харчування",
    renamed: false,
    tone: "#5872D2",
    categories: [category(GROCERIES, "Продукти", "g1", "expense"), category("c2", "Кафе", "g1", "expense")],
  },
  {
    id: "g2",
    systemKey: null,
    kind: "income",
    name: "Доходи",
    renamed: false,
    tone: "#BA4E84",
    categories: [category("c3", "Зарплата", "g2", "income")],
  },
];

function created(body: { accountId: string; amount: { amount: string; currency: string } }) {
  return {
    id: TX,
    accountId: body.accountId,
    amount: body.amount,
    type: body.amount.amount.startsWith("-") ? "expense" : "income",
    date: TODAY,
    counterparty: null,
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
    recordedAt: `${TODAY}T09:14:00Z`,
  };
}

type Handlers = Record<string, Reply | ((call: { body: unknown }) => Reply | Promise<Reply>)>;
const base = (accounts: Account[] = [CURRENT, CARD]): Handlers => ({
  "GET /v1/accounts": { status: 200, body: { items: accounts, nextCursor: null } },
  "GET /v1/merchants": { status: 200, body: { items: MERCHANTS } },
  "GET /v1/categories": { status: 200, body: { groups: GROUPS } },
  "POST /v1/transactions": (call) => ({ status: 201, body: created(call.body as never) }),
  [`PUT /v1/transactions/${TX}/category`]: { status: 200, body: {} },
  [`PATCH /v1/transactions/${TX}/attributes`]: { status: 200, body: {} },
});

function open(handlers: Handlers = base(), props: { accountId?: string } = {}) {
  const api = fakeApi(handlers);
  const onClose = vi.fn();
  const onCreated = vi.fn();
  render(
    <I18nProvider initialLocale="uk">
      <AuthApiProvider value={api.client}>
        <NewTransactionDialog open onClose={onClose} onCreated={onCreated} today={TODAY} {...props} />
      </AuthApiProvider>
    </I18nProvider>,
  );
  return { calls: api.calls, onClose, onCreated };
}

const dialog = () => screen.getByRole("dialog", { name: "Нова транзакція" });
const button = (name: string | RegExp) => within(dialog()).getByRole("button", { name });
const press = (name: string | RegExp) => act(() => button(name).click());
const disabled = (name: string | RegExp) => button(name).getAttribute("aria-disabled") === "true";
async function typeAmount(text: string) {
  const input = within(dialog()).getByRole("textbox", { name: /Сума/ });
  await act(async () => {
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: text } });
    fireEvent.blur(input);
  });
}
async function choose(field: RegExp, option: string | RegExp) {
  await act(async () => within(dialog()).getByRole("button", { name: field }).click());
  await act(async () => within(dialog()).getByRole("option", { name: option }).click());
}
const accountReady = () => waitFor(() => expect(button(/^Рахунок/).textContent).toContain("Поточний"));

beforeEach(() => {
  installMatchMedia({ width: 1280 });
  localStorage.clear();
  sessionStorage.clear();
  resetNavigationSession();
  resetAuthState();
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("FIN-03@PoC d): «Нова транзакція» (S-048)", () => {
  it("FIN-03@PoC FR 28: three steps «1 Основне · 2 Контрагент і категорія · 3 Додатково», every required field on step 1, «Скасувати · Далі · Додати транзакцію»; «Назад» from step 2 (types «Списання» and «Надходження»; «Переказ між рахунками» waits for the server)", async () => {
    open();
    await accountReady();
    const steps = within(dialog()).getByRole("list", { name: "Кроки форми" });
    expect(
      within(steps)
        .getAllByRole("button")
        .map((b) => b.getAttribute("aria-label")),
    ).toEqual([
      "Крок 1: Основне — поточний",
      "Крок 2: Контрагент і категорія — ще недоступний",
      "Крок 3: Додатково — ще недоступний",
    ]);
    expect(
      within(steps).getByRole("button", { name: "Крок 1: Основне — поточний" }).getAttribute("aria-current"),
    ).toBe("step");
    expect(dialog().textContent).toContain("Поля з * обов’язкові.");
    const type = within(dialog()).getByRole("group", { name: "Тип транзакції" });
    expect(
      within(type)
        .getAllByRole("radio")
        .map((r) => r.closest("label")?.textContent),
    ).toEqual(["Списання", "Надходження"]);
    expect((within(type).getByRole("radio", { name: "Списання" }) as HTMLInputElement).checked).toBe(true);
    for (const name of [/^Сума/, /^Рахунок/, /^Дата/])
      expect(within(dialog()).getAllByText(name.source.slice(1)).length).toBeGreaterThan(0);
    expect(
      within(dialog())
        .getAllByRole("button")
        .filter((b) => b.classList.contains("ws-dialog-action"))
        .map((b) => b.textContent),
    ).toEqual(["Скасувати", "Далі", "Додати транзакцію"]);
    expect(disabled("Додати транзакцію")).toBe(true);
    expect(disabled("Далі")).toBe(true);
    expect(dialog().textContent).toContain("Щоб продовжити, заповніть: Сума");

    await typeAmount("42,80");
    expect(disabled("Додати транзакцію")).toBe(false);
    press("Далі");
    expect(dialog().textContent).toContain("Необов’язково · категорію підставить правило контрагента.");
    expect(within(steps).getByRole("button", { name: "Крок 1: Основне — заповнено" })).toBeTruthy();
    expect(
      within(dialog())
        .getAllByRole("button")
        .filter((b) => b.classList.contains("ws-dialog-action"))
        .map((b) => b.textContent),
    ).toEqual(["Скасувати", "Назад", "Далі", "Додати транзакцію"]);
    press("Далі");
    expect(dialog().textContent).toContain("Необов’язково · опис, теги і статус.");
    const status = within(dialog()).getByRole("group", { name: "Статус" });
    expect((within(status).getByRole("radio", { name: "Проведена" }) as HTMLInputElement).checked).toBe(true);
    expect(within(status).getByRole("radio", { name: "Очікує" })).toBeTruthy();
    expect(within(dialog()).queryByRole("button", { name: "Далі" })).toBeNull();
    press("Назад");
    press("Крок 1: Основне — заповнено");
    expect((within(dialog()).getByRole("textbox", { name: /Сума/ }) as HTMLInputElement).value).toBe("42,80");
  });

  it("FIN-03@PoC FR 28: added from step 1 — the steps not opened keep their defaults: no counterparty or category, «Проведена»", async () => {
    const { calls, onClose } = open();
    await accountReady();
    await typeAmount("42,80");
    press("Додати транзакцію");
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const post = calls.find((c) => c.method === "POST" && c.path === "/v1/transactions");
    expect(post?.body).toEqual({
      accountId: ACC,
      amount: { amount: "-42.80", currency: "EUR" },
      date: TODAY,
      counterparty: null,
      description: null,
      status: "posted",
    });
    expect(calls.some((c) => c.method === "PUT" || c.method === "PATCH")).toBe(false);
  });

  it("FIN-03@PoC AC1: −45,50 EUR with a date, a counterparty, a category, a description and «Проведена» — one transaction with the sign, then its category", async () => {
    const { calls, onCreated, onClose } = open();
    await accountReady();
    await typeAmount("45,50");
    press("Далі");
    await choose(/^Контрагент/, /^Сільпо/);
    await choose(/^Категорія/, "Продукти");
    press("Далі");
    await act(async () =>
      fireEvent.change(within(dialog()).getByRole("textbox", { name: "Опис" }), {
        target: { value: "Продукти на тиждень" },
      }),
    );
    press("Додати транзакцію");
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({
      accountId: ACC,
      amount: { amount: "-45.50", currency: "EUR" },
      date: TODAY,
      counterparty: "Сільпо",
      description: "Продукти на тиждень",
      status: "posted",
    });
    expect(calls.find((c) => c.method === "PUT")?.body).toEqual({ categoryId: GROCERIES });
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: TX }));
  });

  it("FIN-03@PoC FR 2: «Надходження» is saved with plus; «Очікує» and tags go with it", async () => {
    const { calls, onClose } = open();
    await accountReady();
    act(() => within(dialog()).getByRole("radio", { name: "Надходження" }).click());
    await typeAmount("3400");
    press("Крок 3: Додатково");
    act(() => within(dialog()).getByRole("radio", { name: "Очікує" }).click());
    await act(async () =>
      fireEvent.change(within(dialog()).getByRole("textbox", { name: "Теги" }), {
        target: { value: "родина, тиждень 45, Родина" },
      }),
    );
    press("Додати транзакцію");
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const post = calls.find((c) => c.method === "POST")?.body as { amount: unknown; status: string };
    expect(post.amount).toEqual({ amount: "3400.00", currency: "EUR" });
    expect(post.status).toBe("pending");
    expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({ tags: ["родина", "тиждень 45"] });
  });

  it("FIN-03@PoC FR 32: «Рахунок» lists the accounts by group with their currency and ends with «Новий рахунок»", async () => {
    open();
    await accountReady();
    await act(async () => button(/^Рахунок/).click());
    const list = within(dialog()).getByRole("listbox");
    expect(within(list).getByRole("group", { name: "Готівкові" })).toBeTruthy();
    expect(within(list).getByRole("group", { name: "Кредитні" })).toBeTruthy();
    const options = within(list)
      .getAllByRole("option")
      .map((o) => plain(o.textContent));
    expect(options).toEqual(["Поточний ··4417EUR", "Кредитна ··9021EUR", "Новий рахунок"]);
  });

  it("FIN-03@PoC AC17: no accounts — the explanation and «Новий рахунок»; the short form fills in the new account and «Додати транзакцію» is active after the amount", async () => {
    let accounts: Account[] = [];
    const handlers = base();
    handlers["GET /v1/accounts"] = () => ({ status: 200, body: { items: accounts, nextCursor: null } });
    handlers["POST /v1/accounts"] = (call) => {
      const body = call.body as { name: string; kind: string; balance: unknown; balanceDate: string };
      expect(body).toEqual({
        kind: "cash",
        name: "Гаманець",
        balance: { amount: "100.00", currency: "EUR" },
        balanceDate: TODAY,
      });
      const fresh = account("00000000-0000-4000-8000-000000000009", "Гаманець", {
        kind: "cash",
        number: null,
      });
      accounts = [fresh];
      return { status: 201, body: fresh };
    };
    open(handlers);
    await waitFor(() =>
      expect(dialog().textContent).toContain(
        "Рахунків ще немає. Транзакція завжди належить рахунку — створіть його тут, не закриваючи форму.",
      ),
    );
    expect(button(/^Рахунок/).textContent).toContain("Оберіть рахунок");
    expect(dialog().textContent).toContain("Щоб продовжити, заповніть: Сума, Рахунок");
    press("Новий рахунок");
    const form = screen.getByRole("dialog", { name: "Новий рахунок" });
    fireEvent.change(within(form).getByRole("combobox", { name: /Тип рахунку/ }), {
      target: { value: "cash" },
    });
    fireEvent.change(within(form).getByRole("textbox", { name: /Назва/ }), { target: { value: "Гаманець" } });
    const balance = within(form).getByRole("textbox", { name: /Залишок/ });
    await act(async () => {
      fireEvent.focus(balance);
      fireEvent.change(balance, { target: { value: "100" } });
      fireEvent.blur(balance);
    });
    await act(async () => within(form).getByRole("button", { name: "Додати рахунок" }).click());
    await waitFor(() => expect(button(/^Рахунок/).textContent).toContain("Гаманець"));
    expect(disabled("Додати транзакцію")).toBe(true);
    await typeAmount("12");
    expect(disabled("Додати транзакцію")).toBe(false);
  });

  it("FIN-03@PoC AC18: the calendar of «Дата» opens on today of the space with «Сьогодні» and «Учора»; later days are unavailable", async () => {
    open();
    await accountReady();
    expect(button(/^Дата/).textContent).toContain("2 лист. 2026");
    expect(button(/^Дата/).textContent).toContain("· сьогодні");
    await act(async () => button(/^Дата/).click());
    const calendar = within(dialog()).getByRole("dialog", { name: "Оберіть дату" });
    const day = (n: number) =>
      within(calendar)
        .getAllByRole("gridcell")
        .find((c) => c.textContent === String(n))!;
    expect(day(2).getAttribute("aria-selected")).toBe("true");
    expect(day(3).getAttribute("aria-disabled")).toBe("true");
    expect(within(calendar).getByRole("button", { name: "Сьогодні" })).toBeTruthy();
    expect(calendar.textContent).toContain(
      "Майбутні дати недоступні — для запланованих платежів є «Регулярні платежі».",
    );
    await act(async () => within(calendar).getByRole("button", { name: "Учора" }).click());
    expect(button(/^Дата/).textContent).toContain("1 лист. 2026");
  });

  it("FIN-03@PoC FR 29: «Дата» is today of the space by default", async () => {
    const { calls, onClose } = open();
    await accountReady();
    await typeAmount("1");
    press("Додати транзакцію");
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect((calls.find((c) => c.method === "POST")?.body as { date: string }).date).toBe(TODAY);
  });

  it("FIN-03@PoC FR 1: on an account card the account is filled in", async () => {
    open(base(), { accountId: ACC2 });
    await waitFor(() => expect(button(/^Рахунок/).textContent).toContain("Кредитна"));
  });

  it("FIN-03@PoC EC2: a currency that does not match the account — «Валюта не відповідає рахунку», the form keeps its values", async () => {
    const handlers = base();
    const refused = problem(400, "VALIDATION_FAILED") as {
      status: number;
      body: object;
      headers: Record<string, string>;
    };
    handlers["POST /v1/transactions"] = {
      ...refused,
      body: {
        ...refused.body,
        errors: [{ in: "body", path: "amount.currency", issue: "currency_mismatch" }],
      },
    };
    const { onClose } = open(handlers);
    await accountReady();
    await typeAmount("5");
    press("Додати транзакцію");
    await waitFor(() =>
      expect(within(dialog()).getByRole("alert").textContent).toContain("Валюта не відповідає рахунку"),
    );
    expect(onClose).not.toHaveBeenCalled();
    expect((within(dialog()).getByRole("textbox", { name: /Сума/ }) as HTMLInputElement).value).toBe("5,00");
  });

  it("FIN-03@PoC criterion «Помилка»: a failed save shows «Помилка. Не вдалося зберегти…» with «Код: …»; the dialog stays", async () => {
    const handlers = base();
    handlers["POST /v1/transactions"] = problem(503, "MODULE_UNAVAILABLE");
    open(handlers);
    await accountReady();
    await typeAmount("5");
    press("Додати транзакцію");
    const alert = await within(dialog()).findByRole("alert");
    expect(plain(alert.textContent)).toContain(
      "Помилка. Не вдалося зберегти. Дані у формі збережено — спробуйте ще раз.",
    );
    expect(alert.textContent).toContain(`Код: ${SUPPORT_ID}`);
  });

  it("S-048 states: loading — «Рахунок» is a skeleton in the shape of the field; a list that failed leaves the explanation and «Новий рахунок»", async () => {
    let release: ((r: Reply) => void) | null = null;
    const handlers = base();
    handlers["GET /v1/accounts"] = () => new Promise<Reply>((r) => (release = r));
    open(handlers);
    expect(dialog().querySelector(".ws-skeleton")).toBeTruthy();
    await waitFor(() => expect(release).not.toBeNull());
    await act(async () => release!(problem(500, "INTERNAL")));
    await waitFor(() => expect(dialog().textContent).toContain("Не вдалося завантажити рахунки."));
    expect(button("Новий рахунок")).toBeTruthy();
  });

  it("S-048 counterparty: the known counterparties with their number of transactions and «Додати «…» як нового контрагента»", async () => {
    const { calls, onClose } = open();
    await accountReady();
    await typeAmount("7");
    press("Далі");
    await act(async () => button(/^Контрагент/).click());
    const list = within(dialog()).getByRole("listbox");
    expect(within(list).getByRole("group", { name: "Відомі контрагенти" })).toBeTruthy();
    expect(plain(within(list).getByRole("option", { name: /^Сільпо/ }).textContent)).toContain(
      "23 транзакції",
    );
    expect(plain(within(list).getByRole("option", { name: /^Сільська аптека/ }).textContent)).toContain(
      "2 транзакції",
    );
    fireEvent.change(within(dialog()).getByRole("combobox"), { target: { value: "Кава" } });
    await act(async () =>
      within(dialog()).getByRole("option", { name: "Додати «Кава» як нового контрагента" }).click(),
    );
    expect(button(/^Контрагент/).textContent).toContain("Кава");
    press("Додати транзакцію");
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect((calls.find((c) => c.method === "POST")?.body as { counterparty: string }).counterparty).toBe(
      "Кава",
    );
  });

  it("S-048 category: the categories of the transaction's kind by group; «Нова категорія» is last and adds one in the same dialog", async () => {
    const handlers = base();
    handlers["POST /v1/categories"] = (call) => {
      expect(call.body).toEqual({ groupId: "g1", name: "Кава" });
      GROUPS[0]!.categories.push(category("c9", "Кава", "g1", "expense"));
      return { status: 201, body: category("c9", "Кава", "g1", "expense") };
    };
    open(handlers);
    await accountReady();
    await typeAmount("3");
    press("Далі");
    await act(async () => button(/^Категорія/).click());
    const list = within(dialog()).getByRole("listbox");
    expect(within(list).getByRole("group", { name: "Харчування" })).toBeTruthy();
    expect(within(list).queryByRole("option", { name: "Зарплата" })).toBeNull();
    const options = within(list).getAllByRole("option");
    expect(options.at(-1)!.textContent).toBe("Нова категорія");
    await act(async () => options.at(-1)!.click());
    const form = screen.getByRole("dialog", { name: "Нова категорія" });
    fireEvent.change(within(form).getByRole("textbox", { name: /Назва/ }), { target: { value: "Кава" } });
    await act(async () => within(form).getByRole("button", { name: "Додати категорію" }).click());
    await waitFor(() => expect(button(/^Категорія/).textContent).toContain("Кава"));
    GROUPS[0]!.categories.pop();
  });
});

describe("FIN-03@PoC FR 1: the entry points of «Нова транзакція»", () => {
  const app = () => fakeApi(base()).client;

  it("FIN-03@PoC FR 1: «Нова транзакція» in the header of «Гроші → Транзакції» opens the form over the page", async () => {
    renderAt("#/money/transactions", app());
    const header = screen.getByRole("heading", { level: 1, name: "Транзакції" }).parentElement!;
    const actions = [...header.querySelectorAll("a, button")].map((el) => el.textContent);
    expect(actions).toEqual(["Імпортувати виписку", "Історія імпорту", "Нова транзакція"]);
    act(() => within(header).getByRole("button", { name: "Нова транзакція" }).click());
    expect(screen.getByRole("dialog", { name: "Нова транзакція" })).toBeTruthy();
    act(() => within(dialog()).getByRole("button", { name: "Скасувати" }).click());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("FIN-03@PoC FR 1: `/money/transactions/new` is «Транзакції» with the form open; closing it stays on «Транзакції»", async () => {
    renderAt("#/money/transactions/new", app());
    expect(screen.getByRole("dialog", { name: "Нова транзакція" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Транзакції");
    act(() => within(dialog()).getByRole("button", { name: "Закрити" }).click());
    await waitFor(() => expect(window.location.hash).toBe("#/money/transactions"));
  });

  it("FIN-03@PoC FR 1: «+ Додати → Транзакція» opens the form over the current page, and «Скасувати» gives the focus back to «+ Додати»", async () => {
    renderAt("#/planning/budget", app());
    const add = screen.getByRole("button", { name: "Додати" });
    act(() => add.click());
    act(() =>
      within(screen.getByRole("menu", { name: "Додати" }))
        .getByRole("menuitem", { name: "Транзакція" })
        .click(),
    );
    expect(window.location.hash).toBe("#/planning/budget");
    act(() => within(dialog()).getByRole("button", { name: "Скасувати" }).click());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(add);
  });
});
