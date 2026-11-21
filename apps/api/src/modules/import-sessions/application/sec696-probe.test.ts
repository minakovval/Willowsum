import { describe, expect, it } from "vitest";
import { parseStatement } from "../../file-parsers/application/index.ts";
import type { StatementEvent } from "../../file-parsers/index.ts";
import { importedRate, importedText } from "../../transactions/index.ts";
import { fileRows } from "./apply.ts";
import type { FilePlan, FileReview } from "./review.ts";

// Synthetic numbers built so no real-looking literal sits in the source.
const IBAN_SPACED = ["ES00", "0000", "0000", "0000", "0000", "4821"].join(" ");
const CARD = ["4111", "1111", "1111", "1234"].join(" ");
const CARD_GLUED = ["4111", "1111", "1111", "5678"].join("");
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
const enc = (lines: readonly string[]) => new TextEncoder().encode(lines.join("\r\n"));
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
  description: `Рядок ${row}`,
  counterparty: null,
  reference: null,
  currencyMark: null,
  flags: [],
  ...over,
});

describe("IMP-02@PoC FR 4 (#696 security probe): parse → apply keeps no full IBAN or card number in the joined text or the reference", () => {
  it("IMP-02@PoC FR 4 (#696 security probe): every description column and the reference column are masked to the last 4 (parser output → fileRows)", () => {
    const parsed = parseStatement(
      enc([
        "Fecha;Concepto;Movimiento;Importe;Divisa;Observaciones;Reference",
        `01/03/2026;Transferencia a ${IBAN_SPACED};Pago ${CARD_GLUED};-25,40;EUR;Tarjeta ${CARD};${CARD_GLUED}`,
        `02/03/2026;${CARD};${CARD};-1,00;EUR;${IBAN_SPACED};REF-1`,
      ]),
      {},
      { account: { currencies: ["EUR"], multiCurrency: false } },
    );
    const role = (h: string) => parsed.analysis.columns.find((c) => c.header === h)?.role.chosen.value;
    expect(role("Reference")).toBe("reference");
    const out = fileRows(parsed.events.events, plan, review);
    expect(out.issues).toEqual([]);
    expect(out.rows).toHaveLength(2);
    for (const r of out.rows) {
      const all = `${r.description} | ${r.reference}`;
      expect(all).not.toMatch(/1111/);
      expect(all).not.toMatch(/0000/);
    }
    expect(out.rows[0]!.description).toBe("Transferencia a …4821 · Pago …5678 · Tarjeta …1234");
    expect(out.rows[0]!.reference).toBe("…5678");
    expect(out.rows[1]!.description).toBe("…1234 · …4821");
  });

  it("IMP-02@PoC FR 4 (#696 security probe): the reference is clipped to its column (200 code points) after the masking; the joined text to 1 000", () => {
    const out = fileRows(
      [event(1, { reference: `${"R".repeat(190)} ${CARD} хвіст`, description: "Я".repeat(2000) })],
      plan,
      review,
    );
    expect([...out.rows[0]!.reference!].length).toBeLessThanOrEqual(200);
    expect(out.rows[0]!.reference).not.toMatch(/1111/);
    expect([...out.rows[0]!.description!].length).toBe(1000);
    expect([...importedText("𝔘".repeat(500), "reference")!].length).toBe(200);
  });

  it("IMP-02@PoC FR 4 (#696 security probe): the rate is a positive plain decimal the column holds, or nothing", () => {
    expect(importedRate("45.0000")).toBe("45");
    for (const bad of [
      "0",
      "0.000",
      "-1",
      "1e5",
      "NaN",
      "Infinity",
      " 1",
      "1,5",
      `1${"0".repeat(20)}`,
      `0.${"0".repeat(18)}1`,
      "",
    ])
      expect(importedRate(bad), bad).toBeNull();
    expect(importedRate(`${"9".repeat(20)}.${"9".repeat(18)}`)).toBe(`${"9".repeat(20)}.${"9".repeat(18)}`);
  });

  it("IMP-02@PoC FR 4 (#696 security probe): the original amount follows the sign of the amount written and is dropped when the books cannot hold it", () => {
    const out = fileRows(
      [
        event(1, { original: { amount: "10.00", currency: "USD" } }),
        event(2, { original: { amount: `1${"0".repeat(20)}`, currency: "USD" } }),
        event(3, { original: { amount: `0.${"1".repeat(19)}`, currency: "USD" } }),
        event(4, { original: { amount: "5", currency: "ZZZZ" } }),
      ],
      plan,
      review,
    );
    expect(out.rows.map((r) => r.original?.toDecimalString() ?? null)).toEqual(["-10", null, null, null]);
  });
});
