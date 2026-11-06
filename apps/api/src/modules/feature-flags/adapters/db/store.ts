import type {
  HouseholdQueryRunner,
  ModuleDatabase,
  ModuleQueryRunner,
} from "../../../../platform/db/module-db.ts";
import type { FlagSnapshot, FlagStore } from "../../application/index.ts";
import type { Rollout } from "../../domain/index.ts";

interface FlagRow {
  key: string;
  stage: Rollout["stage"];
  percent: number;
  fully_enabled_at: Date | null;
}

function toRollout(row: Pick<FlagRow, "stage" | "percent">): Rollout {
  return row.stage === "share" ? { stage: "share", percent: row.percent } : { stage: row.stage };
}

const percentOf = (r: Rollout): number => (r.stage === "share" ? r.percent : r.stage === "all" ? 100 : 0);

/** Every flag state and kill switch, in one transaction without a household (platform tables only). */
export async function readSnapshot(q: ModuleQueryRunner): Promise<FlagSnapshot> {
  const flags = await q.query<FlagRow>("SELECT key, stage, percent, fully_enabled_at FROM flags");
  const killed = await q.query<{ module: string }>("SELECT module FROM kill_switches WHERE disabled");
  return {
    rollouts: new Map(flags.rows.map((r) => [r.key, toRollout(r)])),
    killed: new Set(killed.rows.map((r) => r.module)),
    fullyEnabledAt: new Map(
      flags.rows.filter((r) => r.fully_enabled_at !== null).map((r) => [r.key, r.fully_enabled_at!]),
    ),
  };
}

/** Is the bound space a test space? The household policy shows this space's rows only. */
export async function readIsTestHousehold(q: HouseholdQueryRunner): Promise<boolean> {
  const { rows } = await q.query<{ test: boolean }>(
    "SELECT EXISTS (SELECT 1 FROM test_households WHERE household_id = $1 AND unmarked_at IS NULL) AS test",
    [q.householdId],
  );
  return rows[0]!.test;
}

/** The store in schema «feature_flags» (see the migration). */
export function databaseFlagStore(db: ModuleDatabase): FlagStore {
  return {
    snapshot: () => db.transaction(readSnapshot),
    isTestHousehold: (householdId) => db.inHousehold(householdId, readIsTestHousehold),
    setRollout: (key, next) =>
      db.transaction(async (q) => {
        const old = await q.query<FlagRow>("SELECT stage, percent FROM flags WHERE key = $1 FOR UPDATE", [
          key,
        ]);
        const before: Rollout = old.rows[0] ? toRollout(old.rows[0]) : { stage: "off" };
        const { rows } = await q.query<{ id: string }>(
          `INSERT INTO flags (key, stage, percent, fully_enabled_at)
           VALUES ($1, $2, $3, CASE WHEN $2 = 'all' THEN now() END)
           ON CONFLICT (key) DO UPDATE SET
             stage = EXCLUDED.stage,
             percent = EXCLUDED.percent,
             fully_enabled_at = CASE
               WHEN EXCLUDED.stage <> 'all' THEN NULL
               WHEN flags.stage = 'all' THEN flags.fully_enabled_at
               ELSE now() END,
             changed_at = now()
           RETURNING id`,
          [key, next.stage, percentOf(next)],
        );
        return { id: rows[0]!.id, before };
      }),
    setKillSwitch: (module, disabled) =>
      db.transaction(async (q) => {
        const old = await q.query<{ disabled: boolean }>(
          "SELECT disabled FROM kill_switches WHERE module = $1 FOR UPDATE",
          [module],
        );
        const { rows } = await q.query<{ id: string }>(
          `INSERT INTO kill_switches (module, disabled) VALUES ($1, $2)
           ON CONFLICT (module) DO UPDATE SET disabled = EXCLUDED.disabled, changed_at = now()
           RETURNING id`,
          [module, disabled],
        );
        return { id: rows[0]!.id, before: old.rows[0]?.disabled ?? false };
      }),
    setTestHousehold: (householdId, isTest) =>
      db.inHousehold(householdId, async (q) => {
        if (isTest) {
          const { rowCount } = await q.query(
            `INSERT INTO test_households (household_id) VALUES ($1)
             ON CONFLICT (household_id) WHERE unmarked_at IS NULL DO NOTHING`,
            [q.householdId],
          );
          return { before: rowCount === 0 };
        }
        const { rowCount } = await q.query(
          "UPDATE test_households SET unmarked_at = now() WHERE household_id = $1 AND unmarked_at IS NULL",
          [q.householdId],
        );
        return { before: (rowCount ?? 0) > 0 };
      }),
  };
}
