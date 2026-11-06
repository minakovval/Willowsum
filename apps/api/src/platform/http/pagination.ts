import { z } from "zod";
import { ApiProblem } from "./problem.ts";

/**
 * Server-side pagination of every list (ARC-07 FR 4): keyset cursor + limit. The cursor is opaque to
 * clients (base64url JSON of the last item's sort key); the server never returns more than PAGE_MAX_LIMIT
 * items per page. Row policies still scope every page to the caller's household.
 */
export const PAGE_DEFAULT_LIMIT = 25;
export const PAGE_MAX_LIMIT = 100;
const CURSOR_MAX_LENGTH = 512;

export const pageQuery = z.object({
  cursor: z
    .string()
    .min(1)
    .max(CURSOR_MAX_LENGTH)
    .regex(/^[A-Za-z0-9_-]+$/)
    .optional()
    .meta({ description: "Opaque cursor from `nextCursor` of the previous page." }),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(PAGE_MAX_LIMIT)
    .default(PAGE_DEFAULT_LIMIT)
    .meta({ description: `Items per page, 1–${PAGE_MAX_LIMIT}.` }),
});

export function pageOf<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    nextCursor: z
      .string()
      .nullable()
      .meta({ description: "Cursor of the next page; null on the last page." }),
  });
}

export function encodeCursor(position: Readonly<Record<string, string | number>>): string {
  return Buffer.from(JSON.stringify(position), "utf8").toString("base64url");
}

/** Reads a cursor back; anything that is not a cursor of this list is INVALID_CURSOR (400). */
export function decodeCursor<T extends z.ZodType>(cursor: string, position: T): z.output<T> {
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw new ApiProblem("INVALID_CURSOR");
  }
  const parsed = position.safeParse(raw);
  if (!parsed.success) throw new ApiProblem("INVALID_CURSOR");
  return parsed.data;
}

/**
 * Builds a page from rows fetched with `limit + 1`: the extra row only tells that a next page exists.
 */
export function toPage<R, I>(
  rows: readonly R[],
  limit: number,
  item: (row: R) => I,
  position: (row: R) => Readonly<Record<string, string | number>>,
): { items: I[]; nextCursor: string | null } {
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map(item),
    nextCursor: rows.length > limit && last !== undefined ? encodeCursor(position(last)) : null,
  };
}
