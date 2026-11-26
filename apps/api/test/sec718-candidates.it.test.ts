import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ACCOUNT_CANDIDATES_MAX, createAccountCandidates } from "../src/modules/accounts/index.ts";
import { setupRealModules, type RealModulesDatabase } from "./real-modules.ts";

/** SEC #718: accounts' `AccountCandidates` reads only the caller space's active accounts (real PostgreSQL). */
let db: RealModulesDatabase;
const a = randomUUID();
const b = randomUUID();

async function seed(householdId: string, last4: string | null, status = "active"): Promise<string> {
  const id = randomUUID();
  await db.owner.query(
    `INSERT INTO accounts.accounts (household_id, id, kind, name, institution_name, institution_country, institution_key,
       number_last4, opened_on, status, closed_on)
     VALUES ($1, $2, 'current', 'Synthetic', 'ПУМБ', 'UA', 'ua пумб', $3, '2026-01-01', $4, $5)`,
    [householdId, id, last4, status, status === "closed" ? "2026-02-01" : null],
  );
  return id;
}

beforeAll(async () => {
  db = await setupRealModules();
});
afterAll(async () => {
  await db?.close();
});

describe("SEC #718: account candidates are the caller space's only", () => {
  it("another space's account with the same tail never appears; closed accounts neither; bounded", async () => {
    const mine = await seed(a, "5678");
    await seed(a, "1111", "closed");
    const theirs = await seed(b, "5678");
    const list = await createAccountCandidates(db.databases.for("accounts")).candidates(a);
    expect(list.map((c) => c.accountId)).toEqual([mine]);
    expect(JSON.stringify(list)).not.toContain(theirs);
    expect(list[0]).toEqual({ accountId: mine, institution: "ПУМБ", last4: "5678" });
    expect(Object.keys(list[0]!).sort()).toEqual(["accountId", "institution", "last4"]);
    expect(ACCOUNT_CANDIDATES_MAX).toBeLessThanOrEqual(500);
  });
});
