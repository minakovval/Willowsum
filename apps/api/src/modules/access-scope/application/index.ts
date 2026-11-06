// Application layer of access-scope: use cases, transactions, permission checks (ARC-01 FR 5).
// Uses ports; adapters are wired in ../index.ts.
import { can, type Member } from "../domain/index.ts";

/** The one permission check of the API layer (ARC-07 criterion «маршрут без перевірки прав»). */
export function checkPermission(member: Member, permission: string): boolean {
  return can(member, permission);
}
