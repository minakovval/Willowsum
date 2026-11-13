// Public interface of the budget module (ARC-01 FR 2). Other modules import only this file.
import { defineModule } from "../../platform/modules/define.ts";

export const budgetModule = defineModule({
  name: "budget",
  publishes: [],
  consumes: [],
});
