/**
 * Compatibility of the API contract within a version (ARC-07 FR 3, criterion «несумісна зміна контракту в
 * межах версії — 0»). Compares the base branch's `openapi.json` with this branch's and lists every change a
 * client built against the base could break on:
 *
 * - a removed path, operation, parameter, request or response field, or success response;
 * - a new required request field or parameter, or an optional one made required;
 * - a narrowed request type (type removed, enum value removed, tighter length, range or pattern, new format,
 *   extra properties no longer accepted);
 * - a widened response type (new type or null, response field no longer required, enum value added unless
 *   the enum is marked `x-extensible-enum`).
 *
 * Removing something is allowed only when the base marked it `deprecated` with `x-deprecated-since` at least
 * 6 months before `today`. A new deprecation mark must carry today's date (± 7 days) and keeps it.
 * For mobile clients removal also waits until fewer than 1 % of installs run older versions; that is
 * checked by the release process (ARC-07 FR 3), not here.
 */
type Json = Record<string, unknown>;

export interface CompatOptions {
  /** YYYY-MM-DD (UTC) of the check. */
  readonly today: string;
}

export const DEPRECATION_MONTHS = 6;
const NEW_MARK_TOLERANCE_DAYS = 7;
const METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"];

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function day(iso: string): number {
  const ms = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(ms)) throw new Error(`Not a date: ${iso}`);
  return ms;
}

function addMonths(iso: string, months: number): number {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.getTime();
}

class Checker {
  readonly problems: string[] = [];
  private readonly base: Json;
  private readonly head: Json;
  private readonly today: string;

  constructor(base: Json, head: Json, options: CompatOptions) {
    this.base = base;
    this.head = head;
    this.today = options.today;
  }

  private report(where: string, what: string): void {
    this.problems.push(`${where}: ${what}`);
  }

  /** May an element the base marked deprecated be removed now? */
  private removable(element: Json): boolean {
    const since = element["x-deprecated-since"];
    return (
      element["deprecated"] === true &&
      typeof since === "string" &&
      addMonths(since, DEPRECATION_MONTHS) <= day(this.today)
    );
  }

  private removed(where: string, element: Json, what: string): void {
    if (this.removable(element)) return;
    const since = element["x-deprecated-since"];
    this.report(
      where,
      element["deprecated"] === true
        ? `${what} removed before ${DEPRECATION_MONTHS} months after its deprecation (${String(since ?? "no x-deprecated-since")})`
        : `${what} removed without a deprecation mark (deprecated + x-deprecated-since, ${DEPRECATION_MONTHS} months)`,
    );
  }

  /** A deprecation mark is dated when it appears and keeps that date. */
  private deprecation(where: string, base: Json | undefined, head: Json): void {
    if (head["deprecated"] !== true) return;
    const since = head["x-deprecated-since"];
    if (typeof since !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(since)) {
      this.report(where, "deprecated without x-deprecated-since (YYYY-MM-DD)");
      return;
    }
    if (base?.["deprecated"] === true) {
      if (base["x-deprecated-since"] !== since)
        this.report(where, "x-deprecated-since changed after it was published");
      return;
    }
    const age = (day(this.today) - day(since)) / 86_400_000;
    if (Math.abs(age) > NEW_MARK_TOLERANCE_DAYS) {
      this.report(
        where,
        `a new deprecation mark must carry the date it is added (${this.today}), not ${since}`,
      );
    }
  }

  private resolve(doc: Json, schema: unknown): Json {
    let current = schema;
    for (let i = 0; i < 32 && isObject(current) && typeof current["$ref"] === "string"; i++) {
      const ref = current["$ref"];
      if (!ref.startsWith("#/")) throw new Error(`Only local $ref is supported: ${ref}`);
      current = ref
        .slice(2)
        .split("/")
        .reduce<unknown>(
          (node, key) => (isObject(node) ? node[key.replaceAll("~1", "/").replaceAll("~0", "~")] : undefined),
          doc,
        );
    }
    return isObject(current) ? current : {};
  }

  run(): string[] {
    const basePaths = (this.base["paths"] ?? {}) as Record<string, Json>;
    const headPaths = (this.head["paths"] ?? {}) as Record<string, Json>;
    for (const [path, baseItem] of Object.entries(basePaths)) {
      for (const method of METHODS) {
        const baseOp = baseItem[method];
        if (!isObject(baseOp)) continue;
        const where = `${method.toUpperCase()} ${path}`;
        const headOp = headPaths[path]?.[method];
        if (!isObject(headOp)) {
          this.removed(where, baseOp, "operation");
          continue;
        }
        this.operation(where, baseOp, headOp);
      }
    }
    for (const [path, headItem] of Object.entries(headPaths)) {
      for (const method of METHODS) {
        const headOp = headItem[method];
        if (!isObject(headOp)) continue;
        const baseOp = basePaths[path]?.[method];
        this.deprecation(`${method.toUpperCase()} ${path}`, isObject(baseOp) ? baseOp : undefined, headOp);
        if (!isObject(baseOp)) this.newSchemaMarks(`${method.toUpperCase()} ${path}`, headOp);
      }
    }
    return this.problems;
  }

  /** Deprecation marks inside a new operation still need a current date. */
  private newSchemaMarks(where: string, op: Json): void {
    for (const p of (op["parameters"] ?? []) as Json[])
      this.deprecation(`${where} parameter ${String(p["name"])}`, undefined, p);
  }

  private operation(where: string, baseOp: Json, headOp: Json): void {
    const key = (p: Json): string => `${String(p["in"])}:${String(p["name"])}`;
    const baseParams = new Map(((baseOp["parameters"] ?? []) as Json[]).map((p) => [key(p), p]));
    const headParams = new Map(((headOp["parameters"] ?? []) as Json[]).map((p) => [key(p), p]));
    for (const [k, bp] of baseParams) {
      const at = `${where} parameter ${k}`;
      const hp = headParams.get(k);
      if (!hp) {
        this.removed(at, bp, "parameter");
        continue;
      }
      if (bp["required"] !== true && hp["required"] === true)
        this.report(at, "optional parameter made required");
      this.deprecation(at, bp, hp);
      this.schema(at, this.base, bp["schema"], this.head, hp["schema"], "request");
    }
    for (const [k, hp] of headParams) {
      if (!baseParams.has(k)) {
        if (hp["required"] === true) this.report(`${where} parameter ${k}`, "new required parameter");
        this.deprecation(`${where} parameter ${k}`, undefined, hp);
      }
    }

    const baseBody = this.resolve(this.base, baseOp["requestBody"]);
    const headBody = this.resolve(this.head, headOp["requestBody"]);
    const baseHas = isObject(baseOp["requestBody"]);
    const headHas = isObject(headOp["requestBody"]);
    if (!baseHas && headHas && headBody["required"] === true)
      this.report(`${where} body`, "new required request body");
    if (baseHas && !headHas) this.report(`${where} body`, "request body removed");
    if (baseHas && headHas) {
      if (baseBody["required"] !== true && headBody["required"] === true)
        this.report(`${where} body`, "request body made required");
      this.content(`${where} body`, baseBody, headBody, "request");
    }

    const baseResponses = (baseOp["responses"] ?? {}) as Record<string, unknown>;
    const headResponses = (headOp["responses"] ?? {}) as Record<string, unknown>;
    for (const [status, baseResponse] of Object.entries(baseResponses)) {
      if (!/^2/.test(status)) continue;
      const at = `${where} response ${status}`;
      if (!(status in headResponses)) {
        this.report(at, "success response removed or its status changed");
        continue;
      }
      this.content(
        at,
        this.resolve(this.base, baseResponse),
        this.resolve(this.head, headResponses[status]),
        "response",
      );
    }
  }

  private content(where: string, base: Json, head: Json, direction: Direction): void {
    const baseContent = (base["content"] ?? {}) as Record<string, Json>;
    const headContent = (head["content"] ?? {}) as Record<string, Json>;
    for (const [type, media] of Object.entries(baseContent)) {
      const other = headContent[type];
      if (!other) {
        this.report(where, `media type ${type} removed`);
        continue;
      }
      this.schema(`${where} ${type}`, this.base, media["schema"], this.head, other["schema"], direction);
    }
  }

  private schema(
    where: string,
    baseDoc: Json,
    baseRaw: unknown,
    headDoc: Json,
    headRaw: unknown,
    direction: Direction,
    depth = 0,
  ): void {
    if (depth > 32) return;
    const b = this.resolve(baseDoc, baseRaw);
    const h = this.resolve(headDoc, headRaw);
    const bVariants = variants(b).map((v) => this.resolve(baseDoc, v));
    const hVariants = variants(h).map((v) => this.resolve(headDoc, v));
    if (bVariants.length > 1 || hVariants.length > 1) {
      // Request: every base variant still accepted by a head variant; response: every head variant was a base one.
      const [from, fromDoc, to, toDoc] =
        direction === "request"
          ? [bVariants, baseDoc, hVariants, headDoc]
          : [hVariants, headDoc, bVariants, baseDoc];
      for (const variant of from) {
        const match = to.find((candidate) => overlaps(variant, candidate));
        if (!match) {
          this.report(
            where,
            direction === "request"
              ? `no longer accepts ${describe(variant)}`
              : `may now return ${describe(variant)}`,
          );
          continue;
        }
        if (direction === "request") this.schema(where, fromDoc, variant, toDoc, match, direction, depth + 1);
        else this.schema(where, toDoc, match, fromDoc, variant, direction, depth + 1);
      }
      return;
    }
    const bTypes = types(b);
    const hTypes = types(h);
    if (bTypes && hTypes) {
      if (direction === "request") {
        for (const t of bTypes) if (!accepts(hTypes, t)) this.report(where, `type ${t} no longer accepted`);
      } else {
        for (const t of hTypes) if (!accepts(bTypes, t)) this.report(where, `may now return type ${t}`);
      }
    } else if (direction === "request" && !bTypes && hTypes) {
      this.report(where, `type narrowed to ${[...hTypes].join(" | ")}`);
    } else if (direction === "response" && bTypes && !hTypes) {
      this.report(where, "response type is no longer fixed");
    }
    this.enumeration(where, b, h, direction);
    if (direction === "request") this.requestLimits(where, b, h);
    if (isObject(b["items"]) || isObject(h["items"])) {
      this.schema(`${where}[]`, baseDoc, b["items"], headDoc, h["items"], direction, depth + 1);
    }
    this.object(where, baseDoc, b, headDoc, h, direction, depth);
  }

  private enumeration(where: string, b: Json, h: Json, direction: Direction): void {
    const bValues = values(b);
    const hValues = values(h);
    if (direction === "request") {
      if (hValues && !bValues) this.report(where, "now limited to fixed values");
      if (hValues && bValues) {
        for (const v of bValues)
          if (!hValues.some((x) => same(x, v)))
            this.report(where, `value ${JSON.stringify(v)} no longer accepted`);
      }
    } else if (bValues) {
      if (!hValues) this.report(where, "no longer limited to fixed values");
      else if (b["x-extensible-enum"] !== true) {
        for (const v of hValues)
          if (!bValues.some((x) => same(x, v)))
            this.report(where, `may now return value ${JSON.stringify(v)} (not marked x-extensible-enum)`);
      }
    }
  }

  private requestLimits(where: string, b: Json, h: Json): void {
    const tighter = (key: string, lower: boolean): void => {
      const bv = b[key];
      const hv = h[key];
      if (typeof hv !== "number") return;
      if (typeof bv !== "number") this.report(where, `new limit ${key} ${hv}`);
      else if (lower ? hv < bv : hv > bv) this.report(where, `${key} tightened from ${bv} to ${hv}`);
    };
    tighter("maxLength", true);
    tighter("maxItems", true);
    tighter("maximum", true);
    tighter("exclusiveMaximum", true);
    tighter("maxProperties", true);
    tighter("minLength", false);
    tighter("minItems", false);
    tighter("minimum", false);
    tighter("exclusiveMinimum", false);
    tighter("minProperties", false);
    for (const key of ["pattern", "format", "multipleOf"]) {
      if (h[key] !== undefined && !same(b[key], h[key]))
        this.report(where, `${key} ${b[key] === undefined ? "added" : "changed"}`);
    }
  }

  private object(
    where: string,
    baseDoc: Json,
    b: Json,
    headDoc: Json,
    h: Json,
    direction: Direction,
    depth: number,
  ): void {
    const bProps = (isObject(b["properties"]) ? b["properties"] : {}) as Record<string, unknown>;
    const hProps = (isObject(h["properties"]) ? h["properties"] : {}) as Record<string, unknown>;
    const bRequired = new Set((b["required"] ?? []) as string[]);
    const hRequired = new Set((h["required"] ?? []) as string[]);
    for (const [name, bp] of Object.entries(bProps)) {
      const at = `${where}.${name}`;
      const bpr = this.resolve(baseDoc, bp);
      if (!(name in hProps)) {
        this.removed(at, bpr, "field");
        continue;
      }
      const hpr = this.resolve(headDoc, hProps[name]);
      this.deprecation(at, bpr, hpr);
      if (direction === "request" && !bRequired.has(name) && hRequired.has(name))
        this.report(at, "optional request field made required");
      if (direction === "response" && bRequired.has(name) && !hRequired.has(name))
        this.report(at, "response field no longer always present");
      this.schema(at, baseDoc, bp, headDoc, hProps[name], direction, depth + 1);
    }
    for (const [name, hp] of Object.entries(hProps)) {
      if (name in bProps) continue;
      const at = `${where}.${name}`;
      if (direction === "request" && hRequired.has(name)) this.report(at, "new required request field");
      this.deprecation(at, undefined, this.resolve(headDoc, hp));
    }
    if (
      direction === "request" &&
      b["additionalProperties"] !== false &&
      h["additionalProperties"] === false &&
      Object.keys(bProps).length > 0
    ) {
      this.report(where, "extra fields no longer accepted");
    }
  }
}

type Direction = "request" | "response";

function variants(schema: Json): unknown[] {
  for (const key of ["anyOf", "oneOf"]) {
    const list = schema[key];
    if (Array.isArray(list) && list.length > 0) return list;
  }
  return [schema];
}

function types(schema: Json): Set<string> | undefined {
  const t = schema["type"];
  if (typeof t === "string") return new Set([t]);
  if (Array.isArray(t)) return new Set(t as string[]);
  if ("const" in schema)
    return new Set([
      schema["const"] === null
        ? "null"
        : typeof schema["const"] === "number"
          ? "number"
          : typeof schema["const"],
    ]);
  return undefined;
}

/** `number` also accepts every `integer`. */
function accepts(allowed: Set<string>, type: string): boolean {
  return allowed.has(type) || (type === "integer" && allowed.has("number"));
}

function values(schema: Json): unknown[] | undefined {
  if (Array.isArray(schema["enum"])) return schema["enum"] as unknown[];
  if ("const" in schema) return [schema["const"]];
  return undefined;
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function overlaps(a: Json, b: Json): boolean {
  const ta = types(a);
  const tb = types(b);
  if (!ta || !tb) return true;
  return [...ta].some((t) => accepts(tb, t) || accepts(new Set([t]), [...tb][0] ?? ""));
}

function describe(schema: Json): string {
  const t = types(schema);
  return t ? [...t].join(" | ") : "a value";
}

export function contractProblems(base: Json, head: Json, options: CompatOptions): string[] {
  return new Checker(base, head, options).run();
}
