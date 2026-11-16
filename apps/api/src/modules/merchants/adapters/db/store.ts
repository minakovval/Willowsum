import type { HouseholdQueryRunner } from "../../../../platform/db/module-db.ts";
import type { MerchantHandOff, MerchantsTx } from "../../application/index.ts";
import type { Merchant } from "../../domain/index.ts";
import { enqueueHandOff } from "../queue/job.ts";

/**
 * The merchants schema through the module's own role (migrations/0001_merchants.sql). The row policy binds the space;
 * SQL filters it too.
 */
interface Row {
  id: string;
  match_key: string;
  name: string;
  intermediary: boolean;
  merged_into: string | null;
  version: number;
}

const COLUMNS = `id, match_key, name, intermediary, merged_into, version`;

const merchant = (r: Row): Merchant => ({
  id: r.id,
  key: r.match_key,
  name: r.name,
  intermediary: r.intermediary,
  mergedInto: r.merged_into,
  version: r.version,
});

export function merchantsTx(q: HouseholdQueryRunner): MerchantsTx {
  const byId = (rows: Row[]) => new Map(rows.map((r) => [r.id, merchant(r)]));
  return {
    async ensure(householdId, born) {
      if (born.length === 0) return;
      await q.query(
        `INSERT INTO merchants (household_id, match_key, name, intermediary)
         SELECT $1, b.match_key, b.name, b.intermediary
           FROM unnest($2::text[], $3::text[], $4::boolean[]) AS b (match_key, name, intermediary)
          ORDER BY b.match_key
         ON CONFLICT (household_id, match_key) DO NOTHING`,
        [householdId, born.map((b) => b.key), born.map((b) => b.name), born.map((b) => b.intermediary)],
      );
    },
    async byKeys(householdId, keys) {
      if (keys.length === 0) return new Map();
      const { rows } = await q.query<Row>(
        `SELECT ${COLUMNS} FROM merchants WHERE household_id = $1 AND match_key = ANY($2::text[])`,
        [householdId, keys],
      );
      return new Map(rows.map((r) => [r.match_key, merchant(r)]));
    },
    async byIds(householdId, ids) {
      if (ids.length === 0) return new Map();
      const { rows } = await q.query<Row>(
        `SELECT ${COLUMNS} FROM merchants WHERE household_id = $1 AND id = ANY($2::uuid[])`,
        [householdId, ids],
      );
      return byId(rows);
    },
    async lock(householdId, ids) {
      if (ids.length === 0) return new Map();
      const { rows } = await q.query<Row>(
        `SELECT ${COLUMNS} FROM merchants WHERE household_id = $1 AND id = ANY($2::uuid[])
          ORDER BY id FOR UPDATE`,
        [householdId, ids],
      );
      return byId(rows);
    },
    async joined(householdId, id) {
      const { rows } = await q.query<Row>(
        `SELECT ${COLUMNS} FROM merchants WHERE household_id = $1 AND merged_into = $2 ORDER BY id FOR UPDATE`,
        [householdId, id],
      );
      return rows.map(merchant);
    },
    async all(householdId) {
      const { rows } = await q.query<Row>(`SELECT ${COLUMNS} FROM merchants WHERE household_id = $1`, [
        householdId,
      ]);
      return rows.map(merchant);
    },
    async rename(householdId, id, name, version) {
      await q.query(
        `UPDATE merchants SET name = $3, version = $4, updated_at = now() WHERE household_id = $1 AND id = $2`,
        [householdId, id, name, version],
      );
    },
    async point(householdId, id, mergedInto, version) {
      await q.query(
        `UPDATE merchants SET merged_into = $3, version = $4, updated_at = now()
          WHERE household_id = $1 AND id = $2`,
        [householdId, id, mergedInto, version],
      );
    },
    enqueueHandOff: (_householdId, handOff: MerchantHandOff) => enqueueHandOff(q, handOff),
  };
}
