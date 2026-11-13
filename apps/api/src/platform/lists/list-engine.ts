import { z } from "zod";
import { Money } from "@willowsum/domain-kernel";
import type { HouseholdQueryRunner } from "../db/module-db.ts";
import { HOUSEHOLD_COLUMN } from "../db/isolation.ts";
import { defineListQuery, type ListQuery, type ListQuerySpec } from "../http/list-query.ts";
import { ApiProblem } from "../http/problem.ts";

/**
 * The query engine of the universal list (DAT-01@PoC FR 1, FR 4–6, FR 9). One engine for every list: a list
 * declares its table, the fields it returns and its whitelists of filters and sorts (`defineListQuery`), and the
 * engine returns one page, the number of matching records and their amounts grouped by currency and date for
 * the totals row (`list-total.ts`). Everything is computed on the server, from the same conditions.
 *
 * Permissions (FR 9, business rule «лише записи в межах прав»): the engine runs inside the caller's household
 * transaction (`ModuleDatabase.inHousehold`), so the database policy limits the rows, the count and the sums to
 * that household (ARC-03); the SQL also filters by `household_id` itself. A total is never computed over records
 * the page could not show.
 *
 * Pagination (FR 6; owner decision 2026-11-12): pages of 25, 50 or 100 records, addressed by number, because the
 * list shows «1–N з M» and returning to the list restores the page (AC1). Order is stable: the whitelisted sort,
 * then the list's unique tie-breaker column.
 *
 * Declaration checked against the table (security review of #129): before its first query a list checks, once, that
 * the tie-breaker is a NOT NULL column with a unique key (alone or with `household_id`, which the list filters on;
 * else paging could skip or repeat records),
 * and that a rate-date column is a NOT NULL `date` (a `timestamptz` would take the session time zone, not the Kyiv
 * day of the NBU rate, and an empty date would be converted at today's rate). A declaration that fails is refused.
 */

/** Page sizes the list offers (FR 6, owner decision 2026-11-12); the first is the default. */
export const LIST_PAGE_SIZES = [25, 50, 100] as const;
export type ListPageSize = (typeof LIST_PAGE_SIZES)[number];
/** Highest page number accepted: far beyond any real list, it keeps OFFSET inside int4. */
export const LIST_MAX_PAGE = 100_000;

const IDENTIFIER_RE = /^[a-z_][a-z0-9_]{0,62}$/;
const FIELD_RE = /^[a-z][A-Za-z0-9]{0,63}$/;
const quote = (identifier: string): string => `"${identifier}"`;

/** Query fields of a list route: the whitelisted `filter` and `sort` plus `page` and `pageSize`. */
export const LIST_PAGE_QUERY = Object.freeze({
  page: z
    .string()
    .regex(/^[1-9][0-9]{0,5}$/)
    .transform(Number)
    .pipe(z.number().int().min(1).max(LIST_MAX_PAGE))
    .optional()
    .meta({ description: "Page number, from 1." }),
  pageSize: z
    .enum(LIST_PAGE_SIZES.map(String) as [string, ...string[]])
    .transform((v) => Number(v) as ListPageSize)
    .optional()
    .meta({ description: `Records per page: ${LIST_PAGE_SIZES.join(", ")}.` }),
});

/** Where the amounts of a list are, for the totals row (FR 4, FR 12). */
export interface ListAmounts {
  readonly amountColumn: string;
  readonly currencyColumn: string;
  /**
   * The date whose rate converts each amount: a NOT NULL `date` column of the record (transactions: the date of
   * each transaction) or `today` (values of assets and liabilities, account balances: the day of display).
   */
  readonly rateDate: { readonly column: string } | "today";
}

export interface ListSpec extends ListQuerySpec {
  /** The list's table in the module's own schema. */
  readonly table: string;
  /** Returned field → column. */
  readonly select: Readonly<Record<string, string>>;
  /**
   * A NOT NULL column with a unique key, alone or with `household_id` (the primary key): it makes the order stable
   * between pages.
   */
  readonly tieBreaker: string;
  readonly amounts?: ListAmounts;
}

export interface ListRequest {
  readonly filter?: string | readonly string[] | undefined;
  readonly sort?: string | undefined;
  readonly page?: number | undefined;
  readonly pageSize?: number | undefined;
}

/** The amounts of matching records in one currency and on one rate date (null: the day of display). */
export interface AmountGroup {
  readonly currency: string;
  readonly date: string | null;
  readonly sum: Money;
  readonly count: number;
}

export interface ListResult {
  readonly items: Record<string, unknown>[];
  readonly page: number;
  readonly pageSize: ListPageSize;
  /** Matching records within the caller's permissions (M of «1–N з M»). */
  readonly count: number;
  /** Positions shown: «from–to з count»; 0–0 on an empty page. */
  readonly from: number;
  readonly to: number;
  /** For the totals row; empty when the list has no amounts. */
  readonly groups: readonly AmountGroup[];
}

export interface List {
  readonly query: ListQuery["query"] & typeof LIST_PAGE_QUERY;
  run(q: HouseholdQueryRunner, request: ListRequest): Promise<ListResult>;
}

function invalid(path: "page" | "pageSize"): never {
  throw new ApiProblem("VALIDATION_FAILED", { errors: [{ in: "query", path, issue: "invalid_value" }] });
}

function pageSizeOf(value: number | undefined): ListPageSize {
  if (value === undefined) return LIST_PAGE_SIZES[0];
  if (!(LIST_PAGE_SIZES as readonly number[]).includes(value)) invalid("pageSize");
  return value as ListPageSize;
}

/** Why the table does not fit the declaration, or null; one catalog read (see the module comment). */
async function schemaProblem(q: HouseholdQueryRunner, spec: ListSpec): Promise<string | null> {
  const dateColumn =
    spec.amounts === undefined || spec.amounts.rateDate === "today" ? null : spec.amounts.rateDate.column;
  const { rows } = await q.query<{ found: boolean; unique_tie: boolean; date_type: string | null }>(
    `SELECT to_regclass($1) IS NOT NULL AS found,
            EXISTS (SELECT 1 FROM pg_catalog.pg_index i
                      CROSS JOIN LATERAL (SELECT array_agg(a.attname::text) AS keys
                                            FROM pg_catalog.pg_attribute a
                                           WHERE a.attrelid = i.indrelid
                                             AND a.attnum = ANY ((i.indkey::int2[])[0:i.indnkeyatts - 1])) k
                     WHERE i.indrelid = to_regclass($1) AND i.indisunique AND i.indpred IS NULL
                       AND i.indexprs IS NULL AND $2::text = ANY (k.keys)
                       AND k.keys <@ ARRAY[$2::text, '${HOUSEHOLD_COLUMN}']
                       AND EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
                                    WHERE a.attrelid = i.indrelid AND a.attname = $2 AND a.attnotnull))
              AS unique_tie,
            (SELECT pg_catalog.format_type(a.atttypid, NULL) || CASE WHEN a.attnotnull THEN ' not null' ELSE '' END
               FROM pg_catalog.pg_attribute a
              WHERE a.attrelid = to_regclass($1) AND a.attname = $3 AND NOT a.attisdropped) AS date_type`,
    [spec.table, spec.tieBreaker, dateColumn ?? ""],
  );
  const row = rows[0];
  if (!row?.found) return `table ${spec.table} not found`;
  if (!row.unique_tie) return `tie-breaker ${spec.tieBreaker} is not a NOT NULL column with a unique key`;
  if (dateColumn !== null && row.date_type !== "date not null")
    return `rate-date column ${dateColumn} is ${row.date_type ?? "missing"}, not a NOT NULL date`;
  return null;
}

function pageOf(value: number | undefined): number {
  if (value === undefined) return 1;
  if (!Number.isSafeInteger(value) || value < 1 || value > LIST_MAX_PAGE) invalid("page");
  return value;
}

export function defineList(spec: ListSpec): List {
  const columns = [
    spec.table,
    spec.tieBreaker,
    ...Object.values(spec.select),
    ...(spec.amounts
      ? [
          spec.amounts.amountColumn,
          spec.amounts.currencyColumn,
          ...(spec.amounts.rateDate === "today" ? [] : [spec.amounts.rateDate.column]),
        ]
      : []),
  ];
  if (!columns.every((c) => IDENTIFIER_RE.test(c)))
    throw new Error("list: the table and every column must be plain identifiers");
  if (!Object.keys(spec.select).every((f) => FIELD_RE.test(f)) || Object.keys(spec.select).length === 0)
    throw new Error("list: returned fields must be plain names");
  const listQuery = defineListQuery(spec);
  const table = quote(spec.table);
  const selectList = Object.entries(spec.select)
    .map(([field, column]) => `${quote(column)} AS ${quote(field)}`)
    .join(", ");
  const amounts = spec.amounts;
  const dateExpr =
    amounts === undefined || amounts.rateDate === "today"
      ? "NULL::text"
      : `to_char(${quote(amounts.rateDate.column)}, 'YYYY-MM-DD')`;

  let checked = false;

  return {
    query: { ...listQuery.query, ...LIST_PAGE_QUERY },
    async run(q, request) {
      const pageSize = pageSizeOf(request.pageSize);
      const page = pageOf(request.page);
      // $1 is the household: the code-side filter next to the database policy.
      const compiled = listQuery.compile({ filter: request.filter, sort: request.sort }, 2);
      if (!checked) {
        const problem = await schemaProblem(q, spec);
        if (problem !== null) throw new Error(`list: ${problem}`);
        checked = true;
      }
      const where = `${quote(HOUSEHOLD_COLUMN)} = $1::uuid AND (${compiled.where})`;
      const params = [q.householdId, ...compiled.params];

      let count: number;
      let groups: AmountGroup[] = [];
      if (amounts) {
        const { rows } = await q.query<{ currency: string; date: string | null; sum: string; count: number }>(
          `SELECT ${quote(amounts.currencyColumn)}::text AS currency, ${dateExpr} AS date,
                  sum(${quote(amounts.amountColumn)})::text AS sum, count(*)::int AS count
             FROM ${table} WHERE ${where} GROUP BY 1, 2 ORDER BY 1, 2`,
          params,
        );
        groups = rows.map((r) => {
          // The column is NOT NULL (checked above); an empty date is never converted at today's rate.
          if (r.date === null && amounts.rateDate !== "today")
            throw new Error("list: a record has no rate date");
          return { currency: r.currency, date: r.date, sum: Money.of(r.sum, r.currency), count: r.count };
        });
        count = groups.reduce((n, g) => n + g.count, 0);
      } else {
        const { rows } = await q.query<{ count: number }>(
          `SELECT count(*)::int AS count FROM ${table} WHERE ${where}`,
          params,
        );
        count = rows[0]?.count ?? 0;
      }

      const offset = (page - 1) * pageSize;
      const limitAt = params.length + 1;
      const { rows: items } = await q.query<Record<string, unknown>>(
        `SELECT ${selectList} FROM ${table} WHERE ${where}
          ORDER BY ${compiled.orderBy}, ${quote(spec.tieBreaker)} ASC
          LIMIT $${limitAt}::int OFFSET $${limitAt + 1}::int`,
        [...params, pageSize, offset],
      );
      return {
        items,
        page,
        pageSize,
        count,
        from: items.length === 0 ? 0 : offset + 1,
        to: items.length === 0 ? 0 : offset + items.length,
        groups,
      };
    },
  };
}
