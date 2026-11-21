import { screen, waitFor, within } from "@testing-library/react";
import { installMatchMedia } from "@willowsum/ui/test-utils";
import { fakeApi, renderAt, resetAuthState, type Reply } from "../auth/testing.tsx";
import { resetNavigationSession } from "../routing/session.ts";

/**
 * IMP-02@PoC FR 4 in S-047 «Деталь транзакції» (canvas PocMoneyTxDetail, row «Опис у банку»; «Тексти»
 * PocMoneyTxDetailTexts): the bank's description as printed and the statement's data, read-only. Synthetic data only.
 */
const ACC = "00000000-0000-4000-8000-000000000001";
const TX = "00000000-0000-4000-8000-0000000000aa";
const BATCH = "00000000-0000-4000-8000-0000000000b1";
const FILE = "00000000-0000-4000-8000-0000000000f1";
const DETAIL = `#/money/transactions/${TX}`;
// A long BBVA-like text: several columns joined by « · », one word without spaces.
const LONG =
  "COMPRA TARJETA 4417 MERCADONA S.A. VALENCIA ES · Movimiento: PAGO CON TARJETA EN COMERCIO · Observaciones: " +
  "REFERENCIAMUYLARGASINESPACIOS0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function tx(over: Record<string, unknown> = {}) {
  return {
    id: TX,
    accountId: ACC,
    amount: { amount: "-42.80", currency: "EUR" },
    type: "expense",
    date: "2026-11-02",
    counterparty: "Mercadona",
    description: null,
    status: "posted",
    source: "import",
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

const FULL = {
  bankDescription: LONG,
  balanceAfter: { amount: "1234.56", currency: "EUR" },
  importedFrom: { batchId: BATCH, fileId: FILE, row: 7 },
  originalAmount: { amount: "-45.10", currency: "USD" },
  exchangeRate: "0.949002",
  valueDate: "2026-11-03",
  bankReference: "REF-0001234",
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
  return waitFor(() => expect(screen.getByRole("heading", { level: 1, name: "Mercadona" })).toBeTruthy());
}

const block = () => screen.queryByRole("region", { name: "З виписки" });
const row = (scope: HTMLElement, label: string) => {
  const dt = within(scope)
    .getAllByText(label)
    .find((e) => e.tagName === "DT")!;
  return dt.parentElement!;
};
/** The value of a row with no-break spaces turned into plain ones. */
const val = (scope: HTMLElement, label: string) =>
  row(scope, label)
    .querySelector("dd")!
    .textContent!.replace(/\u00a0/g, " ");

beforeEach(() => {
  installMatchMedia({ width: 1280 });
  resetAuthState();
  resetNavigationSession();
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("IMP-02@PoC FR 4: the statement's data in S-047", () => {
  it("IMP-02@PoC FR 4: the bank's description is shown in full, as printed, in the row «Опис у банку»", async () => {
    await open(tx(FULL));
    const dd = row(document.body, "Опис у банку").querySelector("dd")!;
    expect(dd.textContent).toBe(LONG);
  });

  it("IMP-02@PoC FR 4: the description is wrapped, never clamped, and cannot be changed (GRID-00 FR 33)", async () => {
    await open(tx(FULL));
    const r = row(document.body, "Опис у банку");
    expect(r.querySelector(".txd-bank-text")).not.toBeNull();
    expect(r.querySelector("input, textarea, button, [contenteditable]")).toBeNull();
    expect(r.querySelector("[title]")).toBeNull();
    expect(r.querySelector("[style]")).toBeNull();
  });

  it("IMP-02@PoC FR 4: the original amount, the rate, the settlement amount and the value date, formatted", async () => {
    await open(tx(FULL));
    const b = block()!;
    expect(b).not.toBeNull();
    expect(val(b, "Початкова сума")).toBe("−45,10 $");
    expect(val(b, "Курс")).toBe("0,949002");
    expect(val(b, "Сума розрахунку")).toBe("−42,80 €");
    expect(val(b, "Дата валютування")).toContain("3 лист. 2026");
  });

  it("IMP-02@PoC FR 4: the balance after and the bank's reference are shown when present", async () => {
    await open(tx(FULL));
    const b = block()!;
    expect(val(b, "Залишок після операції")).toBe("1 234,56 €");
    expect(row(b, "Референс банку").textContent).toContain("REF-0001234");
  });

  it("IMP-02@PoC FR 5: the bank's fee is shown beside the amount it is in, when there is one (#698)", async () => {
    await open(tx({ ...FULL, bankFee: { amount: "1.50", currency: "EUR" } }));
    expect(val(block()!, "Комісія банку")).toBe("1,50 €");
  });

  it("IMP-02@PoC FR 4: the import origin links to the import batch", async () => {
    await open(tx(FULL));
    const link = within(block()!).getByRole("link", { name: /7/ });
    expect(link.getAttribute("href")).toBe(`#/import/${BATCH}/result`);
  });

  it("IMP-02@PoC FR 4: a hand-entered transaction has no «З виписки» block and no bank row", async () => {
    await open(tx({ source: "manual" }));
    expect(block()).toBeNull();
    expect(screen.queryByText("Опис у банку")).toBeNull();
    expect(screen.queryByText("Початкова сума")).toBeNull();
  });

  it("IMP-02@PoC FR 4: empty fields are hidden, the filled ones stay", async () => {
    await open(tx({ bankDescription: "SILPO 0457 KYIV", valueDate: "2026-11-03" }));
    const b = block()!;
    expect(row(document.body, "Опис у банку").textContent).toContain("SILPO 0457 KYIV");
    expect(row(b, "Дата валютування")).toBeTruthy();
    for (const label of [
      "Початкова сума",
      "Курс",
      "Залишок після операції",
      "Референс банку",
      "Комісія банку",
      "Імпорт",
    ])
      expect(within(b).queryByText(label)).toBeNull();
    // The settlement amount is shown with the original amount, not alone.
    expect(within(b).queryByText("Сума розрахунку")).toBeNull();
  });

  it("IMP-02@PoC FR 4: only the description filled — the row without the block", async () => {
    await open(tx({ bankDescription: "SILPO 0457 KYIV" }));
    expect(row(document.body, "Опис у банку").textContent).toContain("SILPO 0457 KYIV");
    expect(block()).toBeNull();
  });

  it("IMP-02@PoC FR 4: the statement's data is read-only", async () => {
    await open(tx(FULL));
    expect(within(block()!).queryAllByRole("button")).toHaveLength(0);
    expect(within(block()!).queryAllByRole("textbox")).toHaveLength(0);
  });
});
