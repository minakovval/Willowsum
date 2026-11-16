import { Decimal, Money } from "@willowsum/domain-kernel";
import type { HouseholdQueryRunner } from "../../../../platform/db/module-db.ts";
import type { PlansTx, StoredPlan } from "../../application/index.ts";
import { enqueueHandOff } from "../queue/job.ts";

/** The debt-payoff schema through the module's own role (migrations/0001_plans.sql). The row policy binds the space; SQL filters it too. */
const PLAN_COLUMNS = `id, account_id, currency, start_month, balance::text AS balance, annual_rate::text AS annual_rate,
  monthly_payment::text AS monthly_payment, extra_monthly::text AS extra_monthly, one_offs, months,
  total_interest::text AS total_interest, payoff_month, add_to_planned_expenses, version`;

interface PlanRow {
  id: string;
  account_id: string;
  currency: string;
  start_month: string;
  balance: string;
  annual_rate: string;
  monthly_payment: string;
  extra_monthly: string;
  one_offs: { month: string; amount: string }[];
  months: number;
  total_interest: string;
  payoff_month: string;
  add_to_planned_expenses: boolean;
  version: number;
}

const plan = (r: PlanRow): StoredPlan => ({
  id: r.id,
  accountId: r.account_id,
  currency: r.currency,
  startMonth: r.start_month,
  balance: Money.of(r.balance, r.currency),
  annualRate: new Decimal(r.annual_rate).toFixed(),
  monthlyPayment: Money.of(r.monthly_payment, r.currency),
  extraMonthly: Money.of(r.extra_monthly, r.currency),
  oneOffs: r.one_offs.map((o) => ({ month: o.month, amount: Money.of(o.amount, r.currency) })),
  months: r.months,
  totalInterest: Money.of(r.total_interest, r.currency),
  payoffMonth: r.payoff_month,
  addToPlannedExpenses: r.add_to_planned_expenses,
  version: r.version,
});

export function plansTx(q: HouseholdQueryRunner): PlansTx {
  return {
    async plans(householdId) {
      const { rows } = await q.query<PlanRow>(
        `SELECT ${PLAN_COLUMNS} FROM plans WHERE household_id = $1 ORDER BY created_at, id`,
        [householdId],
      );
      return rows.map(plan);
    },
    async lockPlan(householdId, accountId) {
      // Serialises the saves and deletes of one debt's plan, also while it has none yet (two first saves at once).
      await q.query(
        `SELECT pg_advisory_xact_lock(hashtext('debt-payoff:plan'), hashtext($1::text || $2::text))`,
        [householdId, accountId],
      );
      const { rows } = await q.query<PlanRow>(
        `SELECT ${PLAN_COLUMNS} FROM plans WHERE household_id = $1 AND account_id = $2 FOR UPDATE`,
        [householdId, accountId],
      );
      return rows[0] ? plan(rows[0]) : null;
    },
    async upsertPlan(householdId, p) {
      await q.query(
        `INSERT INTO plans (household_id, id, account_id, currency, start_month, balance, annual_rate, monthly_payment,
           extra_monthly, one_offs, months, total_interest, payoff_month, add_to_planned_expenses, version)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13, $14, $15)
         ON CONFLICT (household_id, account_id) DO UPDATE SET currency = EXCLUDED.currency,
           start_month = EXCLUDED.start_month, balance = EXCLUDED.balance, annual_rate = EXCLUDED.annual_rate,
           monthly_payment = EXCLUDED.monthly_payment, extra_monthly = EXCLUDED.extra_monthly,
           one_offs = EXCLUDED.one_offs, months = EXCLUDED.months, total_interest = EXCLUDED.total_interest,
           payoff_month = EXCLUDED.payoff_month, add_to_planned_expenses = EXCLUDED.add_to_planned_expenses,
           version = EXCLUDED.version, updated_at = now()`,
        [
          householdId,
          p.id,
          p.accountId,
          p.currency,
          p.startMonth,
          p.balance.toDecimalString(),
          p.annualRate,
          p.monthlyPayment.toDecimalString(),
          p.extraMonthly.toDecimalString(),
          JSON.stringify(p.oneOffs.map((o) => ({ month: o.month, amount: o.amount.toDecimalString() }))),
          p.months,
          p.totalInterest.toDecimalString(),
          p.payoffMonth,
          p.addToPlannedExpenses,
          p.version,
        ],
      );
    },
    async deletePlan(householdId, accountId) {
      await q.query(`DELETE FROM plans WHERE household_id = $1 AND account_id = $2`, [
        householdId,
        accountId,
      ]);
    },
    enqueueHandOff: (_householdId, handOff) => enqueueHandOff(q, handOff),
  };
}
