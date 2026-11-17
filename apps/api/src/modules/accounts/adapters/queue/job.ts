import { isCurrencyCode } from "@willowsum/domain-kernel";
import { z } from "zod";
import type { HouseholdQueryRunner } from "../../../../platform/db/module-db.ts";
import { defineJob, enqueueJob } from "../../../../platform/queue/index.ts";
import { handOffKey, type HandOff } from "../../application/index.ts";

const uuid = z.uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
/** A code of the currency registry (NFR-06): ISO 4217, metals and crypto-assets such as USDT (#290 item 7). */
const currency = z.string().max(10).refine(isCurrencyCode);
const decimal = z.string().regex(/^-?\d{1,20}(\.\d{1,18})?$/);
const field = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_.]{0,62}$/);
const value = z.string().max(1000).nullable();
const status = z.strictObject({ status: z.enum(["active", "closed"]), closedOn: date.nullable() });
const amounts = z.array(z.strictObject({ currency, balance: decimal })).max(10);

/** A journal move of a managing hand-off (application/hand-off.ts `HandOffMove`). */
const moveSchema = z.discriminatedUnion("op", [
  z.strictObject({
    op: z.literal("transfer"),
    subaccountId: uuid,
    currency,
    toAccountId: uuid,
    from: uuid,
    to: uuid,
    balance: decimal,
    date,
  }),
  z.strictObject({
    op: z.literal("adjust"),
    subaccountId: uuid,
    currency,
    ledgerAccountId: uuid,
    date,
    plan: z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("post"), amount: decimal }),
      z.strictObject({ kind: z.literal("correct"), entryId: uuid, amount: decimal }),
      z.strictObject({ kind: z.literal("reverse"), entryId: uuid }),
    ]),
    before: z.strictObject({ entryId: uuid, amount: decimal, date }).nullable(),
  }),
]);

/** A subaccount whose ledger account and opening balance a hand-off opens (application/hand-off.ts `HandOffSubaccount`). */
const subaccountSchema = z.strictObject({
  subaccountId: uuid,
  ledgerAccountId: uuid,
  ledgerType: z.enum(["asset", "liability"]),
  currency,
  opening: decimal.nullable(),
  date,
});
const changesSchema = z.array(z.strictObject({ field, before: value, after: value, sensitive: z.boolean() }));

/** The payload of `accounts.hand-off` (application/hand-off.ts `HandOff`), checked when enqueued and when run. */
const handOffSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("account-created"),
    accountId: uuid,
    actorAccountId: uuid,
    subaccounts: z.array(subaccountSchema).min(1).max(10),
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
          field,
          after: value,
          sensitive: z.boolean(),
        }),
      )
      .max(200),
  }),
  z.strictObject({ kind: z.literal("credit-kind"), accountId: uuid, actorAccountId: uuid }),
  z.strictObject({
    kind: z.literal("managed"),
    accountId: uuid,
    changeId: uuid,
    actor: z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("user"), id: uuid }),
      z.strictObject({ kind: z.literal("system") }),
    ]),
    channel: z.enum(["web", "import"]),
    moves: z.array(moveSchema).max(10),
    status: z
      .strictObject({
        before: status,
        after: status,
        settlement: z
          .discriminatedUnion("kind", [
            z.strictObject({ kind: z.literal("transfer"), toAccountId: uuid, amounts }),
            z.strictObject({ kind: z.literal("adjustment"), amounts }),
          ])
          .nullable(),
      })
      .nullable(),
  }),
  z.strictObject({
    kind: z.literal("settings-changed"),
    accountId: uuid,
    actorAccountId: uuid,
    changeId: uuid,
    changes: changesSchema.min(1).max(20),
  }),
  z.strictObject({
    kind: z.literal("currency-changed"),
    accountId: uuid,
    actorAccountId: uuid,
    changeId: uuid,
    added: subaccountSchema.nullable(),
    removed: z.strictObject({ subaccountId: uuid, openingEntryId: uuid.nullable() }).nullable(),
    changes: changesSchema.min(1).max(3),
  }),
]) satisfies z.ZodType<HandOff>;

/**
 * ARC-04 FR 2, FR 3: the hand-off of an accounts change to ledger, liabilities and audit, in the accounts queue (the
 * schema's `jobs`, migrations/0005_queue.sql). Light; the worker retries it up to 8 times, then it is dead-lettered
 * with an «error» log event (ADR-0014).
 */
export const HAND_OFF_JOB = defineJob({ name: "accounts.hand-off", schema: handOffSchema });

/** The payload of a job as the application reads it back (`AccountsTx.pendingManaged`). */
export function handOffOf(payload: unknown): HandOff {
  return handOffSchema.parse(payload);
}

/** Enqueues the hand-off in the caller's accounts transaction; the same key twice is one job. */
export async function enqueueHandOff(
  q: HouseholdQueryRunner,
  handOff: HandOff,
  changeId: string,
): Promise<void> {
  // The schema checks the payload again here; the application's type is readonly, the schema's output is not.
  await enqueueJob(q, HAND_OFF_JOB, handOffKey(handOff, changeId), handOff as z.infer<typeof handOffSchema>);
}
