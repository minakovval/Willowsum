/**
 * «Історія змін» of a transaction (FIN-03@PoC FR 27, from the menu «…» of the details S-047): what the space's own audit
 * log has recorded about it (FR 20, П-10), never reconstructed from the row. Two entities of the log name a transaction
 * by its id: the transaction itself (`transactions.transaction`, written by the hand-off: create, edit, split, hide and
 * show, transfer, merge, «Не дубль», note and tags, «До розбору») and its category (`categorization.transaction-category`,
 * module categorization: by hand and by a rule).
 *
 * What the reader gets is only what the details show anyway: when, who — relative to the reader («you», another member,
 * staff or the system; never an account id), the channel, the action and each field before and after. A masked field
 * (counterparty, description, note: free text that may name a person) is masked again here, whatever was stored, so
 * its text never leaves the log; a change of a group entry (`record`: another record of a bulk action) is not this
 * transaction's and is dropped.
 */

/** The entity types of the log that name a transaction by its id. */
export const HISTORY_ENTITIES = ["transactions.transaction", "categorization.transaction-category"] as const;

/** The mask of a masked value (the audit module's `AUDIT_MASK`, by value: domain code imports no module). */
export const HISTORY_MASK = "•••";

/** An entry of the log as the audit module returns it (`AuditEntry`, by shape). */
export interface LoggedEntry {
  readonly id: string;
  readonly occurredAt: string;
  readonly actorKind: "user" | "staff" | "system";
  readonly actorId: string | null;
  readonly channel: string;
  readonly action: string;
  readonly changes: readonly {
    readonly record?: string;
    readonly field: string;
    readonly before: string | null;
    readonly after: string | null;
    readonly masked: boolean;
  }[];
}

export type HistoryActor = "you" | "member" | "staff" | "system";

export interface HistoryChange {
  readonly field: string;
  readonly before: string | null;
  readonly after: string | null;
  readonly masked: boolean;
}

export interface HistoryEntry {
  readonly id: string;
  /** UTC, ISO 8601. */
  readonly occurredAt: string;
  readonly actor: HistoryActor;
  readonly channel: string;
  readonly action: "create" | "update" | "delete";
  readonly changes: readonly HistoryChange[];
}

const ACTIONS: ReadonlySet<string> = new Set(["create", "update", "delete"]);

function actorOf(entry: LoggedEntry, readerId: string): HistoryActor {
  if (entry.actorKind === "system") return "system";
  if (entry.actorKind === "staff") return "staff";
  return entry.actorId === readerId ? "you" : "member";
}

/**
 * By time (ISO 8601 UTC strings compare as times). The sort is stable: entries of one time keep the order they come
 * in — the log's own order of each entity (its time to the microsecond, then id), which the milliseconds here lose.
 */
const byTime = (a: LoggedEntry, b: LoggedEntry) =>
  a.occurredAt < b.occurredAt ? -1 : a.occurredAt > b.occurredAt ? 1 : 0;

const mask = (v: string | null) => (v === null ? null : HISTORY_MASK);

/**
 * The history from the log's entries of the transaction (any of `HISTORY_ENTITIES`, each entity's in the log's order),
 * oldest first. An update left with no change of its own (a group entry's) is dropped.
 */
export function transactionHistory(entries: readonly LoggedEntry[], readerId: string): HistoryEntry[] {
  return [...entries]
    .sort(byTime)
    .filter((e) => ACTIONS.has(e.action))
    .map((e) => ({
      id: e.id,
      occurredAt: e.occurredAt,
      actor: actorOf(e, readerId),
      channel: e.channel,
      action: e.action as HistoryEntry["action"],
      changes: e.changes
        .filter((c) => c.record === undefined)
        .map((c) =>
          c.masked
            ? { field: c.field, before: mask(c.before), after: mask(c.after), masked: true }
            : { field: c.field, before: c.before, after: c.after, masked: false },
        ),
    }))
    .filter((e) => e.changes.length > 0 || e.action !== "update");
}
