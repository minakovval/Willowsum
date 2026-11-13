import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupRealModules, type RealModulesDatabase } from "../../../test/real-modules.ts";
import { localKeyManagement, type LocalKeyManagement } from "../../platform/adapters/kms/index.ts";
import { ProviderError } from "../../platform/adapters/errors.ts";
import { schedulerDailyTasks } from "../../wiring.ts";
import { createAuditLog } from "../audit/index.ts";
import {
  createHouseholdSpaces,
  createSpaceKeys,
  SpaceKeyError,
  type HouseholdSpaces,
  type SpaceKeys,
} from "./index.ts";

/**
 * ARC-06@PoC (ADR-0012) on a real PostgreSQL: each space's own data key wrapped by the master key through the KMS
 * port (the local implementation), separately encrypted fields bound to their space and field, rewrapping after a
 * master key rotation without downtime, and the destruction of a space's key. Accounts are random ids; names and
 * values are synthetic.
 */
let db: RealModulesDatabase;
let kms: LocalKeyManagement;
let spaces: HouseholdSpaces;
let keys: SpaceKeys;

const IBAN = "UA00 0000 0000 0000 0000 0000 0000 0"; // synthetic: the format of an IBAN, no real account

async function newSpace(name = "Олена Ключова"): Promise<string> {
  return (await spaces.ensureFirstSpace({ accountId: randomUUID(), displayName: name })).householdId;
}

async function keyRow(householdId: string) {
  const { rows } = await db.owner.query(
    `SELECT k.key_id, k.master_key_version, k.wrapped_key, h.encryption_key_ref
       FROM household.households h LEFT JOIN household.space_keys k USING (household_id)
      WHERE h.household_id = $1`,
    [householdId],
  );
  return rows[0] as
    | {
        key_id: string | null;
        master_key_version: string | null;
        wrapped_key: string | null;
        encryption_key_ref: string;
      }
    | undefined;
}

beforeAll(async () => {
  db = await setupRealModules(4);
  kms = localKeyManagement();
  const audit = createAuditLog(db.databases.for("audit"));
  spaces = createHouseholdSpaces(db.databases.for("household"), audit, kms);
  keys = createSpaceKeys(db.databases.for("household"), audit, kms);
});

afterAll(async () => {
  await db?.close();
});

describe("ARC-06@PoC FR 1: every space has its own data key, wrapped by the master key through the KMS port", () => {
  it("ARC-06@PoC FR 1: a new space gets a key; the reference names it; only the wrap is stored", async () => {
    const a = await newSpace();
    const b = await newSpace("Богдан Ключовий");
    const rowA = (await keyRow(a))!;
    const rowB = (await keyRow(b))!;
    expect(rowA.encryption_key_ref).toBe(`dek:${rowA.key_id}`);
    expect(rowA.master_key_version).toBe(await kms.currentVersion());
    expect(rowA.key_id).not.toBe(rowB.key_id);
    expect(rowA.wrapped_key).not.toBe(rowB.wrapped_key);
    // The stored wrap is the KMS's ciphertext: 12-byte IV, 16-byte tag, 32-byte key — never the 32 key bytes alone.
    expect(Buffer.from(rowA.wrapped_key!, "base64url").length).toBeGreaterThan(32);
  });

  it("ARC-06@PoC FR 1: the key row is under the household policy: another space or none sees nothing", async () => {
    const mine = await newSpace();
    const other = await newSpace("Інший Простір");
    const household = db.databases.for("household");
    const seen = await household.inHousehold(mine, async (q) =>
      (await q.query<{ household_id: string }>(`SELECT household_id FROM space_keys`)).rows.map(
        (r) => r.household_id,
      ),
    );
    expect(seen).toEqual([mine]);
    expect(seen).not.toContain(other);
    const unbound = await household.transaction(
      async (q) => (await q.query<{ n: number }>(`SELECT count(*)::int AS n FROM space_keys`)).rows[0]!.n,
    );
    expect(unbound).toBe(0);
    const error = await db.databases
      .for("identity")
      .transaction((q) => q.query(`SELECT * FROM household.space_keys`))
      .then(
        () => null,
        (e: { code?: string }) => e.code,
      );
    expect(error).toBe("42501");
  });

  it("ARC-06@PoC FR 1: without the KMS no space is made (fails closed)", async () => {
    const down = {
      currentVersion: async () => kms.currentVersion(),
      wrap: async () => {
        throw new ProviderError("unavailable", "key-management", "wrap");
      },
      unwrap: async () => {
        throw new ProviderError("unavailable", "key-management", "unwrap");
      },
    };
    const broken = createHouseholdSpaces(
      db.databases.for("household"),
      createAuditLog(db.databases.for("audit")),
      down,
    );
    const accountId = randomUUID();
    await expect(broken.ensureFirstSpace({ accountId, displayName: "Без Ключа" })).rejects.toThrow(
      ProviderError,
    );
    expect(await broken.membershipOf(accountId)).toBeNull();
  });
});

describe("ARC-06@PoC FR 2: sensitive fields are encrypted separately with the space's key", () => {
  it("ARC-06@PoC FR 2: seal and open; the sealed value holds no plaintext and differs on every seal", async () => {
    const id = await newSpace();
    const sealed = await keys.seal(id, "iban", IBAN);
    expect(sealed).toMatch(/^ws1\.[A-Za-z0-9_-]+$/);
    expect(sealed).not.toContain("UA00");
    expect(await keys.seal(id, "iban", IBAN)).not.toBe(sealed);
    expect(await keys.open(id, "iban", sealed)).toBe(IBAN);
  });

  it("ARC-06@PoC FR 2: a value sealed in one space does not open in another, nor as another field", async () => {
    const mine = await newSpace();
    const other = await newSpace("Чужий Простір");
    const sealed = await keys.seal(mine, "iban", IBAN);
    await expect(keys.open(other, "iban", sealed)).rejects.toMatchObject({ code: "SEALED_VALUE_INVALID" });
    await expect(keys.open(mine, "policyNumber", sealed)).rejects.toMatchObject({
      code: "SEALED_VALUE_INVALID",
    });
  });

  it("ARC-06@PoC FR 2: a tampered or malformed value is refused, not returned", async () => {
    const id = await newSpace();
    const sealed = await keys.seal(id, "iban", IBAN);
    const bytes = Buffer.from(sealed.slice(4), "base64url");
    bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1;
    await expect(keys.open(id, "iban", `ws1.${bytes.toString("base64url")}`)).rejects.toBeInstanceOf(
      SpaceKeyError,
    );
    await expect(keys.open(id, "iban", "plain text")).rejects.toMatchObject({ code: "SEALED_VALUE_INVALID" });
  });
});

describe("ARC-06@PoC FR 3: a master key rotation rewraps the keys of spaces in the background, without downtime", () => {
  it("ARC-06@PoC FR 3: after rotation old values still open; the daily task rewraps every key; then the old version can go", async () => {
    const a = await newSpace();
    const b = await newSpace("Другий Ротація");
    const sealedA = await keys.seal(a, "iban", IBAN);
    const sealedB = await keys.seal(b, "policyNumber", "POL-000-SYNTH");
    const before = (await keyRow(a))!;

    const next = kms.rotate();
    // No downtime: before the rewrap, values open and new ones seal with the key wrapped by the old version.
    expect(await keys.open(a, "iban", sealedA)).toBe(IBAN);
    const sealedDuring = await keys.seal(b, "iban", IBAN);

    const result = await keys.rewrapAll();
    expect(result.failed).toBe(0);
    expect(result.rewrapped).toBeGreaterThanOrEqual(2);
    const after = (await keyRow(a))!;
    expect(after.master_key_version).toBe(next);
    expect(after.key_id).toBe(before.key_id);
    expect(after.wrapped_key).not.toBe(before.wrapped_key);

    kms.retire(before.master_key_version!);
    expect(await keys.open(a, "iban", sealedA)).toBe(IBAN);
    expect(await keys.open(b, "policyNumber", sealedB)).toBe("POL-000-SYNTH");
    expect(await keys.open(b, "iban", sealedDuring)).toBe(IBAN);
    // A second run has nothing left to do.
    expect((await keys.rewrapAll()).rewrapped).toBe(0);
  });

  it("ARC-06@PoC FR 3: one space whose key cannot be unwrapped does not stop the others", async () => {
    const good = await newSpace();
    const bad = await newSpace("Зіпсований Ключ");
    await db.owner.query(`UPDATE household.space_keys SET wrapped_key = $2 WHERE household_id = $1`, [
      bad,
      Buffer.alloc(60, 9).toString("base64url"),
    ]);
    kms.rotate();
    const result = await keys.rewrapAll();
    expect(result.failed).toBe(1);
    expect((await keyRow(good))!.master_key_version).toBe(await kms.currentVersion());
    await db.owner.query(`DELETE FROM household.account_spaces WHERE space_id = $1`, [bad]);
  });

  it("ARC-06@PoC FR 1: a space made before keys existed (`pending:`) gets its key from the daily task", async () => {
    const householdId = randomUUID();
    await db.owner.query(
      `INSERT INTO household.households (household_id, name, data_region, encryption_key_ref) VALUES ($1, 'Родина Стара', 'eu', $2)`,
      [householdId, `pending:${householdId}`],
    );
    await db.owner.query(
      `INSERT INTO household.account_spaces (account_id, space_id, role) VALUES ($1, $2, 'owner')`,
      [randomUUID(), householdId],
    );
    await expect(keys.seal(householdId, "iban", IBAN)).rejects.toMatchObject({ code: "SPACE_KEY_MISSING" });
    const result = await keys.rewrapAll();
    expect(result.provisioned).toBe(1);
    const row = (await keyRow(householdId))!;
    expect(row.encryption_key_ref).toBe(`dek:${row.key_id}`);
    const sealed = await keys.seal(householdId, "iban", IBAN);
    expect(await keys.open(householdId, "iban", sealed)).toBe(IBAN);
    const audit = createAuditLog(db.databases.for("audit"));
    expect(
      await audit.entriesFor(householdId, { type: "household.space-key", id: row.key_id! }),
    ).toMatchObject([{ actorKind: "system", action: "create" }]);
  });
});

describe("ARC-06@PoC FR 5: destroying a space's key makes its encrypted fields unreadable", () => {
  it("ARC-06@PoC FR 5: the wrap is gone, the reference says destroyed, values no longer open; recorded in the platform log", async () => {
    const id = await newSpace();
    const other = await newSpace("Сусід Лишається");
    const sealed = await keys.seal(id, "iban", IBAN);
    const sealedOther = await keys.seal(other, "iban", IBAN);
    const { key_id: keyId } = (await keyRow(id))!;

    expect(await keys.destroy(id)).toEqual({ destroyed: true });
    const row = (await keyRow(id))!;
    expect(row.key_id).toBeNull();
    expect(row.encryption_key_ref).toBe(`destroyed:${keyId}`);
    await expect(keys.open(id, "iban", sealed)).rejects.toMatchObject({ code: "SPACE_KEY_DESTROYED" });
    await expect(keys.seal(id, "iban", IBAN)).rejects.toMatchObject({ code: "SPACE_KEY_DESTROYED" });
    // The neighbour keeps its key.
    expect(await keys.open(other, "iban", sealedOther)).toBe(IBAN);

    // The daily task never gives a destroyed space a new key.
    await keys.rewrapAll();
    expect((await keyRow(id))!.key_id).toBeNull();
    // Repeating is harmless.
    expect(await keys.destroy(id)).toEqual({ destroyed: false });

    const entries = await createAuditLog(db.databases.for("audit")).platformEntriesFor({
      type: "household.space-key",
      id: keyId!,
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ actorKind: "system", action: "delete" });
  });
});

describe("ARC-06@PoC FR 3: main.ts's scheduler runs the rewrap as a daily task", () => {
  it("ARC-06@PoC FR 3: schedulerDailyTasks({ spaceKeys }) has «household.space-keys», which rewraps after a rotation", async () => {
    const id = await newSpace("Планувальник Ключів");
    const audit = createAuditLog(db.databases.for("audit"));
    const tasks = schedulerDailyTasks({ databases: db.databases, audit, spaces, spaceKeys: keys });
    const task = tasks.find((t) => t.name === "household.space-keys")!;
    expect(task).toBeDefined();
    const next = kms.rotate();
    await task.run();
    expect((await keyRow(id))!.master_key_version).toBe(next);
    // Without spaceKeys the list is as before (no other task touches keys).
    expect(schedulerDailyTasks({ databases: db.databases, audit, spaces }).map((t) => t.name)).not.toContain(
      "household.space-keys",
    );
  });
});
