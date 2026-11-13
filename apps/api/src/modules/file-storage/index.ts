// Public interface of the file-storage module (ARC-01 FR 2). Other modules import only this file.
import { defineModule } from "../../platform/modules/define.ts";

export const fileStorageModule = defineModule({
  name: "file-storage",
  publishes: [],
  consumes: [],
});
