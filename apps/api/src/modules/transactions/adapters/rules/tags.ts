import type { ModuleDatabase } from "../../../../platform/db/module-db.ts";
import {
  addRuleTags,
  createAcceptedTags,
  restoreRuleTags,
  type HandOffDeps,
} from "../../application/index.ts";
import { tagNames } from "../../domain/index.ts";
import { transactionsTx } from "../db/store.ts";
import { tagsTx } from "../db/tags.ts";

/** BUD-13: «атрибути транзакцій» (adapters/http/routes.ts `ATTRIBUTES`): the tags of a rule need them on. */
const ATTRIBUTES_FEATURE = "transactions.attributes";

/**
 * The transactions module as module categorization's category rules write it (BUD-14@PoC FR 5, FR 7, FR 9): a rule's
 * tags on one transaction and their «Відмінити». Each call is one transactions transaction of its own (the
 * categorization transaction is another), with the hand-off of the change (its audit entry — the worker writes it).
 */
export interface TransactionRuleTags {
  /** The names as a rule keeps them: each checked as a tag's (BUD-13 FR 2), the same once; null — invalid. */
  check(names: readonly string[]): { readonly names: readonly string[] } | { readonly issue: string } | null;
  /**
   * The tags added after the transaction's own; `actorAccountId` null — the system (a new transaction). `refused` — not
   * there, a merged duplicate, a closed account, more than 20 tags, or the tags of transactions are off.
   */
  addTags(
    householdId: string,
    transactionId: string,
    names: readonly string[],
    actorAccountId: string | null,
  ): Promise<
    | { readonly kind: "changed"; readonly before: string[]; readonly after: string[] }
    | { readonly kind: "unchanged" }
    | { readonly kind: "refused" }
  >;
  /**
   * BUD-21 FR 17, FR 26: the tags of rules accepted from a history file, each missing one created with its audit entry;
   * how many were created. Off (the tags of transactions) — none.
   */
  createTags(householdId: string, names: readonly string[], actorAccountId: string): Promise<number>;
  /** «Відмінити»: `next` only while the tags are still `expected`; otherwise `changed` (kept). */
  restoreTags(
    householdId: string,
    transactionId: string,
    expected: readonly string[],
    next: readonly string[],
    actorAccountId: string,
  ): Promise<"restored" | "changed">;
}

export function createRuleTags(deps: {
  readonly db: ModuleDatabase;
  readonly accounts: HandOffDeps["accounts"];
  readonly newId: () => string;
  /** The flag runtime (feature-flags); without it — off (the rules add no tags). */
  readonly flags?: { isEnabled(householdId: string, flag: string): Promise<boolean> };
}): TransactionRuleTags {
  const on = (householdId: string) =>
    deps.flags ? deps.flags.isEnabled(householdId, ATTRIBUTES_FEATURE) : Promise.resolve(false);
  return {
    check(names) {
      const checked = tagNames(names);
      return "issue" in checked ? { issue: checked.issue.issue } : checked;
    },
    async addTags(householdId, transactionId, names, actorAccountId) {
      if (!(await on(householdId))) return { kind: "refused" };
      const result = await deps.db.inHousehold(householdId, (q) =>
        addRuleTags(
          deps,
          transactionsTx(q),
          tagsTx(q),
          { householdId, accountId: actorAccountId },
          transactionId,
          names,
        ),
      );
      return result.kind === "changed"
        ? { kind: "changed", before: result.before, after: result.after }
        : result;
    },
    async createTags(householdId, names, actorAccountId) {
      if (!(await on(householdId))) return 0;
      return deps.db.inHousehold(householdId, (q) =>
        createAcceptedTags(tagsTx(q), householdId, actorAccountId, names, deps.newId),
      );
    },
    async restoreTags(householdId, transactionId, expected, next, actorAccountId) {
      const result = await deps.db.inHousehold(householdId, (q) =>
        restoreRuleTags(
          deps,
          transactionsTx(q),
          tagsTx(q),
          { householdId, accountId: actorAccountId },
          transactionId,
          expected,
          next,
        ),
      );
      return result.kind;
    },
  };
}
