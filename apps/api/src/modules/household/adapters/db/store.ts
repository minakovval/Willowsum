import type { ModuleDatabase, ModuleQueryRunner } from "../../../../platform/db/module-db.ts";
import type {
  SpaceMembership,
  SpaceSettings,
  SpaceSettingsTx,
  SpacesStore,
  SpacesTx,
} from "../../application/index.ts";
import type { SpaceRole, StoredSpaceKey } from "../../domain/index.ts";

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
        `INSERT INTO households (household_id, name, data_region, reporting_currency, encryption_key_ref)
         VALUES ($1, $2, $3, $4, $5)`,
        [space.householdId, space.name, space.dataRegion, space.reportingCurrency, space.encryptionKeyRef],
      );
    },
    async addMember(accountId, householdId, role) {
      await q.query(`INSERT INTO account_spaces (account_id, space_id, role) VALUES ($1, $2, $3)`, [
        accountId,
        householdId,
        role,
      ]);
    },
    // Keys of spaces (ARC-06; migrations/0002_space_keys.sql). The row policy binds the space; SQL filters it too.
    async encryptionKeyRef(householdId) {
      const { rows } = await q.query<{ ref: string }>(
        `SELECT encryption_key_ref AS ref FROM households WHERE household_id = $1`,
        [householdId],
      );
      return rows[0]?.ref ?? null;
    },
    async spaceKey(householdId) {
      const { rows } = await q.query<{ key_id: string; master_key_version: string; wrapped_key: string }>(
        `SELECT key_id, master_key_version, wrapped_key FROM space_keys WHERE household_id = $1`,
        [householdId],
      );
      const row = rows[0];
      return row
        ? { keyId: row.key_id, masterKeyVersion: row.master_key_version, wrappedKey: row.wrapped_key }
        : null;
    },
    async insertSpaceKey(householdId, key: StoredSpaceKey) {
      await q.query(
        `INSERT INTO space_keys (household_id, key_id, master_key_version, wrapped_key) VALUES ($1, $2, $3, $4)`,
        [householdId, key.keyId, key.masterKeyVersion, key.wrappedKey],
      );
    },
    async replaceKeyRef(householdId, expected, ref) {
      const { rowCount } = await q.query(
        `UPDATE households SET encryption_key_ref = $3, updated_at = now()
          WHERE household_id = $1 AND encryption_key_ref = $2`,
        [householdId, expected, ref],
      );
      return rowCount === 1;
    },
    async rewrapSpaceKey(householdId, keyId, fromVersion, to) {
      const { rowCount } = await q.query(
        `UPDATE space_keys SET master_key_version = $4, wrapped_key = $5, rewrapped_at = now()
          WHERE household_id = $1 AND key_id = $2 AND master_key_version = $3`,
        [householdId, keyId, fromVersion, to.masterKeyVersion, to.wrappedKey],
      );
      return rowCount === 1;
    },
    async lockSpace(householdId) {
      await q.query(`SELECT 1 FROM households WHERE household_id = $1 FOR UPDATE`, [householdId]);
    },
    async deleteSpace(householdId) {
      const { rows } = await q.query<{ account_id: string }>(
        `DELETE FROM account_spaces WHERE space_id = $1 RETURNING account_id`,
        [householdId],
      );
      await q.query(`DELETE FROM households WHERE household_id = $1`, [householdId]);
      return rows.map((r) => r.account_id);
    },
    async deleteSpaceKey(householdId, keyId) {
      await q.query(`DELETE FROM space_keys WHERE household_id = $1 AND key_id = $2`, [householdId, keyId]);
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

/** The space's settings (ACC-08@PoC FR 2, FR 5) in a transaction bound to it; the row policy binds the space too. */
export function spaceSettingsTx(q: ModuleQueryRunner): SpaceSettingsTx {
  const read = async (householdId: string, lock: boolean): Promise<SpaceSettings | null> => {
    const { rows } = await q.query<{ name: string; data_region: string; reporting_currency: string }>(
      `SELECT name, data_region, reporting_currency FROM households WHERE household_id = $1${lock ? " FOR UPDATE" : ""}`,
      [householdId],
    );
    const row = rows[0];
    return row
      ? { name: row.name, dataRegion: row.data_region, reportingCurrency: row.reporting_currency }
      : null;
  };
  return {
    lockSettings: (householdId) => read(householdId, true),
    settings: (householdId) => read(householdId, false),
    async setName(householdId, name) {
      await q.query(`UPDATE households SET name = $2, updated_at = now() WHERE household_id = $1`, [
        householdId,
        name,
      ]);
    },
  };
}
