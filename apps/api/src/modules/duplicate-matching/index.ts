// Public interface of the duplicate-matching module (ARC-01 FR 2). Other modules import only this file.
import { defineModule } from "../../platform/modules/define.ts";

export const duplicateMatchingModule = defineModule({
  name: "duplicate-matching",
  publishes: [],
  consumes: [],
});
