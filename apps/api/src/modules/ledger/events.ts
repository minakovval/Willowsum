import { z } from "zod";
import { defineEvent } from "../../platform/events/define.ts";

/**
 * «Проводку записано» (ARC-11 «Межі модуля», «Запис проводок»; issue #125): written to the ledger's outbox in the same
 * transaction as a new entry and its postings (post, reverse, correct). Projections (budget, reports, net worth,
 * cash flow) consume it and read balances through the ledger's interface. Identifiers, codes and dates only: no
 * amounts, accounts, names or other text — the payload is strict, so an extra field is refused when it is published,
 * and the outbox table's CHECK refuses any string that is not a code (migrations/0004_outbox.sql).
 */
const CODE = /^[a-z][a-z0-9-]{0,62}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MOMENT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

export const entryRecorded = defineEvent({
  name: "ledger.entry-recorded",
  version: 1,
  schema: z.strictObject({
    /** The new entry. */
    entryId: z.uuid(),
    /** The module and record whose event made it (for a reversal: the original's source). */
    sourceModule: z.string().regex(CODE),
    sourceId: z.uuid(),
    /** The event type of the posting rules, or `reversal`. */
    eventType: z.string().regex(CODE),
    /** When it happened (YYYY-MM-DD); balances from this date on change. */
    operationDate: z.string().regex(DATE),
    /** When the ledger recorded it (UTC, microseconds). */
    recordedAt: z.string().regex(MOMENT),
    /** The entry this one reverses, or null. */
    reversesEntryId: z.uuid().nullable(),
  }),
});

export type EntryRecorded = z.infer<typeof entryRecorded.schema>;
