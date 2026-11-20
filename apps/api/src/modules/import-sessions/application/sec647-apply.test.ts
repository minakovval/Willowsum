import { describe, expect, it } from "vitest";
import type { StatementEvent } from "../../file-parsers/index.ts";
import { fileRows } from "./apply.ts";
import type { FilePlan, FileReview } from "./review.ts";

/** sec647: an amount the books cannot hold (NUMERIC(38,18): 20 integer digits) is a row's refusal, never an error. */
const event = (row: number, amount: string): StatementEvent => ({
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
});
const plan: FilePlan = {
  fileId: "f",
  balance: null,
  excluded: [],
  flipped: [],
  forced: [],
  readings: [],
  dateOrder: null,
};
const review = { accountCurrency: "EUR", checks: { currency: "EUR" } } as unknown as Pick<
  FileReview,
  "accountCurrency" | "checks"
>;

describe("sec647: an amount past the stored range", () => {
  it("IMP-01@PoC FR 11: a row whose amount has more than 20 integer digits is named «unreadable»; the other rows stay exact", () => {
    const out = fileRows(
      [event(2, `-${"9".repeat(21)}.00`), event(3, `-${"9".repeat(20)}.99`)],
      plan,
      review,
    );
    expect(out.issues).toEqual([{ row: 2, issue: "unreadable" }]);
    expect(out.rows.map((r) => r.amount.toDecimalString())).toEqual([`-${"9".repeat(20)}.99`]);
  });
});
