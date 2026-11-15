import { describe, expect, it } from "vitest";
import { AUDIT_MASK, auditEntryInput, maskChanges } from "./entry.ts";

const entity = { type: "accounts.account", id: "8a6f4f6e-4f7d-4c1e-9a77-1f0a5c3f2b10" };
const base = {
  actor: { kind: "user", id: "1d1f8a52-0a4e-4b8d-8f1e-0c6c7f6a9b21" },
  channel: "web",
  entity,
  action: "update",
  changes: [{ field: "name", before: "Old", after: "New", sensitive: false }],
} as const;

describe("ARC-03 FR 5 / П-10: an audit entry holds no personal data beyond masked fields", () => {
  it("sensitive values are replaced by the mask before storage; null stays null", () => {
    expect(
      maskChanges([
        { field: "iban", before: "UA213223130000026007233566001", after: null, sensitive: true },
        { field: "name", before: "Old", after: "New", sensitive: false },
      ]),
    ).toEqual([
      { field: "iban", before: AUDIT_MASK, after: null, masked: true },
      { field: "name", before: "Old", after: "New", masked: false },
    ]);
  });

  it("every change must state whether it is sensitive", () => {
    const missing = { ...base, changes: [{ field: "name", before: "a", after: "b" }] };
    expect(auditEntryInput.safeParse(missing).success).toBe(false);
    expect(auditEntryInput.safeParse(base).success).toBe(true);
  });

  it("actors are opaque ids, not names or emails; unknown fields are refused", () => {
    expect(
      auditEntryInput.safeParse({ ...base, actor: { kind: "user", id: "anna@example.com" } }).success,
    ).toBe(false);
    expect(
      auditEntryInput.safeParse({ ...base, actor: { kind: "user", id: base.actor.id, email: "a@b.c" } })
        .success,
    ).toBe(false);
    expect(auditEntryInput.safeParse({ ...base, note: "free text" }).success).toBe(false);
    expect(auditEntryInput.safeParse({ ...base, actor: { kind: "system" } }).success).toBe(true);
  });

  it("channel and action come from the fixed lists of П-10", () => {
    expect(auditEntryInput.safeParse({ ...base, channel: "email" }).success).toBe(false);
    expect(auditEntryInput.safeParse({ ...base, action: "rename" }).success).toBe(false);
  });
});

describe("DAT-03@PoC FR 11: a group entry lists its records", () => {
  const record = "5b0c1d2e-3f4a-4b5c-8d6e-7f8091a2b3c4";
  const change = (r?: string) => ({
    ...(r ? { record: r } : {}),
    field: "label",
    before: "a",
    after: "b",
    sensitive: true,
  });

  it("DAT-03@PoC FR 11: up to 500 records × 4 fields, each change with its record's id, masked like any other", () => {
    const parsed = auditEntryInput.parse({
      ...base,
      changes: Array.from({ length: 2000 }, () => change(record)),
    });
    expect(maskChanges(parsed.changes)[0]).toEqual({
      record,
      field: "label",
      before: AUDIT_MASK,
      after: AUDIT_MASK,
      masked: true,
    });
    expect(auditEntryInput.safeParse({ ...base, changes: [change("not-a-uuid")] }).success).toBe(false);
  });

  it("DAT-03@PoC FR 11: changes of the entry's own entity stay at most 200", () => {
    expect(
      auditEntryInput.safeParse({ ...base, changes: Array.from({ length: 201 }, () => change()) }).success,
    ).toBe(false);
  });
});
