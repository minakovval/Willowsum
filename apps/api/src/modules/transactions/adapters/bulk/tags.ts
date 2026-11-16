import { z } from "zod";
import type { ModuleDatabase } from "../../../../platform/db/module-db.ts";
import { ApiProblem } from "../../../../platform/http/problem.ts";
import type {
  BulkActionHandler,
  BulkRecord,
  BulkTarget,
  BulkValues,
  PlannedChange,
} from "../../../bulk-actions/index.ts";
import { resolveTags } from "../../application/index.ts";
import { tagKey, tagNames, TAG_NAME_MAX, TAGS_PER_TRANSACTION_MAX } from "../../domain/index.ts";
import { transactionsList, transactionsTx } from "../db/store.ts";
import { tagsTx } from "../db/tags.ts";

/**
 * DAT-03@PoC FR 2 and BUD-13@PoC FR 2: «Додати теги» of the selection panel of «Транзакції». The target is the entity
 * `transaction-tags` — the transactions of this module with one field, `tags`: the names of their tags in order (JSON),
 * so «Відмінити» gives back the tags by name; the version is the transaction's (a tag renamed, merged or deleted since
 * gives each of its transactions a new one, so such a record is «не відновлено»). A write follows the rules of one
 * change: a merged duplicate and a transaction on a closed account are refused, at most 20 tags; it writes no audit
 * entry of its own (the action's group entry holds the change, DAT-03 FR 11). Tag names are free text: masked there.
 */
export const TAGS_ENTITY = "transaction-tags";
export const ADD_TAGS_ACTION = "transactions.add-tags";

const FIELD = "tags";

const namesOf = (values: BulkValues): string[] | null => {
  try {
    const parsed: unknown = JSON.parse(values[FIELD] ?? "[]");
    return Array.isArray(parsed) && parsed.every((n) => typeof n === "string") ? parsed : null;
  } catch {
    return null;
  }
};

export function createTagBulkActions(deps: {
  readonly db: ModuleDatabase;
  /** The accounts module's directory: a transaction on a closed account is read only (FIN-12 FR 8). */
  readonly accounts: {
    postingAccount(householdId: string, accountId: string): Promise<{ status: string } | null>;
  };
  readonly newId: () => string;
}): { readonly targets: readonly BulkTarget[]; readonly actions: readonly BulkActionHandler[] } {
  const { db } = deps;
  const target: BulkTarget = {
    entity: TAGS_ENTITY,
    async select(caller, filter, excluded, limit) {
      if (caller.scoped) return { ids: [], count: 0 };
      const filters = filter.some((f) => f.startsWith("hidden."))
        ? [...filter]
        : [...filter, "hidden.eq:false"];
      try {
        return await db.inHousehold(caller.householdId, (q) =>
          transactionsList.ids(q, { filter: filters, sort: "-date" }, { excluded, limit }),
        );
      } catch (error) {
        if (error instanceof ApiProblem && error.code === "VALIDATION_FAILED") return { invalid: true };
        throw error;
      }
    },
    async read(caller, ids) {
      const out = new Map<string, BulkRecord>();
      if (caller.scoped || ids.length === 0) return out;
      return db.inHousehold(caller.householdId, async (q) => {
        const { rows } = await q.query<{ id: string; tag_ids: string[]; version: number }>(
          `SELECT id, tag_ids::text[] AS tag_ids, version FROM transactions WHERE household_id = $1 AND id = ANY($2::uuid[])`,
          [caller.householdId, [...ids]],
        );
        const names = await tagsTx(q).names(caller.householdId, [...new Set(rows.flatMap((r) => r.tag_ids))]);
        for (const r of rows) {
          const tags = r.tag_ids.filter((t) => names.has(t)).map((t) => names.get(t)!);
          out.set(r.id, { id: r.id, version: r.version, values: { [FIELD]: JSON.stringify(tags) } });
        }
        return out;
      });
    },
    async write(caller, id, expectedVersion, values) {
      if (caller.scoped) return { kind: "unavailable" };
      const names = namesOf(values);
      const checked = names === null ? null : tagNames(names);
      if (checked === null || "issue" in checked)
        return {
          kind: "invalid",
          issue: checked && checked.issue.issue === "too_many" ? "tags.too_many" : "tags.invalid",
        };
      return db.inHousehold(caller.householdId, async (q) => {
        const rows = transactionsTx(q);
        const seen = await rows.find(caller.householdId, id);
        if (!seen) return { kind: "unavailable" as const };
        if (seen.mergedInto !== null) return { kind: "invalid" as const, issue: "transaction.merged" };
        if ((await deps.accounts.postingAccount(caller.householdId, seen.accountId))?.status === "closed")
          return { kind: "invalid" as const, issue: "account.closed" };
        // The tags before the row (application/attributes.ts: the order of every tag change).
        const tagIds = await resolveTags(tagsTx(q), caller.householdId, checked.names, deps.newId);
        if (!Array.isArray(tagIds)) return { kind: "invalid" as const, issue: "tags.invalid" };
        const current = await rows.lock(caller.householdId, id);
        if (!current) return { kind: "unavailable" as const };
        if (current.version !== expectedVersion) return { kind: "conflict" as const };
        const next = await rows.update(caller.householdId, {
          ...current,
          tagIds,
          version: current.version + 1,
        });
        return { kind: "changed" as const, version: next.version };
      });
    },
  };

  /**
   * «Додати теги» (DAT-03 FR 2): the tags added after each transaction's own, the same tag (without regard to case) once;
   * a transaction that has them all is «без змін»; more than 20 — «невалідний» `tags.too_many` («Досягнуто 20 тегів»);
   * a merged duplicate — `transaction.merged`.
   */
  const addTags: BulkActionHandler = {
    name: ADD_TAGS_ACTION,
    entity: TAGS_ENTITY,
    params: z.strictObject({
      tags: z
        .array(z.string().max(TAG_NAME_MAX * 4))
        .min(1)
        .max(TAGS_PER_TRANSACTION_MAX),
    }),
    sensitiveFields: [FIELD],
    async plan(caller, records, params) {
      const plans = new Map<string, PlannedChange>();
      const added = tagNames((params as { tags: string[] }).tags);
      const merged = await db.inHousehold(caller.householdId, async (q) => {
        const { rows } = await q.query<{ id: string }>(
          `SELECT id FROM transactions WHERE household_id = $1 AND id = ANY($2::uuid[]) AND merged_into IS NOT NULL`,
          [caller.householdId, records.map((r) => r.id)],
        );
        return new Set(rows.map((r) => r.id));
      });
      for (const r of records) {
        const own = namesOf(r.values) ?? [];
        if ("issue" in added) {
          plans.set(r.id, { kind: "invalid", issue: "tags.invalid" });
          continue;
        }
        if (merged.has(r.id)) {
          plans.set(r.id, { kind: "invalid", issue: "transaction.merged" });
          continue;
        }
        const keys = new Set(own.map(tagKey));
        const next = [...own, ...added.names.filter((n) => !keys.has(tagKey(n)))];
        if (next.length === own.length) plans.set(r.id, { kind: "unchanged" });
        else if (next.length > TAGS_PER_TRANSACTION_MAX)
          plans.set(r.id, { kind: "invalid", issue: "tags.too_many" });
        else plans.set(r.id, { kind: "change", after: { [FIELD]: JSON.stringify(next) } });
      }
      return plans;
    },
  };
  return { targets: [target], actions: [addTags] };
}
