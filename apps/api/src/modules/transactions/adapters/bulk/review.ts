import { z } from "zod";
import type { ModuleDatabase } from "../../../../platform/db/module-db.ts";
import { ApiProblem } from "../../../../platform/http/problem.ts";
import type {
  BulkActionHandler,
  BulkRecord,
  BulkTarget,
  PlannedChange,
} from "../../../bulk-actions/index.ts";
import { confirmReview, REVIEW_STATES, type ReviewState } from "../../domain/index.ts";
import { transactionsList, transactionsTx } from "../db/store.ts";

/**
 * BUD-12@PoC FR 12 and FR 14 (DAT-03@PoC FR 2): «Дії з вибраними» → «Підтвердити категорії» of «Транзакції», and
 * «Підтвердити» of a merchant's group in «До розбору» (the group's transactions selected by their ids). The target is the
 * entity `transaction-review` — the transactions of this module with one field, `review` (`queued`, `confirmed`, or null
 * — never in the queue); the version is the transaction's, so a card confirmed or changed since is a conflict. A write
 * follows the rules of one confirmation (application/review.ts): under the row's lock, a merged duplicate refused; it
 * writes no audit entry of its own — the action's one group entry holds every change with its values before and after
 * (business rules: «Масові дії … одним груповим записом»). «Відмінити» puts the confirmed ones back into the queue.
 */
export const REVIEW_ENTITY = "transaction-review";
export const CONFIRM_CATEGORY_ACTION = "transactions.confirm-category";

const FIELD = "review";
/** BUD-12: «розбір транзакцій» (adapters/http/services.ts `REVIEW_FLAG`). */
const REVIEW_FEATURE = "transactions.review";

const stateOf = (value: string | null | undefined): ReviewState | null =>
  (REVIEW_STATES as readonly string[]).includes(value ?? "") ? (value as ReviewState) : null;

export function createReviewBulkActions(deps: {
  readonly db: ModuleDatabase;
  /** The flag runtime (feature-flags): «Підтвердити категорії» is behind `transactions.review`; without it — off. */
  readonly flags?: { isEnabled(householdId: string, flag: string): Promise<boolean> };
}): { readonly targets: readonly BulkTarget[]; readonly actions: readonly BulkActionHandler[] } {
  const { db } = deps;
  const target: BulkTarget = {
    entity: REVIEW_ENTITY,
    async select(caller, filter, excluded, limit) {
      if (caller.scoped) return { ids: [], count: 0 };
      const filters = filter.some((f) => f.startsWith("hidden."))
        ? [...filter]
        : [...filter, "hidden.eq:false"];
      try {
        // The queue's order (oldest first) when the selection is «До розбору», else the list's.
        return await db.inHousehold(caller.householdId, (q) =>
          transactionsList.ids(q, { filter: filters, sort: "date" }, { excluded, limit }),
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
        const { rows } = await q.query<{ id: string; review: string | null; version: number }>(
          `SELECT id, review, version FROM transactions WHERE household_id = $1 AND id = ANY($2::uuid[])`,
          [caller.householdId, [...ids]],
        );
        for (const r of rows) out.set(r.id, { id: r.id, version: r.version, values: { [FIELD]: r.review } });
        return out;
      });
    },
    async write(caller, id, expectedVersion, values) {
      if (caller.scoped) return { kind: "unavailable" };
      // Only into the queue or out of it: a transaction never queued is never put there (FR 8).
      const review = stateOf(values[FIELD]);
      if (review === null) return { kind: "invalid", issue: "review.invalid" };
      return db.inHousehold(caller.householdId, async (q) => {
        const rows = transactionsTx(q);
        const current = await rows.lock(caller.householdId, id);
        if (!current) return { kind: "unavailable" as const };
        if (current.version !== expectedVersion) return { kind: "conflict" as const };
        if (current.mergedInto !== null) return { kind: "invalid" as const, issue: "transaction.merged" };
        if (current.review === null) return { kind: "invalid" as const, issue: "transaction.not_in_review" };
        const next = await rows.update(caller.householdId, {
          ...current,
          review,
          version: current.version + 1,
        });
        return { kind: "changed" as const, version: next.version };
      });
    },
  };

  /**
   * «Підтвердити категорії» (FR 12, FR 14): a transaction of the queue — its category confirmed; one confirmed already
   * or never in the queue (entered by hand) — «без змін»; a merged duplicate — `transaction.merged`.
   */
  const confirmCategories: BulkActionHandler = {
    name: CONFIRM_CATEGORY_ACTION,
    entity: REVIEW_ENTITY,
    // No parameters: «Підтвердити категорії» confirms the category each transaction has.
    params: z.strictObject({}).optional(),
    enabled: (caller) =>
      deps.flags ? deps.flags.isEnabled(caller.householdId, REVIEW_FEATURE) : Promise.resolve(false),
    async plan(caller, records) {
      const plans = new Map<string, PlannedChange>();
      const merged = await db.inHousehold(caller.householdId, async (q) => {
        const { rows } = await q.query<{ id: string }>(
          `SELECT id FROM transactions WHERE household_id = $1 AND id = ANY($2::uuid[]) AND merged_into IS NOT NULL`,
          [caller.householdId, records.map((r) => r.id)],
        );
        return new Set(rows.map((r) => r.id));
      });
      for (const r of records) {
        if (merged.has(r.id)) {
          plans.set(r.id, { kind: "invalid", issue: "transaction.merged" });
          continue;
        }
        const next = confirmReview(stateOf(r.values[FIELD]));
        plans.set(
          r.id,
          next === "confirmed" ? { kind: "change", after: { [FIELD]: next } } : { kind: "unchanged" },
        );
      }
      return plans;
    },
  };
  return { targets: [target], actions: [confirmCategories] };
}
