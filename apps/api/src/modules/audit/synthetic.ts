// Synthetic audit entries (ARC-03 FR 6) for tests and staging; loaded by tools/synthetic. Never real data.
import { defineSyntheticTable } from "@willowsum/synthetic";

const ENTITIES = ["accounts.account", "transactions.transaction", "categories.category", "budget.budget"];
const FIELDS = ["name", "amount", "category", "note", "iban"];

export const synthetic = [
  defineSyntheticTable({
    table: "audit.entries",
    perHousehold: 1_000,
    *rows({ household, rng, count }) {
      const actor = rng.uuid();
      for (let i = 0; i < count; i++) {
        const system = rng.int(1, 10) === 1;
        const field = rng.pick(FIELDS);
        const sensitive = field === "iban" || field === "note";
        yield {
          id: rng.uuid(),
          household_id: household.id,
          occurred_at: rng.instant("2026-01-01T00:00:00Z", 300),
          actor_kind: system ? "system" : "user",
          actor_id: system ? null : actor,
          channel: system ? "system" : rng.pick(["web", "api", "import"]),
          entity_type: rng.pick(ENTITIES),
          entity_id: rng.uuid(),
          action: "update",
          changes: JSON.stringify([
            {
              field,
              before: sensitive ? "•••" : `value ${rng.int(1, 999)}`,
              after: sensitive ? "•••" : `value ${rng.int(1, 999)}`,
              masked: sensitive,
            },
          ]),
        };
      }
    },
  }),
];
