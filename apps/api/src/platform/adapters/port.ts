/**
 * A provider port (ARC-05, ADR-0005): the internal interface of one kind of external service (rates, prices,
 * mail, payments, …). It declares, for every operation, whether repeating it is safe (only then is it retried)
 * and the fields it may send to the provider (FR 5: the minimum the operation needs). The adapter kit refuses
 * to send any other field, and `outgoingFieldViolations` lets a test check recorded requests against the list.
 */
export interface ProviderOperation {
  /** `<port>.<operation>`, e.g. `exchange-rates.ratesOn`. */
  readonly name: string;
  /** Safe to repeat (a read, or a write with an idempotency key): only then is a failed call retried. */
  readonly idempotent: boolean;
  /**
   * Field paths the operation may send: query parameters and body fields, nested as `a.b`, array items as
   * `a[].b`. A listed path covers what is below it.
   */
  readonly fields: readonly string[];
  /**
   * Request path below the provider's base URL, fixed in the port (FR 5: a call cannot add data to it). Data
   * goes into the path only through placeholders, e.g. `rates/{date}`, and each placeholder is a declared field.
   * Empty: the base URL itself.
   */
  readonly path: string;
}

export interface ProviderPort<Op extends string> {
  /** kebab-case name of the kind of service, e.g. `exchange-rates`; never a provider's name. */
  readonly name: string;
  readonly operations: { readonly [K in Op]: ProviderOperation };
}

const PORT_NAME_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const FIELD_RE = /^[A-Za-z_][A-Za-z0-9_-]*(\[\])?(\.[A-Za-z_][A-Za-z0-9_-]*(\[\])?)*$/;
/** A fixed path segment: unreserved characters only and not starting with a dot (no `.`, `..`, `?`, `#`, `:`). */
export const PATH_SEGMENT_RE = /^[A-Za-z0-9_~-][A-Za-z0-9._~-]*$/;
const PLACEHOLDER_RE = /^\{([A-Za-z_][A-Za-z0-9_]*)\}$/;

/** Placeholder names of a path template, in order (`rates/{date}` → `["date"]`). */
export function pathPlaceholders(template: string): string[] {
  if (template === "") return [];
  return template.split("/").flatMap((segment) => {
    const m = PLACEHOLDER_RE.exec(segment);
    return m ? [m[1]!] : [];
  });
}

/** Problems of a path template: segments are fixed or a single `{field}` placeholder of a declared field. */
export function pathTemplateProblems(template: string, fields: readonly string[]): string[] {
  if (template === "") return [];
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const segment of template.split("/")) {
    const m = PLACEHOLDER_RE.exec(segment);
    if (m) {
      if (!fields.includes(m[1]!)) problems.push(`placeholder {${m[1]}} is not a declared field`);
      if (seen.has(m[1]!)) problems.push(`placeholder {${m[1]}} appears twice`);
      seen.add(m[1]!);
    } else if (!PATH_SEGMENT_RE.test(segment)) problems.push(`invalid path segment «${segment}»`);
  }
  return problems;
}

export function defineProviderPort<Op extends string>(
  name: string,
  operations: {
    readonly [K in Op]: {
      readonly idempotent: boolean;
      readonly fields: readonly string[];
      readonly path?: string;
    };
  },
): ProviderPort<Op> {
  if (!PORT_NAME_RE.test(name)) throw new Error(`Provider port «${name}»: names are kebab-case`);
  const built = {} as { [K in Op]: ProviderOperation };
  for (const op of Object.keys(operations) as Op[]) {
    const { idempotent, fields, path = "" } = operations[op];
    for (const field of fields) {
      if (!FIELD_RE.test(field))
        throw new Error(`Provider port ${name}.${op}: invalid field path «${field}»`);
    }
    if (new Set(fields).size !== fields.length)
      throw new Error(`Provider port ${name}.${op}: duplicate field`);
    const pathProblems = pathTemplateProblems(path, fields);
    if (pathProblems.length > 0)
      throw new Error(`Provider port ${name}.${op}: path «${path}»: ${pathProblems.join("; ")}`);
    built[op] = Object.freeze({
      name: `${name}.${op}`,
      idempotent,
      fields: Object.freeze([...fields]),
      path,
    });
  }
  return Object.freeze({ name, operations: Object.freeze(built) });
}

/**
 * The two implementations every port ships (ARC-05 FR 2): `live` talks to the provider, `test` is synthetic
 * (or a provider sandbox) and needs no network. Both are factories, so neither is built unless selected.
 */
export interface ProviderImplementations<T, LiveOptions> {
  readonly test: () => T;
  readonly live: (options: LiveOptions) => T;
}

/** `WS_PROVIDER_MODE`: `test` (default, local development and CI) or `live` (deployed environments). */
export const PROVIDER_MODES = ["test", "live"] as const;
export type ProviderMode = (typeof PROVIDER_MODES)[number];

export function selectImplementation<T, LiveOptions>(
  mode: ProviderMode,
  implementations: ProviderImplementations<T, LiveOptions>,
  liveOptions: () => LiveOptions,
): T {
  return mode === "live" ? implementations.live(liveOptions()) : implementations.test();
}
