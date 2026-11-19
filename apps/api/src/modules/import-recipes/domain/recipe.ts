import { z } from "zod";

/**
 * The parsing recipe (IMP-06@PoC FR 1, FR 2, FR 14): data with a schema and the schema's version — never code. It
 * describes the file (encoding, delimiter, quotes, sheet, rows to skip, header row, footer rows and their pattern), the
 * roles of the columns, dates, numbers, the sign, the currency, the binding to an account, filters and fields extracted
 * by patterns. Rows and columns are numbered from 1, as the user sees them in a spreadsheet.
 *
 * `checkRecipe` refuses — with a code and the field's path (FR 14) — a recipe over 32 KB (UTF-8), nested deeper than any
 * recipe can be, with an unknown key at any level, a wrong value, more than 64 column rules or more than 20 rules with
 * patterns (FR 2). Patterns are checked against the safe dialect by the application layer (file-parsers'
 * `compilePattern`, FR 3): `recipePatterns` lists them with their paths. The sheet and the time zone are recorded but
 * not applied (EC2: the server chooses the sheet; dates are never shifted).
 */
export const RECIPE_SCHEMA_VERSION = 1;

export const RECIPE_LIMITS = {
  /** The recipe's JSON in UTF-8 bytes (32 KB). */
  bytes: 32 * 1024,
  columnRules: 64,
  patternRules: 20,
  /** Nesting of objects and arrays: a recipe's own is 3 (lead decision). */
  depth: 6,
} as const;

/** The recipe's encodings: «auto» or one the engine reads (file-parsers' `ENCODINGS`). */
export const RECIPE_ENCODINGS = [
  "auto",
  "utf-8",
  "utf-16le",
  "utf-16be",
  "windows-1251",
  "windows-1252",
  "cp866",
  "koi8-u",
] as const;
export const RECIPE_DELIMITERS = ["auto", ",", ";", "\t", "|"] as const;

/** Column roles (FR 1 «дата, дата валютування, сума, дебет, кредит, залишок, валюта, опис, контрагент, референс, статус, ігнорувати тощо»). */
export const COLUMN_ROLES = [
  "date",
  "value-date",
  "amount",
  "debit",
  "credit",
  "balance",
  "currency",
  "description",
  "counterparty",
  "reference",
  "status",
  "fee",
  "original-amount",
  "original-currency",
  "exchange-rate",
  "ignore",
] as const;

export type RecipeErrorCode =
  | "RECIPE_NOT_JSON"
  | "RECIPE_TOO_LARGE"
  | "RECIPE_TOO_DEEP"
  | "UNSUPPORTED_SCHEMA_VERSION"
  | "UNKNOWN_FIELD"
  | "MISSING_FIELD"
  | "INVALID_VALUE"
  | "TOO_MANY_COLUMN_RULES"
  | "TOO_MANY_PATTERNS"
  | "DUPLICATE_COLUMN_RULE"
  | "INCOMPLETE_RULE"
  | "UNSAFE_PATTERN"
  | "INVALID_PATTERN"
  | "GROUP_OUT_OF_RANGE"
  | "INVALID_CHARACTER";

/** FR 14: the client shows the localised text of the code and highlights the field (`""` — the whole recipe). */
export interface RecipeError {
  readonly code: RecipeErrorCode;
  readonly path: string;
  /** UNSAFE_PATTERN: the rule of the dialect it breaks. */
  readonly reason?: string;
}

const column = z.number().int().min(1).max(512);
const count = z.number().int().min(0).max(1000);
const label = z.string().min(1).max(40);
/** A pattern's text; its dialect and its 200 characters are checked by `compilePattern`. */
const pattern = z.string().min(1).max(1000);
const currencyCode = z.string().regex(/^[A-Z]{3}$/);

const recipeSchema = z.strictObject({
  schemaVersion: z.literal(RECIPE_SCHEMA_VERSION),
  file: z
    .strictObject({
      encoding: z.enum(RECIPE_ENCODINGS).optional(),
      delimiter: z.enum(RECIPE_DELIMITERS).optional(),
      quote: z.enum(['"', "'", "none"]).optional(),
      sheet: z.string().min(1).max(64).optional(),
      skipRows: count.optional(),
      headerRow: z.number().int().min(1).max(20_000).nullable().optional(),
      footerRows: count.optional(),
      footerPattern: pattern.optional(),
    })
    .optional(),
  columns: z
    .array(
      z.strictObject({
        column,
        role: z.enum(COLUMN_ROLES),
        /** The header the rule expects (FR 6: a warning when the file's differs). */
        header: z.string().max(200).optional(),
      }),
    )
    .optional(),
  dates: z
    .strictObject({
      format: z
        .string()
        .max(32)
        .regex(/^(?:YYYY|YY|MM|M|DD|D|HH|mm|ss|[./\- :T])+$/)
        .optional(),
      order: z.enum(["dmy", "mdy", "ymd"]).optional(),
      baseYear: z.number().int().min(1900).max(2100).optional(),
      timeZone: z.string().min(1).max(64).optional(),
    })
    .optional(),
  numbers: z
    .strictObject({
      decimalSeparator: z.enum([".", ","]).optional(),
      thousandsSeparator: z.enum([",", ".", " ", "'", "none"]).optional(),
      ambiguousIntegers: z.enum(["thousands", "decimals"]).optional(),
      currencySymbols: z
        .record(z.string().min(1).max(8), currencyCode)
        .refine((r) => Object.keys(r).length <= 32)
        .optional(),
    })
    .optional(),
  sign: z
    .strictObject({
      mode: z.enum(["auto", "as-printed", "invert", "indicator"]),
      column: column.optional(),
      outValues: z.array(label).min(1).max(10).optional(),
      inValues: z.array(label).min(1).max(10).optional(),
    })
    .optional(),
  currency: z
    .strictObject({
      mode: z.enum(["auto", "column", "fixed", "file", "row"]),
      column: column.optional(),
      code: currencyCode.optional(),
      pattern: pattern.optional(),
    })
    .optional(),
  account: z
    .strictObject({
      by: z.enum(["iban", "account-number", "mask", "header-pattern", "column"]),
      value: z.string().min(1).max(64).optional(),
      pattern: pattern.optional(),
      column: column.optional(),
    })
    .optional(),
  filters: z
    .strictObject({
      // Bounded with every other pattern by `TOO_MANY_PATTERNS` (FR 2), not here; the 32 KB bound the array.
      ignoreRows: z.array(pattern).optional(),
      statusColumn: column.optional(),
      skipStatuses: z.array(label).max(20).optional(),
      skipZeroAmounts: z.boolean().optional(),
    })
    .optional(),
  extract: z
    .array(
      z.strictObject({
        column,
        pattern,
        group: z.number().int().min(0).max(9),
        target: z.enum(["counterparty", "reference", "description"]),
      }),
    )
    .optional(),
});

export type Recipe = z.infer<typeof recipeSchema>;

export type RecipeCheck =
  | { readonly ok: true; readonly recipe: Recipe }
  | { readonly ok: false; readonly errors: readonly RecipeError[] };

/** A field's path as FR 14 writes it: `columns[3].role`. */
export function fieldPath(path: readonly PropertyKey[]): string {
  return path
    .map((p, i) => (typeof p === "number" ? `[${p}]` : i === 0 ? String(p) : `.${String(p)}`))
    .join("");
}

function valueAt(value: unknown, path: readonly PropertyKey[]): unknown {
  let at = value;
  for (const p of path) {
    if (at === null || typeof at !== "object" || !Object.hasOwn(at, p)) return undefined;
    at = (at as Record<PropertyKey, unknown>)[p];
  }
  return at;
}

/** How deep the JSON text nests (brackets outside strings), stopping past `limit`. */
function textDepth(text: string, limit: number): number {
  let depth = 0;
  let deepest = 0;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{" || c === "[") {
      deepest = Math.max(deepest, ++depth);
      if (deepest > limit) return deepest;
    } else if (c === "}" || c === "]") depth--;
  }
  return deepest;
}

/** How deep a value nests, without recursion, stopping past `limit`. */
function valueDepth(value: unknown, limit: number): number {
  let deepest = 0;
  const stack: [unknown, number][] = [[value, 0]];
  while (stack.length > 0) {
    const [v, d] = stack.pop()!;
    if (v === null || typeof v !== "object") continue;
    deepest = Math.max(deepest, d + 1);
    if (deepest > limit) return deepest;
    for (const child of Object.values(v)) stack.push([child, d + 1]);
  }
  return deepest;
}

const utf8Bytes = (text: string): number => new TextEncoder().encode(text).length;

const fail = (...errors: RecipeError[]): RecipeCheck => ({ ok: false, errors });

/** What a mode needs (FR 14 «INCOMPLETE_RULE»), in a fixed order. */
function incomplete(recipe: Recipe): RecipeError[] {
  const missing: RecipeError[] = [];
  const need = (present: unknown, path: string) => {
    if (present === undefined) missing.push({ code: "INCOMPLETE_RULE", path });
  };
  if (recipe.sign?.mode === "indicator") {
    need(recipe.sign.column, "sign.column");
    need(recipe.sign.outValues, "sign.outValues");
    need(recipe.sign.inValues, "sign.inValues");
  }
  const currency = recipe.currency;
  if (currency?.mode === "column") need(currency.column, "currency.column");
  if (currency?.mode === "fixed") need(currency.code, "currency.code");
  if (currency?.mode === "file" || currency?.mode === "row") need(currency.pattern, "currency.pattern");
  const account = recipe.account;
  if (account && ["iban", "account-number", "mask"].includes(account.by))
    need(account.value, "account.value");
  if (account?.by === "header-pattern") need(account.pattern, "account.pattern");
  if (account?.by === "column") need(account.column, "account.column");
  if (recipe.filters?.skipStatuses) need(recipe.filters.statusColumn, "filters.statusColumn");
  return missing;
}

/** U+0000 and every other C0 or C1 control, the line and paragraph separators (#607 item 5). */
const CONTROL = /[\p{Cc}\u2028\u2029]/u;
/** A lone surrogate: text PostgreSQL cannot store and no file holds. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** Whether a label (or any text the user gives with a recipe) holds a control character or a lone surrogate. */
export const unsafeText = (text: string): boolean => CONTROL.test(text) || LONE_SURROGATE.test(text);

/**
 * `INVALID_CHARACTER` for every text of the recipe — values, and the keys of `numbers.currencySymbols` — that
 * `unsafeText` refuses; the tab of `file.delimiter` is a value of its list, not text.
 */
function characterErrors(recipe: Recipe): RecipeError[] {
  const errors: RecipeError[] = [];
  const stack: [unknown, PropertyKey[]][] = [[recipe, []]];
  while (stack.length > 0) {
    const [v, path] = stack.pop()!;
    if (typeof v === "string") {
      if (unsafeText(v) && fieldPath(path) !== "file.delimiter")
        errors.push({ code: "INVALID_CHARACTER", path: fieldPath(path) });
    } else if (Array.isArray(v)) {
      for (let i = v.length - 1; i >= 0; i--) stack.push([v[i], [...path, i]]);
    } else if (v !== null && typeof v === "object") {
      for (const [k, child] of Object.entries(v).reverse()) {
        if (unsafeText(k)) errors.push({ code: "INVALID_CHARACTER", path: fieldPath([...path, k]) });
        stack.push([child, [...path, k]]);
      }
    }
  }
  return errors;
}

/** Every pattern of the recipe with its path, in the recipe's order. */
export function recipePatterns(recipe: Recipe): { readonly path: string; readonly source: string }[] {
  const found: { path: string; source: string }[] = [];
  if (recipe.file?.footerPattern)
    found.push({ path: "file.footerPattern", source: recipe.file.footerPattern });
  if (recipe.currency?.pattern) found.push({ path: "currency.pattern", source: recipe.currency.pattern });
  if (recipe.account?.pattern) found.push({ path: "account.pattern", source: recipe.account.pattern });
  recipe.filters?.ignoreRows?.forEach((source, i) =>
    found.push({ path: `filters.ignoreRows[${i}]`, source }),
  );
  recipe.extract?.forEach((e, i) => found.push({ path: `extract[${i}].pattern`, source: e.pattern }));
  return found;
}

/** Checks a recipe given as JSON text or as a parsed value (FR 2, FR 14); patterns' dialect excepted (see above). */
export function checkRecipe(input: unknown): RecipeCheck {
  let value: unknown = input;
  if (typeof input === "string") {
    if (utf8Bytes(input) > RECIPE_LIMITS.bytes) return fail({ code: "RECIPE_TOO_LARGE", path: "" });
    if (textDepth(input, RECIPE_LIMITS.depth) > RECIPE_LIMITS.depth)
      return fail({ code: "RECIPE_TOO_DEEP", path: "" });
    try {
      value = JSON.parse(input);
    } catch {
      return fail({ code: "RECIPE_NOT_JSON", path: "" });
    }
  } else {
    if (valueDepth(input, RECIPE_LIMITS.depth) > RECIPE_LIMITS.depth)
      return fail({ code: "RECIPE_TOO_DEEP", path: "" });
    if (utf8Bytes(JSON.stringify(input) ?? "") > RECIPE_LIMITS.bytes)
      return fail({ code: "RECIPE_TOO_LARGE", path: "" });
  }
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return fail({ code: "INVALID_VALUE", path: "" });
  const raw = value as Record<string, unknown>;
  if (!Object.hasOwn(raw, "schemaVersion")) return fail({ code: "MISSING_FIELD", path: "schemaVersion" });
  if (raw.schemaVersion !== RECIPE_SCHEMA_VERSION)
    return fail({ code: "UNSUPPORTED_SCHEMA_VERSION", path: "schemaVersion" });
  if (Array.isArray(raw.columns) && raw.columns.length > RECIPE_LIMITS.columnRules)
    return fail({ code: "TOO_MANY_COLUMN_RULES", path: "columns" });

  const parsed = recipeSchema.safeParse(value);
  if (!parsed.success) {
    const errors: RecipeError[] = [];
    for (const issue of parsed.error.issues) {
      if (issue.code === "unrecognized_keys") {
        for (const key of issue.keys)
          errors.push({ code: "UNKNOWN_FIELD", path: fieldPath([...issue.path, key]) });
      } else if (valueAt(value, issue.path) === undefined) {
        errors.push({ code: "MISSING_FIELD", path: fieldPath(issue.path) });
      } else errors.push({ code: "INVALID_VALUE", path: fieldPath(issue.path) });
    }
    return fail(...errors);
  }
  const recipe = parsed.data;
  if (recipePatterns(recipe).length > RECIPE_LIMITS.patternRules)
    return fail({ code: "TOO_MANY_PATTERNS", path: "" });
  const seen = new Set<number>();
  const duplicates: RecipeError[] = [];
  recipe.columns?.forEach((rule, i) => {
    if (seen.has(rule.column))
      duplicates.push({ code: "DUPLICATE_COLUMN_RULE", path: `columns[${i}].column` });
    seen.add(rule.column);
  });
  const errors = [...characterErrors(recipe), ...duplicates, ...incomplete(recipe)];
  return errors.length > 0 ? fail(...errors) : { ok: true, recipe };
}
