// Adapters of categories: database (ModuleDatabase, schema «categories»), HTTP, external services.
export { eraseHouseholdCategories } from "./db/erasure.ts";
export { categoriesTx } from "./db/store.ts";
export {
  categoriesAudit,
  categoriesRoutes,
  createCategoriesServices,
  type CategoriesServices,
} from "./http/index.ts";
