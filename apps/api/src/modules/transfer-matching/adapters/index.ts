// Adapters of transfer-matching: database (ModuleDatabase, schema «transfer_matching»), HTTP, external services.
export {
  createTransferMatchingServices,
  transferMatchingRoutes,
  type TransferMatchingServices,
} from "./http/index.ts";
