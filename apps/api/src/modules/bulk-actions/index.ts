// Public interface of the bulk-actions module (ARC-01 FR 2). Other modules import only this file.
import { defineModule } from "../../platform/modules/define.ts";

export const bulkActionsModule = defineModule({
  name: "bulk-actions",
  publishes: [],
  consumes: [],
});
