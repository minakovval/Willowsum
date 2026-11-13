import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupRealModules, type RealModulesDatabase } from "../../../test/real-modules.ts";
import { ProviderError } from "../../platform/adapters/errors.ts";
import {
  localKeyManagement,
  type KeyManagement,
  type LocalKeyManagement,
} from "../../platform/adapters/kms/index.ts";
import { createAuditLog, type AuditLog } from "../audit/index.ts";
import { createHouseholdSpaces, createSpaceKeys, type HouseholdSpaces, type SpaceKeys } from "./index.ts";

/** Security review of PR #141 (ARC-06@PoC FR 3, FR 5) on a real PostgreSQL. Synthetic ids and values only. */
let db: RealModulesDatabase;
let kms: LocalKeyManagement;
let audit: AuditLog;
let spaces: HouseholdSpaces;
let keys: SpaceKeys;
const VALUE = ["UA00", "0000", "SYNTH"].join(" ");

async function newSpace(): Promise<string> {
  return (await spaces.ensureFirstSpace({ accountId: randomUUID(), displayName: "Рецензія Ключів" }))
    .householdId;
}

async function keyRow(householdId: string) {
  const { rows } = await db.owner.query(
    `SELECT k.key_id, k.master_key_version, k.wrapped_key, h.encryption_key_ref
       FROM household.households h LEFT JOIN household.space_keys k USING (household_id)
      WHERE h.household_id = $1`,
    [householdId],
  );
  return rows[0] as {
    key_id: string | null;
    master_key_version: string | null;
    wrapped_key: string | null;
    encryption_key_ref: string;
  };
}

beforeAll(async () => {
  db = await setupRealModules(4);
  kms = localKeyManagement();
  audit = createAuditLog(db.databases.for("audit"));
  spaces = createHouseholdSpaces(db.databases.for("household"), audit, kms);
  keys = createSpaceKeys(db.databases.for("household"), audit, kms);
});

afterAll(async () => {
  await db?.close();
});

describe("sec141 ARC-06 FR 3: the KMS fails partway through the daily rewrap", () => {
  it("spaces after the failure keep their old wrap, nothing is lost, the next run finishes the job", async () => {
    const ids = [await newSpace(), await newSpace(), await newSpace(), await newSpace()];
    const sealed = await Promise.all(ids.map((id) => keys.seal(id, "iban", VALUE)));
    const before = await Promise.all(ids.map(keyRow));
    kms.rotate();
    // The KMS answers two unwraps, then goes down for every call (wrap and unwrap) for the rest of the run.
    let unwraps = 0;
    let down = false;
    const flaky: KeyManagement = {
      currentVersion: () => kms.currentVersion(),
      unwrap: async (w, c) => {
        if (down || ++unwraps > 2) {
          down = true;
          throw new ProviderError("unavailable", "key-management", "unwrap");
        }
        return kms.unwrap(w, c);
      },
      wrap: async (k, c) => {
        if (down) throw new ProviderError("unavailable", "key-management", "wrap");
        return kms.wrap(k, c);
      },
    };
    const flakyKeys = createSpaceKeys(db.databases.for("household"), audit, flaky);
    const result = await flakyKeys.rewrapAll();
    expect(result.failed).toBeGreaterThanOrEqual(1);
    for (const [i, id] of ids.entries()) {
      const row = await keyRow(id);
      // Same key; either the old wrap untouched or a valid new wrap — never a missing or half-written row.
      expect(row.key_id).toBe(before[i]!.key_id);
      expect(row.encryption_key_ref).toBe(`dek:${row.key_id}`);
      expect(await keys.open(id, "iban", sealed[i]!)).toBe(VALUE);
    }
    // The KMS is back: the next run moves the rest, and every value still opens after the old version is retired.
    const again = await keys.rewrapAll();
    expect(again.failed).toBe(0);
    kms.retire(before[0]!.master_key_version!);
    for (const [i, id] of ids.entries()) expect(await keys.open(id, "iban", sealed[i]!)).toBe(VALUE);
  });

  it("an unavailable KMS for currentVersion fails the run without touching any key", async () => {
    const id = await newSpace();
    const before = await keyRow(id);
    const down: KeyManagement = {
      currentVersion: () =>
        Promise.reject(new ProviderError("unavailable", "key-management", "currentVersion")),
      unwrap: () => Promise.reject(new ProviderError("unavailable", "key-management", "unwrap")),
      wrap: () => Promise.reject(new ProviderError("unavailable", "key-management", "wrap")),
    };
    await expect(createSpaceKeys(db.databases.for("household"), audit, down).rewrapAll()).rejects.toThrow(
      ProviderError,
    );
    expect(await keyRow(id)).toEqual(before);
  });
});

describe("sec141 ARC-06 FR 5: destroy", () => {
  it("a wrap copied from another space's row does not unwrap here (KMS binding holds through the table)", async () => {
    const a = await newSpace();
    const b = await newSpace();
    const sealedB = await keys.seal(b, "iban", VALUE);
    const rowA = await keyRow(a);
    await db.owner.query(
      `UPDATE household.space_keys SET wrapped_key = $2, master_key_version = $3 WHERE household_id = $1`,
      [b, rowA.wrapped_key, rowA.master_key_version],
    );
    await expect(keys.open(b, "iban", sealedB)).rejects.toMatchObject({ kind: "rejected" });
    await expect(keys.seal(b, "iban", VALUE)).rejects.toMatchObject({ kind: "rejected" });
    await db.owner.query(`DELETE FROM household.account_spaces WHERE space_id = $1`, [b]);
  });

  // Non-blocking defect: the platform entry is written after the key is gone. If that write fails, the key is
  // destroyed for good with no entry, and a repeat answers { destroyed: false } without ever writing one.
  it("a destruction whose audit write failed is still recorded once destroy is repeated", async () => {
    const id = await newSpace();
    const { key_id: keyId } = await keyRow(id);
    const failingAudit = {
      ...audit,
      recordPlatform: () => Promise.reject(new Error("audit unavailable")),
    };
    const broken = createSpaceKeys(db.databases.for("household"), failingAudit, kms);
    await expect(broken.destroy(id)).rejects.toThrow();
    await keys.destroy(id);
    const entries = await audit.platformEntriesFor({ type: "household.space-key", id: keyId! });
    expect(entries.length).toBeGreaterThanOrEqual(1);
    expect((await keyRow(id)).key_id).toBeNull();
  });

  // Non-blocking defect: destroying a `pending:` space does nothing, so the daily task later gives the erased space
  // a fresh key.
  it("a space destroyed while still `pending:` never gets a key afterwards", async () => {
    const householdId = randomUUID();
    await db.owner.query(
      `INSERT INTO household.households (household_id, name, data_region, encryption_key_ref) VALUES ($1, 'Родина Стара', 'eu', $2)`,
      [householdId, `pending:${householdId}`],
    );
    await db.owner.query(
      `INSERT INTO household.account_spaces (account_id, space_id, role) VALUES ($1, $2, 'owner')`,
      [randomUUID(), householdId],
    );
    await keys.destroy(householdId);
    await keys.rewrapAll();
    const row = await keyRow(householdId);
    expect(row.key_id).toBeNull();
    expect(row.encryption_key_ref.startsWith("destroyed:")).toBe(true);
  });
});
