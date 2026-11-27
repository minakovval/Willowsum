import { screen, waitFor, within } from "@testing-library/react";
import { installMatchMedia } from "@willowsum/ui/test-utils";
import { fakeApi, renderAt, resetAuthState, type Reply } from "../auth/testing.tsx";
import { resetNavigationSession } from "../routing/session.ts";

/**
 * FIN-03@PoC FR 8, AC31 (web side) and IMP-03@PoC FR 21 in S-047 «Деталь транзакції»: the difference between the credited
 * amount and the amount at the NBU rate of the transfer date — a loss (an expense of the budget) or a gain (an income),
 * one category «Комісії банку» — is visible in the details of the transfer (`transfer.currencyDifference`, owner,
 * 2026-11-26, decision 11). Synthetic data only.
 */
const ACC = "00000000-0000-4000-8000-000000000001";
const TX = "00000000-0000-4000-8000-0000000000aa";
const DETAIL = `#/money/transactions/${TX}`;
const NAME =
  "Переказ на картку Mono з дуже довгою назвою понад шістдесят символів і словом ЗАВЕЛИКЕСЛОВОБЕЗПРОБІЛІВ0123456789";

function tx(over: Record<string, unknown> = {}) {
  return {
    id: TX,
    accountId: ACC,
    amount: { amount: "-42.80", currency: "EUR" },
    type: "expense",
    date: "2026-11-02",
    counterparty: NAME,
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
    recordedAt: "2026-11-02T09:14:00Z",
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

const OTHER = "00000000-0000-4000-8000-0000000000bb";
const TRANSFER = {
  id: "00000000-0000-4000-8000-0000000000cc",
  side: "outflow",
  counterpartId: OTHER,
  date: "2026-11-02",
  fee: null,
  currencyDifference: null,
  rate: { rate: "0.022989", date: "2026-11-02", source: "nbu" },
};
const ACCOUNT = {
  id: ACC,
  kind: "current",
  group: "cash",
  name: "Поточний",
  institution: null,
  number: { last4: "4417", masked: "••4417" },
  status: "active",
  closedOn: null,
  source: "manual",
  updatedOn: "2026-11-02",
  favourite: false,
  inProfileCurrency: { total: { amount: "1.00", currency: "EUR" }, approximate: false, unavailableCount: 0 },
  currencies: [],
  creditCard: null,
  loan: null,
};

function open(row: ReturnType<typeof tx>) {
  const h: Record<string, Reply> = {
    [`GET /v1/transactions/${TX}`]: { status: 200, body: row },
    [`GET /v1/transactions/${TX}/category`]: {
      status: 200,
      body: { transactionId: TX, categoryId: null, source: "none" },
    },
    "GET /v1/categories": { status: 200, body: { groups: [] } },
    [`GET /v1/accounts/${ACC}`]: { status: 200, body: ACCOUNT },
    "GET /v1/duplicate-proposals": { status: 200, body: { items: [], count: 0, more: false } },
    "GET /v1/transaction-review": { status: 200, body: { count: 0 } },
  };
  renderAt(DETAIL, fakeApi(h).client);
  return waitFor(() => expect(screen.getByRole("heading", { level: 1, name: NAME })).toBeTruthy());
}

const block = () => screen.queryByRole("region", { name: "Різниця за курсом" });
const text = (e: HTMLElement) => e.textContent!.replace(/\u00a0/g, " ");

beforeEach(() => {
  installMatchMedia({ width: 1280 });
  resetAuthState();
  resetNavigationSession();
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

const withDifference = (amount: string) => ({
  type: "income",
  amount: { amount: "4320.00", currency: "UAH" },
  transfer: { ...TRANSFER, side: "inflow", currencyDifference: { amount, currency: "UAH" } },
});

describe("FIN-03@PoC FR 8, AC31 and IMP-03@PoC FR 21: the difference of a transfer in its details", () => {
  it("FIN-03@PoC AC31: a loss of 30,00 UAH (4 350,00 at the NBU rate less 4 320,00 received) is shown as an expense of the budget in «Комісії банку»", async () => {
    await open(tx(withDifference("-30.00")));
    const b = block()!;
    expect(b).not.toBeNull();
    expect(text(within(b).getByText("Втрата за курсом НБУ").closest("div")!)).toBe(
      "Втрата за курсом НБУ−30,00 ₴",
    );
    expect(text(within(b).getByText("У бюджеті").closest("div")!)).toBe("У бюджетіВитрата · Комісії банку");
  });

  it("FIN-03@PoC AC31, FR 8: a gain of 30,00 UAH (4 380,00 received) is shown as an income of the budget in the same category", async () => {
    await open(tx(withDifference("30.00")));
    const b = block()!;
    expect(text(within(b).getByText("Виграш за курсом НБУ").closest("div")!)).toBe(
      "Виграш за курсом НБУ+30,00 ₴",
    );
    expect(text(within(b).getByText("У бюджеті").closest("div")!)).toBe("У бюджетіДохід · Комісії банку");
    expect(within(b).queryByText("Втрата за курсом НБУ")).toBeNull();
  });

  it("IMP-03@PoC FR 21: the amount is spoken with its sign and currency, and a 60+ character name with one long word does not hide it", async () => {
    await open(tx(withDifference("-30.00")));
    expect(block()!.querySelector("[aria-label]")!.getAttribute("aria-label")).toMatch(/30/);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(NAME);
  });

  it("FIN-03@PoC FR 8: a transfer in one currency, or with no difference, and a plain transaction show no block", async () => {
    await open(tx({ transfer: TRANSFER }));
    expect(block()).toBeNull();
  });

  it("FIN-03@PoC FR 8: a plain transaction shows no block", async () => {
    await open(tx());
    expect(block()).toBeNull();
  });
});
