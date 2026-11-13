// Adapters of household: database (ModuleDatabase, schema «household»), HTTP, external services.
export { databaseSpacesStore, spaceSettingsTx } from "./db/store.ts";
export { spacesOfAccount } from "./db/erasure.ts";
export { createHouseholdServices, householdRoutes, type HouseholdServices } from "./http/index.ts";
