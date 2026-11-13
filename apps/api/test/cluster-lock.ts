// globalSetup of the integration config: one integration run per PostgreSQL cluster, also for a bare `vitest` or
// `pnpm test:integration` run that did not go through `pnpm db:test run` (lock and reasons:
// tools/test-guards/cluster-lock.mjs).
import pg from "pg";
import {
  HELD_BY_SQL,
  HOLDER_PID_ENV,
  LOCK_NAME,
  LOCK_SQL,
  lockDatabaseUrl,
} from "../../../tools/test-guards/cluster-lock.mjs";

export interface ClusterLockOptions {
  readonly databaseUrl: string | undefined;
  readonly holderPid: string | undefined;
  readonly log?: (message: string) => void;
  /** application_name of the lock session (pg_stat_activity), so a test can find its own waiting session. */
  readonly applicationName?: string;
}

/**
 * Takes the cluster lock unless the session named by `holderPid` (the `pnpm db:test run` lock session) holds it
 * already; returns the function that releases it. Without a database URL the tests fail on their own.
 */
export async function acquireClusterLock(options: ClusterLockOptions): Promise<() => Promise<void>> {
  const { databaseUrl, holderPid, log = console.log, applicationName = "ws-integration-lock" } = options;
  if (!databaseUrl) return async () => {};
  const client = new pg.Client({
    connectionString: lockDatabaseUrl(databaseUrl),
    application_name: applicationName,
  });
  await client.connect();
  try {
    if (holderPid && /^\d+$/.test(holderPid)) {
      const held = await client.query(HELD_BY_SQL, [Number(holderPid), LOCK_NAME]);
      if (held.rowCount === 1) {
        await client.end();
        return async () => {};
      }
    }
    log("Waiting for the cluster lock (one integration run per PostgreSQL cluster)…");
    await client.query(LOCK_SQL, [LOCK_NAME]);
  } catch (error) {
    await client.end();
    throw error;
  }
  return async () => {
    await client.end(); // ends the session, which releases the lock
  };
}

export default async function setup(): Promise<() => Promise<void>> {
  return acquireClusterLock({
    databaseUrl: process.env["DATABASE_URL"],
    holderPid: process.env[HOLDER_PID_ENV],
  });
}
