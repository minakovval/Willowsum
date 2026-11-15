import { z } from "zod";
import { defineEvent } from "../../platform/events/define.ts";

/**
 * «Категорію об'єднано» (BUD-01@PoC FR 8): written to the categories outbox in the transaction of the merge. The
 * modules that hold records with a category move them from `sourceId` to `targetId`: categorization (transactions
 * and split parts, the rules; BUD-01 b, wave 2 row 20), budget (the limit is added to the target's from the period of
 * `mergedAt`; BUD-02) and recurring (BUD-07). Identifiers, a code and a moment only: no names.
 */
export const categoryMerged = defineEvent({
  name: "categories.merged",
  version: 1,
  schema: z.strictObject({
    sourceId: z.uuid(),
    targetId: z.uuid(),
    /** Both are of this type (FR 8). */
    kind: z.enum(["expense", "income"]),
    /** When it was merged (UTC, ISO 8601); the limit moves from the period this falls in. */
    mergedAt: z.iso.datetime(),
  }),
});

export type CategoryMerged = z.infer<typeof categoryMerged.schema>;
