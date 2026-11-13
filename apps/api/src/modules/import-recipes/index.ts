// Public interface of the import-recipes module (ARC-01 FR 2). Other modules import only this file.
import { defineModule } from "../../platform/modules/define.ts";

export const importRecipesModule = defineModule({
  name: "import-recipes",
  publishes: [],
  consumes: [],
});
