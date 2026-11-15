import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWorker } from "../src/platform/queue/index.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";
import { createAuditLog, createAuditErasure, type AuditLog } from "../src/modules/audit/index.ts";
import {
  createLiabilities,
  createLiabilitiesErasure,
  createLiabilitiesWorkerQueue,
} from "../src/modules/liabilities/index.ts";
import { withTestErasureDatabases } from "./erasure-helpers.ts";

/**
 * #270 item 2 (ARC-04 FR 2, NFR-12@PoC FR 3): a space's erasure while a liabilities hand-off job is running leaves no
 * liability, job row or audit entry in the erased space. Synthetic data only.
 */
let db: RealModulesDatabase;
let audit: AuditLog;

beforeAll(async () => {
  db = await setupRealModules();
  audit = createAuditLog(db.databases.for("audit"));
});
afterAll(async () => {
  await db.close();
});

const terms = { kind: "loan" as const, currency: "EUR", annualRate: "6", monthlyPayment: "650.00" };

async function spaceWithQueuedHandOff() {
  const accountId = randomUUID();
  const { householdId } = await householdSpaces(db).ensureFirstSpace({
    accountId,
    displayName: "Олена Синтетична",
  });
  const failing = { record: async () => Promise.reject(new Error("injected")) } as unknown as Pick<
    AuditLog,
    "record"
  >;
  await createLiabilities(db.databases.for("liabilities"), failing).register(householdId, {
    actorAccountId: accountId,
    accountId: randomUUID(),
    terms,
  });
  return { accountId, householdId };
}

const count = async (sql: string, householdId: string, more = "") =>
  (
    await db.owner.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM ${sql} WHERE household_id = $1 ${more}`,
      [householdId],
    )
  ).rows[0]!.n;

describe("ARC-04@PoC FR 2 (#270 item 2): the space's erasure while a liabilities hand-off job runs", () => {
  it("ARC-04@PoC FR 2: the erasure waits for the running job, and the audit step then removes the entry it wrote", async () => {
    const { householdId } = await spaceWithQueuedHandOff();
    let entered!: () => void;
    const inHandler = new Promise<void>((r) => (entered = r));
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slowAudit = {
      record: async (...args: Parameters<AuditLog["record"]>) => {
        entered();
        await gate;
        return audit.record(...args);
      },
    };
    const worker = createWorker({
      queues: [createLiabilitiesWorkerQueue(db.databases.for("liabilities"), slowAudit)],
      households: async () => [householdId],
    });
    try {
      await worker.tick();
      await inHandler;
      let erased = false;
      const erasing = createLiabilitiesErasure(db.databases.for("liabilities"))
        .eraseHousehold(householdId)
        .then((r) => {
          erased = true;
          return r;
        });
      await new Promise((r) => setTimeout(r, 400));
      expect(erased).toBe(false);
      release();
      await worker.idle();
      await erasing;
    } finally {
      release();
      await worker.stop();
    }
    expect(await count("liabilities.jobs", householdId)).toBe(0);
    expect(await count("liabilities.liabilities", householdId)).toBe(0);
    // The entry the job wrote is there until the erasure's audit step; it must be there (the lock held the erasure).
    expect(await count("audit.entries", householdId, "AND entity_type = 'liabilities.liability'")).toBe(1);
    // It reached the log before the erasure's own audit step, which takes it.
    await withTestErasureDatabases(db, async (erasureDatabases) => {
      await createAuditErasure(erasureDatabases.for("audit")).eraseHousehold(householdId);
    });
    expect(await count("audit.entries", householdId)).toBe(0);
  });

  it("ARC-04@PoC FR 2: a job whose row the erasure has already taken writes no audit entry", async () => {
    const { householdId } = await spaceWithQueuedHandOff();
    let writes = 0;
    const countingAudit = {
      record: async (...args: Parameters<AuditLog["record"]>) => {
        writes += 1;
        return audit.record(...args);
      },
    };
    // The job is claimed, then the erasure commits before its transaction starts: take the claim by hand.
    const jobs = createLiabilitiesWorkerQueue(db.databases.for("liabilities"), countingAudit);
    const handler = jobs.handlers[0]!;
    const { rows } = await db.owner.query<{ id: string; payload: unknown }>(
      `SELECT id, payload FROM liabilities.jobs WHERE household_id = $1`,
      [householdId],
    );
    await createLiabilitiesErasure(db.databases.for("liabilities")).eraseHousehold(householdId);
    await db.databases.for("liabilities").inHousehold(householdId, (q) =>
      handler.run(
        {
          id: rows[0]!.id,
          householdId,
          key: "k",
          payload: handler.job.schema.parse(rows[0]!.payload),
          attempt: 1,
          signal: new AbortController().signal,
        },
        q,
      ),
    );
    expect(writes).toBe(0);
    expect(await count("audit.entries", householdId, "AND entity_type = 'liabilities.liability'")).toBe(0);
  });
});
