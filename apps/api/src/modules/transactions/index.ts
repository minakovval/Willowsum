// Public interface of the transactions module (ARC-01 FR 2). Other modules import only this file.
import { defineModule } from "../../platform/modules/define.ts";

export const transactionsModule = defineModule({
  name: "transactions",
  publishes: [],
  consumes: [],
});
