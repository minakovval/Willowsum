import { randomUUID } from "node:crypto";
import { Money } from "@willowsum/domain-kernel";
import { createAuditLog } from "../src/modules/audit/index.ts";
import { createSpaceKeys } from "../src/modules/household/index.ts";
import { createLedger } from "../src/modules/ledger/index.ts";
import { createLiabilities } from "../src/modules/liabilities/index.ts";
import { localKeyManagement } from "../src/platform/adapters/kms/index.ts";
import { withErasureDatabases } from "../src/platform/db/erasure-db.ts";
import type { ModuleDatabases } from "../src/platform/db/module-db.ts";
import { urlAs } from "./db.ts";
import { householdSpaces, type RealModulesDatabase } from "./real-modules.ts";

/**
 * Synthetic people for the erasure tests (NFR-12@PoC FR 3, ADR-0013): a confirmed account with its first space, two
 * ledger entries, a money account with a sealed number and a liability (FIN-01), the space's audit entries and a sealed
 * value. Names and values are invented.
 */
export const kms = localKeyManagement();

export async function personWithSpace(db: RealModulesDatabase, label: string) {
  const email = `erasure-${label}.${randomUUID().slice(0, 8)}@example.test`;
  const { rows } = await db.owner.query<{ id: string }>(
    `INSERT INTO identity.accounts (email, email_normalized, display_name, password_hash, email_confirmed_at)
     VALUES ($1, $1, 'Олена Синтетична', '$argon2id$v=19$m=19456,t=2,p=1$synthetic$synthetic', now()) RETURNING id`,
    [email],
  );
  const accountId = rows[0]!.id;
  await db.owner.query(
    `INSERT INTO identity.sessions (account_id, token_digest, expires_at)
     VALUES ($1::uuid, decode(md5($1::uuid::text) || md5($1::uuid::text), 'hex'), now() + interval '1 hour')`,
    [accountId],
  );
  const { householdId } = await householdSpaces(db).ensureFirstSpace({
    accountId,
    displayName: "Олена Синтетична",
  });
  const ledger = createLedger(db.databases.for("ledger"));
  const cash = await ledger.openAccount(
    householdId,
    { module: "accounts", id: randomUUID() },
    { type: "asset", currency: "EUR" },
  );
  for (const [amount, date] of [
    ["-42.17", "2026-10-03"],
    ["1250.00", "2026-10-05"],
  ] as const)
    await ledger.post(householdId, {
      source: { module: "transactions", id: randomUUID() },
      idempotencyKey: randomUUID(),
      operationDate: date,
      event: { type: "transaction", account: cash.id, amount: Money.of(amount, "EUR") },
    });
  const keys = createSpaceKeys(db.databases.for("household"), createAuditLog(db.databases.for("audit")), kms);
  const sealed = await keys.seal(householdId, "iban", ["UA00", "0000", "SYNTH"].join(" "));
  // FIN-01: an account (with its subaccount, owner and a stored create response) and its liability.
  const account = randomUUID();
  await db.databases.for("accounts").inHousehold(householdId, async (q) => {
    await q.query(
      `INSERT INTO accounts (household_id, id, kind, name, institution_key, number_last4, number_sealed, opened_on)
       VALUES ($1, $2, 'loan', 'Синтетичний кредит', '-', 'SYNT', $3, '2026-10-01')`,
      [householdId, account, sealed],
    );
    await q.query(
      `INSERT INTO subaccounts (household_id, id, account_id, currency, position, ledger_account_id, balance_date)
       VALUES ($1, $2, $3, 'EUR', 0, $4, '2026-10-01')`,
      [householdId, randomUUID(), account, randomUUID()],
    );
    await q.query(
      `INSERT INTO account_owners (household_id, account_id, owner_account_id, share, valid_from)
       VALUES ($1, $2, $3, 100, '2026-10-01')`,
      [householdId, account, accountId],
    );
    await q.query(
      `INSERT INTO idempotency_keys (household_id, key, request_hash, expires_at)
       VALUES ($1, $2, repeat('0', 64), now() + interval '1 day')`,
      [householdId, randomUUID()],
    );
  });
  await createLiabilities(
    db.databases.for("liabilities"),
    createAuditLog(db.databases.for("audit")),
  ).register(householdId, {
    actorAccountId: accountId,
    accountId: account,
    terms: { kind: "loan", currency: "EUR", annualRate: "4.2", monthlyPayment: "650" },
  });
  return { email, accountId, householdId, sealed, keys };
}

/** The erasure pools of the test database (one-time logins of the erasure roles, as the owner's script does). */
export function withTestErasureDatabases<T>(
  db: RealModulesDatabase,
  work: (databases: ModuleDatabases) => Promise<T>,
): Promise<T> {
  return withErasureDatabases(
    {
      admin: db.owner as never,
      connectionAs: (role, password) => ({ connectionString: urlAs(db.url, role, password) }),
      context: db.context,
    },
    work,
  );
}

/**
 * Every row of a space as the superuser sees it: each table with a household_id column in any module schema (found
 * from the catalogue, so a table a later module adds is covered), plus the space's login directory rows. Hashed.
 */
export async function spaceRows(
  db: RealModulesDatabase,
  householdId: string,
): Promise<Record<string, string>> {
  const { rows: tables } = await db.owner.query<{ schema: string; table: string }>(
    `SELECT c.table_schema AS schema, c.table_name AS table
       FROM information_schema.columns c
       JOIN information_schema.tables x USING (table_schema, table_name)
      WHERE c.column_name = 'household_id' AND x.table_type = 'BASE TABLE'
        AND c.table_schema NOT IN ('pg_catalog', 'information_schema') AND c.table_schema NOT LIKE 'platform%'
      ORDER BY 1, 2`,
  );
  const out: Record<string, string> = {};
  const digest = async (name: string, from: string) => {
    const { rows } = await db.owner.query(
      `SELECT count(*)::int AS n, coalesce(md5(string_agg(md5(r::text), ',' ORDER BY md5(r::text))), '') AS h FROM ${from} r`,
      [householdId],
    );
    out[name] = `${rows[0].n as number}:${rows[0].h as string}`;
  };
  for (const { schema, table } of tables)
    await digest(`${schema}.${table}`, `(SELECT * FROM "${schema}"."${table}" WHERE household_id = $1)`);
  await digest("household.account_spaces", `(SELECT * FROM household.account_spaces WHERE space_id = $1)`);
  return out;
}

export async function rowCount(db: RealModulesDatabase, householdId: string): Promise<number> {
  return Object.values(await spaceRows(db, householdId)).reduce((n, v) => n + Number(v.split(":")[0]), 0);
}
