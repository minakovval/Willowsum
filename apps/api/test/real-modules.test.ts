import { describe, expect, it } from "vitest";
import { sharedLockTableFull } from "./real-modules.ts";

/**
 * #222: `arc11-balance-cache` failed once in `beforeAll` with «out of shared memory» in the ledger migration, because
 * a session in another database of the same cluster held thousands of locks. The helper names that cause.
 */
describe("integration setup: a full shared lock table is named as the cluster's state (#222)", () => {
  const outOfSharedMemory = Object.assign(new Error("out of shared memory"), { code: "53200" });

  it("the error of the migration runner, which wraps the database error as its cause", () => {
    const wrapped = new Error("Migration ledger/0001_journal.sql failed: out of shared memory", {
      cause: outOfSharedMemory,
    });
    const explained = sharedLockTableFull(wrapped);
    expect(explained?.message).toMatch(/shared lock table is full/);
    expect(explained?.message).toMatch(/every database of the cluster/);
    expect(explained?.message).toMatch(/pnpm db:test run/);
    expect(explained?.cause).toBe(wrapped);
  });

  it("the database error itself", () => {
    expect(sharedLockTableFull(outOfSharedMemory)?.cause).toBe(outOfSharedMemory);
  });

  it("any other error is left as it is", () => {
    expect(sharedLockTableFull(new Error("syntax error at end of input"))).toBeUndefined();
    expect(
      sharedLockTableFull(Object.assign(new Error("deadlock detected"), { code: "40P01" })),
    ).toBeUndefined();
    expect(sharedLockTableFull(undefined)).toBeUndefined();
  });
});
