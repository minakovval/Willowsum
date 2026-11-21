import { describe, expect, it } from "vitest";
import type { StatementAnalysis, StatementChecks, StatementEvent } from "../../file-parsers/index.ts";
import { maskedAnalysis, reviewRows, summaryOf } from "./review-rows.ts";
import { readiness, type Decided, type FileReview } from "./review.ts";

/**
 * IMP-08@PoC (plan row 137, server part 1): the rows of «Перевірка розпізнавання» under the batch's decisions — pure,
 * on synthetic rows and checks of the shape the parse gives.
 */
const FILE = "00000000-0000-4000-8000-000000000001";
const AT = new Date("2026-11-20T10:00:00Z");

const event = (row: number, over: Partial<StatementEvent> = {}): StatementEvent => ({
  row,
  date: "2026-03-15",
  valueDate: null,
  currency: "EUR",
  legs: [{ amount: "-10.00", currency: "EUR" }],
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

const analysis = (over: Partial<StatementAnalysis> = {}): StatementAnalysis => ({
  table: { headerRow: 1, dataRows: 0, evidence: [] },
  columns: [],
  dates: null,
  numbers: null,
  sign: null,
  currency: { mode: "unknown", code: null, evidence: [] },
  ...over,
});

function review(signs: StatementChecks["signs"]): FileReview {
  return {
    batchFileId: FILE,
    batchId: "00000000-0000-4000-8000-0000000000b1",
    accountId: "00000000-0000-4000-8000-0000000000a1",
    accountCurrency: "EUR",
    suggestedAccountId: null,
    checks: {
      currency: "EUR",
      figures: {
        opening: null,
        closing: null,
        debitTotal: null,
        creditTotal: null,
        operations: null,
        period: null,
        currency: null,
        rows: [],
      },
      controls: [],
      bounds: { start: null, end: null, opening: null, closing: null, currency: "EUR" },
      account: { status: "match", reasons: [] },
      signs,
      clarifications: [],
      flags: [],
    } as unknown as StatementChecks,
    history: {
      status: "unknown",
      range: null,
      previousClosing: null,
      newOpening: null,
      difference: null,
      currency: "EUR",
    },
    previousFileId: null,
    recordedAt: AT,
  };
}

const rowDecision = (row: number, action: "exclude" | "flip-sign"): Decided => ({
  slot: `row:${FILE}:${row}`,
  fileId: FILE,
  decision: { kind: "row", fileId: FILE, row, action },
  decidedBy: FILE,
  decidedAt: AT,
});

describe("IMP-08@PoC: the review's rows and counts", () => {
  it("IMP-08@PoC AC3: 200 rows, 12 flagged, 3 refused — the counts read 200 / 12 / 3", () => {
    const unconfirmed = Array.from({ length: 12 }, (_, i) => 10 + i);
    const r = review({
      rows: Array.from({ length: 200 }, (_, i) => i + 2).map((row) => ({
        row,
        basis: unconfirmed.includes(row) ? ("majority" as const) : ("balance-chain" as const),
        confidence: unconfirmed.includes(row) ? 0.4 : 0.95,
        confirmed: !unconfirmed.includes(row),
      })),
      unconfirmed,
      card: null,
    });
    // Three rows the apply cannot write (no date): «помилка».
    const events = Array.from({ length: 200 }, (_, i) => event(i + 2, i >= 197 ? { date: null } : {}));
    const plan = readiness([r], []).files[0]!;
    const rows = reviewRows(events, analysis(), r, [], plan);
    const { states, rows: total } = summaryOf(rows, r, []);
    expect([total, states["needs-review"], states.error]).toEqual([200, 12, 3]);
    expect(rows.filter((x) => x.state === "error").map((x) => [x.row, x.issue])).toEqual([
      [199, "unreadable"],
      [200, "unreadable"],
      [201, "unreadable"],
    ]);
  });

  it("IMP-08@PoC FR 6: a fee row the balances do not place is «помилка» «fee» with the detail «fee-basis» (#703 review)", () => {
    const r = review({ rows: [], unconfirmed: [], card: null });
    const plan = readiness([r], []).files[0]!;
    const fee = { fee: { amount: "1.00", currency: "EUR" }, flags: ["fee-basis-unknown" as const] };
    const rows = reviewRows([event(2, fee), event(3)], analysis(), r, [], plan);
    expect(rows.map((x) => [x.row, x.state, x.issue, x.issueDetail])).toEqual([
      [2, "error", "fee", "fee-basis"],
      [3, "ok", null, null],
    ]);
  });

  it("IMP-08@PoC AC6: a flipped row is changed; an excluded row is excluded, not changed; the others are as read", () => {
    const r = review({
      rows: [2, 3, 4].map((row) => ({ row, basis: "majority" as const, confidence: 0.4, confirmed: false })),
      unconfirmed: [2, 3, 4],
      card: null,
    });
    const decisions = [rowDecision(2, "flip-sign"), rowDecision(3, "exclude")];
    const plan = readiness([r], decisions).files[0]!;
    const rows = reviewRows([event(2), event(3), event(4)], analysis(), r, decisions, plan);
    expect(rows.map((x) => [x.row, x.state, x.changed, x.decision?.from ?? null])).toEqual([
      [2, "ok", true, "row"],
      [3, "excluded", false, "row"],
      [4, "needs-review", false, null],
    ]);
  });

  it("IMP-06@PoC FR 8: the alternatives keep their scores; an IBAN in an example or a header keeps its last 4 characters", () => {
    const iban = ["UA", "00", "111111", "0000000", "222222", "334821"].join("");
    const masked = maskedAnalysis(
      analysis({
        columns: [
          {
            column: 3,
            header: `Опис ${iban}`,
            role: {
              chosen: {
                value: "description",
                label: "Опис",
                score: 0.9,
                examples: [{ cell: `Переказ ${iban}`, reads: `Переказ ${iban}` }],
              },
              alternatives: [{ value: "counterparty", label: "Контрагент", score: 0.4, examples: [] }],
              evidence: [{ code: "content", column: 3, example: iban }],
              flags: [],
            },
          },
        ],
      }),
    );
    const text = JSON.stringify(masked);
    expect(text).not.toContain(iban);
    expect(masked.columns[0]!.role.chosen.examples[0]!.cell).toBe("Переказ …4821");
    expect(masked.columns[0]!.role.alternatives).toEqual([
      { value: "counterparty", label: "Контрагент", score: 0.4, examples: [] },
    ]);
  });
});
