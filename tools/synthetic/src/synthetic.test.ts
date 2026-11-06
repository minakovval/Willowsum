import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  Rng,
  defineSyntheticTable,
  generate,
  loadModuleGenerators,
  syntheticHouseholds,
  toCsv,
  toSql,
  type SyntheticTable,
} from "./index.ts";

// Shapes of the future asset and transaction tables, at the volumes ARC-03 FR 6 asks per household.
const assets = defineSyntheticTable({
  table: "fixture.assets",
  perHousehold: 10_000,
  *rows({ household, rng, count }) {
    for (let i = 0; i < count; i++)
      yield {
        id: rng.uuid(),
        household_id: household.id,
        value_amount: rng.amount(9, 2),
        value_currency: rng.pick(["EUR", "UAH", "USD"]),
      };
  },
});
const transactions = defineSyntheticTable({
  table: "fixture.transactions",
  perHousehold: 100_000,
  *rows({ household, rng, count }) {
    for (let i = 0; i < count; i++)
      yield {
        id: rng.uuid(),
        household_id: household.id,
        amount: rng.amount(6, 2, 70),
        currency: "EUR",
        booked_at: rng.instant("2025-01-01T00:00:00Z", 365),
      };
  },
});

function digest(tables: readonly SyntheticTable[], seed: string, households = 1): { hash: string; counts: Record<string, number> } {
  const hash = createHash("sha256");
  const counts: Record<string, number> = {};
  for (const chunk of toCsv(generate({ seed, households, tables }))) {
    hash.update(chunk.text);
    if (!chunk.header) counts[chunk.table] = (counts[chunk.table] ?? 0) + 1;
  }
  return { hash: hash.digest("hex"), counts };
}

describe("ARC-03 FR 6: a script generates synthetic data for tests and staging", () => {
  it("10 000 assets and 100 000 transactions per household, streamed, in seconds", () => {
    const started = Date.now();
    const { counts } = digest([assets, transactions], "size");
    expect(counts).toEqual({ "fixture.assets": 10_000, "fixture.transactions": 100_000 });
    expect(Date.now() - started).toBeLessThan(60_000);
  }, 120_000);

  it("is deterministic: the same seed gives the same data; another seed other data", () => {
    const small = { "fixture.assets": 50, "fixture.transactions": 200 };
    const run = (seed: string) =>
      createHash("sha256")
        .update([...toCsv(generate({ seed, households: 2, tables: [assets, transactions], counts: small }))].map((c) => c.text).join(""))
        .digest("hex");
    expect(run("a")).toBe(run("a"));
    expect(run("a")).not.toBe(run("b"));
  });

  it("adding a table does not change the data of another table", () => {
    const only = [...generate({ seed: "s", households: 1, tables: [assets], counts: { "fixture.assets": 5 } })];
    const both = [
      ...generate({ seed: "s", households: 1, tables: [transactions, assets], counts: { "fixture.assets": 5, "fixture.transactions": 3 } }),
    ].filter((r) => r.table === "fixture.assets");
    expect(both.map((r) => r.row)).toEqual(only.map((r) => r.row));
  });

  it("households are synthetic, in region «eu», each with its own key reference", () => {
    const hs = syntheticHouseholds("seed", 3);
    expect(new Set(hs.map((h) => h.id)).size).toBe(3);
    expect(new Set(hs.map((h) => h.encryptionKeyRef)).size).toBe(3);
    expect(hs.every((h) => h.dataRegion === "eu" && h.name.startsWith("Synthetic household"))).toBe(true);
    expect(syntheticHouseholds("seed", 3)).toEqual(hs);
  });

  it("a row of one household never names another household; row counts are exact", () => {
    const wrong = defineSyntheticTable({
      table: "fixture.wrong",
      perHousehold: 1,
      *rows() {
        yield { household_id: "00000000-0000-4000-8000-000000000000" };
      },
    });
    expect(() => [...generate({ seed: "s", households: 1, tables: [wrong] })]).toThrow(/names another household/);
    const short = defineSyntheticTable({ table: "fixture.short", perHousehold: 2, *rows() {} });
    expect(() => [...generate({ seed: "s", households: 1, tables: [short] })]).toThrow(/produced 0 rows/);
    expect(() => [...generate({ seed: "s", households: 1, tables: [assets], counts: { "x.y": 1 } })]).toThrow(
      /No synthetic generator for x.y/,
    );
  });

  it("amounts are decimal strings built without floats; UUIDs are version-4 shaped", () => {
    const rng = new Rng("amounts");
    for (let i = 0; i < 1000; i++) expect(rng.amount(20, 18, 50)).toMatch(/^-?[1-9][0-9]{0,19}\.[0-9]{18}$/);
    expect(rng.uuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("writes CSV that PostgreSQL COPY reads (quotes, null) and a psql script", () => {
    const t = defineSyntheticTable({
      table: "fixture.text",
      perHousehold: 1,
      *rows() {
        yield { a: 'say "hi", ok', b: null, c: "" };
      },
    });
    const rows = () => generate({ seed: "s", households: 1, tables: [t] });
    expect([...toCsv(rows())].map((c) => c.text).join("")).toBe('a,b,c\n"say ""hi"", ok",,""\n');
    expect([...toSql(rows())].join("")).toContain('COPY fixture.text (a,b,c) FROM stdin WITH (FORMAT csv);\n"say ""hi"", ok",,""\n\\.\n');
  });

  it("modules register their generators: every module's synthetic.ts is found", async () => {
    const tables = await loadModuleGenerators(fileURLToPath(new URL("../../../apps/api/src/modules", import.meta.url)));
    expect(tables.map((t) => t.table)).toContain("audit.entries");
  });
});
