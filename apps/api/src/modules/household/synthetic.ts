// Synthetic spaces (ARC-03 FR 6) for tests and staging; loaded by tools/synthetic. Never real data.
import { createHash } from "node:crypto";
import { defineSyntheticTable } from "@willowsum/synthetic";

function digest(householdId: string, what: string): Buffer {
  return createHash("sha256").update(`${householdId}/${what}`).digest();
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
          encryption_key_ref: household.encryptionKeyRef,
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
        const h = digest(household.id, "space-key").toString("hex");
        yield {
          household_id: household.id,
          key_id: `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`,
          master_key_version: "synthetic-1",
          wrapped_key: digest(household.id, "wrapped").toString("base64url"),
        };
      }
    },
  }),
];
