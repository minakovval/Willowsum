import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { colors, contrastRatio } from "@willowsum/ui";
import { installMatchMedia } from "@willowsum/ui/test-utils";
import { createAuthClient } from "../auth/api.ts";
import { amountChangeMark, chargeMark } from "./status.tsx";
import { translate, type Translate } from "@willowsum/i18n";
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
  it("GRID-04@PoC FR 5: the calendar takes 8 columns, the totals and nearest charges 4, the details 12", async () => {
    renderAt(PAGE, api().client);
    await screen.findByRole("list", { name: "Знайдено в транзакціях" });
    const grid = document.querySelector<HTMLElement>("[data-plan-page='recurring']")!;
    const region = (name: string) => grid.querySelector<HTMLElement>(`[data-plan-region='${name}']`)!;
    expect([...grid.children].map((c) => c.getAttribute("data-plan-region"))).toEqual([
      "calendar",
      "side",
      "details",
    ]);
    expect(region("calendar").className).toContain("plan-span-8");
    expect(region("side").className).toContain("plan-span-4");
    expect(region("details").className).toContain("plan-span-12");
    expect(within(region("calendar")).getByRole("grid", { name: "Календар" })).toBeTruthy();
    expect([...region("side").children].map((c) => c.getAttribute("data-plan-region"))).toEqual([
      "summary",
      "upcoming",
    ]);
    // The details of FR 7 stay in the 12-column region.
    expect(within(region("details")).getByRole("rowheader", { name: /YouTube/ })).toBeTruthy();
  });

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

  it("BUD-07@PoC S-141 list (the list part of the seventh item): «Підписки», other payments and income, each by the next date, with frequency, account and amount", async () => {
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
    expect(head).toEqual(["Платіж", "Частота", "Наступне", "Рахунок", "Сума", "Останнє списання", "Дії"]);
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
    expect(cells(rowOf("^YouTube"))).toEqual(["щомісяця", "18 лист.", "Кредитна ··9021", "17,99 €", "", ""]);
    expect(cells(rowOf("^Квартплата"))).toEqual([
      "щомісяця",
      "28 лист.",
      "Поточний ··4417",
      "≈ 90,00 €",
      "",
      "",
    ]);
    expect(cells(rowOf("^Зарплата"))).toEqual([
      "щомісяця",
      "1 груд.",
      "Поточний ··4417",
      "+3 400,00 €",
      "",
      "",
    ]);
    expect(screen.getByRole("link", { name: "Додати вручну" }).getAttribute("href")).toBe(FORM);
  });

  it("BUD-07@PoC S-141 list (the list part of the seventh item): without account and category names (their lists failed) the payments still show", async () => {
    renderAt(
      PAGE,
      api({ "GET /v1/accounts": problem(500, "INTERNAL"), "GET /v1/categories": "network" }).client,
    );
    await screen.findByRole("table");
    expect(cells(rowOf("^YouTube"))).toEqual([
      "щомісяця",
      "18 лист.",
      "Рахунок не вказано",
      "17,99 €",
      "",
      "",
    ]);
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

  it("NFR-08@PoC: the text pairs of the screen keep 4.5 : 1 in the light theme; actions are buttons and links by name", async () => {
    const pairs: [keyof typeof colors, keyof typeof colors][] = [
      ["ink", "surface-200"],
      ["ink-muted", "surface-200"],
      ["ink-muted", "surface-100"],
      ["ink", "surface-300"],
      ["loss", "surface-200"],
    ];
    for (const [fg, bg] of pairs)
      expect(contrastRatio(colors[fg].light, colors[bg].light), `${fg}/${bg}`).toBeGreaterThanOrEqual(4.5);
    renderAt(PAGE, api().client);
    await screen.findByRole("table");
    for (const b of screen.getAllByRole("button", { name: /Megogo/ })) expect(b.tagName).toBe("BUTTON");
    // The initials tile is decorative: the name is read once, from the text.
    expect(rowOf("^YouTube").querySelector(".rec-tile")!.getAttribute("aria-hidden")).toBe("true");
  });
});

const charge = (over: Record<string, unknown>) => ({
  dueOn: "2026-11-05",
  expectedAmount: money("17.99"),
  status: "expected",
  transactionId: null,
  paidOn: null,
  amount: null,
  overdueDays: null,
  markedOn: null,
  approximate: false,
  amountChange: null,
  ...over,
});

const status = (paymentId: string, over: Record<string, unknown>) => ({
  paymentId,
  state: "active",
  expectedAmount: money("17.99"),
  amountChange: null,
  missesInRow: 0,
  approximate: false,
  lastCharge: null,
  nextCharge: null,
  ...over,
});

const OVERDUE = charge({ dueOn: "2026-11-10", status: "overdue", overdueDays: 6 });
const STATUSES = [
  status("p1", {
    lastCharge: charge({ dueOn: "2026-10-18", status: "paid", paidOn: "2026-10-18" }),
    amountChange: { from: money("15.99"), to: money("17.99"), on: "2026-10-18", transactionId: "t1" },
  }),
  status("p2", { lastCharge: charge({ dueOn: "2026-11-03", status: "paid-late", paidOn: "2026-11-12" }) }),
  status("p3", { state: "possibly-cancelled", lastCharge: OVERDUE, missesInRow: 2 }),
  status("p4", {
    lastCharge: charge({
      dueOn: "2026-11-10",
      status: "overdue",
      overdueDays: 6,
      expectedAmount: money("3400.00"),
    }),
  }),
];
const CHARGES: Record<string, unknown[]> = {
  p3: [charge({ dueOn: "2026-10-10", status: "skipped", markedOn: "2026-11-01" }), OVERDUE],
  p4: [charge({ dueOn: "2026-11-10", status: "overdue", overdueDays: 6 })],
};
function statusApi(over: Record<string, Handler> = {}) {
  const handlers: Record<string, Handler> = {
    "GET /v1/recurring/statuses": { status: 200, body: { items: STATUSES } },
    ...over,
  };
  for (const p of PAYMENTS)
    handlers[`GET /v1/recurring/payments/${p.id}/charges`] = {
      status: 200,
      body: { paymentId: p.id, items: CHARGES[p.id] ?? [] },
    };
  return api(handlers);
}

describe("BUD-07@PoC c) S-141 statuses, calendar and actions", () => {
  it("BUD-07@PoC FR 9, AC13: «Останнє списання» shows only the payment; a change of the amount is a mark beside the amount with its tooltip", async () => {
    renderAt(PAGE, statusApi().client);
    await screen.findByRole("table");
    const youtube = cells(rowOf("^YouTube"));
    expect(youtube[3]).toBe("17,99 €▲2,00 €Статус: Сума зросла з 15,99 € (18 жовт.)");
    expect(youtube[4]).toBe("✓Сплачено 18 жовт.Статус: Сплачено 18 жовт.");
    expect(cells(rowOf("^Spotify"))[4]).toContain("Сплачено із запізненням · 12 лист.");
    expect(cells(rowOf("^Квартплата"))[4]).toContain("Прострочено на 6 дн.");
    expect(cells(rowOf("^Зарплата"))[4]).toContain("Дохід не надійшов · 6 дн.");
    expect(within(rowOf("^YouTube")).getByTitle("Сума зросла з 15,99 € (18 жовт.)")).toBeTruthy();
  });

  it("BUD-07@PoC FR 9, FR 10, AC4: a payment «Можливо, скасований» has the badge beside its name", async () => {
    renderAt(PAGE, statusApi().client);
    await screen.findByRole("table");
    expect(within(rowOf("^Квартплата")).getByText("Можливо, скасований")).toBeTruthy();
    expect(within(rowOf("^YouTube")).queryByText("Можливо, скасований")).toBeNull();
  });

  it("BUD-07@PoC FR 10: «Залишити» keeps the payment and the list is read again", async () => {
    const keep = vi.fn(() => ({ status: 200, body: PAYMENTS[2] }));
    const { client, calls } = statusApi({ "POST /v1/recurring/payments/p3/keep": keep });
    renderAt(PAGE, client);
    await screen.findByRole("table");
    fireEvent.click(within(rowOf("^Квартплата")).getByRole("button", { name: "Ще дії" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Залишити" }));
    await waitFor(() => expect(keep).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(calls.filter((c) => c.path === "/v1/recurring/payments").length).toBeGreaterThan(1),
    );
    expect(document.getElementById("rec-notice")!.textContent).toBe(
      "«Квартплата» лишається в регулярних платежах.",
    );
  });

  it("BUD-07@PoC FR 21, AC16: «Позначити пропущеним» is offered only for an overdue charge and sends its date", async () => {
    const skip = vi.fn(() => ({ status: 200, body: charge({ dueOn: "2026-11-10", status: "skipped" }) }));
    const { client } = statusApi({ "POST /v1/recurring/payments/p4/charges/2026-11-10/skip": skip });
    renderAt(PAGE, client);
    await screen.findByRole("table");
    expect(within(rowOf("^YouTube")).queryByRole("button", { name: "Ще дії" })).toBeNull();
    fireEvent.click(within(rowOf("^Зарплата")).getByRole("button", { name: "Ще дії" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Позначити пропущеним" }));
    await waitFor(() => expect(skip).toHaveBeenCalledTimes(1));
    expect(plain(document.getElementById("rec-notice")!.textContent)).toBe(
      "Списання «Зарплата · Олена» за 10 лист. позначено пропущеним.",
    );
  });

  it("BUD-07@PoC FR 21: a refused «Позначити пропущеним» is said and nothing else changes", async () => {
    const { client } = statusApi({
      "POST /v1/recurring/payments/p4/charges/2026-11-10/skip": problem(409, "RECURRING_CHARGE_NOT_OVERDUE"),
    });
    renderAt(PAGE, client);
    await screen.findByRole("table");
    fireEvent.click(within(rowOf("^Зарплата")).getByRole("button", { name: "Ще дії" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Позначити пропущеним" }));
    await waitFor(() =>
      expect(document.getElementById("rec-notice")!.textContent).toContain("Не вдалося зберегти рішення."),
    );
  });

  it("GRID-04@PoC AC 4: a skipped payment is «Пропущено» in the calendar, by word and marker", async () => {
    vi.setSystemTime(new Date("2026-10-16T10:00:00Z"));
    renderAt(PAGE, statusApi().client);
    await screen.findByRole("table");
    const cell = document.querySelector("[role='gridcell'][data-date='2026-10-10']") as HTMLElement;
    expect(cell).toBeTruthy();
    expect(within(cell).getByText("Квартплата")).toBeTruthy();
    expect(plain(cell.textContent)).toContain("!");
    expect(within(cell).getByText("Статус: Пропущено")).toBeTruthy();
  });

  it("BUD-07@PoC S-141 calendar (the calendar part of the seventh item), FR 9: the calendar shows the charges of the month and the legend has three groups", async () => {
    renderAt(PAGE, statusApi().client);
    await screen.findByRole("table");
    const grid = screen.getByRole("grid", { name: "Календар" });
    const cell = grid.querySelector("[data-date='2026-11-10']") as HTMLElement;
    expect(within(cell).getByText("Зарплата · Олена")).toBeTruthy();
    expect(within(cell).getByText("Статус: Дохід не надійшов · 6 днів")).toBeTruthy();
    expect(grid.querySelector("[data-today]")?.getAttribute("data-date")).toBe("2026-11-16");
    const legend = document.querySelector(".rec-legend") as HTMLElement;
    const titles = [...legend.querySelectorAll(".rec-legend-group > .rec-label")].map((e) => e.textContent);
    expect(titles).toEqual(["Статус списання", "Зміна суми", "Стан платежу"]);
  });

  it("BUD-07@PoC FR 9: the summary counts the overdue charges and lists the nearest ones of the 30 days", async () => {
    renderAt(PAGE, statusApi().client);
    await screen.findByRole("table");
    const summary = screen.getByRole("region", { name: "Підсумок" });
    expect(plain(summary.textContent)).toContain("Прострочено · 1");
    expect(plain(summary.textContent)).toContain("Дохід не надійшов · 1");
    const nearest = screen.getByRole("region", { name: "Найближчі" });
    expect(plain(nearest.textContent)).toContain("наступні 30 днів · 4");
    expect(within(nearest).getAllByRole("listitem")[0]?.textContent).toContain("YouTube");
  });

  it("BUD-07@PoC S-141: when the statuses and the charges fail the payments still show, without status", async () => {
    renderAt(PAGE, api().client);
    await screen.findByRole("table");
    expect(cells(rowOf("^YouTube"))[4]).toBe("");
    expect(within(screen.getByRole("table")).queryByText("Можливо, скасований")).toBeNull();
  });

  it("BUD-07@PoC FR 14: a payment belongs to the whole space: no share and no «Хто компенсує» anywhere on the screen", async () => {
    renderAt(PAGE, statusApi().client);
    await screen.findByRole("table");
    const page = plain(document.body.textContent);
    expect(page).not.toMatch(/Хто компенсує|частка|Частка/);
  });

  it("BUD-07@PoC FR 18: the screen has no notification setting or control for regular payments", async () => {
    renderAt(PAGE, statusApi().client);
    await screen.findByRole("table");
    expect(screen.queryByRole("checkbox", { name: /сповіщ/i })).toBeNull();
    expect(screen.queryByRole("switch", { name: /сповіщ/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /сповіщ/i })).toBeNull();
  });
});

describe("BUD-07@PoC FR 9 (reviewer): the words of income charges and the one-currency guard of the change mark", () => {
  it("BUD-07@PoC FR 9, AC13: income is «Отримано», «Отримано із запізненням», «Очікується», «Пропущено»; expense keeps its words", () => {
    const id = (type: "income" | "expense", over: Record<string, unknown>) =>
      chargeMark("uk", type, charge(over) as never).id;
    expect(id("income", { status: "paid", paidOn: "2026-11-01" })).toBe("e.received");
    expect(id("income", { status: "paid-late", paidOn: "2026-11-12" })).toBe("e.receivedLate");
    expect(id("income", { status: "expected" })).toBe("e.expected");
    expect(id("income", { status: "skipped" })).toBe("e.skipped");
    expect(id("expense", { status: "paid", paidOn: "2026-11-01" })).toBe("d.paid");
    expect(id("expense", { status: "paid-late", paidOn: "2026-11-12" })).toBe("d.paidLate");
  });

  it("BUD-07@PoC FR 9: a change across currencies shows no figure", () => {
    const t: Translate = (key, params) => translate("uk", key, params);
    const change = { from: money("9.99", "GBP"), to: money("11.99"), on: "2026-10-30", transactionId: "t1" };
    expect(amountChangeMark(t, "uk", "expense", change)).toBeNull();
    expect(amountChangeMark(t, "uk", "expense", { ...change, from: money("9.99") })?.amount).toMatch(
      /^2,00\s€$/,
    );
  });
});
