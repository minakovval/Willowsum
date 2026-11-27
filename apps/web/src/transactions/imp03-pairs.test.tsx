import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { installMatchMedia } from "@willowsum/ui/test-utils";
import { fakeApi, plain, renderAt, resetAuthState, SUPPORT_ID, type Reply } from "../auth/testing.tsx";
import { resetNavigationSession } from "../routing/session.ts";
import { resetReviewCount } from "./reviewCount.ts";

/**
 * IMP-03@PoC c) (wave 2, row 139): S-059 «Пари» (canvas PocMoneyPairs, texts PocMoneyPairsTexts) and «Позначити як
 * переказ» in S-047 (FR 24) on the merged server part (#749). The fake API answers as the server does. Synthetic data only.
 */
const CURRENT = "00000000-0000-4000-8000-000000000001";
const SAVINGS = "00000000-0000-4000-8000-000000000002";
const MULTI = "00000000-0000-4000-8000-000000000003";
const OUT = "00000000-0000-4000-8000-0000000000a1";
const INN = "00000000-0000-4000-8000-0000000000a2";
const OUT2 = "00000000-0000-4000-8000-0000000000b1";
const INN2 = "00000000-0000-4000-8000-0000000000b2";
const eur = (amount: string) => ({ amount, currency: "EUR" });

function account(id: string, name: string, last4: string) {
  return {
    id,
    kind: "current",
    group: "cash",
    name,
    institution: null,
    number: { last4, masked: `••${last4}` },
    status: "active",
    closedOn: null,
    source: "manual",
    updatedOn: "2026-10-31",
    favourite: false,
    inProfileCurrency: { total: eur("1.00"), approximate: false, unavailableCount: 0 },
    currencies: [],
    creditCard: null,
    loan: null,
  };
}
const ACCOUNTS = {
  items: [
    account(CURRENT, "Поточний", "4417"),
    account(SAVINGS, "Ощадний", "1180"),
    account(MULTI, "Мультивалютний", "7730"),
  ],
  nextCursor: null,
};

type Proposal = Record<string, unknown>;
function proposal(over: Proposal = {}): Proposal {
  return {
    ambiguousWith: [],
    bankRate: null,
    confidence: "high",
    converted: null,
    date: "2026-10-31",
    difference: null,
    evidence: [
      { code: "exact-amount", days: null, points: 40 },
      { code: "same-day", days: null, points: 10 },
    ],
    fee: null,
    inflow: { accountId: SAVINGS, amount: eur("200.00"), date: "2026-10-31", transactionId: INN },
    kind: "same-currency",
    outflow: { accountId: CURRENT, amount: eur("-200.00"), date: "2026-10-31", transactionId: OUT },
    pairKind: "transfer",
    rate: null,
    rateBand: null,
    score: 92,
    ...over,
  };
}
const FEE_PAIR = proposal({
  inflow: { accountId: SAVINGS, amount: eur("498.00"), date: "2026-11-01", transactionId: INN2 },
  outflow: { accountId: CURRENT, amount: eur("-500.00"), date: "2026-10-31", transactionId: OUT2 },
  fee: eur("2.00"),
  difference: eur("-2.00"),
  evidence: [
    { code: "amount-less-fee", days: null, points: 30 },
    { code: "days-apart", days: 1, points: 10 },
  ],
  confidence: "medium",
  score: 71,
});
const EXCHANGE = proposal({
  pairKind: "exchange",
  kind: "cross-currency",
  confidence: "medium",
  score: 71,
  outflow: {
    accountId: MULTI,
    amount: { amount: "-500.00", currency: "USD" },
    date: "2026-10-28",
    transactionId: OUT,
  },
  inflow: { accountId: MULTI, amount: eur("458.10"), date: "2026-10-28", transactionId: INN },
  bankRate: "0.9162",
  rate: { date: "2026-10-28", rate: "0.921", source: "nbu" },
  difference: eur("-2.40"),
  evidence: [{ code: "same-wallet-group", days: null, points: 20 }],
});

function proposals(items: Proposal[]): Reply {
  return { status: 200, body: { count: items.length, items, more: false } };
}

function pairsPage(items: Proposal[], extra: Record<string, Reply | ((...a: never[]) => Reply)> = {}) {
  const api = fakeApi({
    "GET /v1/transfer-proposals": proposals(items),
    "GET /v1/transaction-review": { status: 200, body: { count: 0 } },
    "GET /v1/accounts": { status: 200, body: ACCOUNTS },
    ...(extra as Record<string, Reply>),
  });
  renderAt("#/money/transactions/pairs", api.client);
  return api;
}

beforeEach(() => {
  installMatchMedia({ width: 1280 });
  resetAuthState();
  resetNavigationSession();
  resetReviewCount();
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const card = (name: RegExp) => screen.findByRole("article", { name });

describe("IMP-03@PoC FR 17, FR 18, FR 20: the tab «Пари»", () => {
  it("IMP-03@PoC FR 17: a proposal shows the kind, the confidence with the score, both operations and the evidence", async () => {
    pairsPage([proposal()]);
    const c = await card(/Переказ/);
    expect(within(c).getByRole("heading", { name: "Переказ" })).toBeTruthy();
    expect(plain(c.textContent)).toContain("Висока упевненість · 92");
    expect(plain(c.textContent)).toContain("Поточний ··4417");
    expect(plain(c.textContent)).toContain("Ощадний ··1180");
    expect(within(c).getByLabelText("мінус 200,00 євро")).toBeTruthy();
    expect(within(c).getByLabelText("плюс 200,00 євро")).toBeTruthy();
    expect(within(c).getByText("однакова сума")).toBeTruthy();
    expect(within(c).getByText("той самий день")).toBeTruthy();
    expect(within(c).getByRole("button", { name: "Підтвердити" })).toBeTruthy();
    expect(within(c).getByRole("button", { name: "Не пара" })).toBeTruthy();
  });

  it("IMP-03@PoC FR 20: the parts are a radio group with the count in the name, not tabs; the tab shows «Пари · N»", async () => {
    pairsPage([proposal(), FEE_PAIR]);
    const group = await screen.findByRole("group", { name: /Частини вкладки/ });
    expect(within(group).getByRole("radio", { name: "Пропозиції · 2" }).hasAttribute("checked")).toBe(true);
    expect(within(group).getByRole("radio", { name: "Односторонні" })).toBeTruthy();
    expect(within(group).getByRole("radio", { name: "Підтверджені" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Пари · 2" })).toBeTruthy();
  });

  it("IMP-03@PoC FR 20: a segment is chosen with the keyboard (arrows), as any radio group", async () => {
    pairsPage([proposal()]);
    const proposalsRadio = await screen.findByRole("radio", { name: "Пропозиції · 1" });
    proposalsRadio.focus();
    fireEvent.click(screen.getByRole("radio", { name: "Односторонні" }));
    expect(screen.getByText(/друга частина якого на рахунку поза Willowsum/)).toBeTruthy();
    expect(screen.queryByRole("article")).toBeNull();
  });

  it("IMP-03@PoC AC22, FR 24: there is no «Поєднати вручну» on the tab", async () => {
    pairsPage([proposal()]);
    await card(/Переказ/);
    expect(screen.queryByText(/Поєднати вручну/)).toBeNull();
    expect(screen.queryByRole("link", { name: /Поєднати вручну/ })).toBeNull();
  });

  it("IMP-03@PoC FR 7: a proposal close in score to others says it is ambiguous", async () => {
    pairsPage([proposal({ ambiguousWith: [{ score: 90, transactionId: INN2 }] })]);
    const c = await card(/Переказ/);
    expect(within(c).getByText(/Неоднозначно з іншими пропозиціями: 1/)).toBeTruthy();
  });

  it("IMP-03@PoC FR 4: the confidence is a word and a symbol, not a colour alone (NFR-08)", async () => {
    pairsPage([FEE_PAIR]);
    const c = await card(/Переказ/);
    const badge = within(c)
      .getByText(/Середня упевненість · 71/)
      .closest(".ws-badge")!;
    expect(badge.textContent).toMatch(/^!/);
  });
});

describe("IMP-03@PoC FR 21, AC16: the difference of a pair", () => {
  it("IMP-03@PoC AC16: −500,00 EUR and +498,00 EUR show «Комісія 2,00 € — стане витратою «Комісії банку»»", async () => {
    pairsPage([FEE_PAIR]);
    const c = await card(/Переказ/);
    expect(plain(c.textContent)).toContain("Комісія 2,00 € — стане витратою «Комісії банку»");
  });

  it("IMP-03@PoC FR 21: a pair with no difference shows no fee row", async () => {
    pairsPage([proposal()]);
    const c = await card(/Переказ/);
    expect(plain(c.textContent)).not.toContain("Комісія");
  });

  it("IMP-03@PoC FR 21: USD→EUR shows the loss at the rate with the bank rate beside the reference one, never «Комісія»", async () => {
    pairsPage([EXCHANGE]);
    const c = await card(/Обмін валют/);
    const text = plain(c.textContent);
    expect(within(c).getByRole("heading", { name: "Обмін валют" })).toBeTruthy();
    expect(text).toContain("Втрата за курсом 2,40 € — стане витратою «Комісії банку»");
    expect(text).toContain("курс банку 0,9162");
    expect(text).toContain("довідковий курс 0,921");
    expect(text).not.toMatch(/Комісія \d/);
    expect(screen.queryByText(/брокер/i)).toBeNull();
  });

  it("IMP-03@PoC FR 21: a gain is an income, said in words", async () => {
    pairsPage([{ ...EXCHANGE, difference: eur("1.10") }]);
    const c = await card(/Обмін валют/);
    expect(plain(c.textContent)).toContain("Виграш за курсом 1,10 € — стане доходом «Комісії банку»");
  });
});

describe("IMP-03@PoC FR 8, FR 12: «Підтвердити» and «Не пара»", () => {
  it("IMP-03@PoC FR 8: «Підтвердити» marks the debit with the credit as its counterpart and the count falls", async () => {
    let left = [proposal()];
    const api = pairsPage([], {
      "GET /v1/transfer-proposals": (() => proposals(left)) as never,
      [`POST /v1/transactions/${OUT}/transfer`]: (() => {
        left = [];
        return { status: 200, body: {} };
      }) as never,
    });
    fireEvent.click(await screen.findByRole("button", { name: "Підтвердити" }));
    await screen.findByText("Пропозицій немає");
    const post = api.calls.find((c) => c.method === "POST")!;
    expect(post.path).toBe(`/v1/transactions/${OUT}/transfer`);
    expect(post.body).toEqual({ counterpartId: INN });
    expect(screen.getByRole("tab", { name: "Пари" })).toBeTruthy();
  });

  it("IMP-03@PoC AC5, FR 12: «Не пара» sends the pair to be never proposed again", async () => {
    let left = [proposal()];
    const api = pairsPage([], {
      "GET /v1/transfer-proposals": (() => proposals(left)) as never,
      [`POST /v1/transactions/${OUT}/not-transfer`]: (() => {
        left = [];
        return { status: 200, body: {} };
      }) as never,
    });
    fireEvent.click(await screen.findByRole("button", { name: "Не пара" }));
    await screen.findByText("Пропозицій немає");
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ counterpartId: INN });
  });

  it("IMP-03@PoC FR 8: a failed action says so with the code and keeps the card", async () => {
    pairsPage([proposal()], {
      [`POST /v1/transactions/${OUT}/transfer`]: {
        status: 500,
        body: { type: "x", title: "x", status: 500, code: "INTERNAL", supportId: SUPPORT_ID },
        headers: { "content-type": "application/problem+json" },
      },
    });
    fireEvent.click(await screen.findByRole("button", { name: "Підтвердити" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(`Код: ${SUPPORT_ID}`);
    expect(screen.getByRole("article")).toBeTruthy();
  });
});

describe("IMP-03@PoC «Стани інтерфейсу»: empty, loading, error", () => {
  it("IMP-03@PoC «Стани інтерфейсу»: empty — «Пропозицій немає» and «Шукати пари знову» that asks again", async () => {
    const api = pairsPage([]);
    await screen.findByRole("heading", { name: "Пропозицій немає" });
    const before = api.calls.filter((c) => c.path === "/v1/transfer-proposals").length;
    fireEvent.click(screen.getAllByRole("button", { name: "Шукати пари знову" })[0]!);
    await waitFor(() =>
      expect(api.calls.filter((c) => c.path === "/v1/transfer-proposals").length).toBeGreaterThan(before),
    );
  });

  it("IMP-03@PoC «Стани інтерфейсу»: loading — a skeleton while the pairs are read", async () => {
    const api = fakeApi({
      "GET /v1/transfer-proposals": () => new Promise<Reply>(() => undefined) as never,
      "GET /v1/transaction-review": { status: 200, body: { count: 0 } },
    });
    renderAt("#/money/transactions/pairs", api.client);
    const busy = await screen.findByLabelText("Пари завантажуються");
    expect(busy.getAttribute("aria-busy")).toBe("true");
  });

  it("IMP-03@PoC «Стани інтерфейсу»: error — «Не вдалося завантажити пари», the code and «Спробувати ще раз»", async () => {
    let fail = true;
    const api = pairsPage([], {
      "GET /v1/transfer-proposals": (() =>
        fail
          ? {
              status: 500,
              body: { type: "x", title: "x", status: 500, code: "INTERNAL", supportId: SUPPORT_ID },
              headers: { "content-type": "application/problem+json" },
            }
          : proposals([proposal()])) as never,
    });
    const alert = await screen.findByText("Не вдалося завантажити пари");
    expect(alert.closest("[role=alert]")!.textContent).toContain(`Код: ${SUPPORT_ID}`);
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Спробувати ще раз" }));
    await card(/Переказ/);
    expect(api.calls.length).toBeGreaterThan(2);
  });

  it("IMP-03@PoC FR 4 (long names): an account of 60+ characters with one long word keeps the amount and the buttons", async () => {
    const LONG = "Дуже довга назва рахунку понад шістдесят символів ЗАВЕЛИКЕСЛОВОБЕЗПРОБІЛІВ0123456789";
    pairsPage([proposal()], {
      "GET /v1/accounts": {
        status: 200,
        body: {
          items: [account(CURRENT, LONG, "4417"), account(SAVINGS, "Ощадний", "1180")],
          nextCursor: null,
        },
      },
    });
    const c = await card(/Переказ/);
    expect(c.textContent).toContain(LONG);
    expect(within(c).getByRole("button", { name: "Підтвердити" })).toBeTruthy();
  });
});

/* «Позначити як переказ» (FR 24) in the details of a transaction. */
const TX = "00000000-0000-4000-8000-0000000000c1";
const C_OK = "00000000-0000-4000-8000-0000000000d1";
const C_USD = "00000000-0000-4000-8000-0000000000d3";

function detailTx(over: Record<string, unknown> = {}) {
  return {
    id: TX,
    accountId: CURRENT,
    amount: eur("-200.00"),
    type: "expense",
    date: "2026-10-10",
    counterparty: "Переказ на ощадний",
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
    oneOff: false,
    review: null,
    version: 1,
    recordedAt: "2026-10-10T09:14:00Z",
    bankDescription: null,
    balanceAfter: null,
    importedFrom: null,
    originalAmount: null,
    exchangeRate: null,
    valueDate: null,
    bankReference: null,
    bankFee: null,
    ...over,
  };
}
function candidate(id: string, over: Record<string, unknown> = {}) {
  return {
    transactionId: id,
    accountId: SAVINGS,
    amount: eur("199.00"),
    bankRate: null,
    converted: null,
    counterparty: "Поповнення",
    date: "2026-10-12",
    description: "Надходження з поточного",
    difference: eur("-1.00"),
    kind: "same-currency",
    markable: true,
    rate: null,
    ...over,
  };
}
function counterparts(items: unknown[]): Reply {
  return {
    status: 200,
    body: {
      items,
      more: false,
      transaction: { accountId: CURRENT, amount: eur("-200.00"), date: "2026-10-10", transactionId: TX },
    },
  };
}

async function openDetail(items: unknown[], row = detailTx(), extra: Record<string, Reply> = {}) {
  const api = fakeApi({
    [`GET /v1/transactions/${TX}`]: { status: 200, body: row },
    [`GET /v1/transactions/${TX}/category`]: {
      status: 200,
      body: { transactionId: TX, categoryId: null, source: "none" },
    },
    "GET /v1/categories": { status: 200, body: { groups: [] } },
    [`GET /v1/accounts/${CURRENT}`]: { status: 200, body: account(CURRENT, "Поточний", "4417") },
    "GET /v1/accounts": { status: 200, body: ACCOUNTS },
    "GET /v1/duplicate-proposals": { status: 200, body: { items: [], count: 0, more: false } },
    "GET /v1/transaction-review": { status: 200, body: { count: 0 } },
    [`GET /v1/transactions/${TX}/transfer-candidates`]: counterparts(items),
    ...extra,
  });
  renderAt(`#/money/transactions/${TX}`, api.client);
  await screen.findByRole("heading", { level: 1, name: "Переказ на ощадний" });
  return api;
}
const openMenu = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Ще дії" }));
  return screen.findAllByRole("menuitem");
};
async function openManual() {
  await openMenu();
  fireEvent.click(screen.getByRole("menuitem", { name: "Позначити як переказ" }));
  return screen.findByRole("dialog", { name: "Позначити як переказ" });
}

describe("IMP-03@PoC FR 24, AC17, AC18, AC19, AC21, AC22: «Позначити як переказ» in the details", () => {
  it("IMP-03@PoC FR 24: the item is in «…» of a free transaction; no page of its own opens (AC22)", async () => {
    await openDetail([candidate(C_OK)]);
    const items = await openMenu();
    expect(items.map((i) => i.textContent)).toContain("Позначити як переказ");
    expect(items.map((i) => i.textContent)).not.toContain("Поєднати вручну");
    fireEvent.click(screen.getByRole("menuitem", { name: "Позначити як переказ" }));
    await screen.findByRole("dialog", { name: "Позначити як переказ" });
    expect(window.location.hash).toBe(`#/money/transactions/${TX}`);
  });

  it("IMP-03@PoC FR 24: a side of a transfer or a hidden transaction has no such item", async () => {
    await openDetail(
      [],
      detailTx({
        transfer: {
          id: "x",
          side: "outflow",
          counterpartId: INN,
          date: "2026-10-10",
          fee: null,
          currencyDifference: null,
          rate: null,
        },
      }),
    );
    const items = await openMenu();
    expect(items.map((i) => i.textContent)).not.toContain("Позначити як переказ");
  });

  it("IMP-03@PoC AC17: the candidate is a radio with the date, account, description and amount; «Поєднати в пару» is inactive until one is chosen", async () => {
    await openDetail([candidate(C_OK, { amount: eur("200.00"), difference: null, date: "2026-10-11" })]);
    const dialog = await openManual();
    const radio = within(dialog).getByRole("radio", { name: /Ощадний ··1180/ });
    expect(plain(radio.closest("label")!.textContent)).toMatch(/Надходження з поточного/);
    const pair = within(dialog).getByRole("button", { name: "Поєднати в пару" });
    expect(pair.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(radio);
    expect(
      within(dialog).getByRole("button", { name: "Поєднати в пару" }).getAttribute("aria-disabled"),
    ).not.toBe("true");
  });

  it("IMP-03@PoC AC17: «Поєднати в пару» marks the transaction with the chosen counterpart and closes the dialog", async () => {
    const api = await openDetail([candidate(C_OK, { amount: eur("200.00"), difference: null })], detailTx(), {
      [`POST /v1/transactions/${TX}/transfer`]: {
        status: 200,
        body: detailTx({
          transfer: {
            id: "t1",
            side: "outflow",
            counterpartId: C_OK,
            date: "2026-10-10",
            fee: null,
            currencyDifference: null,
            rate: null,
          },
        }),
      },
    });
    const dialog = await openManual();
    fireEvent.click(within(dialog).getByRole("radio"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Поєднати в пару" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ counterpartId: C_OK });
    expect(window.location.hash).toBe(`#/money/transactions/${TX}`);
  });

  it("IMP-03@PoC AC18: −200,00 EUR and +199,00 EUR show «Комісія 1,00 € — різниця сум стане витратою «Комісії банку»»", async () => {
    await openDetail([candidate(C_OK)]);
    const dialog = await openManual();
    expect(within(dialog).queryByText(/Комісія/)).toBeNull();
    fireEvent.click(within(dialog).getByRole("radio"));
    expect(plain(within(dialog).getByRole("status").textContent)).toBe(
      "Комісія 1,00 € — різниця сум стане витратою «Комісії банку»",
    );
  });

  it("IMP-03@PoC AC19: the list is what the server returns, in its order (the window and the 5 % are the server's)", async () => {
    await openDetail([
      candidate(C_OK, { amount: eur("1950.00"), difference: eur("-50.00"), date: "2026-08-18" }),
      candidate(C_USD, {
        amount: { amount: "80000.00", currency: "UAH" },
        kind: "cross-currency",
        difference: null,
        date: "2026-08-20",
      }),
    ]);
    const dialog = await openManual();
    const radios = within(dialog).getAllByRole("radio");
    expect(radios).toHaveLength(2);
    expect(plain(radios[0]!.closest("label")!.textContent)).toContain("1 950,00");
    expect(plain(radios[1]!.closest("label")!.textContent)).toContain("80 000,00");
  });

  it("IMP-03@PoC AC21: with no candidates the list says so and offers a one-sided transfer", async () => {
    await openDetail([], detailTx({ amount: eur("-75.00") }));
    const dialog = await openManual();
    expect(
      within(dialog).getByText("Немає транзакцій для пари в межах 7 днів до або після і 5 % суми"),
    ).toBeTruthy();
    expect(within(dialog).getByText(/одностороннім переказом/)).toBeTruthy();
    expect(
      within(dialog).getByRole("button", { name: "Поєднати в пару" }).getAttribute("aria-disabled"),
    ).toBe("true");
  });

  it("IMP-03@PoC FR 24: a candidate in another currency with a rate shows the difference with the bank rate beside the reference one", async () => {
    await openDetail(
      [
        candidate(C_USD, {
          accountId: MULTI,
          amount: { amount: "458.10", currency: "EUR" },
          kind: "cross-currency",
          bankRate: "0.9162",
          rate: { date: "2026-10-10", rate: "0.921", source: "nbu" },
          difference: eur("-2.40"),
        }),
      ],
      detailTx({ amount: { amount: "-500.00", currency: "USD" } }),
    );
    const dialog = await openManual();
    fireEvent.click(within(dialog).getByRole("radio"));
    const text = plain(within(dialog).getByRole("status").textContent);
    expect(text).toContain("Втрата за курсом 2,40 €");
    expect(text).toContain("курс банку 0,9162");
    expect(text).toContain("довідковий курс 0,921");
    expect(text).not.toMatch(/Комісія \d/);
  });

  it("IMP-03@PoC FR 24: a cross-currency candidate with no rate is shown but cannot be chosen", async () => {
    await openDetail([
      candidate(C_USD, {
        amount: { amount: "458.10", currency: "EUR" },
        kind: "cross-currency",
        markable: false,
        difference: null,
      }),
    ]);
    const dialog = await openManual();
    const radio = within(dialog).getByRole("radio") as HTMLInputElement;
    expect(radio.disabled).toBe(true);
    expect(within(dialog).getByText("Курсу на дату немає: поєднати не можна.")).toBeTruthy();
    expect(
      within(dialog).getByRole("button", { name: "Поєднати в пару" }).getAttribute("aria-disabled"),
    ).toBe("true");
  });

  it("IMP-03@PoC FR 24: a failed pairing keeps the dialog open with the error", async () => {
    await openDetail([candidate(C_OK)], detailTx(), {
      [`POST /v1/transactions/${TX}/transfer`]: {
        status: 409,
        body: { type: "x", title: "x", status: 409, code: "VERSION_CONFLICT", supportId: SUPPORT_ID },
        headers: { "content-type": "application/problem+json" },
      },
    });
    const dialog = await openManual();
    fireEvent.click(within(dialog).getByRole("radio"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Поєднати в пару" }));
    await waitFor(() => expect(plain(dialog.textContent)).toContain("Не вдалося поєднати в пару"));
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("IMP-03@PoC «Стани інтерфейсу»: the candidates are read with a skeleton, and a failed read has «Спробувати ще раз»", async () => {
    await openDetail([], detailTx(), {
      [`GET /v1/transactions/${TX}/transfer-candidates`]: {
        status: 500,
        body: { type: "x", title: "x", status: 500, code: "INTERNAL", supportId: SUPPORT_ID },
        headers: { "content-type": "application/problem+json" },
      },
    });
    const dialog = await openManual();
    await within(dialog).findByText("Не вдалося завантажити кандидатів.");
    expect(within(dialog).getByRole("button", { name: "Спробувати ще раз" })).toBeTruthy();
  });

  it("IMP-03@PoC FR 24: Escape closes the dialog and focus returns to the page", async () => {
    await openDetail([candidate(C_OK)]);
    await openManual();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
