// Synthetic import batches (ARC-03 FR 6) for tests and staging; loaded by tools/synthetic. Never real data. Each space
// gets open batches; the first one holds an accepted file (an opaque file-storage id) and rejected ones by code. Their
// audit hand-off jobs are done; the module publishes no events: outbox_events gets one dispatched row for the
// isolation check.
import { createHash } from "node:crypto";
import { defineSyntheticTable } from "@willowsum/synthetic";

function key(householdId: string, table: string, n: number): string {
  const h = createHash("sha256").update(`${householdId}/import-sessions/${table}/${n}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export const synthetic = [
  defineSyntheticTable({
    table: "import_sessions.batches",
    perHousehold: 1,
    *rows({ household, count }) {
      for (let i = 0; i < count; i++)
        yield {
          household_id: household.id,
          id: key(household.id, "batch", i),
          name: i === 0 ? "Виписки за жовтень" : null,
          state: "uploaded",
          created_by: key(household.id, "account", 0),
          version: "1",
          created_at: "2026-10-15T10:00:00Z",
          last_action_at: "2026-10-15T10:00:00Z",
        };
    },
  }),
  defineSyntheticTable({
    table: "import_sessions.batch_files",
    perHousehold: 1,
    *rows({ household, count }) {
      for (let i = 0; i < count; i++)
        yield {
          household_id: household.id,
          id: key(household.id, "file", i),
          batch_id: key(household.id, "batch", 0),
          position: String(i + 1),
          file_name: i === 0 ? "vypyska-zhovten.csv" : `statement-${i}.xlsm`,
          file_id: i === 0 ? key(household.id, "original", i) : null,
          format: i === 0 ? "csv" : null,
          size_bytes: i === 0 ? "48213" : null,
          rejection_code: i === 0 ? null : "UNSUPPORTED_FORMAT",
          content_sha256:
            i === 0 ? createHash("sha256").update(`${household.id}/original/${i}`).digest("hex") : null,
        };
    },
  }),
  // IMP-05 part 2: the checks of the batch's files (masked values only) and a decision per row.
  defineSyntheticTable({
    table: "import_sessions.file_checks",
    perHousehold: 1,
    *rows({ household, count }) {
      for (let i = 0; i < count; i++)
        yield {
          household_id: household.id,
          batch_file_id: key(household.id, "file", i),
          batch_id: key(household.id, "batch", 0),
          account_id: key(household.id, "account-ref", 0),
          account_currency: "UAH",
          checks: JSON.stringify({
            currency: "UAH",
            bounds: {
              start: "2026-10-01",
              end: "2026-10-31",
              opening: "1000.00",
              closing: "1450.00",
              currency: "UAH",
            },
            account: { status: "mismatch", reasons: [{ kind: "iban", file: "…4821", account: "…1190" }] },
            flags: [{ code: "foreign-account", severity: "block" }],
          }),
          history: JSON.stringify({ status: "unknown", range: null }),
          recorded_at: "2026-10-15T10:00:00Z",
        };
    },
  }),
  defineSyntheticTable({
    table: "import_sessions.decisions",
    perHousehold: 1,
    *rows({ household, count }) {
      for (let i = 0; i < count; i++)
        yield {
          household_id: household.id,
          batch_id: key(household.id, "batch", 0),
          slot: `row:${key(household.id, "file", 0)}:${i + 1}`,
          batch_file_id: key(household.id, "file", 0),
          decision: JSON.stringify({
            kind: "row",
            fileId: key(household.id, "file", 0),
            row: i + 1,
            action: "accept",
          }),
          decided_by: key(household.id, "account", 0),
          decided_at: "2026-10-15T10:00:00Z",
        };
    },
  }),
  // IMP-04 a: the stored result of applying a batch (counts only).
  defineSyntheticTable({
    table: "import_sessions.batch_applications",
    perHousehold: 1,
    *rows({ household, count }) {
      for (let i = 0; i < count; i++)
        yield {
          household_id: household.id,
          batch_id: key(household.id, "batch", i),
          result: JSON.stringify({ counts: { import: 2, duplicate: 1 } }),
          applied_by: key(household.id, "account", 0),
          applied_at: "2026-10-15T10:00:00Z",
        };
    },
  }),
  defineSyntheticTable({
    table: "import_sessions.idempotency_keys",
    perHousehold: 1,
    *rows({ household, rng, count }) {
      for (let i = 0; i < count; i++)
        yield {
          household_id: household.id,
          key: rng.uuid(),
          request_hash: "0".repeat(64),
          state: "pending",
          response_status: null,
          response_body: null,
          expires_at: "2026-12-31T00:00:00Z",
        };
    },
  }),
  defineSyntheticTable({
    table: "import_sessions.jobs",
    perHousehold: 1,
    *rows({ household, rng, count }) {
      for (let i = 0; i < count; i++)
        yield {
          id: rng.uuid(),
          household_id: household.id,
          name: "import-sessions.hand-off",
          dedupe_key: `import-sessions.batch:create:${key(household.id, "batch", i)}:${rng.uuid()}`,
          payload: "{}",
          state: "done",
          attempts: "1",
          finished_at: "2026-10-15T10:00:00Z",
        };
    },
  }),
  defineSyntheticTable({
    table: "import_sessions.outbox_events",
    perHousehold: 1,
    *rows({ household, rng, count }) {
      for (let i = 0; i < count; i++)
        yield {
          id: rng.uuid(),
          household_id: household.id,
          event_name: "import-sessions.synthetic-event",
          event_version: "1",
          payload: "{}",
          dispatched_at: "2026-10-15T10:00:00Z",
        };
    },
  }),
];
