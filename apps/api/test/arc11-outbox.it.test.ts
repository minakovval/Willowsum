import { randomUUID } from "node:crypto";
import { Money } from "@willowsum/domain-kernel";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAuditLog } from "../src/modules/audit/index.ts";
import { databaseLedgerStore } from "../src/modules/ledger/adapters/index.ts";
import { post as postWith, type LedgerStore } from "../src/modules/ledger/application/index.ts";
import {
  createLedger,
  entryRecorded,
  type Entry,
  type Ledger,
  type LedgerAccount,
} from "../src/modules/ledger/index.ts";
import { createWorker } from "../src/platform/queue/index.ts";
import { schedulerDailyTasks, workerQueues } from "../src/wiring.ts";
import { setupRealModules, type RealModulesDatabase } from "./real-modules.ts";

/**
 * ARC-11@PoC «Запис проводок» (issue #125) on a real PostgreSQL: a ledger entry is written with its event «проводку
 * записано» in the ledger's outbox (ARC-04), in one transaction — a rolled-back entry leaves no event, a committed one
 * exactly one, an idempotent repeat none. The event carries identifiers, codes and dates only. The worker of main.ts
 * dispatches it; the scheduler's retention cleanup removes it once it is old. Spaces and ids are random.
 */

let db: RealModulesDatabase;
let ledger: Ledger;

beforeAll(async () => {
  db = await setupRealModules(6);
  ledger = createLedger(db.databases.for("ledger"));
});

afterAll(async () => {
  await db?.close();
});

const eur = (amount: string) => Money.of(amount, "EUR");
const code = (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (e: { code?: string }) => e.code ?? String(e),
  );

interface EventRow {
  event_name: string;
  event_version: number;
  payload: Record<string, unknown>;
  dispatched_at: Date | null;
}

/** The space's outbox rows, as the database owner sees them (outside the row policy). */
async function events(householdId: string): Promise<EventRow[]> {
  return (
    await db.owner.query<EventRow>(
      `SELECT event_name, event_version, payload, dispatched_at FROM ledger.outbox_events
        WHERE household_id = $1 ORDER BY created_at, payload->>'recordedAt'`,
      [householdId],
    )
  ).rows;
}

async function space(): Promise<{ householdId: string; cash: LedgerAccount }> {
  const householdId = randomUUID();
  const cash = await ledger.openAccount(
    householdId,
    { module: "accounts", id: randomUUID() },
    { type: "asset", currency: "EUR" },
  );
  return { householdId, cash };
}

const spend = (cash: LedgerAccount, amount = "-42.17", key: string = randomUUID()) => ({
  source: { module: "transactions", id: randomUUID() },
  idempotencyKey: key,
  operationDate: "2026-06-30",
  event: { type: "transaction" as const, account: cash.id, amount: eur(amount) },
});

const payloadOf = (entry: Entry) => ({
  entryId: entry.id,
  sourceModule: entry.source.module,
  sourceId: entry.source.id,
  eventType: entry.eventType,
  operationDate: entry.operationDate,
  recordedAt: entry.recordedAt,
  reversesEntryId: entry.reversesEntryId,
});

describe("ARC-11@PoC: «проводку записано» in the outbox, in the transaction of its entry (issue #125)", () => {
  it("a committed entry leaves exactly one event with ids, codes and dates only; its idempotent repeat leaves none", async () => {
    const s = await space();
    const input = spend(s.cash, "-1234.56");
    const entry = await ledger.post(s.householdId, input);
    expect(await events(s.householdId)).toEqual([
      { event_name: entryRecorded.name, event_version: 1, payload: payloadOf(entry), dispatched_at: null },
    ]);
    // No amount, account or text: only the seven fields of the event.
    const [row] = await events(s.householdId);
    expect(Object.keys(row!.payload).sort()).toEqual([
      "entryId",
      "eventType",
      "operationDate",
      "recordedAt",
      "reversesEntryId",
      "sourceId",
      "sourceModule",
    ]);
    const text = JSON.stringify(row!.payload);
    for (const absent of ["1234", s.cash.id, "EUR"]) expect(text).not.toContain(absent);

    expect((await ledger.post(s.householdId, input)).id).toBe(entry.id);
    expect(await events(s.householdId)).toHaveLength(1);
  });

  it("a rolled-back entry leaves no event and no entry", async () => {
    const s = await space();
    const real = databaseLedgerStore(db.databases.for("ledger"));
    // The entry, its postings and its event are written; then the transaction fails and rolls everything back.
    const failing: LedgerStore = {
      inHousehold: (householdId, work) =>
        real.inHousehold(householdId, async (tx) => {
          await work(tx);
          throw new Error("rolled back after the entry was written");
        }),
    };
    expect(await code(postWith({ store: failing, newId: randomUUID }, s.householdId, spend(s.cash)))).toMatch(
      /rolled back/,
    );
    expect(await events(s.householdId)).toEqual([]);
    const { rows } = await db.owner.query("SELECT 1 FROM ledger.entries WHERE household_id = $1", [
      s.householdId,
    ]);
    expect(rows).toEqual([]);
  });

  it("a reversal is one event pointing at its entry; a change is two (reversal and replacement); a failed change none", async () => {
    const s = await space();
    const first = await ledger.post(s.householdId, spend(s.cash));
    const reversal = await ledger.reverse(s.householdId, first.id, "delete-1");
    // Its repeat writes nothing.
    await ledger.reverse(s.householdId, first.id, "delete-1");
    const second = await ledger.post(s.householdId, spend(s.cash));
    const changed = await ledger.correct(s.householdId, second.id, spend(s.cash, "-50.00"));
    // A change whose replacement is refused (unknown account) rolls back its reversal and the reversal's event.
    const third = await ledger.post(s.householdId, spend(s.cash));
    const unknown = { ...spend(s.cash), event: { ...spend(s.cash).event, account: randomUUID() } };
    expect(await code(ledger.correct(s.householdId, third.id, unknown))).toBe("UNKNOWN_ACCOUNT");

    const payloads = (await events(s.householdId)).map((e) => e.payload);
    // first, its reversal, second, the change's reversal and replacement, third — and nothing of the failed change.
    expect(payloads).toHaveLength(6);
    expect(payloads).toEqual(
      expect.arrayContaining(
        [first, reversal, second, changed.reversal, changed.entry, third].map(payloadOf),
      ),
    );
    expect(payloads.find((p) => p["entryId"] === reversal.id)).toMatchObject({
      eventType: "reversal",
      reversesEntryId: first.id,
    });
  });

  it("another space neither sees the events nor learns that they exist", async () => {
    const mine = await space();
    const other = await space();
    await ledger.post(mine.householdId, spend(mine.cash));
    const seen = (householdId: string) =>
      db.databases
        .for("ledger")
        .inHousehold(householdId, async (q) => (await q.query("SELECT 1 FROM outbox_events")).rowCount);
    // Opening an account writes no event: the other space has none, and does not see this one.
    expect(await seen(mine.householdId)).toBe(1);
    expect(await seen(other.householdId)).toBe(0);
  });
});

describe("ARC-11@PoC: the outbox row itself refuses text and other fields", () => {
  it("the event schema refuses a field beyond the ids, codes and dates", () => {
    const entry = {
      entryId: randomUUID(),
      sourceModule: "transactions",
      sourceId: randomUUID(),
      eventType: "transaction",
      operationDate: "2026-06-30",
      recordedAt: "2026-06-30T10:00:00.123456Z",
      reversesEntryId: null,
    };
    expect(entryRecorded.schema.safeParse(entry).success).toBe(true);
    for (const extra of [{ description: "Кава" }, { amount: "42.17" }, { merchant: "x" }])
      expect(entryRecorded.schema.safeParse({ ...entry, ...extra }).success, JSON.stringify(extra)).toBe(
        false,
      );
    expect(entryRecorded.schema.safeParse({ ...entry, eventType: "кава з молоком" }).success).toBe(false);
  });

  it("the table refuses a payload string that is not a code, even from the module's own role", async () => {
    const s = await space();
    const insert = (payload: unknown) =>
      code(
        db.databases
          .for("ledger")
          .inHousehold(s.householdId, (q) =>
            q.query(
              `INSERT INTO outbox_events (household_id, event_name, event_version, payload) VALUES ($1, $2, 1, $3::jsonb)`,
              [s.householdId, entryRecorded.name, JSON.stringify(payload)],
            ),
          ),
      );
    expect(await insert({ entryId: randomUUID() })).toBe("ok");
    expect(await insert({ note: "Кава в аеропорту" })).toBe("23514");
    expect(await insert({ nested: { merchant: "Coffee shop" } })).toBe("23514");
    expect(await insert(["a list"])).toBe("23514");
  });
});

describe("ARC-11@PoC through main.ts's wiring: the worker dispatches the ledger's events, the scheduler purges old ones", () => {
  it("workerQueues(databases) serves the ledger outbox; queue.retention-cleanup deletes dispatched events after 7 days only", async () => {
    const s = await space();
    await ledger.post(s.householdId, spend(s.cash));
    await ledger.post(s.householdId, spend(s.cash));
    const worker = createWorker({ ...workerQueues(db.databases), households: async () => [s.householdId] });
    try {
      await worker.tick();
      await worker.idle();
    } finally {
      await worker.stop();
    }
    expect((await events(s.householdId)).map((e) => e.dispatched_at !== null)).toEqual([true, true]);
    // One was handed over 8 days ago, the other 6 days ago; a third is still to dispatch.
    await db.owner.query(
      `UPDATE ledger.outbox_events SET dispatched_at = now() - make_interval(days => CASE WHEN rn = 1 THEN 8 ELSE 6 END)
         FROM (SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn FROM ledger.outbox_events
                WHERE household_id = $1) o
        WHERE ledger.outbox_events.id = o.id`,
      [s.householdId],
    );
    await ledger.post(s.householdId, spend(s.cash));
    const tasks = schedulerDailyTasks({
      databases: db.databases,
      audit: createAuditLog(db.databases.for("audit")),
      spaces: { spaceIds: async () => [s.householdId] },
      now: () => Date.now(),
    });
    const cleanup = tasks.find((t) => t.name === "queue.retention-cleanup");
    expect(cleanup).toBeDefined();
    await cleanup!.run();
    const left = await events(s.householdId);
    expect(left).toHaveLength(2);
    expect(left.filter((e) => e.dispatched_at === null)).toHaveLength(1);
    // The entries the events reported stay.
    const { rows } = await db.owner.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM ledger.entries WHERE household_id = $1",
      [s.householdId],
    );
    expect(rows).toEqual([{ n: 3 }]);
  });
});
