// Adapter kit for external providers (ARC-05, ADR-0005). Provider SDKs may be imported only in a module's
// `adapters/` folder or under src/platform/adapters/ (apps/api/provider-sdks.json, `pnpm check:modules`).
export { CircuitBreaker } from "./circuit-breaker.ts";
export type { BreakerPolicy, BreakerState } from "./circuit-breaker.ts";
export { sleep, systemClock } from "./clock.ts";
export type { AdapterClock } from "./clock.ts";
export { OutgoingFieldError, PROVIDER_FAILURE_KINDS, ProviderError } from "./errors.ts";
export type { ProviderFailureKind } from "./errors.ts";
export { checkBaseUrl, createProviderHttp, requestUrl } from "./http.ts";
export type { FetchFn, ProviderHttp, ProviderHttpOptions } from "./http.ts";
export { createLastKnown, memoryLastKnownStore } from "./last-known.ts";
export type { LastKnown, LastKnownEntry, LastKnownStore, Observed } from "./last-known.ts";
export {
  assertOutgoing,
  outgoingFieldViolations,
  payloadFields,
  requestFields,
  UNDECLARED_PATH,
  undeclaredFields,
} from "./outgoing.ts";
export {
  PROVIDER_MODES,
  defineProviderPort,
  pathPlaceholders,
  pathTemplateProblems,
  selectImplementation,
} from "./port.ts";
export type { ProviderImplementations, ProviderMode, ProviderOperation, ProviderPort } from "./port.ts";
export { DEFAULT_CALL_POLICY, backoffDelay, createProviderClient } from "./provider-client.ts";
export type {
  ProviderCallPolicy,
  ProviderClient,
  ProviderClientOptions,
  RetryPolicy,
} from "./provider-client.ts";
