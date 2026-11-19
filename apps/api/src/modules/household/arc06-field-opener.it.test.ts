import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupRealModules, type RealModulesDatabase } from "../../../test/real-modules.ts";
import { localKeyManagement } from "../../platform/adapters/kms/index.ts";
import { createAuditLog } from "../audit/index.ts";
import {
  createHouseholdSpaces,
  createSpaceKeys,
  openWithFieldOpener,
  SpaceKeyError,
  wipeFieldOpener,
  type FieldOpener,
  type HouseholdSpaces,
  type SpaceKeys,
} from "./index.ts";

/**
 * ARC-06@PoC FR 2 (wave 2 row 41 part 3; #618, its second item): the opener of one sealed field, for the isolated parse worker,
 * so a sealed value is opened there and never in the API thread. It opens only its own space's and field's values;
 * a wrong, wiped or moved key fails closed. Values are synthetic.
 */
let db: RealModulesDatabase;
let spaces: HouseholdSpaces;
let keys: SpaceKeys;

const FIELD = "importRecipes.accountValue";
const VALUE = ["UA", "00", "000000", "0000000", "123456", "987654"].join("");

async function newSpace(): Promise<string> {
  return (await spaces.ensureFirstSpace({ accountId: randomUUID(), displayName: "Олена Відкривачка" }))
    .householdId;
}

function refusal(open: () => unknown): string {
  try {
    open();
  } catch (error) {
    expect(error).toBeInstanceOf(SpaceKeyError);
    expect(String((error as Error).message)).not.toContain(VALUE.slice(4));
    return (error as SpaceKeyError).code;
  }
  throw new Error("opened");
}

beforeAll(async () => {
  db = await setupRealModules(4);
  const kms = localKeyManagement();
  const audit = createAuditLog(db.databases.for("audit"));
  spaces = createHouseholdSpaces(db.databases.for("household"), audit, kms);
  keys = createSpaceKeys(db.databases.for("household"), audit, kms);
});

afterAll(async () => {
  await db?.close();
});

describe("ARC-06@PoC FR 2: a field opener lets the isolated worker open its space's sealed field", () => {
  it("ARC-06@PoC FR 2: the opener opens the value sealed for its space and field; it is plain data with its own key", async () => {
    const space = await newSpace();
    const sealed = await keys.seal(space, FIELD, VALUE);
    const opener = await keys.fieldOpener(space, FIELD);
    expect(Object.keys(opener).sort()).toEqual(["field", "householdId", "key"]);
    expect(opener.key.byteLength).toBe(32);
    expect(structuredClone(opener).key.byteLength).toBe(32);
    expect(openWithFieldOpener(opener, sealed)).toBe(VALUE);
    // Its key is a copy of its own: wiping it leaves the space's key whole.
    wipeFieldOpener(opener);
    expect(new Uint8Array(opener.key).every((b) => b === 0)).toBe(true);
    expect(await keys.open(space, FIELD, sealed)).toBe(VALUE);
  });

  it("ARC-06@PoC FR 2: another space's value, another field's value or a changed value is SEALED_VALUE_INVALID", async () => {
    const mine = await newSpace();
    const other = await newSpace();
    const opener = await keys.fieldOpener(mine, FIELD);
    const ofOther = await keys.seal(other, FIELD, VALUE);
    const ofOtherField = await keys.seal(mine, "accounts.iban", VALUE);
    expect(refusal(() => openWithFieldOpener(opener, ofOther))).toBe("SEALED_VALUE_INVALID");
    expect(refusal(() => openWithFieldOpener(opener, ofOtherField))).toBe("SEALED_VALUE_INVALID");
    const sealed = await keys.seal(mine, FIELD, VALUE);
    const changed = sealed.slice(0, -2) + (sealed.endsWith("AA") ? "AB" : "AA");
    expect(refusal(() => openWithFieldOpener(opener, changed))).toBe("SEALED_VALUE_INVALID");
    // The opener names its space and field: a forged pair over the same key is refused, not trusted.
    const forged: FieldOpener = { ...opener, householdId: other };
    expect(refusal(() => openWithFieldOpener(forged, sealed))).toBe("SEALED_VALUE_INVALID");
    expect(openWithFieldOpener(opener, sealed)).toBe(VALUE);
  });

  it("ARC-06@PoC FR 2: a wrong, wiped, moved or malformed key fails closed", async () => {
    const space = await newSpace();
    const sealed = await keys.seal(space, FIELD, VALUE);
    const wrong = await keys.fieldOpener(await newSpace(), FIELD);
    expect(refusal(() => openWithFieldOpener({ ...wrong, householdId: space }, sealed))).toBe(
      "SEALED_VALUE_INVALID",
    );
    const wiped = await keys.fieldOpener(space, FIELD);
    wipeFieldOpener(wiped);
    expect(refusal(() => openWithFieldOpener(wiped, sealed))).toBe("SEALED_VALUE_INVALID");
    const moved = await keys.fieldOpener(space, FIELD);
    structuredClone(moved, { transfer: [moved.key] });
    expect(moved.key.byteLength).toBe(0);
    expect(refusal(() => openWithFieldOpener(moved, sealed))).toBe("SEALED_VALUE_INVALID");
    const short = { householdId: space, field: FIELD, key: new ArrayBuffer(16) };
    expect(refusal(() => openWithFieldOpener(short, sealed))).toBe("SEALED_VALUE_INVALID");
    for (const bad of [null, {}, { householdId: space, field: FIELD, key: new Uint8Array(32) }])
      expect(refusal(() => openWithFieldOpener(bad as unknown as FieldOpener, sealed))).toBe(
        "SEALED_VALUE_INVALID",
      );
  });

  it("ARC-06@PoC FR 5: a destroyed key gives no opener", async () => {
    const space = await newSpace();
    await keys.destroy(space);
    await expect(keys.fieldOpener(space, FIELD)).rejects.toMatchObject({ code: "SPACE_KEY_DESTROYED" });
  });
});
