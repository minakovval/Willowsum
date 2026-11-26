import type { ModuleDatabase } from "../../../platform/db/module-db.ts";
import type { CategoryUsage } from "../../categories/index.ts";
import { byId, categoryEntries, releaseCategory, type CategoryEntries } from "../application/index.ts";
import { budgetTx } from "./db/store.ts";
import { handOffNow, type BudgetServices } from "./http/services.ts";

const text = (e: CategoryEntries) => ({
  limit: e.limit ? { amount: e.limit.toDecimalString(), currency: e.limit.currency } : null,
  stored: e.stored,
  planCells: e.planCells,
});

/**
 * BUD-01@PoC FR 12, AC22 (owner decision 2026-11-26): the budget's entries of a category for module categories — a
 * limit, an income plan or «План» cells do not hold a category; a confirmed delete removes them here, in this module's
 * own transaction with its audit hand-off (ARC-04), never through another module's tables. `db` is the budget module's
 * own database (`ModuleDatabases.for("budget")`).
 */
export function budgetCategoryUsage(
  db: ModuleDatabase,
  services: BudgetServices | (() => BudgetServices),
): CategoryUsage {
  // A thunk lets a server wire the categories' usage before its budget services (the tests' servers).
  const of = () => (typeof services === "function" ? services() : services);
  const categories = async (householdId: string) => byId(await of().deps.reads.categories(householdId));
  return {
    module: "budget",
    limits: {
      held: (householdId, ids) =>
        db.inHousehold(householdId, async (q) => {
          if (ids.length === 0) return new Set<string>();
          const { rows } = await q.query<{ id: string }>(
            `SELECT category_id AS id FROM limits WHERE household_id = $1 AND category_id = ANY($2::uuid[])
             UNION SELECT category_id FROM income_plans WHERE household_id = $1 AND category_id = ANY($2::uuid[])
             UNION SELECT line_id FROM plan_cells
                    WHERE household_id = $1 AND kind IN ('limit', 'income') AND line_id = ANY($2::uuid[])`,
            [householdId, ids],
          );
          return new Set(rows.map((r) => r.id));
        }),
      async entries(householdId, categoryId) {
        const byCategory = await categories(householdId);
        return text(
          await db.inHousehold(householdId, (q) =>
            categoryEntries(of().deps, budgetTx(q), householdId, categoryId, byCategory),
          ),
        );
      },
      async release(caller, categoryId) {
        const byCategory = await categories(caller.householdId);
        const { result, handOffs } = await db.inHousehold(caller.householdId, (q) =>
          releaseCategory(of().deps, budgetTx(q), caller, categoryId, byCategory),
        );
        await handOffNow(of().audit, caller.householdId, handOffs);
        return text(result);
      },
    },
  };
}
