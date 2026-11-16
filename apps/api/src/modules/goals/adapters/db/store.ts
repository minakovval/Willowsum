import { Money } from "@willowsum/domain-kernel";
import type { HouseholdQueryRunner } from "../../../../platform/db/module-db.ts";
import type { GoalsTx, StoredContribution, StoredGoal, StoredSpend } from "../../application/index.ts";
import { enqueueHandOff } from "../queue/job.ts";

/** The goals schema through the module's own role (migrations/0001_goals.sql). The row policy binds the space; SQL filters it too. */
const GOAL_COLUMNS = `id, template, name, target_currency AS currency, target_amount::text AS target_amount,
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

const SPEND_COLUMNS = `id, goal_id, transaction_id, account_id, entry_id, amount::text AS amount, currency,
  to_char(spent_on, 'YYYY-MM-DD') AS date`;

interface SpendRow {
  id: string;
  goal_id: string;
  transaction_id: string;
  account_id: string;
  entry_id: string;
  amount: string;
  currency: string;
  date: string;
}

const spend = (r: SpendRow): StoredSpend => ({
  id: r.id,
  goalId: r.goal_id,
  transactionId: r.transaction_id,
  accountId: r.account_id,
  entryId: r.entry_id,
  amount: Money.of(r.amount, r.currency),
  date: r.date,
});

export function goalsTx(q: HouseholdQueryRunner): GoalsTx {
  return {
    async goals(householdId) {
      const { rows } = await q.query<GoalRow>(
        `SELECT ${GOAL_COLUMNS} FROM goals WHERE household_id = $1 AND closed_on IS NULL ORDER BY created_at, id`,
        [householdId],
      );
      return rows.map(goal);
    },
    async goal(householdId, id, lock = false) {
      const { rows } = await q.query<GoalRow>(
        `SELECT ${GOAL_COLUMNS} FROM goals WHERE household_id = $1 AND id = $2 AND closed_on IS NULL${lock ? " FOR UPDATE" : ""}`,
        [householdId, id],
      );
      return rows[0] ? goal(rows[0]) : null;
    },
    async insertGoal(householdId, g) {
      await q.query(
        `INSERT INTO goals (household_id, id, template, name, target_currency, target_amount, target_date, emergency_months,
           part_kind, account_id, start_amount, start_currency, created_on)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $5, $12)`,
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
         WHERE household_id = $1 AND id = $2 AND closed_on IS NULL RETURNING ${GOAL_COLUMNS}`,
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
      await q.query(`DELETE FROM spends WHERE household_id = $1 AND goal_id = $2`, [householdId, id]);
      await q.query(`DELETE FROM goals WHERE household_id = $1 AND id = $2`, [householdId, id]);
    },
    async closeGoal(householdId, id, closedOn) {
      await q.query(
        `UPDATE goals SET closed_on = $3, version = version + 1, updated_at = now()
          WHERE household_id = $1 AND id = $2 AND closed_on IS NULL`,
        [householdId, id, closedOn],
      );
    },
    async spends(householdId, goalIds) {
      if (goalIds.length === 0) return [];
      const { rows } = await q.query<SpendRow>(
        `SELECT ${SPEND_COLUMNS} FROM spends WHERE household_id = $1 AND goal_id = ANY($2::uuid[])
          ORDER BY spent_on DESC, created_at DESC, id`,
        [householdId, goalIds],
      );
      return rows.map(spend);
    },
    async spendsOfTransactions(householdId, transactionIds) {
      if (transactionIds.length === 0) return [];
      const { rows } = await q.query<SpendRow>(
        `SELECT ${SPEND_COLUMNS} FROM spends WHERE household_id = $1 AND transaction_id = ANY($2::uuid[])`,
        [householdId, transactionIds],
      );
      return rows.map(spend);
    },
    async insertSpend(householdId, s) {
      await q.query(
        `INSERT INTO spends (household_id, id, goal_id, transaction_id, account_id, entry_id, amount, currency, spent_on)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          householdId,
          s.id,
          s.goalId,
          s.transactionId,
          s.accountId,
          s.entryId,
          s.amount.toDecimalString(),
          s.amount.currency,
          s.date,
        ],
      );
    },
    async deleteSpend(householdId, goalId, id) {
      const { rows } = await q.query<SpendRow>(
        `DELETE FROM spends WHERE household_id = $1 AND goal_id = $2 AND id = $3 RETURNING ${SPEND_COLUMNS}`,
        [householdId, goalId, id],
      );
      return rows[0] ? spend(rows[0]) : null;
    },
    async deleteSpendsOfEntries(householdId, entryIds) {
      if (entryIds.length === 0) return [];
      const { rows } = await q.query<SpendRow>(
        `DELETE FROM spends WHERE household_id = $1 AND entry_id = ANY($2::uuid[]) RETURNING ${SPEND_COLUMNS}`,
        [householdId, entryIds],
      );
      return rows.map(spend);
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
        `SELECT c.id, c.goal_id, c.amount::text AS amount, c.currency, to_char(c.contributed_on, 'YYYY-MM-DD') AS date
           FROM contributions c
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
        `INSERT INTO contributions (household_id, id, goal_id, amount, currency, contributed_on)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [householdId, c.id, c.goalId, c.amount.toDecimalString(), c.amount.currency, c.date],
      );
    },
    async lockTransactions(householdId, transactionIds) {
      // In the ids' order, so two spends of overlapping transactions never wait on each other in a cycle.
      await q.query(
        `SELECT pg_advisory_xact_lock(hashtextextended('goals.spend:' || $1 || ':' || t, 0))
           FROM (SELECT DISTINCT unnest($2::uuid[])::text AS t ORDER BY 1) ids`,
        [householdId, transactionIds],
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
          WHERE household_id = $1 AND account_id = $2 AND closed_on IS NULL
            AND ($3::uuid IS NULL OR id <> $3::uuid)`,
        [householdId, accountId, exceptGoalId],
      );
      return rows.map(goal);
    },
    enqueueHandOff: (handOff) => enqueueHandOff(q, handOff),
  };
}
