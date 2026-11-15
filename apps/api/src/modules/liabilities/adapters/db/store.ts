import { Decimal, Money } from "@willowsum/domain-kernel";
import type { ModuleQueryRunner } from "../../../../platform/db/module-db.ts";
import type { LiabilitiesTx, Liability } from "../../application/index.ts";
import { termsMissing, type LiabilityKind } from "../../domain/index.ts";
import { enqueueHandOff } from "../queue/job.ts";

/**
 * The liabilities schema through the module's own role (migrations/0001_liabilities.sql, 0002). `terms_pending` marks a
 * loan that may miss its rate or payment after «Кредитна картка» → «Кредит» (FIN-12@PoC AC12); only `update` sets it,
 * so a new loan stays under the stored rule «a loan has its rate and monthly payment». `enqueueHandOff` writes the audit
 * entry's job in the same transaction (migrations/0003_queue.sql; ARC-04 FR 2). `termsHistory` and `recordTerms` are the
 * dated history of the terms (migrations/0004_terms_history.sql; FIN-12@PoC AC10); `liabilities` keeps the terms now.
 */

interface Row {
  id: string;
  account_id: string;
  kind: LiabilityKind;
  currency: string;
  annual_rate: string | null;
  monthly_payment: string | null;
  credit_limit: string | null;
  grace_period_days: number | null;
}

const COLUMNS = `id, account_id, kind, currency, annual_rate::text AS annual_rate,
  monthly_payment::text AS monthly_payment, credit_limit::text AS credit_limit, grace_period_days`;

const money = (amount: string | null, currency: string) =>
  amount === null ? null : Money.of(amount, currency);
/** NUMERIC(38,18) comes back with 18 decimals; the canonical rate drops the trailing zeros. */
const rate = (text: string | null) => (text === null ? null : new Decimal(text).toFixed());

function liability(row: Row): Liability {
  return {
    id: row.id,
    accountId: row.account_id,
    kind: row.kind,
    currency: row.currency,
    annualRate: rate(row.annual_rate),
    monthlyPayment: money(row.monthly_payment, row.currency),
    creditLimit: money(row.credit_limit, row.currency),
    gracePeriodDays: row.grace_period_days,
  };
}

export function liabilitiesTx(q: ModuleQueryRunner): LiabilitiesTx {
  return {
    async insert(householdId, l) {
      const { rowCount } = await q.query(
        `INSERT INTO liabilities (household_id, id, account_id, kind, currency, annual_rate, monthly_payment,
           credit_limit, grace_period_days)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (household_id, account_id) DO NOTHING`,
        [
          householdId,
          l.id,
          l.accountId,
          l.kind,
          l.currency,
          l.annualRate,
          l.monthlyPayment?.toDecimalString() ?? null,
          l.creditLimit?.toDecimalString() ?? null,
          l.gracePeriodDays,
        ],
      );
      return rowCount === 1;
    },
    async lockByAccount(householdId, accountId) {
      const { rows } = await q.query<Row>(
        `SELECT ${COLUMNS} FROM liabilities WHERE household_id = $1 AND account_id = $2 FOR UPDATE`,
        [householdId, accountId],
      );
      return rows[0] ? liability(rows[0]) : null;
    },
    async update(householdId, l) {
      await q.query(
        `UPDATE liabilities SET kind = $3, annual_rate = $4, monthly_payment = $5, credit_limit = $6,
           grace_period_days = $7, terms_pending = $8
         WHERE household_id = $1 AND id = $2`,
        [
          householdId,
          l.id,
          l.kind,
          l.annualRate,
          l.monthlyPayment?.toDecimalString() ?? null,
          l.creditLimit?.toDecimalString() ?? null,
          l.gracePeriodDays,
          termsMissing(l),
        ],
      );
    },
    async termsHistory(householdId, liabilityId) {
      const { rows } = await q.query<Row & { valid_from: string | null }>(
        `SELECT t.liability_id AS id, l.account_id, t.kind, t.currency, t.annual_rate::text AS annual_rate,
           t.monthly_payment::text AS monthly_payment, t.credit_limit::text AS credit_limit, t.grace_period_days,
           to_char(t.valid_from, 'YYYY-MM-DD') AS valid_from
         FROM liability_terms t
         JOIN liabilities l ON l.household_id = t.household_id AND l.id = t.liability_id
         WHERE t.household_id = $1 AND t.liability_id = $2
         ORDER BY t.valid_from ASC NULLS FIRST, t.seq ASC`,
        [householdId, liabilityId],
      );
      return rows.map((row) => ({ validFrom: row.valid_from, terms: liability(row) }));
    },
    async recordTerms(householdId, { validFrom, terms: l }) {
      await q.query(
        `INSERT INTO liability_terms (household_id, id, liability_id, valid_from, kind, currency, annual_rate,
           monthly_payment, credit_limit, grace_period_days)
         VALUES ($1, gen_random_uuid(), $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (household_id, liability_id) WHERE valid_from IS NULL DO NOTHING`,
        [
          householdId,
          l.id,
          validFrom,
          l.kind,
          l.currency,
          l.annualRate,
          l.monthlyPayment?.toDecimalString() ?? null,
          l.creditLimit?.toDecimalString() ?? null,
          l.gracePeriodDays,
        ],
      );
    },
    enqueueHandOff: (householdId, handOff) => enqueueHandOff({ ...q, householdId }, handOff),
    async byAccount(householdId, accountId) {
      const { rows } = await q.query<Row>(
        `SELECT ${COLUMNS} FROM liabilities WHERE household_id = $1 AND account_id = $2`,
        [householdId, accountId],
      );
      return rows[0] ? liability(rows[0]) : null;
    },
  };
}
