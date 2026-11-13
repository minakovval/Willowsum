// Public interface of the transfer-matching module (ARC-01 FR 2). Other modules import only this file.
import { defineModule } from "../../platform/modules/define.ts";

export const transferMatchingModule = defineModule({
  name: "transfer-matching",
  publishes: [],
  consumes: [],
});
