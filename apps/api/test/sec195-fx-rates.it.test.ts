import { randomUUID } from "node:crypto";
import { exchangeRate, Money } from "@willowsum/domain-kernel";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLedger, type Ledger, type LedgerAccount } from "../src/modules/ledger/index.ts";
import { setupRealModules, type RealModulesDatabase } from "./real-modules.ts";

/**
 * Security review of #195 (FIN-04 EC1, ARC-11 «Незбалансований запис у журналі»): the commit-time check that a
 * cross-currency entry keeps its rate must hold for direct INSERTs as the module role, whatever the session does with
 * `SET CONSTRAINTS`. Synthetic data only.
 */

let db: RealModulesDatabase;
let ledger: Ledger;

beforeAll(async () => {
  db = await setupRealModules(4);
  ledger = createLedger(db.databases.for("ledger"));
});

afterAll(async () => {
  await db?.close();
});

const code = (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (e: { code?: string }) => e.code ?? String(e),
  );

describe("ARC-11@PoC criterion «Незбалансований запис у журналі»: a cross-currency entry without its rate is refused for direct INSERTs", () => {
  const ENTRY = `INSERT INTO entries (household_id, id, source_module, source_id, event_type, operation_date, rules_version, idempotency_key)
                 VALUES ($1, $2::uuid, 'transactions', $2::uuid, 'fx-transfer', '2026-06-15', 1, $2::uuid::text)`;
  const POSTING = `INSERT INTO postings VALUES ($1, $2, $3, $4, $5, $6, $7)`;

  let householdId: string;
  let eurCash: LedgerAccount;
  let usdCash: LedgerAccount;
  let fxEur: string;
  let fxUsd: string;

  beforeAll(async () => {
    householdId = randomUUID();
    const open = (currency: string) =>
      ledger.openAccount(householdId, { module: "accounts", id: randomUUID() }, { type: "asset", currency });
    eurCash = await open("EUR");
    usdCash = await open("USD");
    await ledger.post(householdId, {
      source: { module: "transactions", id: randomUUID() },
      idempotencyKey: randomUUID(),
      operationDate: "2026-06-15",
      event: {
        type: "fx-transaction",
        account: eurCash.id,
        amount: Money.of("1", "USD"),
        settled: Money.of("1", "EUR"),
        rate: exchangeRate({ base: "EUR", quote: "USD", rate: "1", date: "2026-06-15", source: "synthetic" }),
      },
    });
    const { rows } = await db.owner.query<{ id: string }>(
      `SELECT id FROM ledger.accounts WHERE household_id = $1 AND service_kind = 'fx-difference' ORDER BY currency`,
      [householdId],
    );
    [fxEur, fxUsd] = rows.map((r) => r.id) as [string, string];
  });

  const twoCurrencyPairsWithoutRate = (before: string) =>
    code(
      db.databases.for("ledger").inHousehold(householdId, async (q) => {
        await q.query(`DELETE FROM daily_balances`);
        await q.query(`DELETE FROM balance_versions`);
        if (before) await q.query(before);
        const id = randomUUID();
        await q.query(ENTRY, [householdId, id]);
        await q.query(POSTING, [householdId, id, 1, fxUsd, usdCash.id, "10", "USD"]);
        await q.query(POSTING, [householdId, id, 2, eurCash.id, fxEur, "9", "EUR"]);
      }),
    );

  it("ARC-11@PoC criterion «Незбалансований запис у журналі»: refused at commit (the PR's path)", async () => {
    expect(await twoCurrencyPairsWithoutRate("")).toBe("23514");
  });

  // The check is a constraint trigger on `entries` and on `postings`: made IMMEDIATE, it still runs after the last
  // posting, so the two-currency entry cannot commit without its rate.
  it("ARC-11@PoC criterion «Незбалансований запис у журналі»: refused even when the session sets the check IMMEDIATE", async () => {
    expect(
      await twoCurrencyPairsWithoutRate("SET CONSTRAINTS entries_rates_match_currencies IMMEDIATE"),
    ).toBe("23514");
  });

  // Survivor of mutant M15 (CHECK currency <> entry_currency removed): only the row CHECK refuses a «rate» from a
  // currency into itself on a one-currency entry (the commit check sees its currency among the rate's).
  it("ARC-11@PoC criterion «Незбалансований запис у журналі»: a rate from a currency into the same currency is refused", async () => {
    expect(
      await code(
        db.databases.for("ledger").inHousehold(householdId, async (q) => {
          await q.query(`DELETE FROM daily_balances`);
          await q.query(`DELETE FROM balance_versions`);
          const id = randomUUID();
          await q.query(ENTRY, [householdId, id]);
          await q.query(POSTING, [householdId, id, 1, eurCash.id, fxEur, "9", "EUR"]);
          await q.query(
            `INSERT INTO conversions (household_id, entry_id, seq, currency, amount, entry_currency, entry_amount, rate,
               rate_date, rate_source, converted) VALUES ($1, $2, 1, 'EUR', '9', 'EUR', '9', '1', '2026-06-15', 'synthetic', '9')`,
            [householdId, id],
          );
        }),
      ),
    ).toBe("23514");
  });
});
