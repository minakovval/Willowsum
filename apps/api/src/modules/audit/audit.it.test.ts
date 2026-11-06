import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ModuleDatabases } from "../../platform/db/module-db.ts";
import { setupRealModules, type RealModulesDatabase } from "../../../test/real-modules.ts";
import { AUDIT_MASK, createAuditLog, type AuditLog } from "./index.ts";

const householdA = "3b9d7f0e-2c4a-4e8b-9a1d-6f5e4c3b2a01";
const householdB = "9e8d7c6b-5a49-4382-8170-6f5e4d3c2b02";
const entity = { type: "accounts.account", id: "5c0b8a3e-1f2d-4c6b-8e9a-7d6c5b4a3f21" };
const actor = { kind: "user" as const, id: "7a6b5c4d-3e2f-4a1b-9c8d-7e6f5a4b3c22" };

let db: RealModulesDatabase;
let owner: RealModulesDatabase["owner"];
let databases: ModuleDatabases;
let log: AuditLog;

async function code(promise: Promise<unknown>): Promise<string> {
  return promise.then(
    () => "ok",
    (e: { code?: string; message: string }) => e.code ?? e.message,
  );
}

beforeAll(async () => {
  db = await setupRealModules();
  ({ owner, databases } = db);
  log = createAuditLog(databases.for("audit"));
  await log.record(householdA, {
    actor,
    channel: "web",
    entity,
    action: "update",
    changes: [
      { field: "name", before: "Card", after: "Main card", sensitive: false },
      { field: "iban", before: null, after: "UA213223130000026007233566001", sensitive: true },
    ],
  });
});

afterAll(async () => {
  await db?.close();
});

describe("ARC-03 FR 5 / П-10: the audit log", () => {
  it("records author, UTC time, entity, fields with values before and after, channel", async () => {
    const [entry] = await log.entriesFor(householdA, entity);
    expect(entry).toMatchObject({
      householdId: householdA,
      actorKind: "user",
      actorId: actor.id,
      channel: "web",
      entityType: entity.type,
      entityId: entity.id,
      action: "update",
    });
    expect(entry!.occurredAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(entry!.changes).toEqual([
      { field: "name", before: "Card", after: "Main card", masked: false },
      { field: "iban", before: null, after: AUDIT_MASK, masked: true },
    ]);
  });

  it("sensitive values never reach the table", async () => {
    const { rows } = await owner.query<{ raw: string }>("SELECT changes::text AS raw FROM audit.entries");
    expect(rows.map((r) => r.raw).join()).not.toContain("UA2132");
  });

  it("another household sees no entries of this one", async () => {
    expect(await log.entriesFor(householdB, entity)).toEqual([]);
  });

  it.each([
    ["UPDATE", "UPDATE entries SET action = 'delete'"],
    ["DELETE", "DELETE FROM entries"],
    ["TRUNCATE", "TRUNCATE entries"],
  ])("criterion: the application role has no %s on the audit table (append-only)", async (_, sql) => {
    expect(await code(databases.for("audit").inHousehold(householdA, (q) => q.query(sql)))).toBe("42501");
  });

  it.each([
    ["occurred_at", "occurred_at", "'2020-01-01T00:00:00Z'"],
    ["id", "id", "'2f8fddc6-5a91-4b72-9e3f-7a013acd8fad'"],
  ])("module SQL cannot set %s: the database sets it (no backdated entries)", async (_, column, value) => {
    const sql = `INSERT INTO entries (household_id, ${column}, actor_kind, channel, entity_type, entity_id, action, changes)
                 VALUES ($1, ${value}, 'system', 'system', 'x', $2, 'create', '[]')`;
    expect(
      await code(
        databases.for("audit").inHousehold(householdA, (q) => q.query(sql, [householdA, entity.id])),
      ),
    ).toBe("42501");
  });

  it.each([
    ["UPDATE", "UPDATE audit.entries SET action = 'delete'"],
    ["DELETE", "DELETE FROM audit.entries"],
    ["TRUNCATE", "TRUNCATE audit.entries"],
  ])("even the schema owner cannot %s an entry: a trigger refuses it", async (_, sql) => {
    await expect(owner.query(sql)).rejects.toThrow(/append-only/);
    const { rows } = await owner.query<{ n: number }>("SELECT count(*)::int AS n FROM audit.entries");
    expect(rows[0]!.n).toBe(1);
  });

  it("an invalid entry is refused before anything is stored", async () => {
    await expect(
      log.record(householdA, { actor, channel: "web", entity, action: "update", changes: [] } as never),
    ).resolves.toBeDefined();
    await expect(log.record(householdA, { actor: { kind: "user", id: "anna" } } as never)).rejects.toThrow();
    expect(await log.entriesFor(householdA, entity)).toHaveLength(2);
  });
});

describe("П-10 / CICD-06: the platform log (changes that belong to no household)", () => {
  const flag = { type: "feature-flags.flag", id: "0d9c8b7a-6f5e-4d3c-8b2a-1f0e9d8c7b61" };
  const staff = { kind: "staff" as const, id: "1e2d3c4b-5a69-4788-9a6b-5c4d3e2f1a07" };

  it("records who, when, which setting and the values before and after", async () => {
    await log.recordPlatform({
      actor: staff,
      channel: "system",
      entity: flag,
      action: "update",
      changes: [{ field: "stage", before: "off", after: "test", sensitive: false }],
    });
    const [entry] = await log.platformEntriesFor(flag);
    expect(entry).toMatchObject({
      actorKind: "staff",
      actorId: staff.id,
      channel: "system",
      action: "update",
    });
    expect(entry!.changes).toEqual([{ field: "stage", before: "off", after: "test", masked: false }]);
    expect(entry!.occurredAt).toMatch(/Z$/);
  });

  it("a household's user cannot be the author of a platform change", async () => {
    await expect(
      log.recordPlatform({ actor, channel: "web", entity: flag, action: "update", changes: [] }),
    ).rejects.toThrow(/staff or the system/);
  });

  it.each([
    ["UPDATE", "UPDATE platform_entries SET action = 'delete'"],
    ["DELETE", "DELETE FROM platform_entries"],
    ["TRUNCATE", "TRUNCATE platform_entries"],
  ])("the application role has no %s on the platform log (append-only)", async (_, sql) => {
    expect(await code(databases.for("audit").transaction((q) => q.query(sql)))).toBe("42501");
  });

  it("even the schema owner cannot change or delete a platform entry", async () => {
    await expect(owner.query("DELETE FROM audit.platform_entries")).rejects.toThrow(/append-only/);
  });
});
