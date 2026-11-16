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
