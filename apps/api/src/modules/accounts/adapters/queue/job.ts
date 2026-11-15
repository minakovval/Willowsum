import { z } from "zod";
import type { HouseholdQueryRunner } from "../../../../platform/db/module-db.ts";
import { defineJob, enqueueJob } from "../../../../platform/queue/index.ts";
import { handOffKey, type HandOff } from "../../application/index.ts";

const uuid = z.uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const currency = z.string().regex(/^[A-Z]{3}$/);
const decimal = z.string().regex(/^-?\d{1,20}(\.\d{1,18})?$/);

/** The payload of `accounts.hand-off` (application/hand-off.ts `HandOff`), checked when enqueued and when run. */
const handOffSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("account-created"),
    accountId: uuid,
    actorAccountId: uuid,
    subaccounts: z
      .array(
        z.strictObject({
          subaccountId: uuid,
          ledgerAccountId: uuid,
          ledgerType: z.enum(["asset", "liability"]),
          currency,
          opening: decimal.nullable(),
          date,
        }),
      )
      .min(1)
      .max(10),
    liability: z
      .strictObject({
        kind: z.enum(["loan", "credit-card"]),
        currency,
        annualRate: z.string().max(10).nullable(),
        monthlyPayment: z.string().max(40).nullable(),
        creditLimit: z.string().max(40).nullable(),
        gracePeriodDays: z.number().int().min(0).max(365).nullable(),
      })
      .nullable(),
    audit: z
      .array(
        z.strictObject({
          field: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_.]{0,62}$/),
          after: z.string().max(1000).nullable(),
          sensitive: z.boolean(),
        }),
      )
      .max(200),
  }),
  z.strictObject({ kind: z.literal("credit-kind"), accountId: uuid, actorAccountId: uuid }),
]) satisfies z.ZodType<HandOff>;

/**
 * ARC-04 FR 2, FR 3: the hand-off of an accounts change to ledger, liabilities and audit, in the accounts queue (the
 * schema's `jobs`, migrations/0005_queue.sql). Light; the worker retries it up to 8 times, then it is dead-lettered
 * with an «error» log event (ADR-0014).
 */
export const HAND_OFF_JOB = defineJob({ name: "accounts.hand-off", schema: handOffSchema });

/** Enqueues the hand-off in the caller's accounts transaction; the same key twice is one job. */
export async function enqueueHandOff(
  q: HouseholdQueryRunner,
  handOff: HandOff,
  changeId: string,
): Promise<void> {
  // The schema checks the payload again here; the application's type is readonly, the schema's output is not.
  await enqueueJob(q, HAND_OFF_JOB, handOffKey(handOff, changeId), handOff as z.infer<typeof handOffSchema>);
}
