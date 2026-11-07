/**
 * Circuit breaker of one provider (ARC-05 FR 3, ADR-0005): after `failureThreshold` failures in a row
 * (default 5) it opens and calls fail at once without reaching the provider; after `openMs` (default 60 s)
 * one probe call goes through (half-open). A successful probe closes it; a failed one opens it for another
 * `openMs`. While the probe runs, other calls fail at once.
 */
export type BreakerState = "closed" | "open" | "half-open";

export interface BreakerPolicy {
  readonly failureThreshold: number;
  readonly openMs: number;
}

export class CircuitBreaker {
  private stateValue: BreakerState = "closed";
  private failures = 0;
  private openedAt = 0;
  private probing = false;
  private readonly policy: BreakerPolicy;

  constructor(policy: BreakerPolicy) {
    if (!Number.isInteger(policy.failureThreshold) || policy.failureThreshold < 1)
      throw new Error("failureThreshold is a positive integer");
    if (!(policy.openMs > 0)) throw new Error("openMs is positive");
    this.policy = policy;
  }

  /** The state at `now` (an open breaker past its pause reads as half-open). */
  state(now: number): BreakerState {
    if (this.stateValue === "open" && now - this.openedAt >= this.policy.openMs) return "half-open";
    return this.stateValue;
  }

  /** May a call go to the provider now? A true answer in half-open state takes the single probe. */
  tryAcquire(now: number): boolean {
    const state = this.state(now);
    if (state === "closed") return true;
    if (state === "open") return false;
    if (this.probing) return false;
    this.stateValue = "half-open";
    this.probing = true;
    return true;
  }

  /** Milliseconds until the next probe is allowed (0 unless open). */
  retryAfterMs(now: number): number {
    return this.state(now) === "open" ? this.policy.openMs - (now - this.openedAt) : 0;
  }

  /** The provider answered as expected. */
  success(): void {
    this.stateValue = "closed";
    this.failures = 0;
    this.probing = false;
  }

  /** The provider answered, but refused this request: it is up, so the run of failures ends. */
  neutral(): void {
    this.success();
  }

  /** The call never reached the provider (e.g. refused before sending): free the probe, judge nothing. */
  release(): void {
    this.probing = false;
  }

  failure(now: number): void {
    this.probing = false;
    if (this.stateValue === "half-open") {
      this.open(now);
      return;
    }
    this.failures += 1;
    if (this.failures >= this.policy.failureThreshold) this.open(now);
  }

  private open(now: number): void {
    this.stateValue = "open";
    this.openedAt = now;
    this.failures = 0;
  }
}
