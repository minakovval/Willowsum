import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { installMatchMedia } from "@willowsum/ui/test-utils";
import { createAuthClient } from "../auth/api.ts";
import { plain, problem, renderAt, resetAuthState, SUPPORT_ID, type Reply } from "../auth/testing.tsx";
import type { Account } from "./api.ts";
import type { AccountDetail } from "./card.ts";

/**
 * FIN-12@PoC d) and GRID-02@PoC FR 15 — the «…» menu of S-053 «Картка рахунку», S-055 «Закрити рахунок» on
 * `GET …/closing` and `POST …/close`, S-055a «Оновити залишок» on `POST …/balance` (canvas PocMoneyAccount,
 * PocMoneyCloseAcc, PocMoneyAccBalance and their «Тексти» boards). Synthetic data only; the clock is fixed.
 */
const dir = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(dir, "account-card.css"), "utf8").replace(/\s+/g, " ");
const eur = (amount: string) => ({ amount, currency: "EUR" });

const ACCOUNT_ID = "00000000-0000-4000-8000-000000000001";
const SAVINGS_ID = "00000000-0000-4000-8000-000000000002";
const UAH_ID = "00000000-0000-4000-8000-000000000003";
const TODAY = "2026-11-02";
const at = `#/money/accounts/${ACCOUNT_ID}`;

function detail(over: Partial<AccountDetail> = {}): AccountDetail {
  return {
    id: ACCOUNT_ID,
    kind: "current",
    group: "cash",
    name: "Поточний",
    institution: { name: "monobank", country: "UA" },
    number: { last4: "4417", masked: "••4417" },
    note: null,
    status: "active",
    closedOn: null,
    source: "import",
    openedOn: "2021-03-14",
    owners: [],
    currencies: [{ currency: "EUR", balance: eur("5200.00"), balanceDate: TODAY }],
    adjustments: [],
    savings: null,
    deposit: null,
    creditCard: null,
    loan: null,
    ...over,
  } as AccountDetail;
}

function row(id: string, name: string, currency: string, over: Partial<Account> = {}): Account {
  return {
    id,
    kind: "savings",
    group: "cash",
    name,
    institution: { name: "ПриватБанк", country: "UA" },
    number: { last4: "1180", masked: "••1180" },
    status: "active",
    closedOn: null,
    source: "manual",
    updatedOn: TODAY,
    inProfileCurrency: { total: eur("100.00"), approximate: false, unavailableCount: 0 },
    currencies: [{ currency, amount: { amount: "100.00", currency }, equivalent: null }],
    creditCard: null,
    loan: null,
    ...over,
  } as Account;
}

type Handler = Reply | ((url: URL, body: unknown) => Reply | Promise<Reply>);
interface Sent {
  readonly method: string;
  readonly url: URL;
  readonly body: unknown;
}

/** A fake API: handlers by «METHOD /path»; every request is recorded with its JSON body. */
function api(over: Record<string, Handler> = {}) {
  const sent: Sent[] = [];
  const handlers: Record<string, Handler> = {
    [`GET /v1/accounts/${ACCOUNT_ID}`]: { status: 200, body: detail() },
    "GET /v1/transactions": {
      status: 200,
      body: { items: [], page: 1, pageSize: 25, count: 0, from: 0, to: 0, summary: null },
    },
    "GET /v1/recurring/payments": { status: 200, body: { items: [] } },
    "GET /v1/accounts": {
      status: 200,
      body: {
        items: [
          row(ACCOUNT_ID, "Поточний", "EUR"),
          row(SAVINGS_ID, "Ощадний", "EUR"),
          row(UAH_ID, "Гривневий", "UAH"),
        ],
        nextCursor: null,
      },
    },
    [`GET /v1/accounts/${ACCOUNT_ID}/closing`]: (url) => ({
      status: 200,
      body: {
        closedOn: url.searchParams.get("closedOn"),
        zero: false,
        currencies: [{ currency: "EUR", balance: eur("430.00") }],
      },
    }),
    [`POST /v1/accounts/${ACCOUNT_ID}/close`]: { status: 200, body: detail({ status: "closed" }) },
    [`POST /v1/accounts/${ACCOUNT_ID}/balance`]: {
      status: 200,
      body: { changed: true, adjustment: null, balance: eur("5150.00") },
    },
    ...over,
  };
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    const text = request.method === "GET" ? "" : await request.text();
    const body: unknown = text ? JSON.parse(text) : undefined;
    sent.push({ method: request.method, url, body });
    const handler = handlers[`${request.method} ${url.pathname}`];
    const reply = typeof handler === "function" ? await handler(url, body) : handler;
    if (reply === undefined || reply === "network") return new Response(null, { status: 599 });
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
      status: reply.status,
      headers: { "content-type": "application/json", ...reply.headers },
    });
  };
  return { client: createAuthClient(fetchImpl as typeof fetch), sent };
}

const posts = (sent: readonly Sent[], suffix: string) =>
  sent.filter((s) => s.method === "POST" && s.url.pathname.endsWith(suffix));

async function openMenuItem(name: string) {
  const more = await screen.findByRole("button", { name: "Ще дії" });
  fireEvent.click(more);
  fireEvent.click(screen.getByRole("menuitem", { name }));
  return more;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${TODAY}T10:00:00Z`));
  installMatchMedia({ width: 1280 });
  resetAuthState();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("FIN-12@PoC d) the «…» menu of S-053", () => {
  it("GRID-02@PoC AC9: the heading has «…» «Ще дії» (a menu button) beside the gear and «Імпортувати виписку»", async () => {
    renderAt(at, api().client);
    const more = await screen.findByRole("button", { name: "Ще дії" });
    expect(more.getAttribute("aria-haspopup")).toBe("menu");
    expect(more.getAttribute("title")).toBe("Ще дії");
    expect(more.textContent).toBe("");
    const actions = more.closest(".accounts-head-actions")!;
    expect(within(actions as HTMLElement).getByRole("link", { name: "Налаштування рахунку" })).toBeTruthy();
    expect(within(actions as HTMLElement).getByRole("link", { name: "Імпортувати виписку" })).toBeTruthy();
  });

  it("GRID-02@PoC FR 15: «Оновити залишок», then «Закрити рахунок» last, dangerous, after a separator", async () => {
    renderAt(at, api().client);
    fireEvent.click(await screen.findByRole("button", { name: "Ще дії" }));
    const menu = screen.getByRole("menu", { name: "Ще дії" });
    const items = within(menu).getAllByRole("menuitem");
    expect(items.map((i) => plain(i.textContent))).toEqual(["Оновити залишок", "Закрити рахунок"]);
    expect(items[1]!.getAttribute("data-tone")).toBe("danger");
    expect(within(menu).getByRole("separator")).toBeTruthy();
  });

  it("FIN-12@PoC FR 8 (screen): a closed account has no «…» — no «Оновити залишок» (FR 15) and nothing to close", async () => {
    renderAt(
      at,
      api({
        [`GET /v1/accounts/${ACCOUNT_ID}`]: {
          status: 200,
          body: detail({ status: "closed", closedOn: "2026-09-30" }),
        },
      }).client,
    );
    await screen.findByText("Закритий");
    expect(screen.queryByRole("button", { name: "Ще дії" })).toBeNull();
  });
});

describe("FIN-12@PoC d) S-055a «Оновити залишок»", () => {
  it("CMP-61@PoC AC8: «Оновити залишок» opens as a modal dialog over the page, not as a popover", async () => {
    renderAt(at, api().client);
    await openMenuItem("Оновити залишок");
    const dialog = screen.getByRole("dialog", { name: "Оновити залишок" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.closest(".ws-popover-host")).toBeNull();
    expect(dialog.classList.contains("ws-popover")).toBe(false);
  });

  it("FIN-12@PoC AC13 (screen): 5 200,00 € in Willowsum, 5 150,00 € entered — the difference −50,00 €, one request, the card reads again", async () => {
    const fake = api();
    renderAt(at, fake.client);
    await openMenuItem("Оновити залишок");
    const dialog = screen.getByRole("dialog", { name: "Оновити залишок" });
    expect(plain(dialog.textContent)).toContain("Поточний ··4417 · monobank");
    expect(plain(dialog.textContent)).toContain("Зараз у Willowsum · на 2 листопада");
    expect(plain(dialog.textContent)).toContain("5 200,00 €");
    const field = within(dialog).getByRole("textbox", { name: /Поточний залишок/ });
    expect(document.activeElement).toBe(field);
    fireEvent.change(field, { target: { value: "5150" } });
    expect(plain(dialog.querySelector(".abal-diff")?.textContent)).toBe(
      "Різниця стане транзакцією «Коригування залишку» · не входить у доходи й витрати−50,00 €",
    );
    const reads = fake.sent.filter(
      (s) => s.method === "GET" && s.url.pathname === `/v1/accounts/${ACCOUNT_ID}`,
    );
    expect(reads).toHaveLength(1);
    fireEvent.click(within(dialog).getByRole("button", { name: "Оновити залишок" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(posts(fake.sent, "/balance").map((s) => s.body)).toEqual([{ balance: eur("5150.00") }]);
    await waitFor(() =>
      expect(
        fake.sent.filter((s) => s.method === "GET" && s.url.pathname === `/v1/accounts/${ACCOUNT_ID}`),
      ).toHaveLength(2),
    );
  });

  it("FIN-12@PoC FR 15 (screen): an account with import explains the recount on the next statement; a manual one does not", async () => {
    renderAt(at, api().client);
    await openMenuItem("Оновити залишок");
    expect(plain(screen.getByRole("note").textContent)).toBe(
      "Рахунок з імпортом. Під час наступного імпорту виписки з кінцевим залишком коригування буде перераховано: якщо залишки збіжуться, його буде видалено, інакше — змінено на нову різницю.",
    );
  });

  it("FIN-12@PoC AC14 (screen): a manual account — no recount note; the entered balance is sent as it is, the server changes the one adjustment", async () => {
    const fake = api({
      [`GET /v1/accounts/${ACCOUNT_ID}`]: {
        status: 200,
        body: detail({
          kind: "cash",
          name: "Готівка",
          institution: null,
          number: null,
          source: "manual",
          currencies: [{ currency: "EUR", balance: eur("300.00"), balanceDate: TODAY }],
        }),
      },
    });
    renderAt(at, fake.client);
    await openMenuItem("Оновити залишок");
    const dialog = screen.getByRole("dialog", { name: "Оновити залишок" });
    expect(within(dialog).queryByRole("note")).toBeNull();
    fireEvent.change(within(dialog).getByRole("textbox", { name: /Поточний залишок/ }), {
      target: { value: "250" },
    });
    expect(plain(dialog.querySelector(".abal-diff b")?.textContent)).toBe("−50,00 €");
    fireEvent.click(within(dialog).getByRole("button", { name: "Оновити залишок" }));
    await waitFor(() => expect(posts(fake.sent, "/balance")).toHaveLength(1));
    expect(posts(fake.sent, "/balance")[0]!.body).toEqual({ balance: eur("250.00") });
  });

  it("FIN-12@PoC AC16 (screen): the same balance — the difference is 0,00 € without a sign", async () => {
    renderAt(at, api().client);
    await openMenuItem("Оновити залишок");
    const dialog = screen.getByRole("dialog", { name: "Оновити залишок" });
    fireEvent.change(within(dialog).getByRole("textbox", { name: /Поточний залишок/ }), {
      target: { value: "5200,00" },
    });
    expect(plain(dialog.querySelector(".abal-diff b")?.textContent)).toBe("0,00 €");
  });

  it("S-055a: an empty «Поточний залишок» is an error on the field and nothing is sent", async () => {
    const fake = api();
    renderAt(at, fake.client);
    await openMenuItem("Оновити залишок");
    const dialog = screen.getByRole("dialog", { name: "Оновити залишок" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Оновити залишок" }));
    expect(plain(dialog.textContent)).toContain("Введіть поточний залишок.");
    expect(posts(fake.sent, "/balance")).toHaveLength(0);
  });

  it("S-055a error: the dialog stays with «Помилка…» and «Код: …»; Esc closes it and focus returns to «…»", async () => {
    renderAt(at, api({ [`POST /v1/accounts/${ACCOUNT_ID}/balance`]: problem(500, "INTERNAL") }).client);
    const more = await openMenuItem("Оновити залишок");
    const dialog = screen.getByRole("dialog", { name: "Оновити залишок" });
    fireEvent.change(within(dialog).getByRole("textbox", { name: /Поточний залишок/ }), {
      target: { value: "5150" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Оновити залишок" }));
    const alert = await within(dialog).findByRole("alert");
    expect(plain(alert.textContent)).toContain("Помилка. Не вдалося оновити залишок. Спробуйте ще раз.");
    expect(plain(alert.textContent)).toContain(`Код: ${SUPPORT_ID}`);
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(more);
  });

  it("FIN-12@PoC AC17 (screen): «не знайдено» from the server — the card reads again and shows «Сторінку не знайдено» without amounts", async () => {
    let reads = 0;
    renderAt(
      at,
      api({
        [`GET /v1/accounts/${ACCOUNT_ID}`]: () =>
          ++reads === 1 ? { status: 200, body: detail() } : problem(404, "NOT_FOUND"),
        [`POST /v1/accounts/${ACCOUNT_ID}/balance`]: problem(404, "NOT_FOUND"),
      }).client,
    );
    await openMenuItem("Оновити залишок");
    const dialog = screen.getByRole("dialog", { name: "Оновити залишок" });
    fireEvent.change(within(dialog).getByRole("textbox", { name: /Поточний залишок/ }), {
      target: { value: "5150" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Оновити залишок" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Сторінку не знайдено" })).toBeTruthy();
    expect(screen.queryByText(/€/)).toBeNull();
  });

  it("S-055a: a multi-currency account picks the currency; the balance and the request follow it", async () => {
    const fake = api({
      [`GET /v1/accounts/${ACCOUNT_ID}`]: {
        status: 200,
        body: detail({
          currencies: [
            { currency: "EUR", balance: eur("5200.00"), balanceDate: TODAY },
            { currency: "UAH", balance: { amount: "4300.00", currency: "UAH" }, balanceDate: TODAY },
          ],
        }),
      },
    });
    renderAt(at, fake.client);
    await openMenuItem("Оновити залишок");
    const dialog = screen.getByRole("dialog", { name: "Оновити залишок" });
    fireEvent.change(within(dialog).getByRole("combobox", { name: /Валюта/ }), { target: { value: "UAH" } });
    expect(plain(dialog.querySelector(".abal-now b")?.textContent)).toBe("4 300,00 ₴");
    fireEvent.change(within(dialog).getByRole("textbox", { name: /Поточний залишок/ }), {
      target: { value: "4400" },
    });
    expect(plain(dialog.querySelector(".abal-diff b")?.textContent)).toBe("+100,00 ₴");
    fireEvent.click(within(dialog).getByRole("button", { name: "Оновити залишок" }));
    await waitFor(() => expect(posts(fake.sent, "/balance")).toHaveLength(1));
    expect(posts(fake.sent, "/balance")[0]!.body).toEqual({
      balance: { amount: "4400.00", currency: "UAH" },
    });
  });
});

describe("FIN-12@PoC d) S-055 «Закрити рахунок»", () => {
  it("FIN-12@PoC AC4 (screen): 430 EUR on the date — the choice; «Перенести на інший рахунок» to «Ощадний» closes in one request and goes to «Рахунки»", async () => {
    const fake = api();
    renderAt(at, fake.client);
    await openMenuItem("Закрити рахунок");
    const dialog = screen.getByRole("dialog", { name: "Закрити рахунок «Поточний»" });
    expect(plain(dialog.textContent)).toContain(
      "Рахунок лишиться в історії до дати закриття і в списку через «Показати закриті».",
    );
    const date = within(dialog).getByLabelText(/Дата закриття/) as HTMLInputElement;
    expect(date.type).toBe("date");
    expect(date.value).toBe(TODAY);
    await waitFor(() =>
      expect(plain(dialog.querySelector(".aclose-balance")?.textContent)).toBe("Залишок на цю дату430,00 €"),
    );
    const closing = fake.sent.find((s) => s.url.pathname.endsWith("/closing"))!;
    expect(closing.url.searchParams.get("closedOn")).toBe(TODAY);
    const group = within(dialog).getByRole("group", { name: "Що зробити із залишком?" });
    const transfer = within(group).getByRole("radio", { name: /Перенести на інший рахунок/ });
    expect((transfer as HTMLInputElement).checked).toBe(true);
    expect(within(group).getByRole("radio", { name: /Списати коригуванням/ })).toBeTruthy();
    expect(within(group).queryByText(/лише приховати/)).toBeNull();
    const target = await within(group).findByRole("combobox", { name: /Рахунок для переказу/ });
    // Another active account with the same currency only: not this one, not the UAH one.
    await waitFor(() =>
      expect(
        within(target)
          .getAllByRole("option")
          .slice(1)
          .map((o) => o.textContent),
      ).toEqual(["Ощадний ··1180 · ПриватБанк"]),
    );
    fireEvent.change(target, { target: { value: SAVINGS_ID } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Перенести і закрити" }));
    await waitFor(() => expect(window.location.hash).toBe("#/money/accounts"));
    expect(posts(fake.sent, "/close").map((s) => s.body)).toEqual([
      { closedOn: TODAY, settlement: { kind: "transfer", toAccountId: SAVINGS_ID } },
    ]);
  });

  it("FIN-12@PoC FR 7 (screen): «Списати коригуванням» sends the write-off; no account is asked for", async () => {
    const fake = api();
    renderAt(at, fake.client);
    await openMenuItem("Закрити рахунок");
    const dialog = screen.getByRole("dialog", { name: "Закрити рахунок «Поточний»" });
    fireEvent.click(await within(dialog).findByRole("radio", { name: /Списати коригуванням/ }));
    expect(within(dialog).queryByRole("combobox")).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Списати і закрити" }));
    await waitFor(() => expect(posts(fake.sent, "/close")).toHaveLength(1));
    expect(posts(fake.sent, "/close")[0]!.body).toEqual({
      closedOn: TODAY,
      settlement: { kind: "adjustment" },
    });
  });

  it("FIN-12@PoC FR 7 (screen): the transfer without a chosen account asks for one and sends nothing", async () => {
    const fake = api();
    renderAt(at, fake.client);
    await openMenuItem("Закрити рахунок");
    const dialog = screen.getByRole("dialog", { name: "Закрити рахунок «Поточний»" });
    await within(dialog).findByRole("combobox", { name: /Рахунок для переказу/ });
    await waitFor(() => expect(plain(dialog.textContent)).toContain("430,00 €"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Перенести і закрити" }));
    expect(plain(dialog.textContent)).toContain("Оберіть рахунок для переказу.");
    expect(posts(fake.sent, "/close")).toHaveLength(0);
  });

  it("FIN-12@PoC AC4 (screen): no other active account in the currency — the transfer is unavailable with the reason, the write-off is chosen", async () => {
    renderAt(
      at,
      api({
        "GET /v1/accounts": {
          status: 200,
          body: {
            items: [row(ACCOUNT_ID, "Поточний", "EUR"), row(UAH_ID, "Гривневий", "UAH")],
            nextCursor: null,
          },
        },
      }).client,
    );
    await openMenuItem("Закрити рахунок");
    const dialog = screen.getByRole("dialog", { name: "Закрити рахунок «Поточний»" });
    const transfer = await within(dialog).findByRole("radio", { name: /Перенести на інший рахунок/ });
    await waitFor(() => expect((transfer as HTMLInputElement).disabled).toBe(true));
    expect(
      (within(dialog).getByRole("radio", { name: /Списати коригуванням/ }) as HTMLInputElement).checked,
    ).toBe(true);
    expect(plain(dialog.textContent)).toContain("Немає іншого активного рахунку у валюті EUR.");
    expect(within(dialog).getByRole("button", { name: "Списати і закрити" })).toBeTruthy();
  });

  it("FIN-12@PoC AC3 (screen): a zero balance on 2026-09-30 — no choice, «Закрити рахунок» closes on that date", async () => {
    const fake = api({
      [`GET /v1/accounts/${ACCOUNT_ID}/closing`]: (url) => ({
        status: 200,
        body: {
          closedOn: url.searchParams.get("closedOn"),
          zero: true,
          currencies: [{ currency: "EUR", balance: eur("0.00") }],
        },
      }),
    });
    renderAt(at, fake.client);
    await openMenuItem("Закрити рахунок");
    const dialog = screen.getByRole("dialog", { name: "Закрити рахунок «Поточний»" });
    fireEvent.change(within(dialog).getByLabelText(/Дата закриття/), { target: { value: "2026-09-30" } });
    await waitFor(() =>
      expect(fake.sent.some((s) => s.url.searchParams.get("closedOn") === "2026-09-30")).toBe(true),
    );
    await waitFor(() => expect(plain(dialog.querySelector(".aclose-balance b")?.textContent)).toBe("0,00 €"));
    expect(within(dialog).queryByRole("radio")).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Закрити рахунок" }));
    await waitFor(() => expect(posts(fake.sent, "/close")).toHaveLength(1));
    expect(posts(fake.sent, "/close")[0]!.body).toEqual({ closedOn: "2026-09-30" });
  });

  it("FIN-01@PoC EC4 (screen): a date before the last transaction — «Після дати закриття є транзакції» on the field, the action inactive", async () => {
    const fake = api({
      [`GET /v1/accounts/${ACCOUNT_ID}/closing`]: problem(409, "ACCOUNT_ACTIVITY_AFTER_CLOSE"),
    });
    renderAt(at, fake.client);
    await openMenuItem("Закрити рахунок");
    const dialog = screen.getByRole("dialog", { name: "Закрити рахунок «Поточний»" });
    await waitFor(() => expect(plain(dialog.textContent)).toContain("Після дати закриття є транзакції"));
    const action = within(dialog).getByRole("button", { name: "Закрити рахунок" });
    expect(action.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(action);
    expect(posts(fake.sent, "/close")).toHaveLength(0);
  });

  it("S-055: a date in the future is the field's error from the server's answer", async () => {
    renderAt(
      at,
      api({
        [`GET /v1/accounts/${ACCOUNT_ID}/closing`]: {
          status: 400,
          body: {
            type: "about:blank",
            title: "Bad Request",
            status: 400,
            code: "VALIDATION_FAILED",
            errors: [{ in: "query", path: "closedOn", issue: "in_future" }],
          },
          headers: { "content-type": "application/problem+json" },
        },
      }).client,
    );
    await openMenuItem("Закрити рахунок");
    const dialog = screen.getByRole("dialog", { name: "Закрити рахунок «Поточний»" });
    await waitFor(() =>
      expect(plain(dialog.textContent)).toContain("Дата закриття не може бути в майбутньому."),
    );
  });

  it("S-055: postings still pending — the dialog stays with what to do; nothing is closed on the screen", async () => {
    renderAt(
      at,
      api({ [`POST /v1/accounts/${ACCOUNT_ID}/close`]: problem(409, "ACCOUNT_POSTINGS_PENDING") }).client,
    );
    await openMenuItem("Закрити рахунок");
    const dialog = screen.getByRole("dialog", { name: "Закрити рахунок «Поточний»" });
    fireEvent.click(await within(dialog).findByRole("radio", { name: /Списати коригуванням/ }));
    await waitFor(() => expect(plain(dialog.textContent)).toContain("430,00 €"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Списати і закрити" }));
    const alert = await within(dialog).findByRole("alert");
    expect(plain(alert.textContent)).toContain("Частина транзакцій рахунку ще проводиться");
    expect(window.location.hash).toBe(at);
  });

  it("S-055 loading and error of the balance: a skeleton, then «Помилка…», «Код: …» and «Спробувати ще раз» reads it again", async () => {
    let calls = 0;
    renderAt(
      at,
      api({
        [`GET /v1/accounts/${ACCOUNT_ID}/closing`]: (url) =>
          ++calls === 1
            ? problem(500, "INTERNAL")
            : {
                status: 200,
                body: {
                  closedOn: url.searchParams.get("closedOn"),
                  zero: false,
                  currencies: [{ currency: "EUR", balance: eur("430.00") }],
                },
              },
      }).client,
    );
    await openMenuItem("Закрити рахунок");
    const dialog = screen.getByRole("dialog", { name: "Закрити рахунок «Поточний»" });
    const alert = await within(dialog).findByRole("alert");
    expect(plain(alert.textContent)).toContain("Помилка. Не вдалося показати залишок на цю дату.");
    expect(plain(alert.textContent)).toContain(`Код: ${SUPPORT_ID}`);
    fireEvent.click(within(alert).getByRole("button", { name: "Спробувати ще раз" }));
    await waitFor(() =>
      expect(plain(dialog.querySelector(".aclose-balance b")?.textContent)).toBe("430,00 €"),
    );
  });

  it("FIN-12@PoC AC6 (screen): «не знайдено» on closing — the card reads again and shows «Сторінку не знайдено» without its name", async () => {
    let reads = 0;
    renderAt(
      at,
      api({
        [`GET /v1/accounts/${ACCOUNT_ID}`]: () =>
          ++reads === 1 ? { status: 200, body: detail() } : problem(404, "NOT_FOUND"),
        [`POST /v1/accounts/${ACCOUNT_ID}/close`]: problem(404, "NOT_FOUND"),
      }).client,
    );
    await openMenuItem("Закрити рахунок");
    const dialog = screen.getByRole("dialog", { name: "Закрити рахунок «Поточний»" });
    fireEvent.click(await within(dialog).findByRole("radio", { name: /Списати коригуванням/ }));
    await waitFor(() => expect(plain(dialog.textContent)).toContain("430,00 €"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Списати і закрити" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Сторінку не знайдено" })).toBeTruthy();
    expect(screen.queryByText("Поточний")).toBeNull();
  });

  it("S-055 styles: the chosen option has the 2 px `brand-2` border on `tint-info` (tokens only)", () => {
    expect(css).toContain(
      ".aclose-option[data-checked] { border-color: var(--ws-brand-2); box-shadow: inset 0 0 0 1px var(--ws-brand-2); background: var(--ws-tint-info); }",
    );
    expect(css).toContain(
      ".abal-diff { background: transparent; border: 1px dashed var(--ws-border-control); }",
    );
  });
});

describe("FIN-12@PoC d) S-055a amounts out of range", () => {
  it("S-055a: a 21-digit «Поточний залишок» does not take the page down", async () => {
    const fake = api();
    renderAt(at, fake.client);
    await openMenuItem("Оновити залишок");
    const dialog = screen.getByRole("dialog", { name: "Оновити залишок" });
    const field = within(dialog).getByRole("textbox", { name: /Поточний залишок/ });
    fireEvent.change(field, { target: { value: "123456789012345678901" } });
    expect(screen.queryByRole("dialog", { name: "Оновити залишок" })).not.toBeNull();
  });
});

describe("FIN-12@PoC d) S-055a on a debt (review round 1, B1)", () => {
  it("FIN-12@PoC FR 15 (screen): a credit card's debt 640,00 € → 600,00 € shows +40,00 € and sends 600.00", async () => {
    const fake = api({
      [`GET /v1/accounts/${ACCOUNT_ID}`]: {
        status: 200,
        body: detail({
          kind: "credit-card",
          group: "credit",
          name: "Кредитка",
          source: "manual",
          currencies: [{ currency: "EUR", balance: eur("-640.00"), balanceDate: TODAY }],
        }),
      },
    });
    renderAt(at, fake.client);
    await openMenuItem("Оновити залишок");
    const dialog = screen.getByRole("dialog", { name: "Оновити залишок" });
    // The debt is shown the way the field asks for it: a positive amount.
    expect(plain(dialog.querySelector(".abal-now b")?.textContent)).toBe("640,00 €");
    const field = within(dialog).getByRole("textbox", { name: /Поточний залишок/ });
    expect(plain(dialog.textContent)).toContain("Сума боргу, яку ви бачите в банку зараз");
    fireEvent.change(field, { target: { value: "600" } });
    expect(plain(dialog.querySelector(".abal-diff b")?.textContent)).toBe("+40,00 €");
    fireEvent.click(within(dialog).getByRole("button", { name: "Оновити залишок" }));
    await waitFor(() => expect(posts(fake.sent, "/balance")).toHaveLength(1));
    expect(posts(fake.sent, "/balance")[0]!.body).toEqual({ balance: eur("600.00") });
  });

  it("FIN-12@PoC FR 15 (screen): a loan's debt 12 000,00 € → 12 310,00 € shows −310,00 €", async () => {
    renderAt(
      at,
      api({
        [`GET /v1/accounts/${ACCOUNT_ID}`]: {
          status: 200,
          body: detail({
            kind: "loan",
            group: "credit",
            name: "Кредит",
            source: "manual",
            currencies: [{ currency: "EUR", balance: eur("-12000.00"), balanceDate: TODAY }],
          }),
        },
      }).client,
    );
    await openMenuItem("Оновити залишок");
    const dialog = screen.getByRole("dialog", { name: "Оновити залишок" });
    fireEvent.change(within(dialog).getByRole("textbox", { name: /Поточний залишок/ }), {
      target: { value: "12310" },
    });
    expect(plain(dialog.querySelector(".abal-diff b")?.textContent)).toBe("−310,00 €");
  });
});

describe("FIN-12@PoC d) S-055a a negative debt (#454, reviewer patch of #445)", () => {
  it("FIN-12@PoC FR 15 (screen): −600 typed for a credit card's debt — no difference shown, the server's refusal is on the field", async () => {
    const fake = api({
      [`GET /v1/accounts/${ACCOUNT_ID}`]: {
        status: 200,
        body: detail({
          kind: "credit-card",
          group: "credit",
          source: "manual",
          currencies: [{ currency: "EUR", balance: eur("-640.00"), balanceDate: TODAY }],
        }),
      },
      [`POST /v1/accounts/${ACCOUNT_ID}/balance`]: {
        status: 400,
        body: {
          type: "urn:willowsum:problem:validation_failed",
          title: "VALIDATION_FAILED",
          status: 400,
          code: "VALIDATION_FAILED",
          errors: [{ path: "balance.amount", issue: "invalid" }],
        },
      },
    });
    renderAt(at, fake.client);
    await openMenuItem("Оновити залишок");
    const dialog = screen.getByRole("dialog", { name: "Оновити залишок" });
    fireEvent.change(within(dialog).getByRole("textbox", { name: /Поточний залишок/ }), {
      target: { value: "-600" },
    });
    expect(plain(dialog.querySelector(".abal-diff b")?.textContent)).toBe("—");
    fireEvent.click(within(dialog).getByRole("button", { name: "Оновити залишок" }));
    expect(await within(dialog).findByText(/борг вводиться додатною сумою/)).toBeTruthy();
    // The field's error, not the dialog's generic one.
    expect(plain(dialog.textContent)).not.toContain("Не вдалося оновити залишок");
  });
});
