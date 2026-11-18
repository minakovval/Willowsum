import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fireEvent, screen, within } from "@testing-library/react";
import { installMatchMedia } from "@willowsum/ui/test-utils";
import { createAuthClient } from "../auth/api.ts";
import { accountIdOf, accountPath, resolveRoute } from "../routing/routes.ts";
import { plain, problem, renderAt, resetAuthState, SUPPORT_ID, type Reply } from "../auth/testing.tsx";
import type { AccountDetail, RecurringPayment } from "./card.ts";

/**
 * FIN-12@PoC c) and GRID-02@PoC — S-053 «Картка рахунку» on `GET /v1/accounts/{id}`, `GET /v1/transactions` (filtered
 * by the account), the categories and `GET /v1/recurring/payments` (canvas PocMoneyAccount and its «Тексти» board).
 * Synthetic data only.
 */
const dir = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(dir, "account-card.css"), "utf8").replace(/\s+/g, " ");
const eur = (amount: string) => ({ amount, currency: "EUR" });

const ACCOUNT_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_ID = "00000000-0000-4000-8000-000000000099";
const CAT_FOOD = "00000000-0000-4000-8000-0000000000c1";

function detail(over: Partial<AccountDetail> = {}): AccountDetail {
  return {
    id: ACCOUNT_ID,
    kind: "current",
    group: "cash",
    name: "Щоденний",
    institution: { name: "Ощадбанк", country: "UA" },
    number: { last4: "4417", masked: "••4417" },
    note: null,
    status: "active",
    closedOn: null,
    source: "import",
    openedOn: "2021-03-14",
    owners: [],
    currencies: [{ currency: "EUR", balance: eur("5200.00"), balanceDate: "2026-11-02" }],
    adjustments: [],
    savings: null,
    deposit: null,
    creditCard: null,
    loan: null,
    ...over,
  } as AccountDetail;
}

function tx(i: number, over: Record<string, unknown> = {}) {
  return {
    id: `00000000-0000-4000-8000-0000000001${String(i).padStart(2, "0")}`,
    accountId: ACCOUNT_ID,
    amount: eur(`-${10 + i}.50`),
    type: "expense",
    date: `2026-11-${String(10 - i).padStart(2, "0")}`,
    counterparty: `Магазин ${i}`,
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
    recordedAt: "2026-11-02T10:00:00Z",
    ...over,
  };
}

function payment(over: Partial<RecurringPayment> & Pick<RecurringPayment, "name">): RecurringPayment {
  return {
    id: `p-${over.name}`,
    type: "expense",
    frequency: "month",
    expectedAmount: eur("86.40"),
    anchorDate: "2026-01-05",
    nextDate: "2026-11-05",
    endDate: null,
    categoryId: null,
    accountId: ACCOUNT_ID,
    subscription: false,
    variable: false,
    merchantId: null,
    source: "manual",
    createdOn: "2026-01-01",
    version: 1,
    ...over,
  };
}

const categories = {
  groups: [
    {
      id: "g1",
      systemKey: "food",
      kind: "expense",
      name: "Їжа",
      renamed: false,
      tone: "#5872D2",
      categories: [
        {
          id: CAT_FOOD,
          groupId: "g1",
          systemKey: "groceries",
          kind: "expense",
          name: "Продукти",
          renamed: false,
          icon: "shopping-cart",
          color: "#144097",
          iconTone: "white",
          essential: true,
          hidden: false,
          deletable: false,
        },
      ],
    },
  ],
};

type Handler = Reply | ((url: URL) => Reply | Promise<Reply>);

/** A fake API on the app's origin: GET handlers by path; every request URL is recorded. */
function api(over: Record<string, Handler> = {}) {
  const urls: URL[] = [];
  const handlers: Record<string, Handler> = {
    [`/v1/accounts/${ACCOUNT_ID}`]: { status: 200, body: detail() },
    "/v1/transactions": {
      status: 200,
      body: {
        items: [1, 2, 3, 4, 5, 6, 7].map((i) => tx(i)),
        page: 1,
        pageSize: 25,
        count: 28,
        from: 1,
        to: 7,
        summary: null,
      },
    },
    "/v1/categories": { status: 200, body: categories },
    "/v1/recurring/payments": {
      status: 200,
      body: {
        items: [
          payment({ name: "Садочок", expectedAmount: eur("120.00"), nextDate: "2026-11-10" }),
          payment({ name: "Квартплата" }),
          payment({ name: "Зарплата", type: "income", expectedAmount: eur("2400.00") }),
          payment({ name: "Інший рахунок", accountId: OTHER_ID }),
          payment({ name: "Завершений", nextDate: null }),
        ],
      },
    },
    ...over,
  };
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    urls.push(url);
    let handler = request.method === "GET" ? handlers[url.pathname] : undefined;
    if (!handler && /^\/v1\/transactions\/[^/]+\/category$/.test(url.pathname))
      handler = handlers["category"] ?? {
        status: 200,
        body: { transactionId: url.pathname.split("/")[3], categoryId: CAT_FOOD, source: "manual" },
      };
    const reply = typeof handler === "function" ? await handler(url) : handler;
    if (reply === undefined || reply === "network") return new Response(null, { status: 599 });
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
      status: reply.status,
      headers: { "content-type": "application/json", ...reply.headers },
    });
  };
  return { client: createAuthClient(fetchImpl as typeof fetch), urls };
}

const at = `#/money/accounts/${ACCOUNT_ID}`;
const card = (name: string) => screen.getByRole("region", { name });

beforeEach(() => {
  installMatchMedia({ width: 1280 });
  resetAuthState();
});

describe("FIN-12@PoC c) S-053 «Картка рахунку»", () => {
  it("GRID-02@PoC FR 2: header | «Баланс» 8 + «Інформація» 4 | «Транзакції» 8 + «Регулярні платежі» 4", async () => {
    renderAt(at, api().client);
    expect(await screen.findByRole("heading", { level: 1, name: "Щоденний" })).toBeTruthy();
    const regions = ["Баланс", "Інформація", "Транзакції", "Регулярні платежі"].map(card);
    // In this order in the document: the grid places them two by two.
    for (let i = 1; i < regions.length; i++)
      expect(
        regions[i - 1]!.compareDocumentPosition(regions[i]!) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    expect(regions.map((r) => r.className.split(" ").find((c) => c.startsWith("acard-")))).toEqual([
      "acard-balance",
      "acard-info",
      "acard-tx",
      "acard-recurring",
    ]);
    expect(css).toContain(
      "@media (min-width: 1024px) { .acard-grid > .acard-balance, .acard-grid > .acard-tx { grid-column: span 8; } .acard-grid > .acard-info, .acard-grid > .acard-recurring { grid-column: span 4; }",
    );
    expect(css).toContain("grid-template-columns: repeat(var(--ws-columns), minmax(0, 1fr));");
  });

  it("S-053 heading: breadcrumbs «Гроші › Рахунки › <назва>», institution, masked number and currency, the gear «Налаштування рахунку» without a text label and «Імпортувати виписку»", async () => {
    renderAt(at, api().client);
    await screen.findByRole("heading", { level: 1, name: "Щоденний" });
    const crumbs = screen.getByRole("navigation", { name: "Хлібні крихти" });
    expect(
      within(crumbs)
        .getAllByRole("listitem")
        .map((li) => plain(li.textContent)),
    ).toEqual(["Гроші", "Рахунки", "Щоденний"]);
    expect(within(crumbs).getByRole("link", { name: "Рахунки" }).getAttribute("href")).toBe(
      "#/money/accounts",
    );
    expect(screen.getByText(/Ощадбанк · ··4417 · EUR/)).toBeTruthy();
    const gear = screen.getByRole("link", { name: "Налаштування рахунку" });
    expect(gear.getAttribute("href")).toBe(`#/money/accounts/${ACCOUNT_ID}/settings`);
    expect(gear.textContent).toBe("");
    fireEvent.focus(gear);
    expect(plain((await screen.findByRole("tooltip")).textContent)).toBe("Налаштування рахунку");
    expect(screen.getByRole("link", { name: "Імпортувати виписку" }).getAttribute("href")).toBe("#/import");
    expect(document.title).toContain("Щоденний");
  });

  it("GRID-02@PoC FR 19: «Інформація» has the pencil «Редагувати» that opens the account settings and no text link «Змінити»", async () => {
    renderAt(at, api().client);
    const info = await screen.findByRole("region", { name: "Інформація" });
    const pencil = within(info).getByRole("link", { name: "Редагувати інформацію про рахунок" });
    expect(pencil.getAttribute("href")).toBe(`#/money/accounts/${ACCOUNT_ID}/settings`);
    fireEvent.focus(pencil);
    expect(plain((await screen.findByRole("tooltip")).textContent)).toBe("Редагувати");
    expect(within(info).queryByText("Змінити")).toBeNull();
    const facts = within(info)
      .getAllByRole("term")
      .map((dt) => [plain(dt.textContent), plain(dt.nextElementSibling?.textContent)]);
    expect(facts).toEqual([
      ["Тип", "Поточний"],
      ["Установа", "Ощадбанк"],
      ["Номер", "··4417"],
      ["Валюта", "EUR"],
      ["Джерело", "Імпорт"],
    ]);
  });

  it("S-053 «Баланс»: the balance of its day in the account's currency; a multi-currency account lists each currency", async () => {
    const multi = detail({
      currencies: [
        { currency: "EUR", balance: eur("5200.00"), balanceDate: "2026-11-02" },
        { currency: "UAH", balance: { amount: "4300.00", currency: "UAH" }, balanceDate: "2026-11-02" },
      ],
    });
    renderAt(at, api({ [`/v1/accounts/${ACCOUNT_ID}`]: { status: 200, body: multi } }).client);
    const balance = await screen.findByRole("region", { name: "Баланс" });
    expect(plain(balance.textContent)).toContain("на 2 листопада");
    expect(plain(balance.textContent)).toContain("5 200,00 €");
    expect(plain(balance.textContent)).toContain("4 300,00 ₴");
    expect(within(screen.getByRole("region", { name: "Інформація" })).getByText("EUR, UAH")).toBeTruthy();
  });

  it("S-053 «Транзакції»: the 6 newest of the account with their categories, «6 з 28» and «Усі 28 транзакцій рахунку»", async () => {
    const fake = api();
    renderAt(at, fake.client);
    const block = await screen.findByRole("region", { name: "Транзакції" });
    await within(block).findByText("Магазин 1");
    expect(within(block).queryByText("Магазин 7")).toBeNull();
    expect(within(block).getByText("6 з 28")).toBeTruthy();
    expect(within(block).getAllByText("Продукти")).toHaveLength(6);
    expect(plain(block.textContent)).toContain("−11,50 €");
    expect(
      within(block)
        .getByRole("link", { name: /^Усі 28\s+транзакцій рахунку$/ })
        .getAttribute("href"),
    ).toBe(`#/money/transactions?account=${ACCOUNT_ID}`);
    const list = fake.urls.find((u) => u.pathname === "/v1/transactions")!;
    expect(list.searchParams.get("filter")).toBe(`accountId.eq:${ACCOUNT_ID}`);
    // At most one category read per shown row.
    expect(fake.urls.filter((u) => u.pathname.endsWith("/category"))).toHaveLength(6);
  });

  it("S-053 «Транзакції»: an account without transactions says «Транзакцій ще немає» and asks for no categories", async () => {
    const fake = api({
      "/v1/transactions": {
        status: 200,
        body: { items: [], page: 1, pageSize: 25, count: 0, from: 0, to: 0, summary: null },
      },
    });
    renderAt(at, fake.client);
    const block = await screen.findByRole("region", { name: "Транзакції" });
    expect(await within(block).findByText("Транзакцій ще немає")).toBeTruthy();
    expect(within(block).queryByRole("link")).toBeNull();
    expect(fake.urls.some((u) => u.pathname === "/v1/categories")).toBe(false);
  });

  it("S-053 «Регулярні платежі»: this account's expenses with a next charge, soonest first, «2 списуються з цього рахунку», and «›» to «Регулярні платежі»", async () => {
    renderAt(at, api().client);
    const block = await screen.findByRole("region", { name: "Регулярні платежі" });
    await within(block).findByText(/Квартплата/);
    expect(within(block).getByText("2 списуються з цього рахунку")).toBeTruthy();
    const lines = within(block)
      .getAllByRole("listitem")
      .map((li) => plain(li.textContent));
    expect(lines).toEqual(["Квартплата · 5 лист.−86,40 €", "Садочок · 10 лист.−120,00 €"]);
    expect(within(block).getByRole("link", { name: "Усі регулярні платежі" }).getAttribute("href")).toBe(
      "#/planning/recurring",
    );
  });

  it("S-053 «Регулярні платежі»: none on this account — «З цього рахунку регулярні платежі не списуються»", async () => {
    renderAt(at, api({ "/v1/recurring/payments": { status: 200, body: { items: [] } } }).client);
    const block = await screen.findByRole("region", { name: "Регулярні платежі" });
    expect(await within(block).findByText("З цього рахунку регулярні платежі не списуються")).toBeTruthy();
  });

  it("S-053 loading: the breadcrumbs and a skeleton in the shape of the four cards; no amounts yet", async () => {
    let release: (r: Reply) => void = () => undefined;
    const pending = new Promise<Reply>((resolve) => (release = resolve));
    renderAt(at, api({ [`/v1/accounts/${ACCOUNT_ID}`]: () => pending }).client);
    expect(screen.getByRole("navigation", { name: "Хлібні крихти" })).toBeTruthy();
    expect(
      document.querySelectorAll(".acard-grid .ws-skeleton, .acard-grid [aria-busy='true']").length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText(/€/)).toBeNull();
    release({ status: 200, body: detail() });
    expect(await screen.findByRole("heading", { level: 1, name: "Щоденний" })).toBeTruthy();
  });

  it("S-053 error: «✕ Помилка», what failed, «Код: …» and «Спробувати ще раз» reads the account again", async () => {
    let calls = 0;
    renderAt(
      at,
      api({
        [`/v1/accounts/${ACCOUNT_ID}`]: () =>
          ++calls === 1 ? problem(500, "INTERNAL") : { status: 200, body: detail() },
      }).client,
    );
    const alert = await screen.findByRole("alert");
    expect(plain(alert.textContent)).toContain("✕ Помилка");
    expect(plain(alert.textContent)).toContain("Не вдалося завантажити рахунок.");
    expect(plain(alert.textContent)).toContain(`Код: ${SUPPORT_ID}`);
    fireEvent.click(within(alert).getByRole("button", { name: "Спробувати ще раз" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Щоденний" })).toBeTruthy();
  });

  it("S-053 a block that fails keeps the rest of the card: «Не вдалося показати картку. Решта сторінки працює.»", async () => {
    renderAt(at, api({ "/v1/recurring/payments": problem(503, "MODULE_UNAVAILABLE") }).client);
    const block = await screen.findByRole("region", { name: "Регулярні платежі" });
    expect(plain((await within(block).findByRole("alert")).textContent)).toContain(
      "Не вдалося показати картку. Решта сторінки працює.",
    );
    await within(card("Транзакції")).findByText("Магазин 1");
    expect(plain(card("Баланс").textContent)).toContain("5 200,00 €");
  });

  it("S-053 a category that cannot be read is the block's error, never a wrong «Без категорії»", async () => {
    renderAt(at, api({ category: problem(500, "INTERNAL") }).client);
    const block = await screen.findByRole("region", { name: "Транзакції" });
    expect(await within(block).findByRole("alert")).toBeTruthy();
    expect(within(block).queryByText("Без категорії")).toBeNull();
  });

  it("FIN-12@PoC AC6 (screen): an account of another space or none at all is «Сторінку не знайдено» without its name, amounts or counts", async () => {
    const fake = api({ [`/v1/accounts/${ACCOUNT_ID}`]: problem(404, "NOT_FOUND") });
    renderAt(at, fake.client);
    expect(await screen.findByRole("heading", { level: 1, name: "Сторінку не знайдено" })).toBeTruthy();
    expect(screen.queryByText(/€/)).toBeNull();
    expect(fake.urls.some((u) => u.pathname === "/v1/transactions")).toBe(false);
  });

  it("FIN-12@PoC FR 8 (screen): a closed account shows «Закритий» and offers no «Імпортувати виписку»", async () => {
    renderAt(
      at,
      api({
        [`/v1/accounts/${ACCOUNT_ID}`]: {
          status: 200,
          body: detail({ status: "closed", closedOn: "2026-09-30" }),
        },
      }).client,
    );
    const h1 = await screen.findByRole("heading", { level: 1 });
    expect(plain(h1.textContent)).toContain("Щоденний");
    expect(within(h1).getByText("Закритий")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Імпортувати виписку" })).toBeNull();
    expect(screen.getByRole("link", { name: "Налаштування рахунку" })).toBeTruthy();
  });

  it("S-053 route: `/money/accounts/<id>` is the card, `/money/accounts/new` and the settings path are not", () => {
    expect(accountIdOf(`/money/accounts/${ACCOUNT_ID}`)).toBe(ACCOUNT_ID);
    expect(accountIdOf("/money/accounts/new")).toBeNull();
    expect(accountIdOf(`/money/accounts/${ACCOUNT_ID}/settings`)).toBeNull();
    expect(accountPath(ACCOUNT_ID)).toBe(`/money/accounts/${ACCOUNT_ID}`);
    const route = resolveRoute(`/money/accounts/${ACCOUNT_ID}`);
    expect(route.kind === "child" && route.child.id).toBe("account");
  });
});
