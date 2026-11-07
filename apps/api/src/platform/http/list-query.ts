import { z } from "zod";
import { TECHNICAL_LIMITS, requireWithinLimit } from "./limits.ts";
import { ApiProblem } from "./problem.ts";

/**
 * Filters and sorting of list routes from a whitelist (NFR-15 FR 15, FR 17; ADR-0007). A route declares the
 * fields a client may filter and sort by, each with its column, its PostgreSQL type and a zod schema for
 * its value. A request names fields only by those names; every value is parsed by the field's schema and
 * goes into the SQL as a parameter with an explicit cast (`$3::date`), never as text of the query. Column
 * names come only from the declaration. A small primitive: the list conventions of DAT-01 build on it.
 *
 * On the wire: `filter=<field>.<operator>:<value>` (repeatable; `in` takes values separated by commas) and
 * `sort=<field>` or `sort=-<field>` (descending), several keys separated by commas.
 */
export const FILTER_OPERATORS = ["eq", "ne", "lt", "lte", "gt", "gte", "in"] as const;
export type FilterOperator = (typeof FILTER_OPERATORS)[number];

/** The PostgreSQL types a value may be cast to. */
export const FILTER_CASTS = ["text", "uuid", "integer", "numeric", "date", "timestamptz", "boolean"] as const;
export type FilterCast = (typeof FILTER_CASTS)[number];

const SQL_OPERATORS: Readonly<Record<Exclude<FilterOperator, "in">, string>> = {
  eq: "=",
  ne: "<>",
  lt: "<",
  lte: "<=",
  gt: ">",
  gte: ">=",
};

const IDENTIFIER_RE = /^[a-z_][a-z0-9_]{0,62}$/;
const FIELD_RE = /^[a-z][A-Za-z0-9]{0,63}$/;
/** One filter of the request: a field, an operator and the value text. */
const FILTER_RE = /^([a-z][A-Za-z0-9]{0,63})\.([a-z]{2,3}):([\s\S]*)$/;
const MAX_SORT_KEYS = 3;
const MAX_FILTER_TEXT = 1024;

export interface FilterField {
  readonly column: string;
  readonly cast: FilterCast;
  /** Parses one value (from text): `z.coerce.number().int()`, `z.uuid()`, `z.enum([...])`, `z.iso.date()` … */
  readonly value: z.ZodType<string | number | boolean>;
  readonly operators: readonly FilterOperator[];
}

export interface ListQuerySpec {
  readonly filters: Readonly<Record<string, FilterField>>;
  /** Sortable field → column. */
  readonly sorts: Readonly<Record<string, string>>;
  readonly defaultSort: { readonly field: string; readonly direction: "asc" | "desc" };
}

export interface CompiledListQuery {
  /** `TRUE` or conditions joined by AND; placeholders from `firstParam` on. */
  readonly where: string;
  readonly params: readonly unknown[];
  /** `"col" ASC, "col2" DESC` (no `ORDER BY`). */
  readonly orderBy: string;
}

export interface ListQuery {
  /** The query fields to spread into the route's `request.query` (next to `pageQuery`). */
  readonly query: typeof LIST_QUERY_FIELDS;
  compile(
    input: { readonly filter?: string | readonly string[] | undefined; readonly sort?: string | undefined },
    firstParam: number,
  ): CompiledListQuery;
}

const quote = (identifier: string): string => `"${identifier}"`;

const LIST_QUERY_FIELDS = Object.freeze({
  filter: z
    .union([z.string().max(MAX_FILTER_TEXT), z.array(z.string().max(MAX_FILTER_TEXT))])
    .optional()
    .meta({
      description:
        "Filter `<field>.<operator>:<value>` (repeatable); fields and operators from the list's whitelist",
    }),
  sort: z.string().max(256).optional().meta({
    description: "Sort keys `field` or `-field` (descending), separated by commas; from the list's whitelist",
  }),
});

function invalid(path: "filter" | "sort", issue: string): never {
  // The field name or value the client sent is never echoed: only where and what kind of problem.
  throw new ApiProblem("VALIDATION_FAILED", { errors: [{ in: "query", path, issue }] });
}

export function defineListQuery(spec: ListQuerySpec): ListQuery {
  for (const [field, f] of Object.entries(spec.filters)) {
    if (!FIELD_RE.test(field) || !IDENTIFIER_RE.test(f.column) || !FILTER_CASTS.includes(f.cast))
      throw new Error(`list query: filter ${field} has an invalid name, column or cast`);
    if (f.operators.length === 0 || !f.operators.every((o) => FILTER_OPERATORS.includes(o)))
      throw new Error(`list query: filter ${field} has invalid operators`);
  }
  for (const [field, column] of Object.entries(spec.sorts))
    if (!FIELD_RE.test(field) || !IDENTIFIER_RE.test(column))
      throw new Error(`list query: sort ${field} has an invalid name or column`);
  if (!Object.hasOwn(spec.sorts, spec.defaultSort.field))
    throw new Error("list query: default sort is not sortable");
  const filters = new Map(Object.entries(spec.filters));
  const sorts = new Map(Object.entries(spec.sorts));

  const parseValue = (field: FilterField, text: string): string | number | boolean => {
    const parsed = field.value.safeParse(text);
    if (!parsed.success) invalid("filter", "invalid_value");
    return parsed.data;
  };

  return {
    query: LIST_QUERY_FIELDS,
    compile: (input, firstParam) => {
      const raw =
        input.filter === undefined
          ? []
          : typeof input.filter === "string"
            ? [input.filter]
            : [...input.filter];
      requireWithinLimit(raw.length, TECHNICAL_LIMITS.filtersPerRequest);
      const conditions: string[] = [];
      const params: unknown[] = [];
      for (const item of raw) {
        const match = FILTER_RE.exec(item);
        if (!match) invalid("filter", "invalid_format");
        const [, name, op, text] = match as unknown as [string, string, string, string];
        const field = Object.hasOwn(spec.filters, name) ? filters.get(name) : undefined;
        if (!field || !(field.operators as readonly string[]).includes(op))
          invalid("filter", "unknown_filter");
        const placeholder = `$${firstParam + params.length}`;
        if (op === "in") {
          const values = text.split(",");
          requireWithinLimit(values.length, TECHNICAL_LIMITS.filtersPerRequest);
          params.push(values.map((v) => parseValue(field, v)));
          conditions.push(`${quote(field.column)} = ANY(${placeholder}::${field.cast}[])`);
        } else {
          params.push(parseValue(field, text));
          conditions.push(
            `${quote(field.column)} ${SQL_OPERATORS[op as Exclude<FilterOperator, "in">]} ${placeholder}::${field.cast}`,
          );
        }
      }
      const keys = (input.sort ?? "").split(",").filter((k) => k !== "");
      if (keys.length > MAX_SORT_KEYS) invalid("sort", "too_many_keys");
      const order = keys.map((key) => {
        const desc = key.startsWith("-");
        const name = desc ? key.slice(1) : key;
        const column = Object.hasOwn(spec.sorts, name) ? sorts.get(name) : undefined;
        if (column === undefined) invalid("sort", "unknown_sort");
        return `${quote(column)} ${desc ? "DESC" : "ASC"}`;
      });
      if (order.length === 0)
        order.push(
          `${quote(sorts.get(spec.defaultSort.field)!)} ${spec.defaultSort.direction === "desc" ? "DESC" : "ASC"}`,
        );
      return {
        where: conditions.length > 0 ? conditions.join(" AND ") : "TRUE",
        params,
        orderBy: order.join(", "),
      };
    },
  };
}
