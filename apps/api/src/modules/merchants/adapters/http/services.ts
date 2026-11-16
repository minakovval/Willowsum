import { ApiProblem } from "../../../../platform/http/problem.ts";
import type { ProtectedContext } from "../../../../platform/http/route.ts";
import { logEvent } from "../../../../platform/telemetry/signals.ts";
import type { AuditLog } from "../../../audit/index.ts";
import {
  applyHandOff,
  type MerchantAudit,
  type MerchantHandOff,
  type TransactionTextsPort,
} from "../../application/index.ts";

const BRAND = Symbol("willowsum-merchants-services");

/**
 * What the API process wires for the merchants routes (src/api.ts → `ctx.services`): module transactions' texts (the
 * counterparty of a transaction) and the audit log. Every port takes the caller's space.
 */
export interface MerchantsServices {
  readonly [BRAND]: true;
  readonly transactions: TransactionTextsPort;
  readonly audit: MerchantAudit;
}

export function createMerchantsServices(options: {
  readonly transactions: TransactionTextsPort;
  readonly audit: Pick<AuditLog, "record">;
}): MerchantsServices {
  return { [BRAND]: true, transactions: options.transactions, audit: merchantsAudit(options.audit) };
}

/** The services of a merchants route; without them (never in the API process) the route answers 500. */
export function merchantsServices(ctx: ProtectedContext): MerchantsServices {
  const services = ctx.services as Partial<MerchantsServices> | undefined;
  if (!services || services[BRAND] !== true) throw new ApiProblem("INTERNAL");
  return services as MerchantsServices;
}

/** Stands for a merchant's name in the job and the entry: the audit log masks it (`sensitive`), so none is stored. */
const NAME_CHANGED = "changed";

/**
 * A change of a merchant in the space's own log (BUD-14 «Обов'язково пишуться в журнал аудиту: … перейменування й
 * об'єднання мерчантів»; П-10): the entity is the merchant, the action `update`; a rename is a masked change of
 * `name` (a name comes from a bank description and may name a person), a merge and «Роз'єднати» a change of
 * `mergedInto` (merchant ids). Also the worker's (src/wiring.ts).
 */
export function merchantsAudit(audit: Pick<AuditLog, "record">): MerchantAudit {
  return {
    async record(householdId, handOff, key) {
      await audit.record(householdId, {
        actor: { kind: "user", id: handOff.actorAccountId },
        channel: "web",
        entity: { type: "merchants.merchant", id: handOff.merchantId },
        action: "update",
        changes:
          handOff.change === "rename"
            ? [{ field: "name", before: NAME_CHANGED, after: NAME_CHANGED, sensitive: true }]
            : [
                {
                  field: "mergedInto",
                  before: handOff.mergedInto.before,
                  after: handOff.mergedInto.after,
                  sensitive: false,
                },
              ],
        key,
      });
    },
  };
}

/**
 * ARC-04 FR 2: the audit entries of a committed change, right away — after the merchants transaction. A failure is no
 * failure of the request: the change is made and its jobs are in the queue, so the worker writes the entries. Logged
 * as `merchants.hand_off_deferred` (WARN, the error class only).
 */
export async function handOffNow(
  audit: MerchantAudit,
  householdId: string,
  handOffs: readonly MerchantHandOff[],
): Promise<void> {
  for (const handOff of handOffs) {
    try {
      await applyHandOff(audit, householdId, handOff);
    } catch (error) {
      logEvent("merchants.hand_off_deferred", "warn", {
        "ws.module": "merchants",
        "error.type": error instanceof Error ? error.constructor.name || error.name : typeof error,
      });
      return;
    }
  }
}
