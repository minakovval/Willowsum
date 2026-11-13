// Public interface of the accounts module (ARC-01 FR 2). Other modules import only this file.
import { defineModule } from "../../platform/modules/define.ts";

export const accountsModule = defineModule({
  name: "accounts",
  publishes: [],
  consumes: [],
});
