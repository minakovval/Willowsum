// Public interface of the access-scope module (ARC-01 FR 2). Other modules import only this file.
import { defineModule } from "../../platform/modules/define.ts";
import { accessScopeRoutes } from "./adapters/index.ts";

export const accessScopeModule = defineModule({
  name: "access-scope",
  publishes: [],
  consumes: [],
  routes: accessScopeRoutes,
});

export { checkPermission } from "./application/index.ts";
export { can, permissionsOf, PERMISSION_KEYS, PERMISSIONS, ROLES, SCOPABLE_ROLES } from "./domain/index.ts";
export type { Member, Permission, Role } from "./domain/index.ts";
