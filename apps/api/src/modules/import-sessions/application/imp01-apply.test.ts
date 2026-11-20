import { describe, expect, it } from "vitest";
import type { StatementEvent } from "../../file-parsers/index.ts";
import { fileRows } from "./apply.ts";
import type { FilePlan, FileReview } from "./review.ts";

/** IMP-01@PoC FR 11 (#637 item 1): what the apply writes of one file's rows under its plan — pure. Synthetic rows. */
const event = (row: number, amount: string, over: Partial<StatementEvent> = {}): StatementEvent => ({
  row,
  date: "2026-03-15",
  valueDate: null,
  currency: "EUR",
  legs: [{ amount, currency: "EUR" }],
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

describe("IMP-01@PoC FR 11: the rows the apply writes", () => {
  it("IMP-01@PoC FR 11: amounts stay exact decimals with their sign; a flipped row changes sign, an excluded one is left out", () => {
    const out = fileRows(
      [event(1, "-60.10"), event(2, "500.00"), event(3, "-7.00")],
      plan({ flipped: [2], excluded: [3] }),
      review,
    );
    expect(out.issues).toEqual([]);
    expect(out.excluded).toBe(1);
    expect(out.rows.map((r) => [r.row, r.amount.toDecimalString(), r.amount.currency])).toEqual([
      [1, "-60.1", "EUR"],
      [2, "-500", "EUR"],
    ]);
  });

  it("IMP-01@PoC FR 11: a chosen reading keeps the engine's sign for the row (IMP-05 FR 7)", () => {
    const out = fileRows([event(4, "-1.234")], plan({ readings: [{ row: 4, value: "1234" }] }), review);
    expect(out.rows[0]!.amount.toDecimalString()).toBe("-1234");
  });

  it("IMP-01@PoC FR 11: a row closed «as read» with more decimals than the currency has is refused, never rounded (#637 item 1)", () => {
    const out = fileRows([event(5, "-10.5555"), event(6, "-1.00")], plan({ forced: [5] }), review);
    expect(out.issues).toEqual([{ row: 5, issue: "too-precise" }]);
    expect(out.rows.map((r) => r.row)).toEqual([6]);
  });

  it("IMP-01@PoC FR 11: rows without a date, a single amount or a currency, and rows with a fee, are named — never guessed or dropped", () => {
    const out = fileRows(
      [
        event(1, "-1.00", { date: null }),
        event(2, "-1.00", { legs: [] }),
        event(3, "-1.00", { currency: null, legs: [{ amount: "-1.00", currency: null }] }),
        event(4, "-1.00", { fee: { amount: "0.50", currency: "EUR" } }),
        event(5, "0.00"),
      ],
      plan(),
      { accountCurrency: null, checks: review.checks },
    );
    expect(out.issues).toEqual([
      { row: 1, issue: "unreadable" },
      { row: 2, issue: "unreadable" },
      { row: 3, issue: "currency" },
      { row: 4, issue: "fee" },
    ]);
    // A zero row moves no money: counted, not written.
    expect(out.zero).toBe(1);
    expect(out.rows).toEqual([]);
  });
});
