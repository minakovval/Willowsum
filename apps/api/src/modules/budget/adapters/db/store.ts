import { Money } from "@willowsum/domain-kernel";
import type { HouseholdQueryRunner } from "../../../../platform/db/module-db.ts";
import type { BudgetTx, StoredBudget } from "../../application/index.ts";
import type { PeriodPlan, PlanCell, PlanCellKind } from "../../domain/index.ts";
import { enqueueHandOff } from "../queue/job.ts";

/** The budget schema through the module's own role (migrations/0001_budget.sql). The row policy binds the space; SQL filters it too. */
const BUDGET_COLUMNS = `id, currency, to_char(first_period, 'YYYY-MM') AS first_period, income_plan::text AS income_plan,
  to_char(created_on, 'YYYY-MM-DD') AS created_on, version, to_char(first_day, 'YYYY-MM-DD') AS first_day`;

interface BudgetRow {
  id: string;
  currency: string;
  first_period: string;
  income_plan: string;
  created_on: string;
  version: number;
  first_day: string | null;
}

const budget = (r: BudgetRow): StoredBudget => ({
  id: r.id,
  currency: r.currency,
  firstPeriod: r.first_period,
  incomePlan: Money.of(r.income_plan, r.currency),
  createdOn: r.created_on,
  version: r.version,
  firstDay: r.first_day,
});

const month = (period: string) => `${period}-01`;

/** A line without its own id («Інші надходження», «Заощадження без цілі») is stored under the nil id (0005). */
const NIL = "00000000-0000-0000-0000-000000000000";

export function budgetTx(q: HouseholdQueryRunner): BudgetTx {
  return {
    async budget(householdId, lock = false) {
      const { rows } = await q.query<BudgetRow>(
        `SELECT ${BUDGET_COLUMNS} FROM budgets WHERE household_id = $1${lock ? " FOR UPDATE" : ""}`,
        [householdId],
      );
      return rows[0] ? budget(rows[0]) : null;
    },
    async insertBudget(householdId, b) {
      const { rowCount } = await q.query(
        `INSERT INTO budgets (household_id, id, currency, first_period, income_plan, created_on, first_day)
         VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (household_id) DO NOTHING`,
        [
          householdId,
          b.id,
          b.currency,
          month(b.firstPeriod),
          b.incomePlan.toDecimalString(),
          b.createdOn,
          b.firstDay,
        ],
      );
      return rowCount === 1;
    },
    async updateBudget(householdId, id, incomePlan) {
      const { rows } = await q.query<BudgetRow>(
        `UPDATE budgets SET income_plan = $3, version = version + 1, updated_at = now()
          WHERE household_id = $1 AND id = $2 RETURNING ${BUDGET_COLUMNS}`,
        [householdId, id, incomePlan.toDecimalString()],
      );
      return budget(rows[0]!);
    },
    async deleteBudget(householdId, id) {
      // The limits, account choices and snapshots go with it (ON DELETE CASCADE).
      await q.query(`DELETE FROM budgets WHERE household_id = $1 AND id = $2`, [householdId, id]);
    },
    async limits(householdId, budgetId) {
      const { rows } = await q.query<{ category_id: string; amount: string; currency: string }>(
        `SELECT category_id, amount::text AS amount, currency FROM limits
          WHERE household_id = $1 AND budget_id = $2 ORDER BY category_id`,
        [householdId, budgetId],
      );
      return rows.map((r) => ({ categoryId: r.category_id, amount: Money.of(r.amount, r.currency) }));
    },
    async setLimit(householdId, budgetId, categoryId, amount) {
      if (amount === null)
        await q.query(`DELETE FROM limits WHERE household_id = $1 AND budget_id = $2 AND category_id = $3`, [
          householdId,
          budgetId,
          categoryId,
        ]);
      else
        await q.query(
          `INSERT INTO limits (household_id, budget_id, category_id, amount, currency) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (household_id, budget_id, category_id) DO UPDATE SET amount = EXCLUDED.amount`,
          [householdId, budgetId, categoryId, amount.toDecimalString(), amount.currency],
        );
    },
    async accountChoices(householdId) {
      const { rows } = await q.query<{ account_id: string; included: boolean }>(
        `SELECT account_id, included FROM budget_accounts WHERE household_id = $1`,
        [householdId],
      );
      return new Map(rows.map((r) => [r.account_id, r.included]));
    },
    async setAccountChoice(householdId, budgetId, accountId, included) {
      if (included === null)
        await q.query(`DELETE FROM budget_accounts WHERE household_id = $1 AND account_id = $2`, [
          householdId,
          accountId,
        ]);
      else
        await q.query(
          `INSERT INTO budget_accounts (household_id, account_id, budget_id, included) VALUES ($1, $2, $3, $4)
           ON CONFLICT (household_id, account_id) DO UPDATE SET included = EXCLUDED.included, budget_id = EXCLUDED.budget_id`,
          [householdId, accountId, budgetId, included],
        );
    },
    async snapshots(householdId, budgetId) {
      const { rows } = await q.query<{
        period: string;
        currency: string;
        income_plan: string;
        planned_savings: string;
        limits: { categoryId: string; amount: string; mandatory: boolean }[];
      }>(
        `SELECT to_char(period, 'YYYY-MM') AS period, currency, income_plan::text AS income_plan,
                planned_savings::text AS planned_savings, limits
           FROM period_snapshots WHERE household_id = $1 AND budget_id = $2`,
        [householdId, budgetId],
      );
      return new Map(
        rows.map((r): [string, PeriodPlan] => [
          r.period,
          {
            incomePlan: Money.of(r.income_plan, r.currency),
            plannedSavings: Money.of(r.planned_savings, r.currency),
            limits: r.limits.map((l) => ({ ...l, amount: Money.of(l.amount, r.currency) })),
          },
        ]),
      );
    },
    async insertSnapshot(householdId, budgetId, period, plan) {
      await q.query(
        `INSERT INTO period_snapshots (household_id, budget_id, period, currency, income_plan, planned_savings, limits)
         VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING`,
        [
          householdId,
          budgetId,
          month(period),
          plan.incomePlan.currency,
          plan.incomePlan.toDecimalString(),
          plan.plannedSavings.toDecimalString(),
          JSON.stringify(
            plan.limits.map((l) => ({
              categoryId: l.categoryId,
              amount: l.amount.toDecimalString(),
              mandatory: l.mandatory,
            })),
          ),
        ],
      );
    },
    async planCells(householdId, budgetId, from) {
      const { rows } = await q.query<{
        period: string;
        kind: PlanCellKind;
        line_id: string;
        amount: string | null;
        currency: string;
        version: number;
      }>(
        `SELECT to_char(period, 'YYYY-MM') AS period, kind, line_id, amount::text AS amount, currency, version
           FROM plan_cells WHERE household_id = $1 AND budget_id = $2 AND ($3::date IS NULL OR period >= $3::date)
          ORDER BY period, kind, line_id`,
        [householdId, budgetId, from === undefined ? null : month(from)],
      );
      return rows.map((r): PlanCell => ({
        period: r.period,
        kind: r.kind,
        lineId: r.line_id === NIL ? null : r.line_id,
        amount: r.amount === null ? null : Money.of(r.amount, r.currency),
        version: r.version,
      }));
    },
    async setPlanCell(householdId, budgetId, cell, currency) {
      const { rows } = await q.query<{ version: number }>(
        `INSERT INTO plan_cells (household_id, budget_id, period, kind, line_id, amount, currency, version)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 1)
         ON CONFLICT (household_id, budget_id, period, kind, line_id)
           DO UPDATE SET amount = EXCLUDED.amount, version = plan_cells.version + 1, updated_at = now()
         RETURNING version`,
        [
          householdId,
          budgetId,
          month(cell.period),
          cell.kind,
          cell.lineId ?? NIL,
          cell.amount?.toDecimalString() ?? null,
          currency,
        ],
      );
      return rows[0]!.version;
    },
    enqueueHandOff: (handOff) => enqueueHandOff(q, handOff),
  };
}
