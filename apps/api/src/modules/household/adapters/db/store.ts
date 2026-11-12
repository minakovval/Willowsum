import type { ModuleDatabase, ModuleQueryRunner } from "../../../../platform/db/module-db.ts";
import type { SpaceMembership, SpacesStore, SpacesTx } from "../../application/index.ts";
import type { SpaceRole } from "../../domain/index.ts";

/** The household schema through the module's own role (ARC-01, ARC-03; tables in migrations/0001_spaces.sql). */

const MEMBERSHIP = `SELECT space_id, role FROM account_spaces WHERE account_id = $1 ORDER BY created_at, space_id LIMIT 1`;

async function membership(q: ModuleQueryRunner, accountId: string): Promise<SpaceMembership | null> {
  const { rows } = await q.query<{ space_id: string; role: SpaceRole }>(MEMBERSHIP, [accountId]);
  return rows[0] ? { householdId: rows[0].space_id, role: rows[0].role } : null;
}

function tx(q: ModuleQueryRunner): SpacesTx {
  return {
    async lockAccount(accountId) {
      await q.query(`SELECT pg_advisory_xact_lock(hashtext('household:first-space'), hashtext($1))`, [
        accountId,
      ]);
    },
    membershipOf: (accountId) => membership(q, accountId),
    async insertSpace(space) {
      await q.query(
        `INSERT INTO households (household_id, name, data_region, encryption_key_ref) VALUES ($1, $2, $3, $4)`,
        [space.householdId, space.name, space.dataRegion, space.encryptionKeyRef],
      );
    },
    async addMember(accountId, householdId, role) {
      await q.query(`INSERT INTO account_spaces (account_id, space_id, role) VALUES ($1, $2, $3)`, [
        accountId,
        householdId,
        role,
      ]);
    },
  };
}

export function databaseSpacesStore(db: ModuleDatabase): SpacesStore {
  return {
    inSpace: (householdId, work) => db.inHousehold(householdId, (q) => work(tx(q))),
    // The directory is read outside any space: the session has to find its space before one is bound.
    membershipOf: (accountId) => db.transaction((q) => membership(q, accountId)),
    spaceIds: () =>
      db.transaction(async (q) => {
        const { rows } = await q.query<{ space_id: string }>(
          `SELECT DISTINCT space_id FROM account_spaces ORDER BY space_id`,
        );
        return rows.map((r) => r.space_id);
      }),
  };
}
