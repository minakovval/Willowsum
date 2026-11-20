import { describe, expect, it } from "vitest";
import { ROLLBACK_DAYS, rollbackUntil } from "./rollback.ts";

describe("IMP-16@PoC FR 1: the rollback's 7 days", () => {
  it("IMP-16@PoC FR 1: until exactly 7 days after the apply finished", () => {
    expect(ROLLBACK_DAYS).toBe(7);
    expect(rollbackUntil(new Date("2026-11-20T10:00:00Z")).toISOString()).toBe("2026-11-27T10:00:00.000Z");
  });
});
