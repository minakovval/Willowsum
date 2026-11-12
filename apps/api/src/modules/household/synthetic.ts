// Synthetic spaces (ARC-03 FR 6) for tests and staging; loaded by tools/synthetic. Never real data.
import { defineSyntheticTable } from "@willowsum/synthetic";

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
];
