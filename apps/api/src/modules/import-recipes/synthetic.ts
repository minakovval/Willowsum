// Synthetic parsing recipes (ARC-03 FR 6) for tests and staging; loaded by tools/synthetic. Never real data. Each space
// gets a recipe without an account binding; its audit hand-off job is done; the module publishes no events:
// outbox_events gets one dispatched row for the isolation check.
import { createHash } from "node:crypto";
import { defineSyntheticTable } from "@willowsum/synthetic";

function key(householdId: string, table: string, n: number): string {
  const h = createHash("sha256").update(`${householdId}/import-recipes/${table}/${n}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export const synthetic = [
  defineSyntheticTable({
    table: "import_recipes.recipes",
    perHousehold: 1,
    *rows({ household, count }) {
      for (let i = 0; i < count; i++)
        yield {
          household_id: household.id,
          id: key(household.id, "recipe", i),
          name: i === 0 ? "Синтетичний банк, CSV" : `Рецепт ${i + 1}`,
          schema_version: "1",
          recipe: JSON.stringify({
            schemaVersion: 1,
            file: { encoding: "utf-8", delimiter: ";", headerRow: 1 },
            columns: [
              { column: 1, role: "date" },
              { column: 4, role: "amount" },
            ],
            sign: { mode: "invert" },
          }),
          account_value_sealed: null,
          account_value_last4: null,
          fingerprint: `fp1:${"0".repeat(64)}`,
          created_by: key(household.id, "account", 0),
          created_at: "2026-10-15T10:00:00Z",
        };
    },
  }),
  defineSyntheticTable({
    // IMP-07 FR 2: each synthetic template's version 1 (the same recipe).
    table: "import_recipes.recipe_versions",
    perHousehold: 1,
    *rows({ household, count }) {
      for (let i = 0; i < count; i++)
        yield {
          household_id: household.id,
          recipe_id: key(household.id, "recipe", i),
          version: "1",
          name: i === 0 ? "Синтетичний банк, CSV" : `Рецепт ${i + 1}`,
          account_id: null,
          schema_version: "1",
          recipe: JSON.stringify({
            schemaVersion: 1,
            file: { encoding: "utf-8", delimiter: ";", headerRow: 1 },
            columns: [
              { column: 1, role: "date" },
              { column: 4, role: "amount" },
            ],
            sign: { mode: "invert" },
          }),
          account_value_sealed: null,
          account_value_last4: null,
          fingerprint: `fp1:${"0".repeat(64)}`,
          saved_by: key(household.id, "account", 0),
          saved_at: "2026-10-15T10:00:00Z",
        };
    },
  }),
  defineSyntheticTable({
    table: "import_recipes.idempotency_keys",
    perHousehold: 1,
    *rows({ household, rng, count }) {
      for (let i = 0; i < count; i++)
        yield {
          household_id: household.id,
          key: rng.uuid(),
          request_hash: "0".repeat(64),
          state: "pending",
          response_status: null,
          response_body: null,
          expires_at: "2026-12-31T00:00:00Z",
        };
    },
  }),
  defineSyntheticTable({
    table: "import_recipes.jobs",
    perHousehold: 1,
    *rows({ household, rng, count }) {
      for (let i = 0; i < count; i++)
        yield {
          id: rng.uuid(),
          household_id: household.id,
          name: "import-recipes.hand-off",
          dedupe_key: `import-recipes.recipe:create:${key(household.id, "recipe", i)}:${rng.uuid()}`,
          payload: "{}",
          state: "done",
          attempts: "1",
          finished_at: "2026-10-15T10:00:00Z",
        };
    },
  }),
  defineSyntheticTable({
    table: "import_recipes.outbox_events",
    perHousehold: 1,
    *rows({ household, rng, count }) {
      for (let i = 0; i < count; i++)
        yield {
          id: rng.uuid(),
          household_id: household.id,
          event_name: "import-recipes.synthetic-event",
          event_version: "1",
          payload: "{}",
          dispatched_at: "2026-10-15T10:00:00Z",
        };
    },
  }),
];
