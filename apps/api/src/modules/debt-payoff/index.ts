// Public interface of the debt-payoff module (ARC-01 FR 2). Other modules import only this file.
import { defineModule } from "../../platform/modules/define.ts";

export const debtPayoffModule = defineModule({
  name: "debt-payoff",
  publishes: [],
  consumes: [],
});
