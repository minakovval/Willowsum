// Domain layer of file-storage: pure rules, no I/O (ARC-01 FR 5). Allowed imports: this folder,
// @willowsum/domain-kernel, zod, decimal.js.
export { FILE_LIMITS, PARSE_CEILINGS, SIGNED_LINK_MAX_TTL_MS } from "./limits.ts";
export { FileRejectedError, REJECTION_CODES, reject, rejection } from "./rejection.ts";
export type { Rejection, RejectionCode } from "./rejection.ts";
