import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { installMatchMedia } from "@willowsum/ui/test-utils";
import { createAuthClient } from "../auth/api.ts";
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

/**
 * BUD-07@PoC c) (wave 2, row 130): S-141 «Регулярні платежі» on the recurring API of #309 and #324
 * (boards PocPlanRecurring, PocPlanRecurringEmpty). Today is 2026-11-16 in Kyiv.
 */
const ACC_CARD = "9b0e7a6e-0000-4000-8000-000000000001";
const ACC_CURRENT = "9b0e7a6e-0000-4000-8000-000000000002";
const ACC_LOAN = "9b0e7a6e-0000-4000-8000-000000000003";
const CAT_SUBS = "c0000000-0000-4000-8000-000000000001";
const CAT_UTIL = "c0000000-0000-4000-8000-000000000002";
const CAT_SALARY = "c0000000-0000-4000-8000-000000000003";

const money = (amount: string, currency = "EUR") => ({ amount, currency });

function payment(over: Record<string, unknown>) {
  return {
    id: "p0000000-0000-4000-8000-000000000000",
    name: "Spotify",
    type: "expense",
    frequency: "month",
    expectedAmount: money("17.99"),
    anchorDate: "2026-08-03",
    nextDate: "2026-12-03",
    endDate: null,
    categoryId: CAT_SUBS,
    accountId: ACC_CARD,
    merchantId: null,
    source: "manual",
    subscription: true,
    variable: false,
    createdOn: "2026-11-01",
    version: 1,
    ...over,
  };
}

const PAYMENTS = [
  payment({ id: "p1", name: "YouTube", nextDate: "2026-11-18" }),
  payment({ id: "p2", name: "Spotify", nextDate: "2026-12-03" }),
  payment({
    id: "p3",
    name: "Квартплата",
    subscription: false,
    variable: true,
    expectedAmount: money("90.00"),
    categoryId: CAT_UTIL,
    accountId: ACC_CURRENT,
    nextDate: "2026-11-28",
  }),
  payment({
    id: "p4",
    name: "Зарплата · Олена",
    type: "income",
    subscription: false,
    expectedAmount: money("3400.00"),
    categoryId: CAT_SALARY,
    accountId: ACC_CURRENT,
    nextDate: "2026-12-01",
  }),
];

const PROPOSAL = {
  key: "m1|expense|EUR|month|2026-08-20",
  merchant: { id: "m0000000-0000-4000-8000-000000000001", name: "Megogo" },
  type: "expense",
  frequency: "month",
  variable: false,
  expectedAmount: money("5.99"),
  nextDate: "2026-11-20",
  anchorDate: "2026-08-20",
  lastDate: "2026-10-20",
  accountId: ACC_CARD,
  transactionIds: ["t1", "t2", "t3"],
};

const VARIABLE_PROPOSAL = {
  ...PROPOSAL,
  key: "m2|expense|EUR|month|2026-06-28",
  merchant: { id: "m0000000-0000-4000-8000-000000000002", name: "Квартплата" },
  variable: true,
  expectedAmount: money("90.00"),
  nextDate: "2026-11-28",
  accountId: ACC_CURRENT,
  transactionIds: ["t4", "t5", "t6", "t7", "t8", "t9"],
};

function account(id: string, name: string, last4: string, kind = "current", status = "active") {
  return {
    id,
    name,
    kind,
    status,
    group: kind === "loan" ? "credit" : "cash",
    number: { last4, masked: `··${last4}` },
    currencies: [{ currency: "EUR" }],
    closedOn: null,
    creditCard: null,
    inProfileCurrency: { approximate: false, total: null, unavailableCount: 0 },
    institution: null,
    loan: null,
    source: "manual",
    updatedOn: "2026-11-01T10:00:00Z",
  };
}

const ACCOUNTS = {
  status: 200,
  body: {
    items: [
      account(ACC_CARD, "Кредитна", "9021", "credit-card"),
      account(ACC_CURRENT, "Поточний", "4417"),
      account(ACC_LOAN, "Іпотека", "7700", "loan"),
    ],
    nextCursor: null,
  },
};

const category = (id: string, name: string, kind: string) => ({
  id,
  name,
  kind,
  hidden: false,
  color: "chart-cat-1",
  deletable: true,
  essential: null,
  groupId: `g-${kind}`,
  icon: "other",
  iconTone: "white",
  renamed: false,
  systemKey: null,
});
const CATEGORIES = {
  status: 200,
  body: {
    groups: [
      {
        id: "g-expense",
        kind: "expense",
        name: "Витрати",
        renamed: false,
        systemKey: null,
        tone: "chart-cat-1",
        categories: [category(CAT_SUBS, "Підписки", "expense"), category(CAT_UTIL, "Комунальні", "expense")],
      },
      {
        id: "g-income",
        kind: "income",
        name: "Доходи",
        renamed: false,
        systemKey: null,
        tone: "chart-cat-2",
        categories: [category(CAT_SALARY, "Зарплата", "income")],
      },
    ],
  },
};

type Handler = Reply | ((call: Call) => Reply | Promise<Reply>);
function api(over: Record<string, Handler> = {}) {
  return fakeApi({
    "GET /v1/recurring/payments": { status: 200, body: { items: PAYMENTS } },
    "GET /v1/recurring/proposals": { status: 200, body: { items: [PROPOSAL], more: false } },
    "GET /v1/accounts": ACCOUNTS,
    "GET /v1/categories": CATEGORIES,
    ...over,
  });
}

/** A reply that waits until the test lets it go. */
function held(reply: Reply) {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  return { handler: async () => (await gate, reply), release: () => release() };
}

const PAGE = "#/planning/recurring";
const FORM = "#/planning/recurring/new";
const rowOf = (name: string) => screen.getByRole("rowheader", { name: new RegExp(name) }).closest("tr")!;
const cells = (row: HTMLElement) =>
  within(row)
    .getAllByRole("cell")
    .map((c) => plain(c.textContent));

beforeEach(() => {
  installMatchMedia({ width: 1280 });
  resetAuthState();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-16T10:00:00Z"));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("BUD-07@PoC c) S-141 «Регулярні платежі»", () => {
  it("BUD-07@PoC FR 4, AC1: a proposal shows its frequency, expected amount and next date with «Не регулярний» and «Підтвердити»", async () => {
    renderAt(
      PAGE,
      api({
        "GET /v1/recurring/proposals": {
          status: 200,
          body: { items: [PROPOSAL, VARIABLE_PROPOSAL], more: false },
        },
      }).client,
    );
    const list = await screen.findByRole("list", { name: "Знайдено в транзакціях" });
    const [megogo, flat] = within(list).getAllByRole("listitem");
    expect(plain(megogo!.textContent)).toContain("Megogo");
    expect(plain(megogo!.textContent)).toContain(
      "щомісяця · наступне 20 лист. · Кредитна ··9021 · 3 списання",
    );
    expect(plain(megogo!.textContent)).toContain("5,99 €");
    expect(within(megogo!).getByRole("button", { name: "Не регулярний: Megogo" })).toBeTruthy();
    expect(within(megogo!).getByRole("button", { name: "Підтвердити: Megogo" })).toBeTruthy();
    // FR 3: a variable series is said in words and its amount is approximate.
    expect(plain(flat!.textContent)).toContain(
      "щомісяця · змінна · наступне 28 лист. · Поточний ··4417 · 6 списань",
    );
    expect(plain(flat!.textContent)).toContain("≈ 90,00 €");
    expect(plain(screen.getByText(/· підтвердьте або відхиліть/).textContent)).toBe(
      "2 пропозиції · підтвердьте або відхиліть",
    );
  });

  it("BUD-07@PoC FR 4: «Підтвердити» sends the proposal's key once with an idempotency key; the list reloads and says so", async () => {
    let confirmed = false;
    const { client, calls } = api({
      "POST /v1/recurring/proposals/confirm": () => {
        confirmed = true;
        return { status: 201, body: payment({ id: "p9", name: "Megogo", source: "proposal" }) };
      },
      "GET /v1/recurring/proposals": () => ({
        status: 200,
        body: { items: confirmed ? [] : [PROPOSAL], more: false },
      }),
    });
    renderAt(PAGE, client);
    const button = await screen.findByRole("button", { name: "Підтвердити: Megogo" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(await screen.findByText("«Megogo» додано до регулярних платежів.")).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Підтвердити: Megogo" })).toBeNull());
    const posts = calls.filter((c) => c.method === "POST");
    expect(posts).toEqual([
      expect.objectContaining({ path: "/v1/recurring/proposals/confirm", body: { key: PROPOSAL.key } }),
    ]);
    expect(document.getElementById("rec-notice")!.getAttribute("role")).toBe("status");
  });

  it("BUD-07@PoC FR 4: «Не регулярний» rejects the series and it is not proposed again", async () => {
    let rejected = false;
    const { client, calls } = api({
      "POST /v1/recurring/proposals/reject": () => {
        rejected = true;
        return { status: 201, body: {} };
      },
      "GET /v1/recurring/proposals": () => ({
        status: 200,
        body: { items: rejected ? [] : [PROPOSAL], more: false },
      }),
    });
    renderAt(PAGE, client);
    fireEvent.click(await screen.findByRole("button", { name: "Не регулярний: Megogo" }));
    expect(await screen.findByText("«Megogo» більше не пропонуватиметься.")).toBeTruthy();
    await waitFor(() => expect(screen.queryByText("Знайдено в транзакціях")).toBeNull());
    expect(calls.find((c) => c.method === "POST")).toMatchObject({
      path: "/v1/recurring/proposals/reject",
      body: { key: PROPOSAL.key },
    });
  });

  it("BUD-07@PoC FR 4: a proposal already gone (409 RECURRING_PROPOSAL_GONE) is said plainly and the list is read again", async () => {
    const { client, calls } = api({
      "POST /v1/recurring/proposals/confirm": problem(409, "RECURRING_PROPOSAL_GONE"),
    });
    renderAt(PAGE, client);
    fireEvent.click(await screen.findByRole("button", { name: "Підтвердити: Megogo" }));
    expect(await screen.findByText(/Цієї пропозиції вже немає/)).toBeTruthy();
    await waitFor(() => expect(calls.filter((c) => c.path === "/v1/recurring/proposals").length).toBe(2));
  });

  it("BUD-07@PoC FR 4: another failure keeps the proposal and shows what failed with its code", async () => {
    renderAt(PAGE, api({ "POST /v1/recurring/proposals/reject": problem(500, "INTERNAL") }).client);
    fireEvent.click(await screen.findByRole("button", { name: "Не регулярний: Megogo" }));
    const alert = await screen.findByRole("alert");
    expect(plain(alert.textContent)).toContain("Не вдалося зберегти рішення.");
    expect(plain(alert.textContent)).toContain(`Код: ${SUPPORT_ID}`);
    expect(screen.getByRole("button", { name: "Не регулярний: Megogo" })).toBeTruthy();
  });

  it("BUD-07@PoC FR 7 (part): «Підписки», other payments and income, each by the next date, with frequency, account and amount", async () => {
    renderAt(PAGE, api().client);
    const table = await screen.findByRole("table");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Регулярні платежі");
    expect(
      screen.getByText(
        (_, el) => el?.tagName === "P" && plain(el.textContent) === "4 платежі · листопад 2026",
      ),
    ).toBeTruthy();
    const head = within(table.querySelector("thead")!)
      .getAllByRole("columnheader")
      .map((h) => plain(h.textContent));
    expect(head).toEqual(["Платіж", "Частота", "Наступне", "Рахунок", "Сума"]);
    const order = screen.getAllByRole("rowheader").map((h) => plain(h.textContent));
    expect(order).toEqual([
      "YYouTubeПідписки",
      "SSpotifyПідписки",
      "ККвартплатаКомунальні · змінна сума",
      "ЗОЗарплата · ОленаЗарплата",
    ]);
    const groups = [...table.querySelectorAll("tbody")].map((b) =>
      plain(b.querySelector("th[scope='colgroup']")?.textContent),
    );
    expect(groups).toEqual(["Підписки · 2", "Інші платежі · 1", "Доходи · 1"]);
    expect(cells(rowOf("^YouTube"))).toEqual(["щомісяця", "18 лист.", "Кредитна ··9021", "17,99 €"]);
    expect(cells(rowOf("^Квартплата"))).toEqual(["щомісяця", "28 лист.", "Поточний ··4417", "≈ 90,00 €"]);
    expect(cells(rowOf("^Зарплата"))).toEqual(["щомісяця", "1 груд.", "Поточний ··4417", "+3 400,00 €"]);
    expect(screen.getByRole("link", { name: "Додати вручну" }).getAttribute("href")).toBe(FORM);
  });

  it("BUD-07@PoC FR 7 (part): without account and category names (their lists failed) the payments still show", async () => {
    renderAt(
      PAGE,
      api({ "GET /v1/accounts": problem(500, "INTERNAL"), "GET /v1/categories": "network" }).client,
    );
    await screen.findByRole("table");
    expect(cells(rowOf("^YouTube"))).toEqual(["щомісяця", "18 лист.", "Рахунок не вказано", "17,99 €"]);
    expect(plain(rowOf("^YouTube").textContent)).toContain("Без категорії");
  });

  it("BUD-07@PoC «Стани інтерфейсу» empty: «Регулярних платежів ще немає» with «Додати вручну» and the proposals", async () => {
    renderAt(PAGE, api({ "GET /v1/recurring/payments": { status: 200, body: { items: [] } } }).client);
    const empty = await screen.findByRole("region", { name: "Регулярних платежів ще немає" });
    expect(within(empty).getByRole("link", { name: "Додати вручну" }).getAttribute("href")).toBe(FORM);
    expect(within(empty).getByRole("button", { name: "Підтвердити: Megogo" })).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    expect(plain(screen.getByText(/листопад 2026/).textContent)).toBe("листопад 2026");
  });

  it("BUD-07@PoC «Стани інтерфейсу» empty without proposals: only the empty state", async () => {
    renderAt(
      PAGE,
      api({
        "GET /v1/recurring/payments": { status: 200, body: { items: [] } },
        "GET /v1/recurring/proposals": { status: 200, body: { items: [], more: false } },
      }).client,
    );
    await screen.findByText("Регулярних платежів ще немає");
    expect(screen.queryByText("Знайдено в транзакціях")).toBeNull();
  });

  it("BUD-07@PoC «Стани інтерфейсу» loading: a skeleton of the list, announced once", async () => {
    const gate = held({ status: 200, body: { items: PAYMENTS } });
    renderAt(PAGE, api({ "GET /v1/recurring/payments": gate.handler }).client);
    expect((await screen.findAllByText("Завантаження")).length).toBe(1);
    expect(document.querySelector("[aria-busy='true']")).not.toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
    await act(async () => gate.release());
    await screen.findByRole("table");
  });

  it("BUD-07@PoC «Стани інтерфейсу» error: «Не вдалося завантажити регулярні платежі», the code and «Спробувати ще раз» reads again", async () => {
    let fail = true;
    renderAt(
      PAGE,
      api({
        "GET /v1/recurring/payments": () =>
          fail ? problem(500, "INTERNAL") : { status: 200, body: { items: PAYMENTS } },
      }).client,
    );
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByRole("heading").textContent).toBe("Не вдалося завантажити регулярні платежі");
    expect(plain(alert.textContent)).toContain(`Код: ${SUPPORT_ID}`);
    fail = false;
    fireEvent.click(within(alert).getByRole("button", { name: "Спробувати ще раз" }));
    await screen.findByRole("table");
  });

  it("BUD-07@PoC «Ліміти плану»: the function switched off for the space (404) is said plainly, nothing breaks", async () => {
    renderAt(PAGE, api({ "GET /v1/recurring/payments": problem(404, "NOT_FOUND") }).client);
    const alert = await screen.findByRole("alert");
    expect(plain(alert.textContent)).toMatch(/недоступн/);
  });

  it("BUD-07@PoC FR 6: «Додати вручну» sends name, amount, frequency, anchor date, category, account, end date, type, «Підписка», «Змінна сума»", async () => {
    const { client, calls } = api({
      "POST /v1/recurring/payments": { status: 201, body: payment({ id: "p5", name: "Воля · інтернет" }) },
    });
    renderAt(FORM, client);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Новий регулярний платіж");
    const nav = screen.getByRole("navigation", { name: "Хлібні крихти" });
    expect(within(nav).getByRole("link", { name: "Регулярні платежі" }).getAttribute("href")).toBe(PAGE);
    const account = await screen.findByRole("combobox", { name: "Рахунок" });
    // A loan is not offered (the API refuses it); the account's currency becomes the payment's.
    expect(within(account).queryByRole("option", { name: /Іпотека/ })).toBeNull();
    fireEvent.change(screen.getByRole("textbox", { name: /^Назва/ }), {
      target: { value: " Воля · інтернет " },
    });
    fireEvent.change(screen.getByRole("textbox", { name: /^Сума/ }), { target: { value: "14,00" } });
    fireEvent.change(screen.getByRole("combobox", { name: /^Частота/ }), { target: { value: "month" } });
    expect((screen.getByLabelText(/^Дата прив’язки/) as HTMLInputElement).value).toBe("2026-11-16");
    fireEvent.change(screen.getByLabelText(/^Дата прив’язки/), { target: { value: "2026-11-25" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Категорія" }), { target: { value: CAT_SUBS } });
    fireEvent.change(account, { target: { value: ACC_CURRENT } });
    fireEvent.change(screen.getByLabelText(/^Дата завершення/), { target: { value: "2027-11-25" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Підписка" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Змінна сума" }));
    fireEvent.click(screen.getByRole("button", { name: "Зберегти" }));
    await waitFor(() => expect(window.location.hash).toBe(PAGE));
    expect(calls.find((c) => c.method === "POST")).toMatchObject({
      path: "/v1/recurring/payments",
      body: {
        name: "Воля · інтернет",
        amount: { amount: "14.00", currency: "EUR" },
        frequency: "month",
        anchorDate: "2026-11-25",
        type: "expense",
        categoryId: CAT_SUBS,
        accountId: ACC_CURRENT,
        endDate: "2027-11-25",
        subscription: true,
        variable: true,
      },
    });
  });

  it("BUD-07@PoC FR 6: type «Дохід» offers only income categories", async () => {
    renderAt(FORM, api().client);
    const categoryBox = await screen.findByRole("combobox", { name: "Категорія" });
    await within(categoryBox).findByRole("option", { name: "Підписки" });
    fireEvent.click(screen.getByRole("radio", { name: "Дохід" }));
    expect(within(categoryBox).queryByRole("option", { name: "Підписки" })).toBeNull();
    expect(within(categoryBox).getByRole("option", { name: "Зарплата" })).toBeTruthy();
  });

  it("BUD-07@PoC FR 6: required fields and an end before the anchor are marked with «Помилка», nothing is sent; focus goes to the first", async () => {
    const { client, calls } = api();
    renderAt(FORM, client);
    await screen.findByRole("combobox", { name: "Рахунок" });
    fireEvent.change(screen.getByLabelText(/^Дата завершення/), { target: { value: "2026-11-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Зберегти" }));
    const name = screen.getByRole("textbox", { name: /^Назва/ });
    expect(name.getAttribute("aria-invalid")).toBe("true");
    expect(plain(document.getElementById(name.getAttribute("aria-describedby")!)!.textContent)).toBe(
      "Помилка Вкажіть назву до 60 символів.",
    );
    expect(screen.getByRole("textbox", { name: /^Сума/ }).getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByLabelText(/^Дата завершення/).getAttribute("aria-invalid")).toBe("true");
    await waitFor(() => expect(document.activeElement).toBe(name));
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("BUD-07@PoC FR 6: the server's refusal of a merged category is shown at the field", async () => {
    const refusal: Reply = {
      ...(problem(400, "VALIDATION_FAILED") as { status: number; body: Record<string, unknown> }),
    };
    (refusal as { body: Record<string, unknown> }).body["errors"] = [
      { in: "body", path: "categoryId", issue: "merged" },
    ];
    renderAt(FORM, api({ "POST /v1/recurring/payments": refusal }).client);
    await screen.findByRole("combobox", { name: "Рахунок" });
    fireEvent.change(screen.getByRole("textbox", { name: /^Назва/ }), { target: { value: "Воля" } });
    fireEvent.change(screen.getByRole("textbox", { name: /^Сума/ }), { target: { value: "14" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Категорія" }), { target: { value: CAT_SUBS } });
    fireEvent.click(screen.getByRole("button", { name: "Зберегти" }));
    const box = screen.getByRole("combobox", { name: "Категорія" });
    await waitFor(() => expect(box.getAttribute("aria-invalid")).toBe("true"));
    expect(window.location.hash).toBe(FORM);
  });

  it("BUD-07@PoC FR 6: a repeated save of the same request keeps its idempotency key; a changed one takes a new key", async () => {
    const keys: string[] = [];
    const replies: Record<string, Reply> = {
      "GET /v1/accounts": ACCOUNTS,
      "GET /v1/categories": CATEGORIES,
      "POST /v1/recurring/payments": problem(500, "INTERNAL"),
    };
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const request = input instanceof Request ? input : new Request(input, init);
      const key = request.headers.get("Idempotency-Key");
      if (key) keys.push(key);
      const reply = replies[`${request.method} ${new URL(request.url).pathname}`];
      if (!reply || reply === "network") return new Response(null, { status: 599 });
      return new Response(JSON.stringify(reply.body), { status: reply.status, headers: reply.headers ?? {} });
    };
    renderAt(FORM, createAuthClient(fetchImpl as typeof fetch));
    await screen.findByRole("combobox", { name: "Рахунок" });
    fireEvent.change(screen.getByRole("textbox", { name: /^Назва/ }), { target: { value: "Воля" } });
    fireEvent.change(screen.getByRole("textbox", { name: /^Сума/ }), { target: { value: "14" } });
    fireEvent.click(screen.getByRole("button", { name: "Зберегти" }));
    expect(plain((await screen.findByRole("alert")).textContent)).toContain("Не вдалося зберегти платіж.");
    fireEvent.click(screen.getByRole("button", { name: "Зберегти" }));
    await waitFor(() => expect(keys.length).toBe(2));
    fireEvent.change(screen.getByRole("textbox", { name: /^Сума/ }), { target: { value: "15" } });
    fireEvent.click(screen.getByRole("button", { name: "Зберегти" }));
    await waitFor(() => expect(keys.length).toBe(3));
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[0]);
  });
});
