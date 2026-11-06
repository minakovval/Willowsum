import { z } from "zod";

/**
 * An audit entry (ARC-03 FR 5, П-10): who (actor), when (UTC, set by the database), which entity, which
 * fields, values before and after, channel. Values of sensitive fields never reach the log: they are
 * replaced by a mask here, before storage. Every change states `sensitive` explicitly, so a caller cannot
 * forget to decide. Identifiers are opaque UUIDs; no names, emails or free text about people.
 */
export const AUDIT_MASK = "•••";

const uuid = z.uuid();
const value = z.string().max(1000).nullable();

export const auditEntryInput = z
  .object({
    actor: z.discriminatedUnion("kind", [
      z.object({ kind: z.enum(["user", "staff"]), id: uuid }).strict(),
      z.object({ kind: z.literal("system") }).strict(),
    ]),
    channel: z.enum(["web", "api", "import", "system"]),
    entity: z.object({ type: z.string().regex(/^[a-z][a-z0-9_.-]{0,62}$/), id: uuid }).strict(),
    action: z.enum(["create", "update", "delete"]),
    changes: z
      .array(
        z
          .object({
            field: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_.]{0,62}$/),
            before: value,
            after: value,
            sensitive: z.boolean(),
          })
          .strict(),
      )
      .max(200),
  })
  .strict();

export type AuditEntryInput = z.infer<typeof auditEntryInput>;

/**
 * An entry of the platform log: a change that belongs to no household (feature flags, kill switches; staff
 * actions later). Made by staff or the system, never by a household's user.
 */
export const platformEntryInput = auditEntryInput.refine((e) => e.actor.kind !== "user", {
  message: "platform changes are made by staff or the system",
  path: ["actor"],
});

export type PlatformEntryInput = z.infer<typeof platformEntryInput>;
export type AuditChange = AuditEntryInput["changes"][number];

/** What is stored for one changed field. */
export interface StoredChange {
  readonly field: string;
  readonly before: string | null;
  readonly after: string | null;
  readonly masked: boolean;
}

export function maskChanges(changes: readonly AuditChange[]): StoredChange[] {
  return changes.map((c) => ({
    field: c.field,
    before: c.sensitive && c.before !== null ? AUDIT_MASK : c.before,
    after: c.sensitive && c.after !== null ? AUDIT_MASK : c.after,
    masked: c.sensitive,
  }));
}
