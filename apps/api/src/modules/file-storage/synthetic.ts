// Synthetic stored files (ARC-03 FR 6) for tests and staging; loaded by tools/synthetic. Never real data. Each space
// gets the rows of two statement originals; their objects (ciphertext in the S3-compatible storage) are not part of the
// database and are not generated here.
import { defineSyntheticTable } from "@willowsum/synthetic";

const FILES = [
  { name: "vypyska-zhovten.csv", format: "csv", type: "text/csv", size: "48213" },
  {
    name: "statement-october.xlsx",
    format: "xlsx",
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    size: "91877",
  },
] as const;

export const synthetic = [
  defineSyntheticTable({
    table: "file_storage.files",
    perHousehold: FILES.length,
    *rows({ household, rng, count }) {
      for (let i = 0; i < count; i++) {
        const file = FILES[i % FILES.length]!;
        const id = rng.uuid();
        yield {
          household_id: household.id,
          id,
          kind: "statement",
          format: file.format,
          content_type: file.type,
          file_name: file.name,
          size_bytes: file.size,
          sha256: `\\x${[...Array(32)].map(() => rng.int(0, 255).toString(16).padStart(2, "0")).join("")}`,
          object_key: `spaces/${household.id}/files/${id}`,
        };
      }
    },
  }),
];
