import { afterEach, describe, expect, it, vi } from "vitest";
import { DAILY_FIRST_DELAY_MS, DAILY_INTERVAL_MS, scheduleDaily } from "./daily.ts";

describe("ACC-01 FR 6 / NFR-12: the scheduler runs its tasks daily", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("first a minute after the start, then every 24 h", async () => {
    vi.useFakeTimers({ now: 0 });
    let runs = 0;
    const schedule = scheduleDaily([{ name: "test.daily", run: async () => void runs++ }]);
    await vi.advanceTimersByTimeAsync(DAILY_FIRST_DELAY_MS - 1);
    expect(runs).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(runs).toBe(1);
    await vi.advanceTimersByTimeAsync(DAILY_INTERVAL_MS - 1);
    expect(runs).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(runs).toBe(2);
    await vi.advanceTimersByTimeAsync(DAILY_INTERVAL_MS);
    expect(runs).toBe(3);
    await schedule.stop();
    await vi.advanceTimersByTimeAsync(2 * DAILY_INTERVAL_MS);
    expect(runs).toBe(3);
  });

  it("a failing task does not stop the others or the next day's run", async () => {
    vi.useFakeTimers({ now: 0 });
    let failing = 0;
    let other = 0;
    const schedule = scheduleDaily([
      {
        name: "test.failing",
        run: async () => {
          failing++;
          throw new Error("down");
        },
      },
      { name: "test.other", run: async () => void other++ },
    ]);
    await vi.advanceTimersByTimeAsync(DAILY_FIRST_DELAY_MS + DAILY_INTERVAL_MS);
    expect([failing, other]).toEqual([2, 2]);
    await schedule.stop();
  });

  it("one run at a time; stop waits for the run in progress", async () => {
    let release!: () => void;
    let started = 0;
    let finished = 0;
    const schedule = scheduleDaily(
      [
        {
          name: "test.slow",
          run: async () => {
            started++;
            await new Promise<void>((resolve) => (release = resolve));
            finished++;
          },
        },
      ],
      { firstDelayMs: DAILY_INTERVAL_MS },
    );
    const first = schedule.runNow();
    const second = schedule.runNow();
    await Promise.resolve();
    expect(started).toBe(1);
    const stopped = schedule.stop();
    release();
    await Promise.all([first, second, stopped]);
    expect([started, finished]).toEqual([1, 1]);
  });
});
