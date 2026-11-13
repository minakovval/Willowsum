/**
 * Erasure requests (NFR-12@PoC FR 3; ADR-0013). A request is recorded in the erasure log when the product owner
 * accepts it; it must be done within 30 days. Its state comes from the log alone (the log outlives the database).
 */
export const ERASURE_DEADLINE_DAYS = 30;
const DAY_MS = 86_400_000;

export function erasureDueAt(requestedAt: number): number {
  return requestedAt + ERASURE_DEADLINE_DAYS * DAY_MS;
}

/** The log records this domain reads (the port's shape, kept here without its validation). */
export type ErasureRecord =
  | {
      readonly kind: "requested";
      readonly requestId: string;
      readonly accountId: string;
      readonly householdIds: readonly string[];
      readonly at: string;
      readonly dueAt: string;
    }
  | {
      readonly kind: "completed";
      readonly requestId: string;
      readonly accountId: string;
      readonly householdIds: readonly string[];
      readonly at: string;
    };

export interface RequestState {
  readonly requestId: string;
  readonly accountId: string;
  readonly householdIds: readonly string[];
  readonly requestedAt: string;
  readonly dueAt: string;
  readonly state: "pending" | "completed";
  /** The latest completion (a re-application after a restore adds another). */
  readonly completedAt: string | null;
  /** Pending past its deadline. */
  readonly overdue: boolean;
  /** Whole days until the deadline (0 once it has passed or on its last day). */
  readonly daysLeft: number;
}

/** Each request in the order it was made, with its state at `now`. */
export function requestStates(records: readonly ErasureRecord[], now: number): RequestState[] {
  const out = new Map<string, RequestState>();
  for (const record of records) {
    if (record.kind === "requested") {
      if (out.has(record.requestId)) continue;
      out.set(record.requestId, {
        requestId: record.requestId,
        accountId: record.accountId,
        householdIds: record.householdIds,
        requestedAt: record.at,
        dueAt: record.dueAt,
        state: "pending",
        completedAt: null,
        overdue: false,
        daysLeft: 0,
      });
    } else {
      const known = out.get(record.requestId);
      if (known)
        out.set(record.requestId, {
          ...known,
          householdIds: [...new Set([...known.householdIds, ...record.householdIds])],
          state: "completed",
          completedAt: record.at,
        });
    }
  }
  return [...out.values()].map((r) => {
    const due = Date.parse(r.dueAt);
    const pending = r.state === "pending";
    return {
      ...r,
      overdue: pending && now > due,
      daysLeft: pending ? Math.max(0, Math.floor((due - now) / DAY_MS)) : 0,
    };
  });
}
