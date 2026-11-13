// Review of PR #168: a bare `vitest` or `pnpm test:integration` run must queue for the cluster lock like
// `pnpm db:test run` does (infra/local/README.md, «Limitation»; tools/test-guards/cluster-lock.mjs).
import { randomBytes } from "node:crypto";
import pg from "pg";
import { describe, expect, it } from "vitest";
import {
  LOCK_NAME,
  LOCK_SQL,
  HELD_BY_SQL,
  lockDatabaseUrl,
} from "../../../tools/test-guards/cluster-lock.mjs";
import { acquireClusterLock } from "./cluster-lock.ts";

const url = process.env["DATABASE_URL"]!;

async function withLockDb<T>(work: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: lockDatabaseUrl(url) });
  await c.connect();
  try {
    return await work(c);
  } finally {
    await c.end();
  }
}

/** Sessions holding the cluster lock now. */
const holders = (): Promise<number[]> =>
  withLockDb(async (c) => {
    const rows = await c.query<{ pid: number }>(
      `SELECT pid FROM pg_stat_activity WHERE datname = current_database()`,
    );
    const out: number[] = [];
    for (const { pid } of rows.rows)
      if ((await c.query(HELD_BY_SQL, [pid, LOCK_NAME])).rowCount === 1) out.push(pid);
    return out;
  });

describe("one integration run per PostgreSQL cluster", () => {
  it("this run holds the cluster lock (taken by globalSetup or by pnpm db:test run)", async () => {
    expect(await holders()).toHaveLength(1);
  });

  it("a second run waits for the lock: a plain lock attempt times out", async () => {
    await withLockDb(async (c) => {
      await c.query("SET statement_timeout = 500");
      await expect(c.query(LOCK_SQL, [LOCK_NAME])).rejects.toThrow(/statement timeout/);
    });
  });

  it("globalSetup of a second run queues until the lock is free, and trusts only a session that holds it", async () => {
    const [holder] = await holders();
    // The pnpm db:test run lock session: a run it started does not take the lock again.
    const release = await acquireClusterLock({ databaseUrl: url, holderPid: String(holder), log: () => {} });
    await release();

    // A run without a holder, or naming a session that does not hold the lock, waits.
    const name = `ws-lock-test-${randomBytes(4).toString("hex")}`;
    let settled = false;
    const waiting = acquireClusterLock({
      databaseUrl: url,
      holderPid: "1",
      log: () => {},
      applicationName: name,
    });
    void waiting.then(
      () => (settled = true),
      () => (settled = true),
    );
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    expect(settled).toBe(false);
    const waiters = await withLockDb((c) =>
      c.query<{ pid: number; wait: string | null }>(
        `SELECT pid, wait_event_type AS wait FROM pg_stat_activity WHERE application_name = $1`,
        [name],
      ),
    );
    expect(waiters.rows).toEqual([{ pid: expect.any(Number), wait: "Lock" }]);
    // Ends only the test's own waiting session.
    await withLockDb((c) =>
      c.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = $1`, [name]),
    );
    await expect(waiting).rejects.toThrow();
  });
});
