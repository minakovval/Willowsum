import { ApiProblem } from "../../../../platform/http/problem.ts";
import type { ProtectedContext } from "../../../../platform/http/route.ts";
import { logEvent } from "../../../../platform/telemetry/signals.ts";
import type { AuditLog } from "../../../audit/index.ts";
import {
  applyAudit,
  applyHandOff,
  type AuditHandOff,
  type CategoryAudit,
  type CategoryHandOff,
  type RuleDeps,
  type RulesAuditLog,
  type SetDeps,
} from "../../application/index.ts";

const BRAND = Symbol("willowsum-categorization-services");

/**
 * What the API process wires for the categorization routes (src/api.ts → `ctx.services`): module transactions'
 * lookup, module categories' directory (FR 9) and the audit log. Every port takes the caller's space.
 */
export interface CategorizationServices {
  readonly [BRAND]: true;
  readonly deps: SetDeps;
  readonly audit: CategoryAudit;
  /** BUD-14 b: the ports of the category rules; absent — the rule routes answer 500. */
  readonly rules: { readonly deps: RuleDeps } | null;
  readonly rulesAudit: RulesAuditLog;
  /** FR 7 «Показати»: the newest transactions of a space a rule's conditions are matched against. */
  readonly scanMax: number;
}

/** BUD-14 FR 7: a rule's matches look at the newest 20 000 transactions of the space (a bound on one request). */
export const RULE_SCAN_MAX = 20_000;

export function createCategorizationServices(options: {
  readonly transactions: SetDeps["transactions"];
  readonly categories: SetDeps["categories"];
  readonly audit: Pick<AuditLog, "record">;
  /** BUD-14 b: module accounts' directory, module merchants' names, module transactions' rule inputs. */
  readonly rules?: Omit<RuleDeps, "categories">;
  readonly scanMax?: number;
}): CategorizationServices {
  return {
    [BRAND]: true,
    deps: { transactions: options.transactions, categories: options.categories },
    audit: categorizationAudit(options.audit),
    rules: options.rules ? { deps: { ...options.rules, categories: options.categories } } : null,
    rulesAudit: options.audit,
    scanMax: options.scanMax ?? RULE_SCAN_MAX,
  };
}

/** The services of a categorization route; without them (never in the API process) the route answers 500. */
export function categorizationServices(ctx: ProtectedContext): CategorizationServices {
  const services = ctx.services as Partial<CategorizationServices> | undefined;
  if (!services || services[BRAND] !== true) throw new ApiProblem("INTERNAL");
  return services as CategorizationServices;
}

/**
 * A change of a transaction's category in the space's own log (BUD-01 «Права доступу»: who, when, before and after;
 * П-10): the entity is the transaction's category (its id — the transaction's); category ids and source codes are not
 * personal data. Also the worker's (src/wiring.ts).
 */
export function categorizationAudit(audit: Pick<AuditLog, "record">): CategoryAudit {
  return {
    async record(householdId, handOff, key) {
      await audit.record(householdId, {
        actor: { kind: "user", id: handOff.actorAccountId },
        channel: "web",
        entity: { type: "categorization.transaction-category", id: handOff.transactionId },
        action: "update",
        changes: [
          { field: "categoryId", before: handOff.before.categoryId, after: handOff.after.categoryId },
          { field: "source", before: handOff.before.source, after: handOff.after.source },
        ]
          .filter((c) => c.before !== c.after)
          .map((c) => ({ ...c, sensitive: false })),
        key,
      });
    },
  };
}

/**
 * ARC-04 FR 2: the audit entry of a committed change, right away — after the categorization transaction. A failure is
 * no failure of the request: the change is made and its job is in the queue, so the worker writes the entry. Logged as
 * `categorization.hand_off_deferred` (WARN, the error class only).
 */
export async function handOffNow(
  audit: CategoryAudit,
  householdId: string,
  handOff: CategoryHandOff | null,
): Promise<void> {
  if (handOff === null) return;
  try {
    await applyHandOff(audit, householdId, handOff);
  } catch (error) {
    logEvent("categorization.hand_off_deferred", "warn", {
      "ws.module": "categorization",
      "error.type": error instanceof Error ? error.constructor.name || error.name : typeof error,
    });
  }
}

/**
 * The audit entry of a committed change of a rule, right away (ARC-04 FR 2): a failure is no failure of the request —
 * the job `categorization.audit` is in the queue and the worker writes it. Logged as `categorization.hand_off_deferred`.
 */
export async function rulesAuditNow(
  audit: RulesAuditLog,
  householdId: string,
  handOff: AuditHandOff | null,
): Promise<void> {
  if (handOff === null) return;
  try {
    await applyAudit(audit, householdId, handOff);
  } catch (error) {
    logEvent("categorization.hand_off_deferred", "warn", {
      "ws.module": "categorization",
      "error.type": error instanceof Error ? error.constructor.name || error.name : typeof error,
    });
  }
}
