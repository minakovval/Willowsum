import { Money } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import {
  duplicateKey,
  normalizeDescription,
  outcomeCounts,
  planBatch,
  planWindow,
  PLAN_WORK_MAX,
  PlanTooLargeError,
  type IncomingRow,
  type KnownTransaction,
  type RowOutcome,
} from "./index.ts";

/**
 * IMP-04@PoC a) (wave 2 row 43): the plan of an import batch, pure. Synthetic rows and ids only; amounts are exact
 * decimals (Money), never floats.
 */
const ACCOUNT = "acc-1";
const BATCH = "batch-new";
const EUR = (a: string) => Money.of(a, "EUR");

let nextRow = 1;
function row(over: Partial<IncomingRow> & { amount: Money; date: string }): IncomingRow {
  return { row: nextRow++, description: null, balance: null, status: "posted", ...over };
}

let nextTx = 1;
function tx(over: Partial<KnownTransaction> & { amount: Money; date: string }): KnownTransaction {
  return {
    transactionId: `t${String(nextTx++).padStart(4, "0")}`,
    accountId: ACCOUNT,
    description: null,
    balanceAfter: null,
    status: "posted",
    source: "imported",
    importBatchId: "batch-old",
    hidden: false,
    transfer: false,
    matched: false,
    ...over,
  };
}

const plan = (
  rows: readonly IncomingRow[],
  existing: readonly KnownTransaction[] = [],
  sameFile: string | null = null,
) => planBatch({ batchId: BATCH, accountId: ACCOUNT, rows, existing, sameFileAppliedIn: sameFile });

/** The rows the apply step creates a transaction for. */
const CREATES = new Set(["import", "repeat", "possible-duplicate", "replace"]);
const created = (outcomes: readonly RowOutcome[]) => outcomes.filter((o) => CREATES.has(o.kind)).length;
const kinds = (outcomes: readonly RowOutcome[]) => outcomes.map((o) => o.kind);

describe("IMP-04@PoC FR 1: the duplicate key and max(0, n − k)", () => {
  it("IMP-04@PoC FR 1: three rows of a key against one transaction of the account — one duplicate, two imported", () => {
    const e = tx({ amount: EUR("-3.20"), date: "2026-05-04", description: "Кава" });
    const rows = [1, 2, 3].map(() => row({ amount: EUR("-3.20"), date: "2026-05-04", description: "Кава" }));
    const out = plan(rows, [e]);
    expect(out[0]).toMatchObject({ kind: "duplicate", of: e.transactionId, occurrence: 1 });
    expect(kinds(out.slice(1))).toEqual(["repeat", "repeat"]);
    expect(created(out)).toBe(2);
  });

  it("IMP-04@PoC FR 1: one row against two transactions of the key — a duplicate, nothing created (max(0, 1 − 2) = 0)", () => {
    const existing = [1, 2].map(() => tx({ amount: EUR("-3.20"), date: "2026-05-04", description: "Кава" }));
    const out = plan([row({ amount: EUR("-3.20"), date: "2026-05-04", description: "Кава" })], existing);
    expect(kinds(out)).toEqual(["duplicate"]);
  });

  it("IMP-04@PoC FR 1: each part of the key counts — another date, amount, currency, description or account is no duplicate", () => {
    const e = tx({ amount: EUR("-3.20"), date: "2026-05-04", description: "Кава" });
    const others = [
      row({ amount: EUR("-3.20"), date: "2026-05-05", description: "Кава" }),
      row({ amount: EUR("-3.21"), date: "2026-05-04", description: "Кава" }),
      row({ amount: Money.of("-3.20", "USD"), date: "2026-05-04", description: "Кава" }),
      row({ amount: EUR("-3.20"), date: "2026-05-04", description: "Чай" }),
    ];
    expect(plan(others, [e]).filter((o) => o.kind === "duplicate")).toEqual([]);
    const elsewhere = tx({
      amount: EUR("-3.20"),
      date: "2026-05-04",
      description: "Кава",
      accountId: "acc-2",
    });
    expect(
      kinds(plan([row({ amount: EUR("-3.20"), date: "2026-05-04", description: "Кава" })], [elsewhere])),
    ).toEqual(["import"]);
  });

  it("IMP-04@PoC FR 1: the balance after the operation is a part of the key when both sides have one", () => {
    const at100 = tx({
      amount: EUR("-3.20"),
      date: "2026-05-04",
      description: "Кава",
      balanceAfter: EUR("100.00"),
    });
    const other = row({
      amount: EUR("-3.20"),
      date: "2026-05-04",
      description: "Кава",
      balance: EUR("96.80"),
    });
    expect(plan([other], [at100])[0]!.kind).not.toBe("duplicate");
    const same = row({ amount: EUR("-3.20"), date: "2026-05-04", description: "Кава", balance: EUR("100") });
    expect(plan([same], [at100])[0]).toMatchObject({ kind: "duplicate", of: at100.transactionId });
    const noBalance = tx({ amount: EUR("-3.20"), date: "2026-05-04", description: "Кава" });
    expect(plan([other], [noBalance])[0]).toMatchObject({ kind: "duplicate", of: noBalance.transactionId });
  });

  it("IMP-04@PoC FR 1: an exact balance match is taken first, so a row without a match of its balance gets the other", () => {
    const a = tx({ amount: EUR("-3.20"), date: "2026-05-04", description: "Кава" });
    const b = tx({
      amount: EUR("-3.20"),
      date: "2026-05-04",
      description: "Кава",
      balanceAfter: EUR("96.80"),
    });
    const first = row({
      amount: EUR("-3.20"),
      date: "2026-05-04",
      description: "Кава",
      balance: EUR("100.00"),
    });
    const second = row({
      amount: EUR("-3.20"),
      date: "2026-05-04",
      description: "Кава",
      balance: EUR("96.80"),
    });
    const out = plan([first, second], [a, b]);
    expect(out.map((o) => (o.kind === "duplicate" ? o.of : o.kind))).toEqual([
      a.transactionId,
      b.transactionId,
    ]);
  });

  it("IMP-04@PoC FR 1: the normalized description — NFKC, lower case, one space, trimmed", () => {
    expect(normalizeDescription("  CARD  PAYMENT\tＳｈｏｐ ")).toBe("card payment shop");
    expect(normalizeDescription(null)).toBe("");
    expect(duplicateKey(ACCOUNT, { date: "2026-03-02", amount: EUR("-3.2"), description: "Кава " })).toBe(
      duplicateKey(ACCOUNT, { date: "2026-03-02", amount: EUR("-3.200"), description: "кава" }),
    );
  });

  it("IMP-04@PoC FR 1: a hidden imported transaction counts (it stays in the balance)", () => {
    const hidden = tx({ amount: EUR("-9.00"), date: "2026-05-04", description: "Таксі", hidden: true });
    expect(
      plan([row({ amount: EUR("-9.00"), date: "2026-05-04", description: "Таксі" })], [hidden])[0],
    ).toMatchObject({
      kind: "duplicate",
      of: hidden.transactionId,
    });
  });
});

describe("IMP-04@PoC FR 2: «повтор у файлі»", () => {
  it("IMP-04@PoC AC1: two «Кава 3,20 EUR» of 2026-05-04 in a file create two transactions, the second «повтор у файлі» № 2", () => {
    const rows = [1, 2].map(() => row({ amount: EUR("-3.20"), date: "2026-05-04", description: "Кава" }));
    const out = plan(rows);
    expect(out).toMatchObject([
      { kind: "import", occurrence: 1 },
      { kind: "repeat", occurrence: 2 },
    ]);
    expect(created(out)).toBe(2);
  });

  it("IMP-04@PoC FR 2: the occurrence is in file order and ignores the printed balance", () => {
    const rows = [
      row({ amount: EUR("-3.20"), date: "2026-05-04", description: "Кава", balance: EUR("100.00") }),
      row({ amount: EUR("-5.00"), date: "2026-05-04", description: "Хліб", balance: EUR("95.00") }),
      row({ amount: EUR("-3.20"), date: "2026-05-04", description: "кава", balance: EUR("91.80") }),
    ];
    expect(plan(rows).map((o) => [o.kind, o.occurrence])).toEqual([
      ["import", 1],
      ["import", 1],
      ["repeat", 2],
    ]);
  });
});

describe("IMP-04@PoC FR 3: the same file again", () => {
  it("IMP-04@PoC AC2: a file applied before — every row «дубль — уже імпортовано», nothing created", () => {
    const rows = [1, 2, 3].map((i) => row({ amount: EUR(`-${i}.00`), date: "2026-05-04" }));
    const out = plan(rows, [], "batch-old");
    expect(out.every((o) => o.kind === "already-imported" && o.batchId === "batch-old")).toBe(true);
    expect(created(out)).toBe(0);
  });

  it("IMP-04@PoC FR 3: the same rows as an earlier import (another file, e.g. renamed) are duplicates by the key, nothing created", () => {
    const rows = [
      row({ amount: EUR("-3.20"), date: "2026-05-04", description: "Кава" }),
      row({ amount: EUR("-3.20"), date: "2026-05-04", description: "Кава" }),
      row({ amount: EUR("1500.00"), date: "2026-05-05", description: "Зарплата" }),
    ];
    const existing = rows.map((r) => tx({ amount: r.amount, date: r.date, description: r.description }));
    expect(kinds(plan(rows, existing))).toEqual(["duplicate", "duplicate", "duplicate"]);
  });
});

describe("IMP-04@PoC FR 4: overlapping periods and another format", () => {
  it("IMP-04@PoC AC3: March imported from CSV, then an XLSX of March–April — March rows are duplicates, only April is imported", () => {
    // The CSV import kept the bank's text as printed; the XLSX prints it in another case and spacing, the amount
    // with another scale.
    const march = [
      tx({ amount: EUR("-12.50"), date: "2026-03-03", description: "CARD PAYMENT  Bakery" }),
      tx({ amount: EUR("2000.00"), date: "2026-03-15", description: "Salary" }),
      tx({ amount: EUR("-80.00"), date: "2026-03-28", description: "Groceries" }),
    ];
    const xlsx = [
      row({ amount: EUR("-12.5"), date: "2026-03-03", description: "card payment bakery" }),
      row({ amount: EUR("2000"), date: "2026-03-15", description: "SALARY" }),
      row({ amount: EUR("-80.000"), date: "2026-03-28", description: " Groceries " }),
      row({ amount: EUR("-15.00"), date: "2026-04-02", description: "Pharmacy" }),
      row({ amount: EUR("2000.00"), date: "2026-04-15", description: "Salary" }),
    ];
    const out = plan(xlsx, march);
    expect(kinds(out)).toEqual(["duplicate", "duplicate", "duplicate", "import", "import"]);
    expect(out.slice(0, 3).map((o) => (o.kind === "duplicate" ? o.of : null))).toEqual(
      march.map((t) => t.transactionId),
    );
  });

  it("IMP-04@PoC EC1: the overlapped rows of a second file are duplicates", () => {
    const first = [1, 2, 3, 4].map((d) =>
      tx({ amount: EUR(`-${d}.00`), date: `2026-06-0${d}`, description: "x" }),
    );
    const second = [3, 4, 5, 6].map((d) =>
      row({ amount: EUR(`-${d}.00`), date: `2026-06-0${d}`, description: "x" }),
    );
    expect(kinds(plan(second, first))).toEqual(["duplicate", "duplicate", "import", "import"]);
  });

  it("IMP-04@PoC EC2: the same account in CSV and XLSX — duplicates by the key", () => {
    const csvRow = tx({ amount: EUR("-7.40"), date: "2026-06-10", description: "Metro Ticket" });
    const xlsxRow = row({ amount: EUR("-7.4"), date: "2026-06-10", description: "METRO TICKET" });
    expect(plan([xlsxRow], [csvRow])[0]).toMatchObject({ kind: "duplicate", of: csvRow.transactionId });
  });
});

describe("IMP-04@PoC FR 5: a manual transaction and «Можливий дубль»", () => {
  it("IMP-04@PoC FR 5: a single manual −42,00 EUR of 2026-04-10 and a row of 2026-04-11 — merged with it (the audit entry and «Роз'єднати» come with the apply step)", () => {
    const manual = tx({ amount: EUR("-42.00"), date: "2026-04-10", source: "manual", importBatchId: null });
    const out = plan(
      [row({ amount: EUR("-42.00"), date: "2026-04-11", description: "RESTAURANT" })],
      [manual],
    );
    expect(out).toEqual([{ row: out[0]!.row, occurrence: 1, kind: "merge", with: manual.transactionId }]);
  });

  it("IMP-04@PoC AC5: two manual −42,00 EUR for one row — «Можливий дубль» to «До розбору», no merge", () => {
    const a = tx({ amount: EUR("-42.00"), date: "2026-04-10", source: "manual", importBatchId: null });
    const b = tx({ amount: EUR("-42.00"), date: "2026-04-12", source: "manual", importBatchId: null });
    const out = plan([row({ amount: EUR("-42.00"), date: "2026-04-11" })], [a, b]);
    expect(out[0]).toMatchObject({
      kind: "possible-duplicate",
      candidates: [a.transactionId, b.transactionId],
    });
    expect(created(out)).toBe(1);
  });

  it("IMP-04@PoC FR 5: a manual one merged by a row is matched for the next row — that one is «Можливий дубль»", () => {
    const manual = tx({ amount: EUR("-42.00"), date: "2026-04-10", source: "manual", importBatchId: null });
    const rows = [
      row({ amount: EUR("-42.00"), date: "2026-04-11", description: "A" }),
      row({ amount: EUR("-42.00"), date: "2026-04-12", description: "B" }),
    ];
    expect(kinds(plan(rows, [manual]))).toEqual(["merge", "possible-duplicate"]);
  });

  it("IMP-04@PoC FR 5: two rows for one manual transaction — the closer date merges, whatever the file order; a tie merges none", () => {
    const manual = tx({ amount: EUR("-42.00"), date: "2026-04-10", source: "manual", importBatchId: null });
    const far = row({ amount: EUR("-42.00"), date: "2026-04-12", description: "A" });
    const near = row({ amount: EUR("-42.00"), date: "2026-04-10", description: "B" });
    expect(plan([far, near], [manual])).toMatchObject([
      { kind: "possible-duplicate", candidates: [manual.transactionId] },
      { kind: "merge", with: manual.transactionId },
    ]);
    const before = row({ amount: EUR("-42.00"), date: "2026-04-09", description: "C" });
    const after = row({ amount: EUR("-42.00"), date: "2026-04-11", description: "D" });
    expect(kinds(plan([before, after], [manual]))).toEqual(["possible-duplicate", "possible-duplicate"]);
  });

  it("IMP-04@PoC FR 5: a manual one matched already, outside ± 3 days, hidden or a side of a transfer — no merge", () => {
    const r = () => row({ amount: EUR("-42.00"), date: "2026-04-11" });
    const manual = (over: Partial<KnownTransaction>) =>
      tx({ amount: EUR("-42.00"), date: "2026-04-10", source: "manual", importBatchId: null, ...over });
    expect(plan([r()], [manual({ matched: true })])[0]!.kind).toBe("possible-duplicate");
    expect(plan([r()], [manual({ date: "2026-04-15" })])[0]!.kind).toBe("import");
    expect(plan([r()], [manual({ hidden: true })])[0]!.kind).toBe("import");
    expect(plan([r()], [manual({ transfer: true })])[0]!.kind).toBe("import");
  });

  it("IMP-04@PoC FR 5: a manual one 3 days before or after the row merges (the window on both sides)", () => {
    const r = () => row({ amount: EUR("-42.00"), date: "2026-04-11" });
    const manual = (date: string) =>
      tx({ amount: EUR("-42.00"), date, source: "manual", importBatchId: null });
    expect(plan([r()], [manual("2026-04-08")])[0]!.kind).toBe("merge");
    expect(plan([r()], [manual("2026-04-14")])[0]!.kind).toBe("merge");
  });

  it("IMP-04@PoC AC11: an imported −25,00 EUR «CARD PAYMENT 4411» of 2026-05-10 from another batch and a row −25,00 of 2026-05-12 «SHOP ONLINE» — «Можливий дубль», nothing merged or hidden", () => {
    const earlier = tx({ amount: EUR("-25.00"), date: "2026-05-10", description: "CARD PAYMENT 4411" });
    const out = plan(
      [row({ amount: EUR("-25.00"), date: "2026-05-12", description: "SHOP ONLINE" })],
      [earlier],
    );
    expect(out[0]).toMatchObject({ kind: "possible-duplicate", candidates: [earlier.transactionId] });
    expect(created(out)).toBe(1);
  });
});

describe("IMP-04@PoC FR 6: «замінено»", () => {
  const pending = (over: Partial<KnownTransaction> = {}) =>
    tx({ amount: EUR("-30.00"), date: "2026-05-01", description: "HOLD SHOP", status: "pending", ...over });

  it("IMP-04@PoC AC6: a posted −30,10 EUR three days after a pending −30,00 of a previous import replaces it", () => {
    const p = pending();
    const out = plan([row({ amount: EUR("-30.10"), date: "2026-05-04", description: "SHOP" })], [p]);
    expect(out[0]).toMatchObject({ kind: "replace", replaces: p.transactionId });
  });

  it("IMP-04@PoC FR 1: a pending row whose key has a pending and a posted transaction is the duplicate of the earlier one", () => {
    const first = pending({ date: "2026-05-04", description: "SHOP" });
    const second = tx({ amount: EUR("-30.00"), date: "2026-05-04", description: "SHOP" });
    const out = plan(
      [row({ amount: EUR("-30.00"), date: "2026-05-04", description: "SHOP", status: "pending" })],
      [second, first],
    );
    expect(out[0]).toMatchObject({ kind: "duplicate", of: first.transactionId });
  });

  it("IMP-04@PoC EC3: pending → posted with the same key is a replacement, not a duplicate", () => {
    const p = pending();
    const out = plan([row({ amount: EUR("-30.00"), date: "2026-05-01", description: "HOLD SHOP" })], [p]);
    expect(out[0]).toMatchObject({ kind: "replace", replaces: p.transactionId });
    const again = row({
      amount: EUR("-30.00"),
      date: "2026-05-01",
      description: "HOLD SHOP",
      status: "pending",
    });
    expect(plan([again], [p])[0]).toMatchObject({ kind: "duplicate", of: p.transactionId });
  });

  it("IMP-04@PoC FR 6: the bounds — 0,25 and 10 days are in, 0,26, 11 days, another currency, a manual or the same batch are out", () => {
    const r = (amount: string, date = "2026-05-04", currency = "EUR") =>
      row({ amount: Money.of(amount, currency), date });
    expect(plan([r("-30.25")], [pending()])[0]!.kind).toBe("replace");
    expect(plan([r("-29.75", "2026-05-11")], [pending()])[0]!.kind).toBe("replace");
    expect(plan([r("-30.26")], [pending()])[0]!.kind).not.toBe("replace");
    expect(plan([r("-30.00", "2026-05-12")], [pending()])[0]!.kind).not.toBe("replace");
    expect(plan([r("-30.00", "2026-05-04", "USD")], [pending()])[0]!.kind).not.toBe("replace");
    expect(plan([r("-30.00")], [pending({ source: "manual", importBatchId: null })])[0]!.kind).not.toBe(
      "replace",
    );
    expect(plan([r("-30.00")], [pending({ importBatchId: BATCH })])[0]!.kind).not.toBe("replace");
  });

  it("IMP-04@PoC FR 6: the posted date is on the pending date or up to 10 days after it, never before", () => {
    expect(plan([row({ amount: EUR("-30.00"), date: "2026-05-01" })], [pending()])[0]!.kind).toBe("replace");
    expect(plan([row({ amount: EUR("-30.00"), date: "2026-04-30" })], [pending()])[0]!.kind).not.toBe(
      "replace",
    );
    expect(plan([row({ amount: EUR("-30.00"), date: "2026-04-22" })], [pending()])[0]!.kind).not.toBe(
      "replace",
    );
  });

  it("IMP-04@PoC FR 6: a posted refund never replaces a pending charge (another sign is not the corresponding row)", () => {
    const hold = pending({ amount: EUR("-0.10"), date: "2026-05-03" });
    const refund = row({ amount: EUR("0.10"), date: "2026-05-04", description: "REFUND" });
    expect(plan([refund], [hold])[0]!.kind).not.toBe("replace");
  });

  it("IMP-04@PoC FR 6: each pending one is replaced once, by the closest amount", () => {
    const p = pending();
    const rows = [
      row({ amount: EUR("-30.20"), date: "2026-05-03" }),
      row({ amount: EUR("-30.05"), date: "2026-05-03" }),
    ];
    const out = plan(rows, [p]);
    expect(out.filter((o) => o.kind === "replace")).toHaveLength(1);
    // File order decides between rows; the first row takes it (the closest pending one for that row).
    expect(out[0]).toMatchObject({ kind: "replace", replaces: p.transactionId });
    expect(plan([rows[1]!], [p, pending({ amount: EUR("-30.24") })])[0]).toMatchObject({
      replaces: p.transactionId,
    });
  });
});

describe("IMP-04@PoC a): the window and the counts", () => {
  it("IMP-04@PoC FR 1: the window is the rows' dates ± 10 days; none for an empty file", () => {
    const rows = [
      row({ amount: EUR("1"), date: "2026-03-05" }),
      row({ amount: EUR("1"), date: "2026-02-27" }),
    ];
    expect(planWindow(rows)).toEqual({ from: "2026-02-17", to: "2026-03-15" });
    expect(planWindow([])).toBeNull();
  });

  it("IMP-04@PoC FR 7: the counts by outcome for the stored result", () => {
    const e = tx({ amount: EUR("-3.20"), date: "2026-05-04", description: "Кава" });
    const rows = [1, 2, 3].map(() => row({ amount: EUR("-3.20"), date: "2026-05-04", description: "Кава" }));
    expect(outcomeCounts(plan(rows, [e]))).toEqual({
      import: 0,
      repeat: 2,
      duplicate: 1,
      "already-imported": 0,
      merge: 0,
      "possible-duplicate": 0,
      replace: 0,
    });
  });
});

describe("IMP-04@PoC a): the work of one plan is bounded", () => {
  const day = (i: number) =>
    new Date(Date.UTC(2026, 0, 1) + (i % 60) * 86_400_000).toISOString().slice(0, 10);

  it("IMP-04@PoC a): 20 000 posted rows against 12 500 pending ones of one amount in the window — refused after bounded work", () => {
    // The work is counted, not timed (a wall-clock limit failed in full parallel runs): every look at a transaction's
    // amount is counted. Unbounded, the plan would look at 20 000 × 12 500 pairs (≥ 250 000 000 reads).
    let reads = 0;
    const existing = Array.from({ length: 12_500 }, (_, i) => {
      const t = tx({ amount: EUR("-3.20"), date: day(i), status: "pending", description: `e ${i}` });
      const amount = t.amount;
      return Object.defineProperty({ ...t }, "amount", {
        enumerable: true,
        get: () => {
          reads++;
          return amount;
        },
      }) as KnownTransaction;
    });
    const rows = Array.from({ length: 20_000 }, (_, i) =>
      row({ amount: EUR("-3.20"), date: day(i), description: `r ${i}` }),
    );
    const started = performance.now();
    expect(() => plan(rows, existing)).toThrow(PlanTooLargeError);
    // The bound itself is pinned: the count below scales with it.
    expect(PLAN_WORK_MAX).toBe(500_000);
    expect(reads).toBeGreaterThan(0);
    expect(reads).toBeLessThanOrEqual(5 * PLAN_WORK_MAX + 10 * existing.length);
    // A backstop only: the bound above is what this test guards.
    expect(performance.now() - started).toBeLessThan(30_000);
  }, 120_000);

  it("IMP-04@PoC a): 20 000 rows against 50 000 posted transactions of spread amounts — planned, not refused", () => {
    const amount = (i: number) => EUR(`-${(i % 997) + 1}.${String(i % 100).padStart(2, "0")}`);
    const existing = Array.from({ length: 50_000 }, (_, i) =>
      tx({ amount: amount(i), date: day(i), description: `e ${i}` }),
    );
    const rows = Array.from({ length: 20_000 }, (_, i) =>
      row({ amount: amount(i * 7), date: day(i), description: `r ${i}` }),
    );
    expect(plan(rows, existing)).toHaveLength(20_000);
  }, 120_000);
});
