// Public interface of the liabilities module (ARC-01 FR 2). Other modules import only this file.
import { randomUUID } from "node:crypto";
import type { ModuleDatabase } from "../../platform/db/module-db.ts";
import { defineModule } from "../../platform/modules/define.ts";
import type { AuditLog } from "../audit/index.ts";
import { eraseHouseholdLiabilities, liabilitiesTx } from "./adapters/index.ts";
import {
  changeLiabilityKind,
  registerLiability,
  type ChangeKindResult,
  type Liability,
  type LiabilityAudit,
  type RegisterResult,
} from "./application/index.ts";
import type { LiabilityKind, LiabilityTermsInput } from "./domain/index.ts";

export const liabilitiesModule = defineModule({
  name: "liabilities",
  publishes: [],
  consumes: [],
});

export {
  availableCredit,
  checkTerms,
  GRACE_PERIOD_MAX_DAYS,
  LIABILITY_KINDS,
  parseAnnualRate,
  parseTypedAmount,
  termsMissing,
} from "./domain/index.ts";
export type { LiabilityKind, LiabilityTerms, LiabilityTermsInput, TermsIssue } from "./domain/index.ts";
export type { ChangeKindResult, Liability, RegisterResult } from "./application/index.ts";

/** Liabilities of a space (FIN-01@PoC FR 2, FR 16): every call is bound to one space. */
export interface Liabilities {
  /**
   * The liability of an account (a loan or a credit card of `accounts`) with its terms, audited as created by
   * `actorAccountId`. Idempotent per account: a second call returns the liability there and writes nothing.
   */
  register(
    householdId: string,
    input: {
      readonly actorAccountId: string;
      readonly accountId: string;
      readonly terms: LiabilityTermsInput;
    },
  ): Promise<RegisterResult>;
  /** The liability of an account, or null. */
  forAccount(householdId: string, accountId: string): Promise<Liability | null>;
  /**
   * «Кредит» ↔ «Кредитна картка» (FIN-12@PoC FR 5): the account's liability takes the new kind, keeping the terms that
   * kind may have; audited as changed by `actorAccountId`. The same kind again writes nothing.
   */
  changeKind(
    householdId: string,
    input: { readonly actorAccountId: string; readonly accountId: string; readonly kind: LiabilityKind },
  ): Promise<ChangeKindResult>;
}

/** The terms' entry in the space's own log (П-10); amounts and rates are not personal data, nothing is masked. */
function liabilityAudit(audit: Pick<AuditLog, "record">): LiabilityAudit {
  return {
    async liabilityCreated(householdId, actorAccountId, l) {
      const change = (field: string, after: string | null) => ({
        field,
        before: null,
        after,
        sensitive: false,
      });
      await audit.record(householdId, {
        actor: { kind: "user", id: actorAccountId },
        channel: "web",
        entity: { type: "liabilities.liability", id: l.id },
        action: "create",
        changes: [
          change("accountId", l.accountId),
          change("kind", l.kind),
          change("currency", l.currency),
          change("annualRate", l.annualRate),
          change("monthlyPayment", l.monthlyPayment?.toDecimalString() ?? null),
          change("creditLimit", l.creditLimit?.toDecimalString() ?? null),
          change("gracePeriodDays", l.gracePeriodDays === null ? null : String(l.gracePeriodDays)),
        ],
      });
    },
    async liabilityChanged(householdId, actorAccountId, before, after) {
      const terms = (l: Liability) => ({
        kind: l.kind,
        annualRate: l.annualRate,
        monthlyPayment: l.monthlyPayment?.toDecimalString() ?? null,
        creditLimit: l.creditLimit?.toDecimalString() ?? null,
        gracePeriodDays: l.gracePeriodDays === null ? null : String(l.gracePeriodDays),
      });
      const [was, now] = [terms(before), terms(after)];
      await audit.record(householdId, {
        actor: { kind: "user", id: actorAccountId },
        channel: "web",
        entity: { type: "liabilities.liability", id: after.id },
        action: "update",
        changes: (Object.keys(was) as (keyof typeof was)[])
          .filter((field) => was[field] !== now[field])
          .map((field) => ({ field, before: was[field], after: now[field], sensitive: false })),
      });
    },
  };
}

/** `db` is the liabilities module's own database (`ModuleDatabases.for("liabilities")`). */
export function createLiabilities(db: ModuleDatabase, audit: Pick<AuditLog, "record">): Liabilities {
  const deps = { audit: liabilityAudit(audit), newId: randomUUID };
  return {
    register: (householdId, input) =>
      db.inHousehold(householdId, (q) => registerLiability(deps, liabilitiesTx(q), householdId, input)),
    forAccount: (householdId, accountId) =>
      db.inHousehold(householdId, (q) => liabilitiesTx(q).byAccount(householdId, accountId)),
    changeKind: (householdId, input) =>
      db.inHousehold(householdId, (q) => changeLiabilityKind(deps, liabilitiesTx(q), householdId, input)),
  };
}

/** Erasure of a space's liabilities (NFR-12@PoC FR 3): the owner's erasure script only (module data-erasure). */
export interface LiabilitiesErasure {
  eraseHousehold(householdId: string): Promise<{ readonly liabilities: number }>;
}

/** `db` is the liabilities module's own database (`ModuleDatabases.for("liabilities")`). */
export function createLiabilitiesErasure(db: ModuleDatabase): LiabilitiesErasure {
  return { eraseHousehold: (householdId) => eraseHouseholdLiabilities(db, householdId) };
}
