import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderError } from "./errors.ts";
import { createLastKnown } from "./last-known.ts";
import { defineProviderPort } from "./port.ts";
import { DEFAULT_CALL_POLICY, backoffDelay, createProviderClient } from "./provider-client.ts";

const port = defineProviderPort("probe-service", {
  read: { idempotent: true, fields: ["id"] },
  write: { idempotent: false, fields: ["id"] },
});
const READ = port.operations.read;
const WRITE = port.operations.write;

const unavailable = () => new ProviderError("unavailable", "probe", "probe-service.read");

/** Settles a promise for the assertions without an unhandled rejection while timers run. */
function settle<T>(promise: Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  return promise.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("ARC-05 FR 3: time limit of every call (default 10 s)", () => {
  it("ARC-05 FR 3: the defaults are 10 s, 5 failures in a row and a 60 s pause", () => {
    expect(DEFAULT_CALL_POLICY.timeoutMs).toBe(10_000);
    expect(DEFAULT_CALL_POLICY.breaker).toEqual({ failureThreshold: 5, openMs: 60_000 });
  });

  it("ARC-05 FR 3: a call that does not answer in 10 s fails with «timeout» and its signal is aborted", async () => {
    const client = createProviderClient({ provider: "probe", policy: { retry: { maxAttempts: 1 } } });
    let seen: AbortSignal | undefined;
    const result = settle(
      client.call(READ, (signal) => {
        seen = signal;
        return new Promise<never>(() => undefined);
      }),
    );
    await vi.advanceTimersByTimeAsync(9_999);
    expect(seen?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const outcome = await result;
    expect(outcome.ok).toBe(false);
    expect((outcome as { error: ProviderError }).error.kind).toBe("timeout");
    expect(seen?.aborted).toBe(true);
  });

  it("ARC-05 FR 3: an answer within the limit is returned and leaves no timer behind", async () => {
    const client = createProviderClient({ provider: "probe" });
    await expect(client.call(READ, async () => "value")).resolves.toBe("value");
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("ARC-05 FR 3: retries only for idempotent operations", () => {
  it("ARC-05 FR 3: an idempotent call is retried after «unavailable», with backoff, up to 3 attempts", async () => {
    const client = createProviderClient({ provider: "probe", random: () => 0.5 });
    const run = vi
      .fn()
      .mockRejectedValueOnce(unavailable())
      .mockRejectedValueOnce(unavailable())
      .mockResolvedValue("ok");
    const result = settle(client.call(READ, run));
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
    // Attempt 1 → 2: step 250 ms, equal jitter with 0.5 → 187 ms.
    await vi.advanceTimersByTimeAsync(186);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(2);
    // Attempt 2 → 3: step 500 ms → 375 ms.
    await vi.advanceTimersByTimeAsync(375);
    expect(run).toHaveBeenCalledTimes(3);
    expect(await result).toEqual({ ok: true, value: "ok" });
  });

  it("ARC-05 FR 3: retries are bounded: after the last attempt the error is passed on", async () => {
    const client = createProviderClient({ provider: "probe", random: () => 0 });
    const run = vi.fn().mockRejectedValue(unavailable());
    const result = settle(client.call(READ, run));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(run).toHaveBeenCalledTimes(3);
    expect((await result).ok).toBe(false);
  });

  it("ARC-05 FR 3: a timeout of an idempotent call is retried", async () => {
    const client = createProviderClient({ provider: "probe", random: () => 0 });
    const run = vi
      .fn()
      .mockImplementationOnce(() => new Promise<never>(() => undefined))
      .mockResolvedValue("late but fine");
    const result = settle(client.call(READ, run));
    await vi.advanceTimersByTimeAsync(10_000 + 125);
    expect(await result).toEqual({ ok: true, value: "late but fine" });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("ARC-05 FR 3: an operation not declared idempotent is never retried", async () => {
    const client = createProviderClient({ provider: "probe" });
    const run = vi.fn().mockRejectedValue(unavailable());
    const result = settle(client.call(WRITE, run));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(run).toHaveBeenCalledTimes(1);
    expect((await result).ok).toBe(false);
  });

  it("ARC-05 FR 3: a refused request or a broken answer is not retried", async () => {
    const client = createProviderClient({ provider: "probe" });
    for (const kind of ["rejected", "invalid-response"] as const) {
      const run = vi.fn().mockRejectedValue(new ProviderError(kind, "probe", READ.name));
      const result = settle(client.call(READ, run));
      await vi.advanceTimersByTimeAsync(60_000);
      expect(run).toHaveBeenCalledTimes(1);
      expect(((await result) as { error: ProviderError }).error.kind).toBe(kind);
    }
  });

  it("an exception from adapter code (a bug) is passed on unchanged: no retry, not counted, not hidden", async () => {
    const client = createProviderClient({ provider: "probe", random: () => 0 });
    const bug = new TypeError("adapter bug");
    const run = vi.fn(async () => {
      throw bug;
    });
    for (let i = 0; i < 6; i += 1) await expect(client.call(READ, run)).rejects.toBe(bug);
    expect(run).toHaveBeenCalledTimes(6);
    expect(client.breakerState()).toBe("closed");
    // Through the last known value: a bug is not masked by an old value.
    const lastKnown = createLastKnown<string>();
    await lastKnown.read("k", () => client.call(READ, async () => "v1"));
    await expect(lastKnown.read("k", () => client.call(READ, run))).rejects.toBe(bug);
  });

  it("ARC-05 FR 3: the backoff step never exceeds maxDelayMs", () => {
    const retry = { maxAttempts: 10, baseDelayMs: 100, maxDelayMs: 300 };
    expect([1, 2, 3, 4, 8].map((n) => backoffDelay(n, retry, () => 0.999999))).toEqual([
      99, 199, 299, 299, 299,
    ]);
  });

  it("backoff is exponential, capped and jittered within [step/2, step]", () => {
    const retry = { maxAttempts: 10, baseDelayMs: 250, maxDelayMs: 2_000 };
    expect([1, 2, 3, 4, 5].map((n) => backoffDelay(n, retry, () => 0))).toEqual([
      125, 250, 500, 1_000, 1_000,
    ]);
    expect([1, 2, 3, 4, 5].map((n) => backoffDelay(n, retry, () => 0.999999))).toEqual([
      249, 499, 999, 1_999, 1_999,
    ]);
  });
});

describe("ARC-05 FR 3: circuit breaker — 5 failures in a row → no calls for 60 s", () => {
  const noRetry = { retry: { maxAttempts: 1 } };

  async function fail(client: ReturnType<typeof createProviderClient>, times: number) {
    for (let i = 0; i < times; i += 1)
      await settle(client.call(READ, async () => Promise.reject(unavailable())));
  }

  it("ARC-05 FR 3: after the 5th failure in a row calls fail at once without reaching the provider", async () => {
    const client = createProviderClient({ provider: "probe", policy: noRetry });
    await fail(client, 4);
    expect(client.breakerState()).toBe("closed");
    await fail(client, 1);
    expect(client.breakerState()).toBe("open");
    const run = vi.fn().mockResolvedValue("ok");
    const outcome = await settle(client.call(READ, run));
    expect(run).not.toHaveBeenCalled();
    expect((outcome as { error: ProviderError }).error.kind).toBe("circuit-open");
  });

  it("ARC-05 FR 3: retries of one call count as failures in a row and stop when the breaker opens", async () => {
    const client = createProviderClient({ provider: "probe", random: () => 0 });
    const run = vi.fn().mockRejectedValue(unavailable());
    const first = settle(client.call(READ, run)); // 3 attempts
    await vi.advanceTimersByTimeAsync(5_000);
    await first;
    const second = settle(client.call(READ, run)); // 2 more attempts open it; the 3rd is not made
    await vi.advanceTimersByTimeAsync(5_000);
    expect(run).toHaveBeenCalledTimes(5);
    expect(((await second) as { error: ProviderError }).error.kind).toBe("circuit-open");
  });

  it("ARC-05 FR 3: a success, or a refused request (the provider is up), ends the run of failures", async () => {
    const client = createProviderClient({ provider: "probe", policy: noRetry });
    await fail(client, 4);
    await client.call(READ, async () => "ok");
    await fail(client, 4);
    await settle(
      client.call(READ, async () => Promise.reject(new ProviderError("rejected", "probe", READ.name))),
    );
    await fail(client, 4);
    expect(client.breakerState()).toBe("closed");
  });

  it("ARC-05 FR 3: after 60 s one probe goes through; success closes the breaker", async () => {
    const client = createProviderClient({ provider: "probe", policy: noRetry });
    await fail(client, 5);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(client.breakerState()).toBe("open");
    await vi.advanceTimersByTimeAsync(1);
    expect(client.breakerState()).toBe("half-open");
    let release: (v: string) => void = () => undefined;
    const probe = client.call(READ, () => new Promise<string>((r) => (release = r)));
    // While the probe runs, other calls do not reach the provider.
    const other = vi.fn().mockResolvedValue("ok");
    const blocked = await settle(client.call(READ, other));
    expect(other).not.toHaveBeenCalled();
    expect((blocked as { error: ProviderError }).error.kind).toBe("circuit-open");
    release("probe ok");
    await expect(probe).resolves.toBe("probe ok");
    expect(client.breakerState()).toBe("closed");
  });

  it("ARC-05 FR 3: a failed probe pauses calls for another 60 s", async () => {
    const client = createProviderClient({ provider: "probe", policy: noRetry });
    await fail(client, 5);
    await vi.advanceTimersByTimeAsync(60_000);
    await fail(client, 1);
    expect(client.breakerState()).toBe("open");
    await vi.advanceTimersByTimeAsync(59_999);
    expect(client.breakerState()).toBe("open");
    await vi.advanceTimersByTimeAsync(1);
    expect(client.breakerState()).toBe("half-open");
  });

  it("ARC-05 FR 3: five broken answers in a row («invalid-response») open the breaker", async () => {
    const client = createProviderClient({ provider: "probe", random: () => 0 });
    const run = vi.fn(async () => Promise.reject(new ProviderError("invalid-response", "probe", READ.name)));
    for (let i = 0; i < 5; i += 1) await settle(client.call(READ, run));
    expect(run).toHaveBeenCalledTimes(5);
    expect(client.breakerState()).toBe("open");
  });

  it("ARC-05 FR 3: a timed-out call counts as a failure", async () => {
    const client = createProviderClient({ provider: "probe", policy: noRetry });
    for (let i = 0; i < 5; i += 1) {
      const pending = settle(client.call(READ, () => new Promise<never>(() => undefined)));
      await vi.advanceTimersByTimeAsync(10_000);
      await pending;
    }
    expect(client.breakerState()).toBe("open");
  });
});
