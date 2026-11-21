import { describe, expect, it } from "vitest";
import type { StatementEvent } from "../../file-parsers/index.ts";
import { fileRows } from "./apply.ts";
import type { FilePlan, FileReview } from "./review.ts";

/**
 * IMP-02@PoC FR 4 (S-047 data): what the apply keeps of a statement row besides its amount — the bank's text masked
 * (IMP-05 business rule) and within its column, the original amount and currency, the rate, the value date and the
 * reference. Pure; synthetic rows.
 */
// Synthetic numbers built so no real-looking literal sits in the source.
const IBAN = ["ES", "00", "0000", "0000", "00", "0000004821"].join("");
const CARD = ["4111", "1111", "1111", "1234"].join(" ");

const event = (row: number, over: Partial<StatementEvent> = {}): StatementEvent => ({
  row,
  date: "2026-03-15",
  valueDate: null,
  currency: "EUR",
  legs: [{ amount: "-22.50", currency: "EUR" }],
  fee: null,
  balance: null,
  original: null,
  rate: null,
  description: `Синтетичний рядок ${row}`,
  counterparty: null,
  reference: null,
  currencyMark: null,
  flags: [],
  ...over,
});

const plan = (over: Partial<FilePlan> = {}): FilePlan => ({
  fileId: "f",
  balance: null,
  excluded: [],
  flipped: [],
  forced: [],
  readings: [],
  dateOrder: null,
  ...over,
});

const review = { accountCurrency: "EUR", checks: { currency: "EUR" } } as unknown as Pick<
  FileReview,
  "accountCurrency" | "checks"
>;

describe("IMP-02@PoC FR 4: the statement row's own data, kept by the apply", () => {
  it("IMP-02@PoC FR 4: a joined description keeps the masking — a card and an IBAN show their last 4, each part on its own", () => {
    const out = fileRows(
      [
        event(1, { description: `Pago con tarjeta · Compra · Tarjeta ${CARD}` }),
        event(2, { description: `Transferencia · ${IBAN} · 1234 5678` }),
      ],
      plan(),
      review,
    );
    expect(out.issues).toEqual([]);
    expect(out.rows.map((r) => r.description)).toEqual([
      "Pago con tarjeta · Compra · Tarjeta …1234",
      // Two short numbers of two parts never read as one long number across the separator.
      "Transferencia · …4821 · 1234 5678",
    ]);
  });

  it("IMP-02@PoC FR 4: the description keeps its column's bound (1 000 code points) after the masking", () => {
    const out = fileRows([event(1, { description: `${"Д".repeat(990)} · ${CARD} · хвіст` })], plan(), review);
    expect([...out.rows[0]!.description!].length).toBe(1000);
    expect(out.rows[0]!.description!.endsWith(" · …1234 ·")).toBe(true);
  });

  it("IMP-02@PoC FR 4: the original amount and currency (signed as the amount), the rate, the value date and the masked reference are kept", () => {
    const out = fileRows(
      [
        event(1, {
          valueDate: "2026-03-17",
          original: { amount: "1000.00", currency: "UAH" },
          rate: "0.0225",
          reference: `REF ${CARD}`,
        }),
        // A flipped row flips the original amount with it.
        event(2, {
          legs: [{ amount: "-5.00", currency: "EUR" }],
          original: { amount: "-200.00", currency: "UAH" },
        }),
      ],
      plan({ flipped: [2] }),
      review,
    );
    expect(out.issues).toEqual([]);
    const [a, b] = out.rows;
    expect(a).toMatchObject({ rate: "0.0225", valueDate: "2026-03-17", reference: "REF …1234" });
    expect([a!.original?.toDecimalString(), a!.original?.currency]).toEqual(["-1000", "UAH"]);
    expect([b!.amount.toDecimalString(), b!.original?.toDecimalString(), b!.original?.currency]).toEqual([
      "5",
      "200",
      "UAH",
    ]);
  });

  it("IMP-02@PoC FR 4: an original amount without a settled currency, and a rate the column cannot hold, are not kept — the row still is", () => {
    const out = fileRows(
      [
        event(1, { original: { amount: "10.00", currency: null }, rate: "0" }),
        event(2, { rate: `0.${"1".repeat(19)}` }),
      ],
      plan(),
      review,
    );
    expect(out.issues).toEqual([]);
    expect(out.rows.map((r) => [r.original, r.rate])).toEqual([
      [null, null],
      [null, null],
    ]);
  });

  it("IMP-02@PoC FR 4: a value date the books do not take (before 1900, not a calendar day) is not kept — the row still is (#696)", () => {
    const out = fileRows(
      [
        event(1, { valueDate: "1800-01-01" }),
        event(2, { valueDate: "2026-02-30" }),
        event(3, { valueDate: "1900-01-01" }),
      ],
      plan(),
      review,
    );
    expect(out.issues).toEqual([]);
    expect(out.rows.map((r) => r.valueDate)).toEqual([null, null, "1900-01-01"]);
  });

  it("IMP-04@PoC FR 1: the row carries the first description column's text, masked and clipped, as its legacy key when it differs (#696)", () => {
    const out = fileRows(
      [
        event(1, { description: `Compra · Tarjeta ${CARD}`, legacyDescription: `Compra ${CARD}` }),
        event(2, { description: "Compra", legacyDescription: "Compra" }),
        event(3, { description: "Compra" }),
      ],
      plan(),
      review,
    );
    expect(out.rows.map((r) => r.legacyDescription)).toEqual(["Compra …1234", undefined, undefined]);
  });

  it("IMP-02@PoC FR 4: a reference with a control character is the row's issue «text», never written as it is", () => {
    const out = fileRows([event(1, { reference: "REF\u0007" })], plan(), review);
    expect(out.issues).toEqual([{ row: 1, issue: "text" }]);
  });
});
