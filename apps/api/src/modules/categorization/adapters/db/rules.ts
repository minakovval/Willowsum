import { Money } from "@willowsum/domain-kernel";
import type { z } from "zod";
import type { HouseholdQueryRunner } from "../../../../platform/db/module-db.ts";
import { enqueueJob } from "../../../../platform/queue/index.ts";
import type { AuditHandOff, RulesTx, StoredRule } from "../../application/index.ts";
import type { RuleCondition } from "../../domain/index.ts";
import { AUDIT_JOB } from "../queue/job.ts";

/**
 * The category rules through the module's own role (migrations/0003_rules.sql). The row policy binds the space; SQL
 * filters it too. A condition is stored as JSON: an amount as its decimal string and currency.
 */
type StoredCondition =
  | { field: "merchant" | "description"; operator: "equals" | "contains"; value: string }
  | { field: "amount"; operator: "equals" | "greater" | "less"; value: { amount: string; currency: string } }
  | { field: "account"; operator: "equals"; value: string };

interface Row {
  id: string;
  position: number;
  conditions: StoredCondition[];
  account_ids: string[];
  category_id: string;
  enabled: boolean;
  version: number;
  created_at: string;
}

const toJson = (conditions: readonly RuleCondition[]): StoredCondition[] =>
  conditions.map((c) =>
    c.field === "amount"
      ? {
          field: c.field,
          operator: c.operator,
          value: { amount: c.value.toDecimalString(), currency: c.value.currency },
        }
      : { ...c },
  );

const fromJson = (conditions: readonly StoredCondition[]): RuleCondition[] =>
  conditions.map((c) =>
    c.field === "amount" ? { ...c, value: Money.of(c.value.amount, c.value.currency) } : c,
  );

const stored = (r: Row): StoredRule => ({
  id: r.id,
  position: r.position,
  conditions: fromJson(r.conditions),
  accountIds: r.account_ids,
  categoryId: r.category_id,
  enabled: r.enabled,
  version: r.version,
  createdAt: r.created_at,
});

export function rulesTx(q: HouseholdQueryRunner): RulesTx {
  return {
    async lockRules(householdId) {
      await q.query(`SELECT pg_advisory_xact_lock(hashtextextended('categorization.rules:' || $1, 0))`, [
        householdId,
      ]);
    },
    async rules(householdId) {
      const { rows } = await q.query<Row>(
        `SELECT id, position, conditions, account_ids, category_id, enabled, version,
                to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') AS created_at FROM rules
          WHERE household_id = $1 ORDER BY position`,
        [householdId],
      );
      return rows.map(stored);
    },
    async insertRule(householdId, rule, key) {
      await q.query(
        `INSERT INTO rules (household_id, id, position, conditions, account_ids, category_id, enabled, condition_key)
         VALUES ($1, $2, $3, $4::jsonb, $5::uuid[], $6, $7, $8)`,
        [
          householdId,
          rule.id,
          rule.position,
          JSON.stringify(toJson(rule.conditions)),
          rule.accountIds,
          rule.categoryId,
          rule.enabled,
          key,
        ],
      );
    },
    async updateRule(householdId, rule, key) {
      await q.query(
        `UPDATE rules SET conditions = $3::jsonb, account_ids = $4::uuid[], category_id = $5, enabled = $6,
                          condition_key = $7, version = $8, updated_at = now()
          WHERE household_id = $1 AND id = $2`,
        [
          householdId,
          rule.id,
          JSON.stringify(toJson(rule.conditions)),
          rule.accountIds,
          rule.categoryId,
          rule.enabled,
          key,
          rule.version,
        ],
      );
    },
    async setOrder(householdId, ids) {
      // The unique position is checked at commit (DEFERRABLE), so the rules may pass through each other's places.
      await q.query(
        `UPDATE rules r SET position = o.position, version = r.version + 1, updated_at = now()
           FROM unnest($2::uuid[]) WITH ORDINALITY AS o(id, position)
          WHERE r.household_id = $1 AND r.id = o.id AND r.position <> o.position`,
        [householdId, ids],
      );
    },
    async sameConditions(householdId, key, exceptId) {
      const { rows } = await q.query<{ id: string }>(
        `SELECT id FROM rules WHERE household_id = $1 AND condition_key = $2 AND id <> $3
          ORDER BY position LIMIT 1`,
        [householdId, key, exceptId],
      );
      return rows[0]?.id ?? null;
    },
    async appliedCounts(householdId) {
      const { rows } = await q.query<{ rule_id: string; count: string }>(
        `SELECT rule_id, count(*) AS count FROM transaction_categories
          WHERE household_id = $1 AND source = 'rule' AND rule_id IS NOT NULL GROUP BY rule_id`,
        [householdId],
      );
      return new Map(rows.map((r) => [r.rule_id, Number(r.count)]));
    },
    async moveRules(householdId, sourceId, targetId) {
      const { rowCount } = await q.query(
        `UPDATE rules SET category_id = $3, version = version + 1, updated_at = now()
          WHERE household_id = $1 AND category_id = $2`,
        [householdId, sourceId, targetId],
      );
      return rowCount ?? 0;
    },
    async enqueueAudit(_householdId, handOff: AuditHandOff) {
      await enqueueJob(q, AUDIT_JOB, handOff.key, handOff as z.infer<typeof AUDIT_JOB.schema>);
    },
  };
}
