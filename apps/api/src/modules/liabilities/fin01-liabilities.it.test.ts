import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupRealModules, type RealModulesDatabase } from "../../../test/real-modules.ts";
import { createAuditLog, type AuditLog } from "../audit/index.ts";
import { createLiabilities, type Liabilities } from "./index.ts";

/**
 * FIN-01@PoC FR 2, FR 16 on a real PostgreSQL: a liability per account with its terms, audited once, registered again
 * without a second row, and only within its own space. Ids are synthetic; the spaces need no record here.
 */
let db: RealModulesDatabase;
let audit: AuditLog;
let liabilities: Liabilities;

beforeAll(async () => {
  db = await setupRealModules(2);
  audit = createAuditLog(db.databases.for("audit"));
  liabilities = createLiabilities(db.databases.for("liabilities"), audit);
});

afterAll(async () => {
  await db?.close();
});

const loan = { kind: "loan" as const, currency: "EUR", annualRate: "6", monthlyPayment: "650.00" };

describe("FIN-01@PoC FR 2: a loan is a liability with its rate and monthly payment", () => {
  it("FIN-01@PoC FR 2: registering twice keeps one liability and one audit entry", async () => {
    const householdId = randomUUID();
    const accountId = randomUUID();
    const actorAccountId = randomUUID();
    const first = await liabilities.register(householdId, { actorAccountId, accountId, terms: loan });
    const again = await liabilities.register(householdId, {
      actorAccountId,
      accountId,
      terms: { ...loan, annualRate: "7" },
    });
    expect(first.kind).toBe("registered");
    expect(again).toEqual(first);
    const stored = await liabilities.forAccount(householdId, accountId);
    expect(stored).toMatchObject({ kind: "loan", annualRate: "6", gracePeriodDays: null });
    expect(stored?.monthlyPayment?.toDecimalString()).toBe("650");
    if (first.kind !== "registered") throw new Error("not registered");
    const entries = await audit.entriesFor(householdId, {
      type: "liabilities.liability",
      id: first.liability.id,
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.changes).toEqual(
      expect.arrayContaining([
        { field: "annualRate", before: null, after: "6", masked: false },
        { field: "monthlyPayment", before: null, after: "650", masked: false },
      ]),
    );
  });

  it("FIN-01@PoC FR 5: invalid terms are refused and nothing is written", async () => {
    const householdId = randomUUID();
    const result = await liabilities.register(householdId, {
      actorAccountId: randomUUID(),
      accountId: randomUUID(),
      terms: { kind: "loan", currency: "EUR" },
    });
    expect(result.kind).toBe("invalid");
    const { rows } = await db.owner.query(
      `SELECT count(*)::int AS n FROM liabilities.liabilities WHERE household_id = $1`,
      [householdId],
    );
    expect(rows[0]).toEqual({ n: 0 });
  });

  it("FIN-01@PoC AC10: another space does not see the liability", async () => {
    const householdId = randomUUID();
    const accountId = randomUUID();
    await liabilities.register(householdId, { actorAccountId: randomUUID(), accountId, terms: loan });
    expect(await liabilities.forAccount(randomUUID(), accountId)).toBeNull();
  });

  it("FIN-01@PoC FR 16: the database refuses a loan without its terms and a card with a monthly payment", async () => {
    const householdId = randomUUID();
    const insert = (kind: string, rate: string | null, payment: string | null) =>
      db.databases.for("liabilities").inHousehold(householdId, (q) =>
        q.query(
          `INSERT INTO liabilities (household_id, id, account_id, kind, currency, annual_rate, monthly_payment)
           VALUES ($1, $2, $3, $4, 'EUR', $5, $6)`,
          [householdId, randomUUID(), randomUUID(), kind, rate, payment],
        ),
      );
    await expect(insert("loan", null, "650")).rejects.toMatchObject({ code: "23514" });
    await expect(insert("credit-card", null, "10")).rejects.toMatchObject({ code: "23514" });
    await expect(insert("loan", "4.205", "650")).rejects.toMatchObject({ code: "23514" });
  });
});
