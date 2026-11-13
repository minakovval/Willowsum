// Domain layer of data-erasure: pure rules, no I/O (ARC-01 FR 5). Allowed imports: this folder,
// @willowsum/domain-kernel, zod, decimal.js.
export { ERASURE_DEADLINE_DAYS, erasureDueAt, requestStates } from "./requests.ts";
export type { ErasureRecord, RequestState } from "./requests.ts";
