import { describe, expect, it } from "vitest";
import { ERASURE_DEADLINE_DAYS, erasureDueAt, requestStates } from "./index.ts";

/** NFR-12@PoC FR 3: an erasure is done within 30 days of the request; the state of each request is derived from the log. */
const DAY = 86_400_000;
const at = Date.UTC(2026, 10, 13, 10, 0, 0);
const iso = (ms: number) => new Date(ms).toISOString();
const ids = {
  r1: "6f1c2a52-6d0e-4c43-9a43-1f0f5d2b9a10",
  r2: "7f1c2a52-6d0e-4c43-9a43-1f0f5d2b9a11",
  a: "0b7e0a1e-2f43-4d0a-8f43-7a2e4c1b0d22",
};

describe("NFR-12@PoC FR 3: the 30-day deadline of an erasure request", () => {
  it("NFR-12@PoC FR 3: the deadline is 30 days after the request", () => {
    expect(ERASURE_DEADLINE_DAYS).toBe(30);
    expect(erasureDueAt(at)).toBe(at + 30 * DAY);
  });

  it("NFR-12@PoC FR 3: pending until completed; overdue after the deadline; days left rounded down", () => {
    const records = [
      {
        kind: "requested" as const,
        requestId: ids.r1,
        accountId: ids.a,
        householdIds: [],
        at: iso(at),
        dueAt: iso(at + 30 * DAY),
      },
      {
        kind: "requested" as const,
        requestId: ids.r2,
        accountId: ids.a,
        householdIds: [],
        at: iso(at),
        dueAt: iso(at + 30 * DAY),
      },
      {
        kind: "completed" as const,
        requestId: ids.r2,
        accountId: ids.a,
        householdIds: [],
        at: iso(at + DAY),
      },
    ];
    const day29 = requestStates(records, at + 29 * DAY + 1);
    expect(day29).toEqual([
      expect.objectContaining({ requestId: ids.r1, state: "pending", overdue: false, daysLeft: 0 }),
      expect.objectContaining({
        requestId: ids.r2,
        state: "completed",
        overdue: false,
        completedAt: iso(at + DAY),
      }),
    ]);
    expect(requestStates(records, at + 10 * DAY)[0]).toMatchObject({ daysLeft: 20, overdue: false });
    expect(requestStates(records, at + 30 * DAY + 1)[0]).toMatchObject({
      state: "pending",
      overdue: true,
      daysLeft: 0,
    });
  });
});
