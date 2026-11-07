import { ApiProblem } from "./problem.ts";

/**
 * Technical limits against abuse that do not depend on the plan (NFR-15 FR 17; ADR-0007). Exceeding one is
 * 422 LIMIT_REACHED with the limit; plan limits are a different thing (402 PLAN_LIMIT_REACHED, plan-catalog)
 * and never live here. The modules that own drafts, saved views and bulk actions check their own limit with
 * `requireWithinLimit`; filters per request are checked by `defineListQuery`.
 *
 * Page sizes are not here: the page bound is the pagination's own (`PAGE_MAX_LIMIT`, pagination.ts) until
 * the owner settles the allowed sizes (open question of ADR-0007).
 */
export const TECHNICAL_LIMITS = Object.freeze({
  /** Filters in one list request. */
  filtersPerRequest: 50,
  /** Assets in one bulk action. */
  bulkItems: 500,
  /** Size of one draft, bytes (100 KB). */
  draftBytes: 100 * 1024,
  /** Drafts per user in a space. */
  draftsPerUser: 20,
  /** Saved views per user per list. */
  savedViewsPerList: 50,
});

/** Request bodies of the API: at most 1 MiB (Fastify's own limit made explicit); a route may set less. */
export const API_BODY_LIMIT_BYTES = 1024 * 1024;

/** Throws 422 LIMIT_REACHED when `count` is above `limit`. */
export function requireWithinLimit(count: number, limit: number): void {
  if (count > limit) throw new ApiProblem("LIMIT_REACHED", { extensions: { limit } });
}
