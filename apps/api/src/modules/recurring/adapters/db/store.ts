import { Money } from "@willowsum/domain-kernel";
import type { HouseholdQueryRunner } from "../../../../platform/db/module-db.ts";
import type { RecurringTx, StoredMark, StoredPayment, StoredRejection } from "../../application/index.ts";
import { enqueueHandOff } from "../queue/job.ts";

/** The recurring schema through the module's own role (migrations/0001_payments.sql). The row policy binds the space; SQL filters it too. */
const PAYMENT_COLUMNS = `id, name, type, frequency, expected_amount::text AS expected_amount, expected_currency AS currency,
  to_char(anchor_date, 'YYYY-MM-DD') AS anchor_date, to_char(end_date, 'YYYY-MM-DD') AS end_date, category_id,
  account_id, subscription, variable, merchant_id, source, to_char(created_on, 'YYYY-MM-DD') AS created_on, version,
  current_amount::text AS current_amount, current_currency, to_char(kept_on, 'YYYY-MM-DD') AS kept_on`;

interface PaymentRow {
  id: string;
  name: string;
  type: StoredPayment["type"];
  frequency: StoredPayment["frequency"];
  expected_amount: string;
  currency: string;
  anchor_date: string;
  end_date: string | null;
  category_id: string | null;
  account_id: string | null;
  subscription: boolean;
  variable: boolean;
  merchant_id: string | null;
  source: StoredPayment["source"];
  created_on: string;
  version: number;
  current_amount: string | null;
  current_currency: string | null;
  kept_on: string | null;
}

const payment = (r: PaymentRow): StoredPayment => ({
  id: r.id,
  name: r.name,
  type: r.type,
  frequency: r.frequency,
  expected: Money.of(r.expected_amount, r.currency),
  anchorDate: r.anchor_date,
  endDate: r.end_date,
  categoryId: r.category_id,
  accountId: r.account_id,
  subscription: r.subscription,
  variable: r.variable,
  merchantId: r.merchant_id,
  source: r.source,
  createdOn: r.created_on,
  version: r.version,
  current:
    r.current_amount === null || r.current_currency === null
      ? null
      : Money.of(r.current_amount, r.current_currency),
  keptOn: r.kept_on,
});

interface RejectionRow {
  id: string;
  merchant_id: string;
  type: StoredRejection["type"];
  frequency: StoredRejection["frequency"];
  variable: boolean;
  expected_amount: string;
  currency: string;
  transaction_ids: string[];
  created_on: string;
}

const UNIQUE_VIOLATION = "23505";

export function recurringTx(q: HouseholdQueryRunner): RecurringTx {
  return {
    async payments(householdId) {
      const { rows } = await q.query<PaymentRow>(
        `SELECT ${PAYMENT_COLUMNS} FROM payments WHERE household_id = $1 ORDER BY name, id`,
        [householdId],
      );
      return rows.map(payment);
    },
    async payment(householdId, id) {
      const { rows } = await q.query<PaymentRow>(
        `SELECT ${PAYMENT_COLUMNS} FROM payments WHERE household_id = $1 AND id = $2`,
        [householdId, id],
      );
      return rows[0] ? payment(rows[0]) : null;
    },
    async insertPayment(householdId, p) {
      await q.query(
        `INSERT INTO payments (household_id, id, name, type, frequency, expected_amount, expected_currency, anchor_date, end_date,
           category_id, account_id, subscription, variable, merchant_id, source, created_on)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
        [
          householdId,
          p.id,
          p.name,
          p.type,
          p.frequency,
          p.expected.toDecimalString(),
          p.expected.currency,
          p.anchorDate,
          p.endDate,
          p.categoryId,
          p.accountId,
          p.subscription,
          p.variable,
          p.merchantId,
          p.source,
          p.createdOn,
        ],
      );
    },
    async decisions(householdId) {
      const merchants = await q.query<{ merchant_id: string }>(
        `SELECT merchant_id FROM payments WHERE household_id = $1 AND merchant_id IS NOT NULL`,
        [householdId],
      );
      const { rows } = await q.query<RejectionRow>(
        `SELECT id, merchant_id, type, frequency, variable, expected_amount::text AS expected_amount, expected_currency AS currency,
           transaction_ids::text[] AS transaction_ids, to_char(created_on, 'YYYY-MM-DD') AS created_on
         FROM rejections WHERE household_id = $1`,
        [householdId],
      );
      return {
        merchantIds: new Set(merchants.rows.map((r) => r.merchant_id)),
        rejections: rows.map((r) => ({
          id: r.id,
          merchantId: r.merchant_id,
          type: r.type,
          frequency: r.frequency,
          variable: r.variable,
          expected: Money.of(r.expected_amount, r.currency),
          transactionIds: r.transaction_ids,
          createdOn: r.created_on,
        })),
      };
    },
    async lockMerchant(householdId, merchantId) {
      await q.query(
        `SELECT pg_advisory_xact_lock(hashtextextended('recurring.merchant:' || $1 || ':' || $2, 0))`,
        [householdId, merchantId],
      );
    },
    async insertRejection(householdId, r) {
      await q.query(
        `INSERT INTO rejections (household_id, id, merchant_id, type, frequency, variable, expected_amount, expected_currency,
           transaction_ids, created_on)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::uuid[], $10)`,
        [
          householdId,
          r.id,
          r.merchantId,
          r.type,
          r.frequency,
          r.variable,
          r.expected.toDecimalString(),
          r.expected.currency,
          r.transactionIds,
          r.createdOn,
        ],
      );
    },
    async moveCategory(householdId, sourceId, targetId) {
      const { rows } = await q.query<PaymentRow>(
        `UPDATE payments SET category_id = $3, version = version + 1, updated_at = now()
         WHERE household_id = $1 AND category_id = $2
         RETURNING ${PAYMENT_COLUMNS}`,
        [householdId, sourceId, targetId],
      );
      return rows.map(payment);
    },
    async categoriesInUse(householdId, ids) {
      const { rows } = await q.query<{ category_id: string }>(
        `SELECT DISTINCT category_id FROM payments WHERE household_id = $1 AND category_id = ANY($2::uuid[])`,
        [householdId, ids],
      );
      return new Set(rows.map((r) => r.category_id));
    },
    async lockPayment(householdId, id) {
      const { rows } = await q.query<PaymentRow>(
        `SELECT ${PAYMENT_COLUMNS} FROM payments WHERE household_id = $1 AND id = $2 FOR UPDATE`,
        [householdId, id],
      );
      return rows[0] ? payment(rows[0]) : null;
    },
    async marks(householdId) {
      const { rows } = await q.query<{
        id: string;
        payment_id: string;
        due_on: string;
        kind: StoredMark["kind"];
        transaction_id: string | null;
        marked_on: string;
      }>(
        `SELECT id, payment_id, to_char(due_on, 'YYYY-MM-DD') AS due_on, kind, transaction_id,
           to_char(marked_on, 'YYYY-MM-DD') AS marked_on
         FROM charge_marks WHERE household_id = $1 ORDER BY payment_id, due_on`,
        [householdId],
      );
      return rows.map((r) =>
        r.kind === "settled"
          ? {
              id: r.id,
              paymentId: r.payment_id,
              dueOn: r.due_on,
              kind: "settled" as const,
              transactionId: r.transaction_id!,
              markedOn: r.marked_on,
            }
          : {
              id: r.id,
              paymentId: r.payment_id,
              dueOn: r.due_on,
              kind: "skipped" as const,
              markedOn: r.marked_on,
            },
      );
    },
    async saveMark(householdId, m) {
      // One mark per charge: «Зарахувати» replaces «Пропущено» (FR 20). A transaction settles one charge of the space
      // (`charge_marks_by_transaction`): the second one is refused.
      try {
        // A refusal ends the request: the transaction is rolled back, nothing runs after it.
        const { rows } = await q.query<{ id: string }>(
          `INSERT INTO charge_marks (household_id, id, payment_id, due_on, kind, transaction_id, marked_on)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (household_id, payment_id, due_on) DO UPDATE
             SET kind = EXCLUDED.kind, transaction_id = EXCLUDED.transaction_id, marked_on = EXCLUDED.marked_on,
                 updated_at = now()
           RETURNING id`,
          [
            householdId,
            m.id,
            m.paymentId,
            m.dueOn,
            m.kind,
            m.kind === "settled" ? m.transactionId : null,
            m.markedOn,
          ],
        );
        return rows[0]!.id;
      } catch (error) {
        if ((error as { code?: string }).code === UNIQUE_VIOLATION) return null;
        throw error;
      }
    },
    async settledElsewhere(householdId, transactionId) {
      const { rowCount } = await q.query(
        `SELECT 1 FROM charge_marks WHERE household_id = $1 AND transaction_id = $2`,
        [householdId, transactionId],
      );
      return (rowCount ?? 0) > 0;
    },
    async keep(householdId, id, today) {
      const { rows } = await q.query<PaymentRow>(
        `UPDATE payments SET kept_on = $3, version = version + 1, updated_at = now()
         WHERE household_id = $1 AND id = $2
         RETURNING ${PAYMENT_COLUMNS}`,
        [householdId, id, today],
      );
      return rows[0] ? payment(rows[0]) : null;
    },
    async setCurrentAmount(householdId, id, before, after) {
      // Compare and set: of two reads that find the same change, one writes it (and its audit entry).
      const { rowCount } = await q.query(
        `UPDATE payments SET current_amount = $3::numeric, current_currency = $5, updated_at = now()
         WHERE household_id = $1 AND id = $2 AND current_amount IS NOT DISTINCT FROM $4::numeric`,
        [
          householdId,
          id,
          after.toDecimalString(),
          before === null ? null : before.toDecimalString(),
          after.currency,
        ],
      );
      return (rowCount ?? 0) > 0;
    },
    enqueueHandOff: (handOff) => enqueueHandOff(q, handOff),
  };
}
