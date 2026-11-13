// Application layer of data-erasure: use cases, transactions, permission checks (ARC-01 FR 5).
// Uses ports; adapters are wired in ../index.ts.
export { ErasureError, erasureStatus, reapplyErasures, requestErasure, runErasure } from "./erasure.ts";
export type { ErasureDeps } from "./erasure.ts";
