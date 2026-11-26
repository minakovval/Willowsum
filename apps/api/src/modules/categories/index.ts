// Public interface of the categories module (ARC-01 FR 2). Other modules import only this file.
import { systemClock } from "../../platform/adapters/index.ts";
import type { ModuleDatabase } from "../../platform/db/module-db.ts";
import { defineModule } from "../../platform/modules/define.ts";
import type { AuditLog } from "../audit/index.ts";
import {
  categoriesAudit,
  categoriesRoutes,
  categoriesTx,
  eraseHouseholdCategories,
} from "./adapters/index.ts";
import { ensureTree, type StoredCategory } from "./application/index.ts";
export type { CategoryUsage } from "./application/index.ts";
import type { CategoryKind, CategoryState, ServiceCategoryKey } from "./domain/index.ts";
import { categoryMerged } from "./events.ts";

export const categoriesModule = defineModule({
  name: "categories",
  publishes: [categoryMerged],
  consumes: [],
  routes: categoriesRoutes,
});

export { createCategoriesServices, type CategoriesServices } from "./adapters/index.ts";
export { categoryMerged, type CategoryMerged } from "./events.ts";
export { CATEGORY_KINDS, CATEGORY_STATES, FEE_CATEGORY_KEY, SERVICE_CATEGORY_KEYS } from "./domain/index.ts";
export type { CategoryKind, CategoryState, ServiceCategoryKey } from "./domain/index.ts";

/** A category of a space as other modules check it (BUD-01@PoC FR 9). */
export interface CategoryRef {
  readonly id: string;
  readonly groupId: string;
  readonly kind: CategoryKind;
  readonly systemKey: string | null;
  /** «hidden» — out of the budget plan (its records count in «Інше»); «retired» — merged away, see `mergedInto`. */
  readonly state: CategoryState;
  /** FR 8: the category in use its records went to; null unless merged. */
  readonly mergedInto: string | null;
  /** FR 11: «обов'язкова»; null for income and service categories. */
  readonly essential: boolean | null;
}

/**
 * FR 9: categories of transactions, rules, split parts and limits belong to the space's tree — the modules that keep
 * them (categorization, budget, recurring) check each one here. Every call is bound to one space; a category of
 * another space is null, like an unknown one.
 */
export interface CategoryDirectory {
  category(householdId: string, categoryId: string): Promise<CategoryRef | null>;
  /** «Переказ» or «Коригування» of the space (FR 1, FR 7), for transfer matching and balance adjustments. */
  serviceCategory(householdId: string, key: ServiceCategoryKey): Promise<CategoryRef | null>;
  /**
   * Every category of the space's tree — hidden ones too, and merged ones (`retired`, with `mergedInto`): a split part or
   * a transaction not yet moved may still name one (BUD-02: the budget's groups and limits; merged — counted in the target).
   */
  categories(householdId: string): Promise<readonly CategoryRef[]>;
}

const ref = (c: StoredCategory): CategoryRef => ({
  id: c.id,
  groupId: c.groupId,
  kind: c.kind,
  systemKey: c.systemKey,
  state: c.state,
  mergedInto: c.mergedInto,
  essential: c.essential,
});

/** `db` is the categories module's own database (`ModuleDatabases.for("categories")`). */
export function createCategoryDirectory(options: {
  readonly db: ModuleDatabase;
  readonly audit: Pick<AuditLog, "record">;
  readonly newId: () => string;
}): CategoryDirectory {
  const deps = { audit: categoriesAudit(options.audit), newId: options.newId, now: () => systemClock.now() };
  const read = async (
    householdId: string,
    find: (tx: ReturnType<typeof categoriesTx>) => Promise<StoredCategory | null>,
  ) => {
    await options.db.inHousehold(householdId, (q) => ensureTree(deps, categoriesTx(q), householdId));
    const row = await options.db.inHousehold(householdId, (q) => find(categoriesTx(q)));
    return row ? ref(row) : null;
  };
  return {
    category: (householdId, categoryId) => read(householdId, (tx) => tx.category(householdId, categoryId)),
    serviceCategory: (householdId, key) => read(householdId, (tx) => tx.bySystemKey(householdId, key)),
    async categories(householdId) {
      await options.db.inHousehold(householdId, (q) => ensureTree(deps, categoriesTx(q), householdId));
      const rows = await options.db.inHousehold(householdId, (q) =>
        categoriesTx(q).categories(householdId, { withRetired: true }),
      );
      return rows.map(ref);
    },
  };
}

/** Erasure of a space's categories (NFR-12@PoC FR 3): the owner's erasure script only (module data-erasure). */
export interface CategoriesErasure {
  eraseHousehold(householdId: string): Promise<{
    readonly categories: number;
    readonly groups: number;
    readonly idempotencyKeys: number;
    readonly events: number;
    readonly jobs: number;
  }>;
}

export function createCategoriesErasure(db: ModuleDatabase): CategoriesErasure {
  return { eraseHousehold: (householdId) => eraseHouseholdCategories(db, householdId) };
}
