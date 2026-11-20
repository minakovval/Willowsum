import { describe, expect, it } from "vitest";
import type { StatementChecks } from "../../file-parsers/index.ts";
import {
  checkDecision,
  DecisionRefused,
  readiness,
  slotOf,
  type Decided,
  type DecisionInput,
  type FileReview,
} from "./review.ts";

/**
 * IMP-05@PoC part 2: decisions (FR 10) and the readiness to apply (FR 11) on synthetic checks of the shape the parse
 * gives (file-parsers `StatementChecks`). Pure: no database, no clock.
 */
const FILE = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const ACCOUNT = "00000000-0000-4000-8000-0000000000a1";
const AT = new Date("2026-11-20T10:00:00Z");

function checks(over: Partial<StatementChecks> = {}): StatementChecks {
  return {
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
    bounds: {
      start: "2026-03-01",
      end: "2026-03-31",
      opening: "1000.00",
      closing: "1440.00",
      currency: "EUR",
    },
    account: { status: "match", reasons: [] },
    signs: {
      rows: [1, 2, 3].map((row) => ({
        row,
        basis: "balance-chain" as const,
        confidence: 0.95,
        confirmed: true,
      })),
      unconfirmed: [],
      card: null,
    },
    clarifications: [],
    flags: [],
    ...over,
  };
}

function file(c: StatementChecks, id = FILE, over: Partial<FileReview> = {}): FileReview {
  return {
    batchFileId: id,
    batchId: "00000000-0000-4000-8000-0000000000b1",
    accountId: ACCOUNT,
    accountCurrency: "EUR",
    suggestedAccountId: null,
    checks: c,
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
    ...over,
  };
}

/** The decisions as `decide` stores them: checked, in their slots, the later one replacing the earlier. */
function decided(files: readonly FileReview[], inputs: readonly DecisionInput[]): Decided[] {
  const map = new Map(files.map((f) => [f.batchFileId, f]));
  const slots = new Map<string, Decided>();
  inputs.forEach((d, i) =>
    slots.set(slotOf(d), {
      slot: slotOf(d),
      fileId: d.fileId,
      decision: checkDecision(d, map, i),
      decidedBy: ACCOUNT,
      decidedAt: AT,
    }),
  );
  return [...slots.values()];
}

const amountQuestion = (row: number, cell: string, comma: string, dot: string) =>
  ({
    kind: "amount",
    row,
    cell,
    readings: [
      { decimal: ",", value: comma },
      { decimal: ".", value: dot },
    ],
  }) as const;

const unconfirmedSigns = (rows: readonly number[]): StatementChecks["signs"] => ({
  rows: [1, 2, 3].map((row) =>
    rows.includes(row)
      ? { row, basis: "card" as const, confidence: 0.5, confirmed: false }
      : { row, basis: "balance-chain" as const, confidence: 0.95, confirmed: true },
  ),
  unconfirmed: rows,
  card: null,
});

describe("IMP-05@PoC FR 11: the readiness to apply", () => {
  it("IMP-05@PoC AC9: everything agrees and nothing is flagged — ready with no decision", () => {
    const r = readiness([file(checks())], []);
    expect(r.ready).toBe(true);
    expect(r.refusals).toEqual([]);
    expect(r.files).toEqual([
      { fileId: FILE, balance: null, excluded: [], flipped: [], forced: [], readings: [], dateOrder: null },
    ]);
  });

  it("IMP-05@PoC AC8: an unanswered clarification refuses with «Потрібні уточнення»", () => {
    const f = file(checks({ clarifications: [amountQuestion(2, "1.234", "1234", "1.234")] }), FILE, {
      checks: checks({ currency: null, clarifications: [amountQuestion(2, "1.234", "1234", "1.234")] }),
      accountCurrency: null,
    });
    const r = readiness([f], []);
    expect(r.ready).toBe(false);
    expect(r.refusals).toEqual([
      { code: "clarifications", files: [{ fileId: FILE, rows: [2], count: 1, dateOrder: false }] },
    ]);
  });

  it("IMP-05@PoC FR 8: an open order of day and month is a clarification of the file until it is answered", () => {
    const c = checks({
      clarifications: [
        {
          kind: "date-order",
          rows: 3,
          example: {
            cell: "03.04.2026",
            readings: [
              { order: "dmy", value: "2026-04-03" },
              { order: "mdy", value: "2026-03-04" },
            ],
          },
        },
      ],
    });
    expect(readiness([file(c)], []).refusals).toEqual([
      { code: "clarifications", files: [{ fileId: FILE, rows: [], count: 0, dateOrder: true }] },
    ]);
    const r = readiness([file(c)], decided([file(c)], [{ kind: "date-order", fileId: FILE, order: "mdy" }]));
    expect(r.ready).toBe(true);
    expect(r.files[0]!.dateOrder).toBe("mdy");
  });

  it("IMP-05@PoC FR 8: a group decision on «потребує уточнення» never closes the order of day and month", () => {
    const c = checks({
      clarifications: [
        {
          kind: "date-order",
          rows: 3,
          example: {
            cell: "03.04.2026",
            readings: [
              { order: "dmy", value: "2026-04-03" },
              { order: "mdy", value: "2026-03-04" },
            ],
          },
        },
      ],
    });
    for (const action of ["exclude", "accept"] as const)
      for (const fileId of [FILE, null]) {
        const r = readiness(
          [file(c)],
          decided([file(c)], [{ kind: "group", fileId, group: "clarify", action }]),
        );
        expect(r.ready).toBe(false);
        expect(r.refusals).toEqual([
          { code: "clarifications", files: [{ fileId: FILE, rows: [], count: 0, dateOrder: true }] },
        ]);
        expect(r.files[0]!.dateOrder).toBeNull();
      }
  });

  it("IMP-05@PoC FR 11: rows whose sign is not confirmed refuse with «Потрібен перегляд рядків» until each has a decision", () => {
    const c = checks({ signs: unconfirmedSigns([2, 3]) });
    expect(readiness([file(c)], []).refusals).toEqual([
      { code: "review-rows", files: [{ fileId: FILE, rows: [2, 3], count: 2 }] },
    ]);
    const one = decided([file(c)], [{ kind: "row", fileId: FILE, row: 2, action: "flip-sign" }]);
    expect(readiness([file(c)], one).refusals).toEqual([
      { code: "review-rows", files: [{ fileId: FILE, rows: [3], count: 1 }] },
    ]);
    const both = decided(
      [file(c)],
      [
        { kind: "row", fileId: FILE, row: 2, action: "flip-sign" },
        { kind: "row", fileId: FILE, row: 3, action: "exclude" },
      ],
    );
    const r = readiness([file(c)], both);
    expect(r.ready).toBe(true);
    expect(r.files[0]).toMatchObject({ flipped: [2], excluded: [3] });
  });

  it("IMP-05@PoC FR 11: an unconfirmed flag refuses with «Не підтверджені позначки»; a confirmation for the batch confirms it in every file", () => {
    const flagged = checks({ flags: [{ code: "formula-cells", severity: "review", count: 2 }] });
    const files = [file(flagged), file(flagged, OTHER)];
    const r = readiness(files, []);
    expect(r.refusals.map((x) => x.code)).toEqual(["flags"]);
    expect(r.refusals[0]).toMatchObject({
      files: [
        { fileId: FILE, flags: [{ code: "formula-cells", count: 2 }] },
        { fileId: OTHER, flags: [{ code: "formula-cells" }] },
      ],
    });
    expect(
      readiness(files, decided(files, [{ kind: "flag", fileId: null, code: "formula-cells" }])).ready,
    ).toBe(true);
  });

  it("IMP-05@PoC FR 11: every unmet condition is named, in the order of FR 11", () => {
    const c = checks({
      account: { status: "mismatch", reasons: [{ kind: "iban", file: "…4821", account: "…1190" }] },
      clarifications: [amountQuestion(1, "1.234", "1234", "1.234")],
      signs: unconfirmedSigns([3]),
      flags: [
        { code: "foreign-account", severity: "block" },
        { code: "no-transactions", severity: "review" },
      ],
      currency: null,
    });
    expect(readiness([file(c, FILE, { accountCurrency: null })], []).refusals.map((x) => x.code)).toEqual([
      "confirm-account",
      "clarifications",
      "review-rows",
      "flags",
    ]);
  });
});

describe("IMP-05@PoC FR 2: the control-sum mismatch needs a balance choice", () => {
  const mismatch = checks({
    flags: [
      { code: "checksum-mismatch", severity: "review", check: "balance-equation", difference: "10.00" },
    ],
  });

  it("IMP-05@PoC AC1: «Застосувати» is refused with the difference and both choices of the dialog", () => {
    const r = readiness([file(mismatch)], []);
    expect(r.ready).toBe(false);
    expect(r.refusals).toEqual([
      {
        code: "flags",
        files: [
          {
            fileId: FILE,
            flags: [
              {
                code: "checksum-mismatch",
                severity: "review",
                check: "balance-equation",
                difference: "10.00",
                choices: ["update", "keep"],
              },
            ],
          },
        ],
      },
    ]);
  });

  it("IMP-05@PoC FR 2: a plain flag confirmation does not settle it; «Застосувати без оновлення залишку» does, and the plan carries it", () => {
    const files = [file(mismatch)];
    expect(() => decided(files, [{ kind: "flag", fileId: FILE, code: "checksum-mismatch" }])).toThrow(
      DecisionRefused,
    );
    const r = readiness(files, decided(files, [{ kind: "balance", fileId: FILE, choice: "keep" }]));
    expect(r.ready).toBe(true);
    expect(r.files[0]!.balance).toBe("keep");
    const again = readiness(
      files,
      decided(files, [
        { kind: "balance", fileId: FILE, choice: "keep" },
        { kind: "balance", fileId: FILE, choice: "update" },
      ]),
    );
    expect(again.files[0]!.balance).toBe("update");
  });

  it("IMP-05@PoC FR 2: a balance choice for a file without a mismatch is refused", () => {
    expect(() => decided([file(checks())], [{ kind: "balance", fileId: FILE, choice: "update" }])).toThrow(
      DecisionRefused,
    );
  });
});

describe("IMP-05@PoC FR 4: another account's file", () => {
  const foreign = checks({
    account: { status: "mismatch", reasons: [{ kind: "iban", file: "…4821", account: "…1190" }] },
    flags: [{ code: "foreign-account", severity: "block" }],
  });
  const SUGGESTED = "00000000-0000-4000-8000-0000000000a2";

  it("IMP-05@PoC AC3: refused with «Підтвердіть рахунок», the masked reasons and the suggested account; «Так, це правильний рахунок» lets it apply", () => {
    const files = [file(foreign, FILE, { suggestedAccountId: SUGGESTED })];
    const r = readiness(files, []);
    expect(r.refusals).toEqual([
      {
        code: "confirm-account",
        files: [
          {
            fileId: FILE,
            missing: false,
            reasons: [{ kind: "iban", file: "…4821", account: "…1190" }],
            suggestedAccountId: SUGGESTED,
          },
        ],
      },
    ]);
    expect(readiness(files, decided(files, [{ kind: "account", fileId: FILE }])).ready).toBe(true);
  });

  it("IMP-05@PoC FR 4: a file with no account yet is refused with «Підтвердіть рахунок» and no decision confirms it", () => {
    const files = [file(checks(), FILE, { accountId: null })];
    const r = readiness(files, []);
    expect(r.ready).toBe(false);
    expect(r.refusals).toEqual([
      {
        code: "confirm-account",
        files: [{ fileId: FILE, missing: true, reasons: [], suggestedAccountId: null }],
      },
    ]);
    expect(() => decided(files, [{ kind: "account", fileId: FILE }])).toThrow(DecisionRefused);
  });

  it("IMP-05@PoC FR 4: the confirmation is refused for a file whose account agrees, and a flag confirmation is no account confirmation", () => {
    expect(() => decided([file(checks())], [{ kind: "account", fileId: FILE }])).toThrow(DecisionRefused);
    expect(() => decided([file(foreign)], [{ kind: "flag", fileId: FILE, code: "foreign-account" }])).toThrow(
      DecisionRefused,
    );
  });
});

describe("IMP-05@PoC FR 7: readings of an ambiguous amount", () => {
  const two = checks({
    currency: null,
    clarifications: [
      amountQuestion(1, "1.234", "1234", "1.234"),
      amountQuestion(3, "5.678", "5678", "5.678"),
    ],
  });
  const files = [file(two, FILE, { accountCurrency: null })];

  it("IMP-05@PoC AC6: «1 234» with «застосувати до файлу» reads the similar rows the same way", () => {
    const d = decided(files, [{ kind: "reading", fileId: FILE, row: 1, value: "1234", applyToFile: true }]);
    const r = readiness(files, d);
    expect(r.ready).toBe(true);
    expect(r.files[0]!.readings).toEqual([
      { row: 1, value: "1234" },
      { row: 3, value: "5678" },
    ]);
  });

  it("IMP-05@PoC FR 7: without «застосувати до файлу» only that row is answered; a row's own answer wins over the file's", () => {
    const one = decided(files, [
      { kind: "reading", fileId: FILE, row: 1, value: "1.234", applyToFile: false },
    ]);
    expect(readiness(files, one).refusals).toEqual([
      { code: "clarifications", files: [{ fileId: FILE, rows: [3], count: 1, dateOrder: false }] },
    ]);
    const mixed = decided(files, [
      { kind: "reading", fileId: FILE, row: 3, value: "5.678", applyToFile: false },
      { kind: "reading", fileId: FILE, row: 1, value: "1234", applyToFile: true },
    ]);
    expect(readiness(files, mixed).files[0]!.readings).toEqual([
      { row: 1, value: "1234" },
      { row: 3, value: "5.678" },
    ]);
  });

  it("IMP-05@PoC FR 7: «застосувати до файлу» never gives another row a reading its currency refuses", () => {
    const f = file(
      checks({
        currency: null,
        clarifications: [
          amountQuestion(1, "1.234", "1234", "1.234"),
          amountQuestion(2, "12,345", "12.345", "12345"),
        ],
      }),
    );
    const r = readiness(
      [f],
      decided([f], [{ kind: "reading", fileId: FILE, row: 1, value: "1234", applyToFile: true }]),
    );
    expect(r.files[0]!.readings).toEqual([{ row: 1, value: "1234" }]);
    expect(r.ready).toBe(false);
    expect(r.refusals[0]).toMatchObject({
      code: "clarifications",
      files: [{ fileId: FILE, rows: [2], count: 1 }],
    });
  });

  it("IMP-05@PoC AC7: with EUR a reading with three decimals is refused", () => {
    const eur = [file(two, FILE, { accountCurrency: "EUR" })];
    expect(() =>
      decided(eur, [{ kind: "reading", fileId: FILE, row: 1, value: "1.234", applyToFile: false }]),
    ).toThrow(expect.objectContaining({ issue: "READING_TOO_PRECISE", index: 0 }));
    expect(() =>
      decided(eur, [{ kind: "reading", fileId: FILE, row: 1, value: "1234", applyToFile: false }]),
    ).not.toThrow();
  });

  it("IMP-05@PoC FR 7: a reading that is not one of the row's two readings is refused", () => {
    expect(() =>
      decided(files, [{ kind: "reading", fileId: FILE, row: 1, value: "12.34", applyToFile: false }]),
    ).toThrow(expect.objectContaining({ issue: "NOT_IN_CHECKS" }));
  });
});

describe("IMP-05@PoC FR 10: decisions on rows, groups, files and the batch", () => {
  const c = checks({ signs: unconfirmedSigns([1, 2, 3]) });

  it("IMP-05@PoC FR 10: a group decision for the file covers its rows; a row's own decision wins; the batch's covers every file", () => {
    const files = [file(c), file(c, OTHER)];
    const d = decided(files, [
      { kind: "group", fileId: FILE, group: "review", action: "accept" },
      { kind: "row", fileId: FILE, row: 2, action: "exclude" },
      { kind: "group", fileId: null, group: "review", action: "flip-sign" },
    ]);
    const r = readiness(files, d);
    expect(r.ready).toBe(true);
    expect(r.files).toMatchObject([
      { fileId: FILE, excluded: [2], flipped: [] },
      { fileId: OTHER, excluded: [], flipped: [1, 2, 3] },
    ]);
  });

  it("IMP-05@PoC FR 10: a decision can be repeated until apply — the later one in a slot replaces the earlier", () => {
    const files = [file(c)];
    const d = decided(files, [
      { kind: "group", fileId: FILE, group: "review", action: "exclude" },
      { kind: "row", fileId: FILE, row: 1, action: "exclude" },
      { kind: "row", fileId: FILE, row: 1, action: "include" },
      { kind: "group", fileId: FILE, group: "review", action: "accept" },
      { kind: "row", fileId: FILE, row: 3, action: "import-anyway" },
    ]);
    expect(d).toHaveLength(3);
    expect(readiness(files, d).files[0]).toMatchObject({ excluded: [], flipped: [], forced: [3] });
  });

  it("IMP-05@PoC FR 10: «прийняти» the group «потребує уточнення» answers its questions as read; «виключити» excludes them", () => {
    const q = checks({ currency: null, clarifications: [amountQuestion(2, "1.234", "1234", "1.234")] });
    const files = [file(q, FILE, { accountCurrency: null })];
    expect(
      readiness(files, decided(files, [{ kind: "group", fileId: null, group: "clarify", action: "accept" }]))
        .ready,
    ).toBe(true);
    const ex = readiness(
      files,
      decided(files, [{ kind: "group", fileId: FILE, group: "clarify", action: "exclude" }]),
    );
    expect(ex.ready).toBe(true);
    expect(ex.files[0]!.excluded).toEqual([2]);
  });

  it("IMP-05@PoC FR 6: «знак картки» is confirmed, or the sign is flipped for the file", () => {
    const card = checks({
      signs: { ...unconfirmedSigns([1, 2, 3]), card: { positive: 3, negative: 0 } },
      flags: [{ code: "card-sign", severity: "review", positive: 3, negative: 0 }],
    });
    const files = [file(card)];
    expect(readiness(files, []).refusals.map((x) => x.code)).toEqual(["review-rows", "flags"]);
    const flipped = readiness(
      files,
      decided(files, [{ kind: "group", fileId: FILE, group: "review", action: "flip-sign" }]),
    );
    expect(flipped.ready).toBe(true);
    expect(flipped.files[0]!.flipped).toEqual([1, 2, 3]);
    const confirmed = decided(files, [
      { kind: "flag", fileId: FILE, code: "card-sign" },
      { kind: "group", fileId: FILE, group: "review", action: "accept" },
    ]);
    expect(readiness(files, confirmed).ready).toBe(true);
  });

  it("IMP-05@PoC FR 10: a decision on an unknown file, a row the file does not have or a flag it does not carry is refused", () => {
    const files = [file(c)];
    expect(() => decided(files, [{ kind: "row", fileId: OTHER, row: 1, action: "accept" }])).toThrow(
      expect.objectContaining({ issue: "UNKNOWN_FILE" }),
    );
    expect(() => decided(files, [{ kind: "row", fileId: FILE, row: 99, action: "accept" }])).toThrow(
      expect.objectContaining({ issue: "NOT_IN_CHECKS" }),
    );
    expect(() => decided(files, [{ kind: "flag", fileId: null, code: "hidden-sheets" }])).toThrow(
      DecisionRefused,
    );
    expect(() =>
      decided(files, [{ kind: "group", fileId: FILE, group: "clarify", action: "flip-sign" }]),
    ).toThrow(DecisionRefused);
  });
});
