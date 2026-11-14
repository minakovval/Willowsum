import { randomUUID } from "node:crypto";
import { Money } from "@willowsum/domain-kernel";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { databaseLedgerStore } from "../src/modules/ledger/adapters/index.ts";
import { balanceAt as balanceWith, post as postWith } from "../src/modules/ledger/application/index.ts";
import { createLedger, type Ledger, type LedgerAccount } from "../src/modules/ledger/index.ts";
import { realModules, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";

/**
 * Security review of PR #122 (FIN-04@PoC part 1): the ledger's database guards, probed with SQL in the ledger
 * module's own role (as a bug in module code would run it), in another module's role and as the owner.
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

const eur = (amount: string) => Money.of(amount, "EUR");
const code = (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (e: { code?: string }) => e.code ?? String(e),
  );

async function space(): Promise<{ householdId: string; cash: LedgerAccount; savings: LedgerAccount }> {
  const householdId = randomUUID();
  const open = () =>
    ledger.openAccount(
      householdId,
      { module: "accounts", id: randomUUID() },
      { type: "asset", currency: "EUR" },
    );
  return { householdId, cash: await open(), savings: await open() };
}

const transfer = (s: Awaited<ReturnType<typeof space>>, amount: string, date = "2026-06-15") =>
  ledger.post(s.householdId, {
    source: { module: "transactions", id: randomUUID() },
    idempotencyKey: randomUUID(),
    operationDate: date,
    event: { type: "transfer", from: s.cash.id, to: s.savings.id, amount: eur(amount) },
  });

/** Several statements in one transaction of the ledger role, bound to a space; resolves to the SQLSTATE or "ok". */
const asLedger = (householdId: string, statements: [string, unknown[]][]) =>
  code(
    db.databases.for("ledger").inHousehold(householdId, async (q) => {
      for (const [sql, values] of statements) await q.query(sql, values);
    }),
  );

const ENTRY = `INSERT INTO entries (household_id, id, source_module, source_id, event_type, operation_date,
  rules_version, idempotency_key) VALUES ($1, $2::uuid, 'transactions', $2::uuid, 'transfer', $3, 1, $2::uuid::text)`;
const POSTING = `INSERT INTO postings VALUES ($1, $2, $3, $4, $5, $6, 'EUR')`;

describe("sec122 FIN-04 FR 2 / AC2: a posting set is written whole, in one transaction, and never grows later", () => {
  // Guarded by the constraint trigger postings_with_their_entry: a posting added later to a committed entry would
  // change the atomic set of FR 2 and history on earlier dates, and «as known at» a moment before the insert would
  // show it, since entries.recorded_at keeps the old time.
  it("a posting cannot be added to an entry committed in an earlier transaction", async () => {
    const s = await space();
    const entry = await transfer(s, "10");
    expect(
      await asLedger(s.householdId, [
        [POSTING, [s.householdId, entry.id, 2, s.savings.id, s.cash.id, "1000000"]],
      ]),
    ).not.toBe("ok");
  });

  it("«as known at» a past moment does not change after that moment", async () => {
    const s = await space();
    const entry = await transfer(s, "10", "2026-01-10");
    const before = await ledger.balanceAt(s.householdId, s.savings.id, "2026-12-31", {
      asKnownAt: entry.recordedAt,
    });
    await asLedger(s.householdId, [[POSTING, [s.householdId, entry.id, 2, s.savings.id, s.cash.id, "500"]]]);
    const after = await ledger.balanceAt(s.householdId, s.savings.id, "2026-12-31", {
      asKnownAt: entry.recordedAt,
    });
    expect(after.toDecimalString()).toBe(before.toDecimalString());
  });

  // Guarded by the constraint trigger entries_have_postings, at commit (not only by part 2's daily check).
  it("an entry with no postings is refused at commit", async () => {
    const s = await space();
    expect(await asLedger(s.householdId, [[ENTRY, [s.householdId, randomUUID(), "2026-06-01"]]])).not.toBe(
      "ok",
    );
  });

  it("an entry with its postings in the same transaction is accepted (the way post() writes)", async () => {
    const s = await space();
    const id = randomUUID();
    expect(
      await asLedger(s.householdId, [
        [ENTRY, [s.householdId, id, "2026-06-01"]],
        [POSTING, [s.householdId, id, 1, s.savings.id, s.cash.id, "5"]],
        [POSTING, [s.householdId, id, 2, s.savings.id, s.cash.id, "0.000000000000000001"]],
      ]),
    ).toBe("ok");
    expect((await ledger.balanceAt(s.householdId, s.savings.id, "2026-06-01")).toDecimalString()).toBe(
      "5.000000000000000001",
    );
  });
});

describe("sec122 ARC-03: a space cannot write into or read another space's journal", () => {
  it("rows for another household are refused by the policy; reads of it see nothing", async () => {
    const mine = await space();
    const other = await space();
    const theirs = await transfer(other, "3");
    const id = randomUUID();
    expect(await asLedger(mine.householdId, [[ENTRY, [other.householdId, id, "2026-06-01"]]])).toBe("42501");
    expect(
      await asLedger(mine.householdId, [
        [POSTING, [other.householdId, theirs.id, 9, other.savings.id, other.cash.id, "1"]],
      ]),
    ).toBe("42501");
    expect(
      await asLedger(mine.householdId, [
        [
          `INSERT INTO accounts (household_id, id, type, currency, service_kind) VALUES ($1, $2, 'equity', 'EUR', 'adjustment')`,
          [other.householdId, randomUUID()],
        ],
      ]),
    ).toBe("42501");
    const seen = await db.databases.for("ledger").inHousehold(mine.householdId, async (q) => {
      const n: number[] = [];
      for (const t of ["accounts", "entries", "postings"])
        n.push(
          (
            await q.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${t} WHERE household_id = $1`, [
              other.householdId,
            ])
          ).rows[0]!.n,
        );
      return n;
    });
    expect(seen).toEqual([0, 0, 0]);
    expect(await code(ledger.balanceAt(mine.householdId, other.savings.id, "2026-12-31"))).toBe(
      "UNKNOWN_ACCOUNT",
    );
  });
});

describe("sec122 least privilege: only the ledger's own roles hold rights on its tables", () => {
  it("no other role has any table privilege on ledger.*; the module role has SELECT and INSERT only", async () => {
    const { rows } = await db.owner.query<{ grantee: string; table_name: string; privilege_type: string }>(
      `SELECT grantee, table_name, privilege_type FROM information_schema.role_table_grants
        WHERE table_schema = 'ledger' AND grantee NOT IN ('ws_own_ledger') ORDER BY 1, 2, 3`,
    );
    // ADR-0013 option A (the owner's decision of 2026-11-13): besides the module role, only the erasure role, with
    // SELECT and DELETE on the journal tables (with the rates of cross-currency entries) (its triggers let it delete a whole space only) and on the queue
    // tables (ARC-11: the space's events and jobs go with its journal) and the balance cache — nothing else.
    expect(
      rows
        .filter((r) => r.grantee !== "ws_mod_ledger")
        .map((r) => `${r.grantee}:${r.table_name}:${r.privilege_type}`),
    ).toEqual([
      "ws_era_ledger:accounts:DELETE",
      "ws_era_ledger:accounts:SELECT",
      "ws_era_ledger:balance_versions:DELETE",
      "ws_era_ledger:balance_versions:SELECT",
      "ws_era_ledger:conversions:DELETE",
      "ws_era_ledger:conversions:SELECT",
      "ws_era_ledger:daily_balances:DELETE",
      "ws_era_ledger:daily_balances:SELECT",
      "ws_era_ledger:entries:DELETE",
      "ws_era_ledger:entries:SELECT",
      "ws_era_ledger:jobs:DELETE",
      "ws_era_ledger:jobs:SELECT",
      "ws_era_ledger:outbox_events:DELETE",
      "ws_era_ledger:outbox_events:SELECT",
      "ws_era_ledger:postings:DELETE",
      "ws_era_ledger:postings:SELECT",
    ]);
    expect(
      [
        ...new Set(
          rows.filter((r) => r.grantee === "ws_mod_ledger").map((r) => `${r.table_name}:${r.privilege_type}`),
        ),
      ].sort(),
    ).toEqual([
      "accounts:SELECT",
      // ARC-11 «Баланси і продуктивність»: the daily balance cache is derived from the postings, not the journal: it is
      // changed in place and rebuilt from them (migrations/0006_balance_cache.sql). The row policy keeps it in one space.
      "balance_versions:DELETE",
      "balance_versions:INSERT",
      "balance_versions:SELECT",
      "balance_versions:UPDATE",
      // FIN-04 EC1 / ARC-11: the rates of cross-currency entries are journal rows, append-only (0007_conversions.sql).
      "conversions:INSERT",
      "conversions:SELECT",
      "daily_balances:DELETE",
      "daily_balances:INSERT",
      "daily_balances:SELECT",
      "daily_balances:UPDATE",
      "entries:SELECT",
      // FIN-04 FR 10: the claim log of the integrity letter, append-only like the journal.
      "integrity_alerts:INSERT",
      "integrity_alerts:SELECT",
      // ARC-04 / ARC-11: the queue tables are not the journal: the worker marks events dispatched and jobs done,
      // and the retention cleanup deletes old ones (platform/queue). The row policy keeps them in one space.
      "jobs:DELETE",
      "jobs:INSERT",
      "jobs:SELECT",
      "jobs:UPDATE",
      "outbox_events:DELETE",
      "outbox_events:INSERT",
      "outbox_events:SELECT",
      "outbox_events:UPDATE",
      "postings:INSERT",
      "postings:SELECT",
    ]);
    // The column grants on accounts and entries exclude the times the database sets (the queue tables and the balance
    // cache, listed above, are not the journal).
    const cols = await db.owner.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.column_privileges
        WHERE table_schema = 'ledger' AND grantee = 'ws_mod_ledger' AND privilege_type IN ('UPDATE', 'REFERENCES')
          AND table_name NOT IN ('jobs', 'outbox_events', 'balance_versions', 'daily_balances')`,
    );
    expect(cols.rows).toEqual([]);
  });

  it("every other module's role is refused reads and writes on the ledger tables", async () => {
    const s = await space();
    for (const module of realModules.filter((m) => m !== "ledger")) {
      for (const sql of [
        `SELECT 1 FROM ledger.entries`,
        `SELECT 1 FROM ledger.postings`,
        `SELECT 1 FROM ledger.accounts`,
        `INSERT INTO ledger.postings VALUES ($1, gen_random_uuid(), 1, gen_random_uuid(), gen_random_uuid(), 1, 'EUR')`,
      ]) {
        const values = sql.includes("$1") ? [s.householdId] : [];
        expect(
          await code(db.databases.for(module).inHousehold(s.householdId, (q) => q.query(sql, values))),
          `${module}: ${sql}`,
        ).toBe("42501");
      }
    }
  });

  it("append-only holds for the schema owner role (row policy hides every row) and the superuser (triggers)", async () => {
    const s = await space();
    const entry = await transfer(s, "4");
    for (const sql of [
      `UPDATE ledger.postings SET amount = amount + 1 WHERE entry_id = $1`,
      `DELETE FROM ledger.postings WHERE entry_id = $1`,
      `UPDATE ledger.entries SET operation_date = '2030-01-01' WHERE id = $1`,
      `UPDATE ledger.accounts SET currency = 'USD' WHERE id = (SELECT credit_account_id FROM ledger.postings WHERE entry_id = $1)`,
    ])
      expect(
        await code(
          (async () => {
            await db.owner.query("BEGIN");
            try {
              await db.owner.query("SET LOCAL ROLE ws_own_ledger");
              const { rowCount } = await db.owner.query(sql, [entry.id]);
              if (rowCount !== 0) throw new Error(`owner changed ${rowCount} rows`);
            } finally {
              await db.owner.query("ROLLBACK");
            }
            await db.owner.query(sql, [entry.id]);
          })(),
        ),
        sql,
      ).toBe("42501");
  });
});

describe("sec122 FIN-04 FR 6 / AC4: a balance on a date never counts later-dated entries", () => {
  it("an entry dated the next day, recorded first, is not in the balance; one dated the same day is", async () => {
    const s = await space();
    await transfer(s, "100", "2026-07-01");
    await transfer(s, "0.01", "2026-06-30");
    expect((await ledger.balanceAt(s.householdId, s.savings.id, "2026-06-30")).toDecimalString()).toBe(
      "0.01",
    );
    expect((await ledger.balanceAt(s.householdId, s.cash.id, "2026-06-30")).toDecimalString()).toBe("-0.01");
    expect((await ledger.balanceAt(s.householdId, s.savings.id, "2026-07-01")).toDecimalString()).toBe(
      "100.01",
    );
  });

  it("amounts are exact decimals end to end (no float rounding)", async () => {
    const s = await space();
    await transfer(s, "0.1");
    await transfer(s, "0.2");
    await transfer(s, "12345678901234567890.123456789012345678");
    expect((await ledger.balanceAt(s.householdId, s.savings.id, "2026-06-30")).toDecimalString()).toBe(
      "12345678901234567890.423456789012345678",
    );
  });
});

describe("sec122 ARC-03 defence in depth: the module's SQL filters by space even where the row policy is absent", () => {
  /** The ledger store over the superuser connection, which bypasses row policies: only the code's filter is left. */
  const noPolicy = () =>
    databaseLedgerStore({
      inHousehold: async (householdId: string, work: (q: never) => Promise<unknown>) => {
        await db.owner.query("SET search_path = ledger");
        try {
          return await work({
            householdId,
            query: (sql: string, values?: unknown[]) => db.owner.query(sql, values),
          } as never);
        } finally {
          await db.owner.query("RESET search_path");
        }
      },
    } as never);

  it("another space's account is unknown and its postings are not summed", async () => {
    const mine = await space();
    const other = await space();
    await transfer(other, "9");
    const deps = { store: noPolicy(), newId: randomUUID };
    expect(await code(balanceWith(deps, mine.householdId, other.savings.id, "2026-12-31"))).toBe(
      "UNKNOWN_ACCOUNT",
    );
    expect(
      await code(
        postWith(deps, mine.householdId, {
          source: { module: "transactions", id: randomUUID() },
          idempotencyKey: randomUUID(),
          operationDate: "2026-06-15",
          event: { type: "transfer", from: mine.cash.id, to: other.savings.id, amount: eur("1") },
        }),
      ),
    ).toBe("UNKNOWN_ACCOUNT");
    // The same account id posted from two spaces would only collide in a forged row; sums stay per space.
    const forged = await space();
    await db.owner.query(
      `INSERT INTO ledger.accounts (household_id, id, type, currency, owner_module, owner_id)
      VALUES ($1, $2, 'asset', 'EUR', 'accounts', gen_random_uuid())`,
      [forged.householdId, other.savings.id],
    );
    expect(
      (await balanceWith(deps, forged.householdId, other.savings.id, "2026-12-31")).toDecimalString(),
    ).toBe("0");
  });
});
