// Synthetic spaces (ARC-03 FR 6) for tests and staging; loaded by tools/synthetic. Never real data.
import { createHash } from "node:crypto";
import { defineSyntheticTable } from "@willowsum/synthetic";

function digest(householdId: string, what: string): Buffer {
  return createHash("sha256").update(`${householdId}/${what}`).digest();
}

/** The synthetic key id of a space: the same in its record's reference and in its key row. */
function keyIdOf(householdId: string): string {
  const h = digest(householdId, "space-key").toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export const synthetic = [
  defineSyntheticTable({
    table: "household.households",
    perHousehold: 1,
    // A space has one record of its own: its id is the key.
    maxPerHousehold: 1,
    *rows({ household, count }) {
      for (let i = 0; i < count; i++)
        yield {
          household_id: household.id,
          name: household.name,
          data_region: household.dataRegion,
          // ACC-06@PoC FR 1: every space reports in EUR in this release.
          reporting_currency: "EUR",
          // ARC-06 FR 1: the reference names the space's (synthetic) key row below.
          encryption_key_ref: `dek:${keyIdOf(household.id)}`,
        };
    },
  }),
  defineSyntheticTable({
    table: "household.space_keys",
    perHousehold: 1,
    // One key per space (ARC-06 FR 1). The «wrapped key» is random-looking bytes, not a wrap of any key.
    maxPerHousehold: 1,
    *rows({ household, count }) {
      for (let i = 0; i < count; i++) {
        yield {
          household_id: household.id,
          key_id: keyIdOf(household.id),
          master_key_version: "synthetic-1",
          wrapped_key: digest(household.id, "wrapped").toString("base64url"),
        };
      }
    },
  }),
  defineSyntheticTable({
    table: "household.space_key_rotations",
    perHousehold: 1,
    // NFR-01@PoC FR 3: at most one replacement of the space's data key in progress. The «wrap» is random-looking bytes.
    maxPerHousehold: 1,
    *rows({ household, count }) {
      for (let i = 0; i < count; i++) {
        const h = digest(household.id, "rotation").toString("hex");
        yield {
          household_id: household.id,
          old_key_id: keyIdOf(household.id),
          new_key_id: `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`,
          new_master_key_version: "synthetic-1",
          new_wrapped_key: digest(household.id, "rotation-wrapped").toString("base64url"),
        };
      }
    },
  }),
];
