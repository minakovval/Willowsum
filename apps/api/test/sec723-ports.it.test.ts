import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCreditAccounts } from "../src/modules/accounts/index.ts";
import { createAuditLog } from "../src/modules/audit/index.ts";
import { createLedger } from "../src/modules/ledger/index.ts";
import { createLiabilities } from "../src/modules/liabilities/index.ts";
import { createRecurringLoans } from "../src/modules/recurring/index.ts";
import { createAccountInflows } from "../src/modules/transactions/index.ts";
import { setupRealModules, type RealModulesDatabase } from "./real-modules.ts";

/**
 * Security review of PR #723 (BUD-07@PoC AC9): the two new cross-module ports asked directly with ids of another
 * space — `AccountInflows.inflows` and `createRecurringLoans` (`list`, `debt`). Synthetic data only.
 */
let db: RealModulesDatabase;

beforeAll(async () => {
  db = await setupRealModules(6);
});
afterAll(async () => {
  await db?.close();
});

async function seedInflow(householdId: string, accountId: string, hidden = false, amount = "250.00") {
  const id = randomUUID();
  const cols = await db.owner.query<{
    column_name: string;
    is_nullable: string;
    column_default: string | null;
  }>(
    `SELECT column_name, is_nullable, column_default FROM information_schema.columns
      WHERE table_schema = 'transactions' AND table_name = 'transactions'`,
  );
  const known: Record<string, unknown> = {
    id,
    household_id: householdId,
    account_id: accountId,
    subaccount_id: randomUUID(),
    amount,
    currency: "EUR",
    occurred_on: "2026-11-10",
    hidden,
  };
  const missing = cols.rows.filter(
    (c) => c.is_nullable === "NO" && c.column_default === null && !(c.column_name in known),
  );
  expect(
    missing.map((c) => c.column_name),
    "required columns the seed does not know",
  ).toEqual([]);
  const names = Object.keys(known);
  await db.owner.query(
    `INSERT INTO transactions.transactions (${names.join(", ")}) VALUES (${names.map((_, i) => `$${i + 1}`).join(", ")})`,
    names.map((n) => known[n]),
  );
  return id;
}

describe("BUD-07@PoC AC9: the calendar's ports never read another space", () => {
  it("BUD-07@PoC AC9: AccountInflows gives a space only its own shown inflows, even asked with another space's account id", async () => {
    const [mine, theirs] = [randomUUID(), randomUUID()];
    const [myAccount, theirAccount] = [randomUUID(), randomUUID()];
    const own = await seedInflow(mine, myAccount);
    await seedInflow(theirs, theirAccount);
    await seedInflow(mine, myAccount, true);
    await seedInflow(mine, myAccount, false, "-250.00");
    const port = createAccountInflows(db.databases.for("transactions"));
    expect(await port.inflows(mine, [myAccount, theirAccount], "2026-01-01", "2026-12-31")).toEqual([
      { accountId: myAccount, transactionId: own, date: "2026-11-10" },
    ]);
    expect(await port.inflows(theirs, [myAccount], "2026-01-01", "2026-12-31")).toEqual([]);
    expect(await port.inflows(mine, [], "2026-01-01", "2026-12-31")).toEqual([]);
  });

  it("BUD-07@PoC AC9: createRecurringLoans lists no loans of an unknown space and refuses a journal account that is not the space's", async () => {
    const audit = createAuditLog(db.databases.for("audit"));
    const loans = createRecurringLoans({
      credit: createCreditAccounts(db.databases.for("accounts")),
      liabilities: createLiabilities(db.databases.for("liabilities"), audit),
      inflows: createAccountInflows(db.databases.for("transactions")),
      ledger: createLedger(db.databases.for("ledger")),
    });
    expect(await loans.list(randomUUID())).toEqual([]);
    await expect(loans.debt(randomUUID(), randomUUID(), "2026-11-18")).rejects.toThrow();
  });
});
