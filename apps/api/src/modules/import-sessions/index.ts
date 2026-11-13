// Public interface of the import-sessions module (ARC-01 FR 2). Other modules import only this file.
import { defineModule } from "../../platform/modules/define.ts";

export const importSessionsModule = defineModule({
  name: "import-sessions",
  publishes: [],
  consumes: [],
});
