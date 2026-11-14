import { describe, expect, it } from "vitest";
import { drain } from "./queue-fixture.ts";

/**
 * The `drain` helper of the queue tests (#199, #222): two tests of arc04-queue.it.test.ts failed once each because a
 * copy of it stopped on a pass that found nothing while released jobs were still finishing. No database here: a
 * stand-in worker with the two things that matter — a capacity, and a job that takes a moment to end.
 */
function standInWorker(capacity: number, queued: number, jobMs: number) {
  const running = new Set<Promise<void>>();
  const state = { queued, done: 0 };
  const start = () => {
    const job = new Promise<void>((resolve) => setTimeout(resolve, jobMs)).then(() => {
      state.done += 1;
      running.delete(job);
    });
    running.add(job);
  };
  return {
    state,
    start,
    /** One pass: takes queued jobs up to the free capacity; resolves once they have started (like `Worker.tick`). */
    async tick() {
      let started = 0;
      while (state.queued > 0 && running.size < capacity) {
        state.queued -= 1;
        start();
        started += 1;
      }
      return started;
    },
    async idle() {
      while (running.size > 0) await Promise.allSettled([...running]);
    },
  };
}

describe("queue tests' drain helper (#199, #222)", () => {
  it("a job still queued behind running jobs is run: the first pass waits for the jobs that hold the capacity", async () => {
    // As in «the worker's pool size of main.ts…»: the capacity is full of jobs just released, one more job waits.
    const w = standInWorker(4, 1, 30);
    for (let n = 0; n < 4; n++) w.start();
    await drain(w);
    expect(w.state).toEqual({ queued: 0, done: 5 });
  });

  it("jobs that outnumber the capacity are all run, pass after pass", async () => {
    const w = standInWorker(1, 3, 5);
    await drain(w);
    expect(w.state).toEqual({ queued: 0, done: 3 });
  });
});
