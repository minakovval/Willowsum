// Domain layer of access-scope: pure rules, no I/O (ARC-01 FR 5). Allowed imports: this folder,
// @willowsum/domain-kernel, zod, decimal.js.
export { can, permissionsOf, PERMISSION_KEYS, PERMISSIONS, ROLES } from "./permissions.ts";
export type { Member, Permission, Role } from "./permissions.ts";
