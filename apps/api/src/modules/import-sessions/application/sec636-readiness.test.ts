import { describe, expect, it } from "vitest";
import type { StatementChecks } from "../../file-parsers/index.ts";
import {
  checkDecision,
  readiness,
  slotOf,
  type Decided,
  type DecisionInput,
  type FileReview,
} from "./review.ts";

/** Security review of PR #636 (IMP-05@PoC part 2): money integrity of the readiness check. Synthetic values only. */
const FILE = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
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
    accountId: "00000000-0000-4000-8000-0000000000a1",
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

function decided(files: readonly FileReview[], inputs: readonly DecisionInput[]): Decided[] {
  const map = new Map(files.map((f) => [f.batchFileId, f]));
  const slots = new Map<string, Decided>();
  inputs.forEach((d, i) =>
    slots.set(slotOf(d), {
      slot: slotOf(d),
      fileId: d.fileId,
      decision: checkDecision(d, map, i),
      decidedBy: FILE,
      decidedAt: AT,
    }),
  );
  return [...slots.values()];
}

const question = (row: number, cell: string, comma: string, dot: string) =>
  ({
    kind: "amount",
    row,
    cell,
    readings: [
      { decimal: ",", value: comma },
      { decimal: ".", value: dot },
    ],
  }) as const;

describe("SEC-636 IMP-05@PoC FR 7, AC7: «застосувати до файлу» never brings in a reading the currency refuses", () => {
  // The statement names no currency (both readings were kept at the parse); the account is EUR. Row 1 is «1.234»,
  // row 3 is «12,345»: the comma as the decimal separator reads row 1 as 1234 and row 3 as 12.345.
  const mixed = checks({
    currency: null,
    clarifications: [question(1, "1.234", "1234", "1.234"), question(3, "12,345", "12.345", "12345")],
  });
  const files = [file(mixed, FILE, { accountCurrency: "EUR" })];

  it("the same reading sent for the row itself is refused (the guard the file-wide answer must not go round)", () => {
    expect(() =>
      decided(files, [{ kind: "reading", fileId: FILE, row: 3, value: "12.345", applyToFile: false }]),
    ).toThrow(expect.objectContaining({ issue: "READING_TOO_PRECISE" }));
  });

  // Defect at 3a669065: passes as a plain `it` with fix-ac7-apply-to-file.patch applied.
  it("a file-wide answer leaves a row whose reading has three decimals in EUR unanswered, not in the plan", () => {
    const d = decided(files, [{ kind: "reading", fileId: FILE, row: 1, value: "1234", applyToFile: true }]);
    const r = readiness(files, d);
    expect(r.files[0]!.readings).toEqual([{ row: 1, value: "1234" }]);
    expect(r.ready).toBe(false);
    expect(r.refusals).toEqual([
      { code: "clarifications", files: [{ fileId: FILE, rows: [3], count: 1, dateOrder: false }] },
    ]);
  });
});

describe("SEC-636 IMP-05@PoC FR 2, FR 4, FR 11: a decision settles only its own file and its own kind", () => {
  const mismatch = (): StatementChecks =>
    checks({
      account: { status: "mismatch", reasons: [{ kind: "iban", file: "…4821", account: "…1190" }] },
      flags: [
        { code: "foreign-account", severity: "block" },
        { code: "checksum-mismatch", severity: "review", difference: "10.00" },
      ],
    });
  const files = [file(mismatch(), FILE), file(mismatch(), OTHER)];

  it("«Так, це правильний рахунок» and the balance choice of one file leave the other file refused", () => {
    const d = decided(files, [
      { kind: "account", fileId: FILE },
      { kind: "balance", fileId: FILE, choice: "keep" },
    ]);
    const r = readiness(files, d);
    expect(r.ready).toBe(false);
    expect(r.refusals.map((x) => [x.code, x.files.map((f) => f.fileId)])).toEqual([
      ["confirm-account", [OTHER]],
      ["flags", [OTHER]],
    ]);
  });

  it("a flag confirmation (file or batch) is refused for «чужий рахунок» and «розбіжність контрольних сум»", () => {
    for (const code of ["foreign-account", "checksum-mismatch"] as const)
      for (const fileId of [FILE, null])
        expect(() => decided(files, [{ kind: "flag", fileId, code }])).toThrow(
          expect.objectContaining({ issue: "NOT_IN_CHECKS" }),
        );
  });

  it("a stored decision of another kind in the account's or the balance's slot does not settle it", () => {
    const forged: Decided[] = [
      {
        slot: `account:${FILE}`,
        fileId: FILE,
        decision: { kind: "flag", fileId: FILE, code: "foreign-account" },
        decidedBy: FILE,
        decidedAt: AT,
      },
      {
        slot: `balance:${FILE}`,
        fileId: FILE,
        decision: { kind: "account", fileId: FILE },
        decidedBy: FILE,
        decidedAt: AT,
      },
    ];
    const r = readiness([files[0]!], forged);
    expect(r.refusals.map((x) => x.code)).toEqual(["confirm-account", "flags"]);
    expect(r.files[0]!.balance).toBeNull();
  });

  it("a group decision never settles the account, the balance choice or a flag", () => {
    const d = decided(files, [
      { kind: "group", fileId: null, group: "review", action: "accept" },
      { kind: "group", fileId: null, group: "clarify", action: "accept" },
    ]);
    expect(readiness(files, d).refusals.map((x) => x.code)).toEqual(["confirm-account", "flags"]);
  });
});

describe("SEC-636 IMP-05@PoC FR 6, FR 7, FR 10, FR 11: survivors of the mutation run", () => {
  const cardSign = { code: "card-sign", severity: "review", positive: 2, negative: 0 } as const;
  const unconfirmed = (): StatementChecks["signs"] => ({
    rows: [1, 2, 3].map((row) => ({ row, basis: "card" as const, confidence: 0.5, confirmed: false })),
    unconfirmed: [1, 2, 3],
    card: null,
  });

  it("«перевернути знак» for a row is no answer to its amount question", () => {
    const files = [
      file(checks({ currency: null, clarifications: [question(1, "1.234", "1234", "1.234")] }), FILE, {
        accountCurrency: null,
      }),
    ];
    const d = decided(files, [{ kind: "row", fileId: FILE, row: 1, action: "flip-sign" }]);
    expect(readiness(files, d).refusals).toEqual([
      { code: "clarifications", files: [{ fileId: FILE, rows: [1], count: 1, dateOrder: false }] },
    ]);
  });

  it("«прийняти» or «виключити» the group «потребує перегляду» does not confirm «знак картки»", () => {
    const files = [file(checks({ signs: unconfirmed(), flags: [cardSign] }))];
    for (const action of ["accept", "exclude"] as const) {
      const d = decided(files, [{ kind: "group", fileId: FILE, group: "review", action }]);
      expect(readiness(files, d).refusals.map((x) => x.code)).toEqual(["flags"]);
    }
  });

  it("a flag confirmed for one file stays open in the other file that carries it", () => {
    const flag = { code: "hidden-sheets", severity: "review", count: 1 } as const;
    const files = [file(checks({ flags: [flag] }), FILE), file(checks({ flags: [flag] }), OTHER)];
    const d = decided(files, [{ kind: "flag", fileId: FILE, code: "hidden-sheets" }]);
    const r = readiness(files, d);
    expect(r.refusals.map((x) => [x.code, x.files.map((f) => f.fileId)])).toEqual([["flags", [OTHER]]]);
  });

  it("a group or flag decision for a file the batch does not have is refused (no slot outside the batch's files)", () => {
    const files = [file(checks({ flags: [cardSign] }))];
    const unknown = "00000000-0000-4000-8000-00000000dead";
    for (const d of [
      { kind: "group", fileId: unknown, group: "review", action: "accept" },
      { kind: "flag", fileId: unknown, code: "card-sign" },
    ] as const)
      expect(() => decided(files, [d])).toThrow(expect.objectContaining({ issue: "UNKNOWN_FILE" }));
  });
});
