// Public interface of the transfer-matching module (ARC-01 FR 2). Other modules import only this file.
import { defineModule } from "../../platform/modules/define.ts";
import { transferMatchingRoutes } from "./adapters/index.ts";

export const transferMatchingModule = defineModule({
  name: "transfer-matching",
  publishes: [],
  consumes: [],
  routes: transferMatchingRoutes,
});

export { createTransferMatchingServices, type TransferMatchingServices } from "./adapters/index.ts";
export { CROSS_CURRENCY_MAX_SHARE, FEE_MAX_SHARE, MATCH_WINDOW_DAYS } from "./domain/index.ts";
