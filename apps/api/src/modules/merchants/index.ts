// Public interface of the merchants module (ARC-01 FR 2). Other modules import only this file.
import { defineModule } from "../../platform/modules/define.ts";

export const merchantsModule = defineModule({
  name: "merchants",
  publishes: [],
  consumes: [],
});
