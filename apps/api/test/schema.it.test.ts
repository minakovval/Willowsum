import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyHouseholdIsolation } from "../src/platform/db/isolation.ts";
import { migrate } from "../src/platform/db/migrate.ts";
import { schemaProblems, type SchemaExemptions } from "../src/platform/db/schema-rules.ts";
import { createTestDatabase } from "./db.ts";
import { migrateRealModules, realModules } from "./real-modules.ts";

const fixtures = fileURLToPath(new URL("./fixtures/db-modules", import.meta.url));
const none: SchemaExemptions = { tables: {} };

let db: { url: string; drop: () => Promise<void> };
let owner: pg.Client;

beforeAll(async () => {
  db = await createTestDatabase();
  owner = new pg.Client({ connectionString: db.url });
  await owner.connect();
  await migrateRealModules(owner, db.url);
  await migrate(owner, { modules: ["homes", "household"], modulesDir: fixtures });
  // The violations fixture breaks the boundary too (a SECURITY DEFINER function its role can call): its
  // migrations are applied, then the run stops — the schema check below still reports every problem.
  await expect(migrate(owner, { modules: ["violations"], modulesDir: fixtures })).rejects.toThrow(
    /ws_mod_violations can execute SECURITY DEFINER function violations\.elevated\(\)/,
  );
});

afterAll(async () => {
  await owner?.end();
  await db?.drop();
});

describe("ARC-03 criterion «таблиця з даними клієнтів без політики рядків — 0»: CI schema check", () => {
  it("the real modules pass the check (the same check runs in CI: pnpm check:schema)", async () => {
    const exemptions = JSON.parse(
      readFileSync(new URL("../schema-exemptions.json", import.meta.url), "utf8"),
    ) as SchemaExemptions;
    expect(await schemaProblems(owner, realModules, exemptions)).toEqual([]);
  });

  it("the migration runner enables and forces row security with the household policy on a new customer table", async () => {
    expect(await schemaProblems(owner, ["homes"], none)).toEqual([]);
    const { rows } = await owner.query(
      "SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'homes.records'::regclass",
    );
    expect(rows).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);
  });

  it.each([
    [
      "row security disabled",
      "ALTER TABLE homes.records DISABLE ROW LEVEL SECURITY",
      /without row-level security/,
    ],
    [
      "row security not forced",
      "ALTER TABLE homes.records NO FORCE ROW LEVEL SECURITY",
      /without row-level security/,
    ],
    [
      "policy dropped",
      "DROP POLICY household_isolation ON homes.records",
      /without the household_isolation policy/,
    ],
    [
      "another permissive policy",
      "CREATE POLICY open ON homes.records USING (true)",
      /permissive policy open would widen household isolation/,
    ],
    [
      "policy changed",
      "ALTER POLICY household_isolation ON homes.records USING (true)",
      /without the household_isolation policy/,
    ],
  ])("a customer table whose isolation was weakened fails the check (%s)", async (_, sql, problem) => {
    await owner.query("BEGIN");
    try {
      await owner.query(sql);
      expect((await schemaProblems(owner, ["homes"], none)).join("\n")).toMatch(problem);
    } finally {
      await owner.query("ROLLBACK");
    }
    expect(await schemaProblems(owner, ["homes"], none)).toEqual([]);
  });

  it("a restrictive policy may narrow access further", async () => {
    await owner.query("BEGIN");
    try {
      await owner.query(
        "CREATE POLICY only_recent ON homes.records AS RESTRICTIVE USING (at > now() - interval '1 year')",
      );
      expect(await schemaProblems(owner, ["homes"], none)).toEqual([]);
    } finally {
      await owner.query("ROLLBACK");
    }
  });

  it("reports every broken rule: household column, exemptions, amounts, time, region, policy bypasses", async () => {
    const problems = await schemaProblems(owner, ["violations"], {
      tables: {
        "violations.exempted": "Reference data without customer data (test)",
        "violations.gone": "Old",
      },
    });
    expect(problems.sort()).toEqual(
      [
        "violations.plain: no household_id column; customer data needs it, other tables go to schema-exemptions.json with a reason",
        "violations.amounts.amount: numeric columns are NUMERIC(38,18), not numeric(12,2)",
        "violations.amounts.fee_amount: an amount needs its currency column fee_currency",
        "violations.amounts.price: real is not allowed; amounts are NUMERIC(38,18) with a currency code",
        "violations.amounts.total: double precision is not allowed; amounts are NUMERIC(38,18) with a currency code",
        "violations.amounts.cash: money is not allowed; amounts are NUMERIC(38,18) with a currency code",
        "violations.amounts.quantity: numeric columns are NUMERIC(38,18), not numeric",
        "violations.amounts.created: time is UTC; use timestamptz, not timestamp without time zone",
        "violations.amounts.opens: time without time zone is not allowed; use timestamptz (UTC)",
        "violations.amounts.data_region: data_region must be of type platform_types.data_region",
        "violations.leaky: a view must be WITH (security_invoker = true), or it bypasses row policies",
        "violations.snapshot: materialized views and foreign tables cannot carry row policies",
        "violations.elevated(): SECURITY DEFINER functions in module schemas would bypass row policies",
        "ws_mod_violations can execute SECURITY DEFINER function violations.elevated()",
        "schema-exemptions.json: violations.gone does not exist",
        "violations.linked: unique key linked_code_key does not include household_id (it would reveal rows of other households)",
        "violations.linked: foreign key linked_parent_fkey does not include household_id",
      ].sort(),
    );
  });

  it("an exemption needs a reason and cannot cover a customer-data table", async () => {
    const problems = await schemaProblems(owner, ["violations", "homes"], {
      tables: { "violations.exempted": " ", "homes.records": "not customer data" },
    });
    expect(problems).toContain("schema-exemptions.json: violations.exempted needs a reason");
    expect(problems).toContain("homes.records: has household_id but is listed in schema-exemptions.json");
  });

  it("ARC-03 FR 3: the household table must carry its data region («eu») and its own key reference", async () => {
    expect(await schemaProblems(owner, ["household"], none)).toEqual([
      "household.households: needs data_region platform_types.data_region NOT NULL (ARC-03 FR 3)",
      "household.households: needs encryption_key_ref text NOT NULL (ARC-03 FR 3)",
    ]);
    await owner.query("BEGIN");
    try {
      await owner.query(
        `ALTER TABLE household.households ADD COLUMN data_region platform_types.data_region NOT NULL DEFAULT 'eu',
                                          ADD COLUMN encryption_key_ref text NOT NULL DEFAULT 'k'`,
      );
      expect(await schemaProblems(owner, ["household"], none)).toEqual([]);
      await expect(owner.query("SELECT 'us'::platform_types.data_region")).rejects.toThrow(
        /data_region_known/,
      );
    } finally {
      await owner.query("ROLLBACK");
    }
  });

  it("a migration whose household_id is not uuid NOT NULL fails and leaves nothing behind", async () => {
    await expect(migrate(owner, { modules: ["wrong-household"], modulesDir: fixtures })).rejects.toThrow(
      /wrong_household.items: household_id must be uuid NOT NULL/,
    );
    expect((await owner.query("SELECT to_regclass('wrong_household.items') AS t")).rows).toEqual([
      { t: null },
    ]);
  });

  it("isolation is applied idempotently", async () => {
    await applyHouseholdIsolation(owner, "homes");
    expect(await schemaProblems(owner, ["homes"], none)).toEqual([]);
  });
});
