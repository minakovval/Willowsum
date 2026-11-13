// Public interface of the liabilities module (ARC-01 FR 2). Other modules import only this file.
import { defineModule } from "../../platform/modules/define.ts";

export const liabilitiesModule = defineModule({
  name: "liabilities",
  publishes: [],
  consumes: [],
});
