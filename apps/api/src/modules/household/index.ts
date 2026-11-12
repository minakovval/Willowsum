// Public interface of the household module (ARC-01 FR 2). Other modules import only this file.
import { randomUUID } from "node:crypto";
import type { ModuleDatabase } from "../../platform/db/module-db.ts";
import { DATA_REGIONS } from "../../platform/db/isolation.ts";
import { defineModule } from "../../platform/modules/define.ts";
import type { AuditLog } from "../audit/index.ts";
import { databaseSpacesStore } from "./adapters/index.ts";
import { ensureFirstSpace, type SpaceMembership } from "./application/index.ts";

export const householdModule = defineModule({
  name: "household",
  publishes: [],
  consumes: [],
});

export { firstSpaceName, SPACE_NAME_MAX, SPACE_ROLES } from "./domain/index.ts";
export type { SpaceRole } from "./domain/index.ts";
export type { SpaceMembership } from "./application/index.ts";

/** Spaces of accounts (ACC-01@PoC part c; ADR-0010). */
export interface HouseholdSpaces {
  /**
   * The account's first space «Родина <Прізвище>» with it as Owner, when it belongs to no space yet (ACC-01 FR 7).
   * Idempotent, also under concurrent calls for one account.
   */
  ensureFirstSpace(owner: {
    readonly accountId: string;
    readonly displayName: string;
  }): Promise<SpaceMembership & { readonly created: boolean }>;
  /** The space and role an account works in (PoC: its one space), or null. */
  membershipOf(accountId: string): Promise<SpaceMembership | null>;
}

/** `db` is the household module's own database (`ModuleDatabases.for("household")`). */
export function createHouseholdSpaces(db: ModuleDatabase, audit: Pick<AuditLog, "record">): HouseholdSpaces {
  const store = databaseSpacesStore(db);
  const deps = {
    store,
    newId: randomUUID,
    dataRegion: DATA_REGIONS[0],
    audit: {
      spaceCreated: async (
        householdId: string,
        ownerAccountId: string,
        space: { name: string; dataRegion: string },
      ) => {
        await audit.record(householdId, {
          actor: { kind: "user", id: ownerAccountId },
          channel: "web",
          entity: { type: "household.space", id: householdId },
          action: "create",
          changes: [
            { field: "name", before: null, after: space.name, sensitive: false },
            { field: "dataRegion", before: null, after: space.dataRegion, sensitive: false },
          ],
        });
        await audit.record(householdId, {
          actor: { kind: "user", id: ownerAccountId },
          channel: "web",
          entity: { type: "household.member", id: ownerAccountId },
          action: "create",
          changes: [{ field: "role", before: null, after: "owner", sensitive: false }],
        });
      },
    },
  };
  return {
    ensureFirstSpace: (owner) => ensureFirstSpace(deps, owner),
    membershipOf: (accountId) => store.membershipOf(accountId),
  };
}
