import { z } from "zod";
import { defineEvent } from "../../platform/events/define.ts";

/**
 * «Нова транзакція» (BUD-14@PoC FR 8): written to the transactions outbox in the transaction of a create. Module
 * categorization runs the space's category rules on it (wave 2 row 23). The identifier only: no texts, no amount.
 */
export const transactionCreated = defineEvent({
  name: "transactions.created",
  version: 1,
  schema: z.strictObject({ transactionId: z.uuid() }),
});

export type TransactionCreated = z.infer<typeof transactionCreated.schema>;

/**
 * «Злито з імпортом» (IMP-04@PoC FR 5; #658): an import batch's row merged with a manual transaction — the bank's
 * transaction (`transactionId`) stays, the manual one (`duplicateId`) is merged into it. Written to the outbox in the
 * transaction of the apply's write, and of the user's «Об'єднати» of a manual and an imported transaction (FIN-03@PoC
 * FR 11, FR 17). Module categorization carries the manual one's category to the bank's transaction
 * (FR 5: «ручна транзакція зберігає категорію»). Identifiers only.
 */
export const transactionImportMerged = defineEvent({
  name: "transactions.import-merged",
  version: 1,
  schema: z.strictObject({ transactionId: z.uuid(), duplicateId: z.uuid(), actorAccountId: z.uuid() }),
});

export type TransactionImportMerged = z.infer<typeof transactionImportMerged.schema>;
