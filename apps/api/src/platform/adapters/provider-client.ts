import { SpanKind, SpanStatusCode, trace } from "@opentelemetry/api";
import { TELEMETRY_SCOPE } from "../telemetry/scope.ts";
import { logEvent, recordProviderCall } from "../telemetry/signals.ts";
import { CircuitBreaker, type BreakerPolicy, type BreakerState } from "./circuit-breaker.ts";
import { sleep, systemClock, type AdapterClock } from "./clock.ts";
import { ProviderError } from "./errors.ts";
import type { ProviderOperation } from "./port.ts";

/**
 * Every call to a provider goes through a `ProviderClient` (ARC-05 FR 3, ADR-0005):
 * - a time limit (default 10 s): the call's AbortSignal fires and the call fails with `timeout`, even if the
 *   adapter ignores the signal;
 * - retries only for operations declared idempotent, only after `timeout` or `unavailable`, at most
 *   `maxAttempts` attempts in all, with exponential backoff and jitter;
 * - a circuit breaker shared by all operations of the provider: 5 failures in a row → 60 s without calls.
 * Each call is a span, a `ws.provider.calls` count and, on failure, the log event `provider.failure` (ARC-09,
 * NFR-10 FR 3): the adapter, the operation, the number of attempts and the outcome (failure kind, the
 * underlying error's class or HTTP status) — never the URL, its parameters, headers, keys or bodies.
 */
export interface RetryPolicy {
  /** Attempts in all, the first included. */
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
}

export interface ProviderCallPolicy {
  readonly timeoutMs: number;
  readonly retry: RetryPolicy;
  readonly breaker: BreakerPolicy;
}

export const DEFAULT_CALL_POLICY: ProviderCallPolicy = Object.freeze({
  timeoutMs: 10_000,
  retry: Object.freeze({ maxAttempts: 3, baseDelayMs: 250, maxDelayMs: 2_000 }),
  breaker: Object.freeze({ failureThreshold: 5, openMs: 60_000 }),
});

export interface ProviderClientOptions {
  /** Name of the provider adapter, e.g. `exchange-rates:http`; appears in errors and nowhere else. */
  readonly provider: string;
  readonly policy?: {
    readonly timeoutMs?: number;
    readonly retry?: Partial<RetryPolicy>;
    readonly breaker?: Partial<BreakerPolicy>;
  };
  readonly clock?: AdapterClock;
  /** Uniform in [0, 1): the jitter source; tests pass a fixed one. */
  readonly random?: () => number;
}

export interface ProviderClient {
  readonly provider: string;
  readonly policy: ProviderCallPolicy;
  call<T>(operation: ProviderOperation, run: (signal: AbortSignal) => Promise<T>): Promise<T>;
  breakerState(): BreakerState;
}

/**
 * Delay before attempt `attempt + 1` (attempt counts from 1): «equal jitter» — half of the capped exponential
 * step plus a random part of the other half, so delays are bounded and spread out.
 */
export function backoffDelay(attempt: number, retry: RetryPolicy, random: () => number): number {
  const step = Math.min(retry.maxDelayMs, retry.baseDelayMs * 2 ** (attempt - 1));
  const r = Math.min(Math.max(random(), 0), 1);
  return Math.floor(step / 2 + (r * step) / 2);
}

export function createProviderClient(options: ProviderClientOptions): ProviderClient {
  const clock = options.clock ?? systemClock;
  const random = options.random ?? Math.random;
  const policy: ProviderCallPolicy = Object.freeze({
    timeoutMs: options.policy?.timeoutMs ?? DEFAULT_CALL_POLICY.timeoutMs,
    retry: Object.freeze({ ...DEFAULT_CALL_POLICY.retry, ...options.policy?.retry }),
    breaker: Object.freeze({ ...DEFAULT_CALL_POLICY.breaker, ...options.policy?.breaker }),
  });
  if (!(policy.timeoutMs > 0)) throw new Error("timeoutMs is positive");
  if (!Number.isInteger(policy.retry.maxAttempts) || policy.retry.maxAttempts < 1)
    throw new Error("maxAttempts is a positive integer");
  const breaker = new CircuitBreaker(policy.breaker);
  const { provider } = options;

  async function attemptOnce<T>(operation: ProviderOperation, run: (signal: AbortSignal) => Promise<T>) {
    const controller = new AbortController();
    let timer: unknown;
    const timedOut = new Promise<never>((_, reject) => {
      timer = clock.setTimeout(() => {
        controller.abort();
        reject(new ProviderError("timeout", provider, operation.name));
      }, policy.timeoutMs);
    });
    const running = Promise.resolve().then(() => run(controller.signal));
    // If the time limit wins, a later rejection of the abandoned call must not surface as unhandled.
    running.catch(() => undefined);
    try {
      return await Promise.race([running, timedOut]);
    } finally {
      clock.clearTimeout(timer);
    }
  }

  async function callWithRetries<T>(
    operation: ProviderOperation,
    run: (signal: AbortSignal) => Promise<T>,
    attempts: { count: number },
  ): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      attempts.count = attempt;
      if (!breaker.tryAcquire(clock.now())) throw new ProviderError("circuit-open", provider, operation.name);
      try {
        const result = await attemptOnce(operation, run);
        breaker.success();
        return result;
      } catch (raw) {
        if (!(raw instanceof ProviderError)) {
          // Not a provider failure: a refused outgoing field (nothing was sent) or a bug in the adapter. It
          // is passed on unchanged — never retried, never counted, never hidden behind a last known value.
          // A half-open probe is released without judging the provider. Adapters classify transport
          // failures themselves (createProviderHttp turns them into «unavailable»).
          breaker.release();
          throw raw;
        }
        const error = raw;
        if (error.countsAsFailure) breaker.failure(clock.now());
        else breaker.neutral();
        const again = operation.idempotent && error.retryable && attempt < policy.retry.maxAttempts;
        if (!again) throw error;
        await sleep(clock, backoffDelay(attempt, policy.retry, random));
      }
    }
  }

  return {
    provider,
    policy,
    breakerState: () => breaker.state(clock.now()),
    async call<T>(operation: ProviderOperation, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
      const span = trace.getTracer(TELEMETRY_SCOPE).startSpan(`provider ${operation.name}`, {
        kind: SpanKind.CLIENT,
        attributes: { "ws.provider": provider, "ws.provider.operation": operation.name },
      });
      const attempts = { count: 0 };
      let outcome = "ok";
      let cause: Record<string, string | number> = {};
      try {
        return await callWithRetries(operation, run, attempts);
      } catch (error) {
        outcome = error instanceof ProviderError ? error.kind : "error";
        cause = providerCause(error);
        throw error;
      } finally {
        const attributes = {
          "ws.provider": provider,
          "ws.provider.operation": operation.name,
          "ws.provider.outcome": outcome,
        };
        span.setAttributes({ ...attributes, "ws.provider.attempts": Math.max(attempts.count, 1), ...cause });
        if (outcome !== "ok") {
          span.setStatus({ code: SpanStatusCode.ERROR });
          logEvent("provider.failure", "warn", { ...attributes, ...cause });
        }
        span.end();
        recordProviderCall(attributes);
      }
    },
  };
}

/** The value-free cause of a failed call: the underlying error's class, or the provider's HTTP status. */
function providerCause(error: unknown): Record<string, string | number> {
  const name =
    error instanceof ProviderError
      ? error.causeName
      : error instanceof Error
        ? error.constructor.name || error.name
        : undefined;
  if (name === undefined) return {};
  const http = /^HTTP ([1-5][0-9]{2})$/.exec(name);
  if (http) return { "http.response.status_code": Number(http[1]) };
  return /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(name) ? { "error.type": name } : {};
}
