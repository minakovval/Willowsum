// Public interface of the cashflow module (ARC-01 FR 2). Other modules import only this file.
import { defineModule } from "../../platform/modules/define.ts";

export const cashflowModule = defineModule({
  name: "cashflow",
  publishes: [],
  consumes: [],
});
