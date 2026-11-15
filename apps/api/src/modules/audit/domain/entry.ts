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
/** Changes of one group entry: 500 records × 4 fields, and the entry's own fields. */
export const GROUP_CHANGES_MAX = 2200;

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
            /**
             * A group entry (DAT-03 FR 11: a bulk action, an import): the record of the entity's list this change
             * belongs to. Absent for a change of the entry's own entity.
             */
            record: uuid.optional(),
            field: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_.]{0,62}$/),
            before: value,
            after: value,
            sensitive: z.boolean(),
          })
          .strict(),
      )
      // A group entry lists up to 500 records (NFR-15 FR 17) with up to 4 fields each; at most 200 of its own fields.
      .max(GROUP_CHANGES_MAX)
      .refine((changes) => changes.filter((c) => c.record === undefined).length <= 200, {
        message: "at most 200 changes of the entry's own entity",
      }),
    /**
     * ARC-04 FR 3: the entry is appended once per key in the space — a hand-off that runs again (a job's retry)
     * appends nothing more. A code (`<module>.<what>:<id>`), never free text.
     */
    key: z
      .string()
      .regex(/^[A-Za-z0-9:._-]{1,200}$/)
      .optional(),
  })
  .strict();

export type AuditEntryInput = z.infer<typeof auditEntryInput>;

/**
 * An entry of the platform log: a change that belongs to no household (feature flags, kill switches; staff
 * actions later). Made by staff or the system, never by a household's user.
 */
export const platformEntryInput = auditEntryInput
  .refine((e) => e.actor.kind !== "user", {
    message: "platform changes are made by staff or the system",
    path: ["actor"],
  })
  .refine((e) => e.key === undefined, { message: "the platform log has no keys", path: ["key"] });

export type PlatformEntryInput = z.infer<typeof platformEntryInput>;
export type AuditChange = AuditEntryInput["changes"][number];

/** What is stored for one changed field. */
export interface StoredChange {
  /** The record of a group entry the change belongs to (absent for the entry's own entity). */
  readonly record?: string;
  readonly field: string;
  readonly before: string | null;
  readonly after: string | null;
  readonly masked: boolean;
}

export function maskChanges(changes: readonly AuditChange[]): StoredChange[] {
  return changes.map((c) => ({
    ...(c.record !== undefined ? { record: c.record } : {}),
    field: c.field,
    before: c.sensitive && c.before !== null ? AUDIT_MASK : c.before,
    after: c.sensitive && c.after !== null ? AUDIT_MASK : c.after,
    masked: c.sensitive,
  }));
}
