import { Money } from "@willowsum/domain-kernel";
import type { HouseholdQueryRunner } from "../../../../platform/db/module-db.ts";
import type { GoalsTx, StoredContribution, StoredGoal } from "../../application/index.ts";
import { enqueueHandOff } from "../queue/job.ts";

/** The goals schema through the module's own role (migrations/0001_goals.sql). The row policy binds the space; SQL filters it too. */
const GOAL_COLUMNS = `id, template, name, currency, target_amount::text AS target_amount,
  to_char(target_date, 'YYYY-MM-DD') AS target_date, emergency_months, part_kind, account_id,
  start_amount::text AS start_amount, to_char(created_on, 'YYYY-MM-DD') AS created_on, version`;

interface GoalRow {
  id: string;
  template: StoredGoal["template"];
  name: string;
  currency: string;
  target_amount: string;
  target_date: string | null;
  emergency_months: number | null;
  part_kind: StoredGoal["partKind"];
  account_id: string | null;
  start_amount: string;
  created_on: string;
  version: number;
}

const goal = (r: GoalRow): StoredGoal => ({
  id: r.id,
  template: r.template,
  name: r.name,
  target: Money.of(r.target_amount, r.currency),
  targetDate: r.target_date,
  emergencyMonths: r.emergency_months,
  partKind: r.part_kind,
  accountId: r.account_id,
  startAmount: Money.of(r.start_amount, r.currency),
  createdOn: r.created_on,
  version: r.version,
});

export function goalsTx(q: HouseholdQueryRunner): GoalsTx {
  return {
    async goals(householdId) {
      const { rows } = await q.query<GoalRow>(
        `SELECT ${GOAL_COLUMNS} FROM goals WHERE household_id = $1 ORDER BY created_at, id`,
        [householdId],
      );
      return rows.map(goal);
    },
    async goal(householdId, id, lock = false) {
      const { rows } = await q.query<GoalRow>(
        `SELECT ${GOAL_COLUMNS} FROM goals WHERE household_id = $1 AND id = $2${lock ? " FOR UPDATE" : ""}`,
        [householdId, id],
      );
      return rows[0] ? goal(rows[0]) : null;
    },
    async insertGoal(householdId, g) {
      await q.query(
        `INSERT INTO goals (household_id, id, template, name, currency, target_amount, target_date, emergency_months,
           part_kind, account_id, start_amount, created_on)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          householdId,
          g.id,
          g.template,
          g.name,
          g.target.currency,
          g.target.toDecimalString(),
          g.targetDate,
          g.emergencyMonths,
          g.partKind,
          g.accountId,
          g.startAmount.toDecimalString(),
          g.createdOn,
        ],
      );
    },
    async updateGoal(householdId, g) {
      const { rows } = await q.query<GoalRow>(
        `UPDATE goals SET template = $3, name = $4, target_amount = $5, target_date = $6, emergency_months = $7,
           part_kind = $8, account_id = $9, start_amount = $10, version = version + 1, updated_at = now()
         WHERE household_id = $1 AND id = $2 RETURNING ${GOAL_COLUMNS}`,
        [
          householdId,
          g.id,
          g.template,
          g.name,
          g.target.toDecimalString(),
          g.targetDate,
          g.emergencyMonths,
          g.partKind,
          g.accountId,
          g.startAmount.toDecimalString(),
        ],
      );
      return goal(rows[0]!);
    },
    async deleteGoal(householdId, id) {
      await q.query(`DELETE FROM contributions WHERE household_id = $1 AND goal_id = $2`, [householdId, id]);
      await q.query(`DELETE FROM goals WHERE household_id = $1 AND id = $2`, [householdId, id]);
    },
    async contributions(householdId, goalIds) {
      if (goalIds.length === 0) return [];
      const { rows } = await q.query<{
        id: string;
        goal_id: string;
        amount: string;
        currency: string;
        date: string;
      }>(
        `SELECT c.id, c.goal_id, c.amount::text AS amount, g.currency, to_char(c.contributed_on, 'YYYY-MM-DD') AS date
           FROM contributions c JOIN goals g ON g.household_id = c.household_id AND g.id = c.goal_id
          WHERE c.household_id = $1 AND c.goal_id = ANY($2::uuid[])
          ORDER BY c.contributed_on DESC, c.created_at DESC`,
        [householdId, goalIds],
      );
      return rows.map((r): StoredContribution => ({
        id: r.id,
        goalId: r.goal_id,
        amount: Money.of(r.amount, r.currency),
        date: r.date,
      }));
    },
    async insertContribution(householdId, c) {
      await q.query(
        `INSERT INTO contributions (household_id, id, goal_id, amount, contributed_on) VALUES ($1, $2, $3, $4, $5)`,
        [householdId, c.id, c.goalId, c.amount.toDecimalString(), c.date],
      );
    },
    async lockAccount(householdId, accountId) {
      await q.query(
        `SELECT pg_advisory_xact_lock(hashtextextended('goals.account:' || $1 || ':' || $2, 0))`,
        [householdId, accountId],
      );
    },
    async goalsOnAccount(householdId, accountId, exceptGoalId) {
      const { rows } = await q.query<GoalRow>(
        `SELECT ${GOAL_COLUMNS} FROM goals
          WHERE household_id = $1 AND account_id = $2 AND ($3::uuid IS NULL OR id <> $3::uuid)`,
        [householdId, accountId, exceptGoalId],
      );
      return rows.map(goal);
    },
    enqueueHandOff: (handOff) => enqueueHandOff(q, handOff),
  };
}
