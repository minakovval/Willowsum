import { Decimal } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import type { PivotRate } from "../domain/index.ts";
import type { FxClock, FxRateFeed, FxRateStore, FxRefreshEvent } from "./index.ts";
import { FIRST_ATTEMPT_DELAY_MS, startFxRefresh } from "./index.ts";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

/** A clock the test moves by hand: timers fire only when `advance` passes them; nothing reads the wall clock. */
function manualClock(start: number) {
  let now = start;
  let timers: { at: number; callback: () => void; id: number }[] = [];
  let next = 0;
  const clock: FxClock = {
    now: () => now,
    setTimeout: (callback, ms) => {
      timers.push({ at: now + ms, callback, id: ++next });
      return next;
    },
    clearTimeout: (id) => {
      timers = timers.filter((t) => t.id !== id);
    },
  };
  const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
  return {
    clock,
    /** The delays of the timers armed now, from the current time. */
    pending: () => timers.map((t) => t.at - now),
    async advance(ms: number) {
      const target = now + ms;
      for (;;) {
        const due = timers.filter((t) => t.at <= target).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        timers = timers.filter((t) => t !== due);
        now = due.at;
        due.callback();
        for (let i = 0; i < 5; i++) await settle();
      }
      now = target;
    },
  };
}

function memoryStore(): FxRateStore & { saved: PivotRate[][] } {
  const saved: PivotRate[][] = [];
  let last: number | null = null;
  return {
    saved,
    async saveUpdate(update) {
      saved.push([...update.rates]);
      last = update.completedAt;
    },
    lastSuccessAt: async () => last,
    ratesOnOrBefore: async () => null,
  };
}

function scriptedFeed(): FxRateFeed & { up: boolean; calls: string[] } {
  const feed = {
    name: "scripted",
    up: true,
    calls: [] as string[],
    async dailyRates(date: string): Promise<readonly PivotRate[]> {
      feed.calls.push(date);
      if (!feed.up) throw new Error("provider unavailable");
      return ["USD", "EUR", "PLN"].map((currency) => ({
        currency,
        rate: new Decimal("40.5"),
        date,
        source: "NBU",
      }));
    },
  };
  return feed;
}

const T0 = Date.UTC(2026, 10, 12, 6, 0);

function setup() {
  const time = manualClock(T0);
  const feed = scriptedFeed();
  const store = memoryStore();
  const events: FxRefreshEvent[] = [];
  const loop = startFxRefresh({ feed, store, clock: time.clock, report: (e) => events.push(e) });
  return { time, feed, store, events, loop };
}

describe("VAL-05@PoC: the daily update task with retries", () => {
  it("VAL-05 AC1: at the time of the daily update, with the provider available, the rates of all currencies are loaded", async () => {
    const { time, feed, store, events, loop } = setup();
    await time.advance(FIRST_ATTEMPT_DELAY_MS);
    expect(feed.calls).toEqual(["2026-11-12"]);
    expect(store.saved[0]!.map((r) => r.currency)).toEqual(["USD", "EUR", "PLN"]);
    expect(events).toEqual([{ kind: "updated", currencies: 3 }]);
    await loop.stop();
  });

  it("VAL-05 FR2: after a success the next update is a day later, once a day", async () => {
    const { time, feed, loop } = setup();
    await time.advance(FIRST_ATTEMPT_DELAY_MS);
    expect(time.pending()).toEqual([24 * HOUR]);
    await time.advance(24 * HOUR - 1);
    expect(feed.calls).toHaveLength(1);
    await time.advance(1);
    expect(feed.calls).toEqual(["2026-11-12", "2026-11-13"]);
    await loop.stop();
    expect(time.pending()).toEqual([]);
  });

  it("VAL-05 AC2: a provider that does not answer is retried; after 24 h without success an error-level event is reported", async () => {
    const { time, feed, events, loop } = setup();
    await time.advance(FIRST_ATTEMPT_DELAY_MS);
    feed.up = false;
    await time.advance(24 * HOUR);
    expect(feed.calls).toHaveLength(2);
    // Three short retries, then 1 h, 2 h, 4 h, … (assumption of VAL-05@PoC).
    const pauses: number[] = [];
    for (let i = 0; i < 8; i++) {
      pauses.push(time.pending()[0]!);
      await time.advance(time.pending()[0]!);
    }
    expect(pauses.map((p) => p / MINUTE)).toEqual([15, 15, 60, 120, 240, 480, 960, 1440]);
    const failed = events.filter((e) => e.kind === "failed");
    expect(failed).toHaveLength(9);
    // The first failure came 24 h after the success: 24 h without a successful update from that moment on.
    const stale = events.filter((e) => e.kind === "stale");
    expect(stale.length).toBe(9);
    expect(stale[0]).toEqual({ kind: "stale", failures: 1 });

    feed.up = true;
    await time.advance(time.pending()[0]!);
    expect(events.at(-1)).toEqual({ kind: "updated", currencies: 3 });
    expect(time.pending()).toEqual([24 * HOUR]);
    await loop.stop();
  });

  it("VAL-05 AC2: failures within 24 h of the last success are retried without the error-level event", async () => {
    const { time, feed, events, loop } = setup();
    await time.advance(FIRST_ATTEMPT_DELAY_MS);
    await time.advance(23 * HOUR);
    feed.up = false;
    await time.advance(HOUR); // the daily run fails, 24 h after the success: stale
    expect(events.filter((e) => e.kind === "stale")).toHaveLength(1);
    await loop.stop();

    const second = setup();
    second.feed.up = false;
    await second.time.advance(FIRST_ATTEMPT_DELAY_MS + 30 * MINUTE);
    // Never a success, but the task started less than 24 h ago: retries only.
    expect(second.events.map((e) => e.kind)).toEqual(["failed", "failed", "failed"]);
    await second.time.advance(32 * HOUR); // the retry at 31 h 31 min is past 24 h since the start
    expect(second.events.some((e) => e.kind === "stale")).toBe(true);
    await second.loop.stop();
  });

  it("VAL-05 FR1: an attempt asked while one runs joins it (one update at a time)", async () => {
    const { feed, loop } = setup();
    const [a, b] = await Promise.all([loop.attempt(), loop.attempt()]);
    expect([a, b]).toEqual(["updated", "updated"]);
    expect(feed.calls).toHaveLength(1);
    await loop.stop();
  });
});
