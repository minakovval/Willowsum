import { describe, expect, it } from "vitest";
import type { StatementEvent } from "../../file-parsers/index.ts";
import { fileRows } from "./apply.ts";
import type { FilePlan, FileReview } from "./review.ts";

/**
 * IMP-02@PoC FR 5 (#698): a row with the bank's fee is written with it — the amount is the account's movement, the fee
 * its own leg — and is refused («fee») only when the fee does not read. Synthetic rows.
 */
const event = (row: number, amount: string, over: Partial<StatementEvent> = {}): StatementEvent => ({
  row,
  date: "2026-11-04",
  valueDate: null,
  currency: "UAH",
  legs: [{ amount, currency: "UAH" }],
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
const fee = (amount: string, currency = "UAH") => ({ fee: { amount, currency } });
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
const review = { accountCurrency: "UAH", checks: { currency: "UAH" } } as unknown as Pick<
  FileReview,
  "accountCurrency" | "checks"
>;
const written = (out: ReturnType<typeof fileRows>) =>
  out.rows.map((r) => [r.row, r.amount.toDecimalString(), r.fee?.toDecimalString() ?? null]);

describe("IMP-02@PoC FR 5: rows with the bank's fee are written with it", () => {
  it("IMP-02@PoC FR 5: monobank — the card amount includes the fee: the row moves the account by it, the fee is kept beside it", () => {
    const out = fileRows(
      [
        event(1, "-2020.00", { ...fee("20.00"), feeIncluded: true }),
        event(2, "-4641.00", {
          ...fee("91.00"),
          feeIncluded: true,
          original: { amount: "-100.00", currency: "EUR" },
          rate: "45.5000",
        }),
      ],
      plan(),
      review,
    );
    expect(out.issues).toEqual([]);
    expect(written(out)).toEqual([
      [1, "-2020", "20"],
      [2, "-4641", "91"],
    ]);
  });

  it("IMP-02@PoC FR 5: an amount without the fee — the account moves by the amount and the fee", () => {
    const out = fileRows(
      [
        event(1, "-100.00", { ...fee("1.50"), feeIncluded: false }),
        event(2, "200.00", { ...fee("2.00"), feeIncluded: false }),
      ],
      plan(),
      review,
    );
    expect(out.issues).toEqual([]);
    expect(written(out)).toEqual([
      [1, "-101.5", "1.5"],
      [2, "198", "2"],
    ]);
  });

  it("IMP-02@PoC FR 5: a flipped row keeps its fee as a charge", () => {
    const out = fileRows(
      [event(1, "-2020.00", { ...fee("20.00"), feeIncluded: true })],
      plan({ flipped: [1] }),
      review,
    );
    expect(written(out)).toEqual([[1, "2020", "20"]]);
  });

  it("IMP-02@PoC FR 5: a fee printed as «0» or none at all writes the row without a fee", () => {
    const out = fileRows([event(1, "-5.00", fee("0.00")), event(2, "-6.00")], plan(), review);
    expect(out.issues).toEqual([]);
    expect(written(out)).toEqual([
      [1, "-5", null],
      [2, "-6", null],
    ]);
  });

  it("IMP-02@PoC FR 5: only a fee that does not read is «Комісію не вдалося прочитати» — never a readable one", () => {
    const out = fileRows(
      [
        event(1, "-2020.00", { flags: ["fee-unreadable"] }),
        event(2, "-10.00", { ...fee("1.00", "EUR"), feeIncluded: true }),
        event(3, "-10.00", { ...fee("0.005"), feeIncluded: true }),
        event(4, "-10.00", { ...fee("10.00"), feeIncluded: true }),
        event(5, "-10.00", { ...fee("1.00"), feeIncluded: true }),
      ],
      plan(),
      review,
    );
    expect(out.issues).toEqual([
      { row: 1, issue: "fee" },
      { row: 2, issue: "fee" },
      { row: 3, issue: "fee" },
      { row: 4, issue: "fee" },
    ]);
    expect(written(out)).toEqual([[5, "-10", "1"]]);
  });
});
