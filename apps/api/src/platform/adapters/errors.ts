/**
 * Errors of a provider call (ARC-05, ADR-0005). The message names only the provider, the operation and the
 * kind of failure: never the request, the response or a provider's own error text, which may hold data.
 */
export const PROVIDER_FAILURE_KINDS = [
  /** No answer within the time limit (default 10 s). */
  "timeout",
  /** The provider could not be reached or answered «try later» (network error, 429, 5xx). */
  "unavailable",
  /** The provider answered, but not in the expected shape. */
  "invalid-response",
  /** The provider refused this request (4xx other than 429): the provider is up, the request is wrong. */
  "rejected",
  /** Five failures in a row: calls are paused (60 s by default) without reaching the provider. */
  "circuit-open",
] as const;
export type ProviderFailureKind = (typeof PROVIDER_FAILURE_KINDS)[number];

/** Failures worth another attempt of an idempotent operation. */
const RETRYABLE: ReadonlySet<ProviderFailureKind> = new Set(["timeout", "unavailable"]);
/** Failures that count towards opening the circuit breaker. */
const BREAKER_FAILURE: ReadonlySet<ProviderFailureKind> = new Set([
  "timeout",
  "unavailable",
  "invalid-response",
]);

export class ProviderError extends Error {
  readonly provider: string;
  readonly operation: string;
  readonly kind: ProviderFailureKind;
  /** Class name of the underlying error, if any (its message is not kept: it may echo data). */
  readonly causeName: string | undefined;

  constructor(kind: ProviderFailureKind, provider: string, operation: string, causeName?: string) {
    super(`Provider ${provider}.${operation}: ${kind}`);
    this.name = "ProviderError";
    this.kind = kind;
    this.provider = provider;
    this.operation = operation;
    this.causeName = causeName;
  }

  get retryable(): boolean {
    return RETRYABLE.has(this.kind);
  }

  get countsAsFailure(): boolean {
    return BREAKER_FAILURE.has(this.kind);
  }
}

/**
 * An adapter tried to send a field that its port does not declare (ARC-05 FR 5). A programming error: the
 * request is not sent and the breaker does not count it. The message lists field names, never values.
 */
export class OutgoingFieldError extends Error {
  readonly fields: readonly string[];

  constructor(provider: string, operation: string, fields: readonly string[]) {
    super(`Provider ${provider}.${operation}: undeclared outgoing fields ${fields.join(", ")}`);
    this.name = "OutgoingFieldError";
    this.fields = fields;
  }
}
