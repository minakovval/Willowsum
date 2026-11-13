// Public interface of the goals module (ARC-01 FR 2). Other modules import only this file.
import { defineModule } from "../../platform/modules/define.ts";

export const goalsModule = defineModule({
  name: "goals",
  publishes: [],
  consumes: [],
});
