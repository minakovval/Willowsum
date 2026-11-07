import type { AnyValue, AttributeValue, Attributes } from "@opentelemetry/api";
import { PROBLEM_CODES } from "../http/problem.ts";

/**
 * The redaction filter of every exported signal (ARC-09 FR 2, NFR-10 FR 1–3, ADR-0006). It works on an
 * allow-list: an attribute leaves the process only if its key is listed here AND its value matches the
 * key's grammar (a route template, a SQLSTATE, a class name …) AND no personal-data detector fires on it.
 * Everything else is dropped, so a new attribute, a free-text message or a value a caller passed by mistake
 * never reaches the telemetry service. A deny-list would have to recognise every account name, address and
 * amount format; the allow-list has to recognise only our own technical values.
 *
 * Span names and log bodies are short technical names under the same rules; anything else becomes
 * `redacted`. Span status messages, exception messages and stack traces are never exported.
 */

/** A value grammar: what a technical value of one key looks like. */
type Rule =
  | {
      readonly kind: "string";
      readonly re: RegExp;
      readonly max: number;
      /** The grammar alone is enough (a fixed set or a version number): the detectors are not applied. */
      readonly closed?: true;
    }
  | { readonly kind: "int"; readonly min: number; readonly max: number };

const str = (re: RegExp, max = 128): Rule => ({ kind: "string", re, max });
const closed = (re: RegExp, max = 64): Rule => ({ kind: "string", re, max, closed: true });
const int = (min: number, max: number): Rule => ({ kind: "int", min, max });

/** A lower-case technical name: `feature-flags`, `exchange-rates:http`, `exchange-rates.ratesOn`. */
export const NAME_RE = /^[a-z][a-z0-9]*([._:-][a-zA-Z0-9]+)*$/;
/** A path template of a route: `/v1/accounts/:accountId`, `/v1/me/features`. Never a concrete URL. */
const ROUTE_RE = /^(\/[A-Za-z0-9_~:{}*-]*)+$/;
const METHOD_RE = /^(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS|_OTHER)$/;
const CLASS_RE = /^[A-Za-z][A-Za-z0-9]{0,63}$/;
const SQLSTATE_RE = /^[0-9A-Z]{5}$/;
const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_$]{0,62}$/;
const WORD_RE = /^[a-z][a-z0-9-]{0,31}$/;
const SEMVER_RE = /^[0-9]+\.[0-9]+\.[0-9]+([.-][A-Za-z0-9.-]+)?$/;

/**
 * Every attribute key that may be exported, with the grammar of its value. Keys follow the OpenTelemetry
 * semantic conventions where one exists, `ws.*` otherwise.
 */
export const ATTRIBUTE_RULES: Readonly<Record<string, Rule>> = Object.freeze({
  // Resource
  "service.name": str(NAME_RE, 64),
  "service.namespace": str(NAME_RE, 64),
  "service.version": closed(SEMVER_RE),
  "deployment.environment.name": str(WORD_RE, 32),
  "telemetry.sdk.name": str(NAME_RE, 64),
  "telemetry.sdk.language": str(NAME_RE, 64),
  "telemetry.sdk.version": closed(SEMVER_RE),
  "ws.role": str(/^(api|worker|scheduler)$/, 16),
  // HTTP (server side): the method, the route template and the status. Never the URL, query or headers.
  "http.request.method": str(METHOD_RE, 8),
  "http.route": str(ROUTE_RE, 128),
  "http.response.status_code": int(100, 599),
  "error.type": str(CLASS_RE, 64),
  // A closed set: the problem codes of the API (it labels the duration metric, so its cardinality stays fixed).
  // Why a 503 was answered (closed set): only `kill_switch` is left out of the 5xx ratio.
  "ws.unavailable.reason": closed(/^(kill_switch|flags_unknown)$/, 16),
  "ws.problem.code": closed(new RegExp(`^(${PROBLEM_CODES.join("|")})$`), 64),
  // Database errors (NFR-10 FR 2): the SQLSTATE and the names of the constraint, table, column and schema.
  "db.system.name": str(/^postgresql$/, 16),
  "db.response.status_code": str(SQLSTATE_RE, 5),
  "ws.db.constraint": str(IDENTIFIER_RE, 63),
  "ws.db.table": str(IDENTIFIER_RE, 63),
  "ws.db.column": str(IDENTIFIER_RE, 63),
  "ws.db.schema": str(IDENTIFIER_RE, 63),
  "ws.module": str(NAME_RE, 64),
  // Provider calls (NFR-10 FR 3): adapter, operation, outcome. Never the URL, its parameters or keys.
  "ws.provider": str(NAME_RE, 64),
  "ws.provider.operation": str(NAME_RE, 64),
  "ws.provider.outcome": str(WORD_RE, 32),
  "ws.provider.attempts": int(1, 100),
  // Jobs and scheduled tasks (ARC-09 FR 3), bank synchronisation (NFR-10 FR 6).
  "ws.job.name": str(NAME_RE, 64),
  "ws.outcome": str(/^(success|failure)$/, 16),
  // Exceptions: the class only (`exception.message` and `exception.stacktrace` are never exported).
  "exception.type": str(CLASS_RE, 64),
  // How many attributes the filter dropped from this item (a signal that code sends something it should not).
  "ws.telemetry.redacted": int(0, 10_000),
});

/** The marker that replaces a span name or a log body that is not a technical name. */
export const REDACTED = "redacted";

/**
 * Detectors of personal and financial data: a second line behind the grammars, so a value that fits a
 * grammar but looks like an email, an IBAN, a card or account number, an amount, a token or coordinates is
 * still dropped.
 */
const DETECTORS: readonly RegExp[] = [
  /[^\s@]+@[^\s@]+\.[^\s@]+/, // email
  /\b[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}\b/i, // IBAN
  /(?:\d[ -]?){12,19}/, // card or account number (also grouped)
  /\d{6,}/, // any long digit run: account numbers, phone numbers, amounts in minor units
  /\d+[.,]\d+/, // decimal: an amount or a coordinate
  /[$€£₴]|\b(UAH|EUR|USD|GBP|PLN|CHF|BTC|ETH)\b/i, // currency
  /\beyJ[A-Za-z0-9_-]{4,}/, // JWT
  /\b(bearer|basic)\s+\S/i, // an Authorization value
  /\b(api[_-]?key|access[_-]?token|token|secret|password)\s*[:=]\s*\S/i, // a credential by name
  /[?&#=]/, // a query string or URL parameters
];

/** A long opaque run of letters and digits (both): a key, a token, a hash, a trace or session id. */
function opaqueToken(value: string): boolean {
  for (const run of value.match(/[A-Za-z0-9+_-]{20,}/g) ?? [])
    if (/[0-9]/.test(run) && /[A-Za-z]/.test(run)) return true;
  return false;
}

export function looksPersonal(value: string): boolean {
  return DETECTORS.some((re) => re.test(value)) || opaqueToken(value);
}

function allowedValue(rule: Rule, value: AttributeValue | AnyValue | undefined): boolean {
  if (rule.kind === "int")
    return typeof value === "number" && Number.isInteger(value) && value >= rule.min && value <= rule.max;
  if (typeof value !== "string" || value.length === 0 || value.length > rule.max) return false;
  if (!rule.re.test(value)) return false;
  // A closed grammar (a version) skips the detectors for its numeric core only: a pre-release or build part
  // could still carry digits (a card number) or a token.
  if (rule.closed) return !looksPersonal(value.replace(/^[0-9]+\.[0-9]+\.[0-9]+/, ""));
  // Grammars of route templates, SQL identifiers and names cannot hold a personal value except by
  // coincidence; the detectors catch the formats that can still slip through (e.g. digits).
  return !looksPersonal(value);
}

/** Attributes reduced to the allow-list; `ws.telemetry.redacted` counts what was dropped. */
export function redactAttributes(attributes: Attributes | undefined): Attributes {
  const out: Attributes = {};
  let dropped = 0;
  for (const [key, value] of Object.entries(attributes ?? {})) {
    const rule = Object.hasOwn(ATTRIBUTE_RULES, key) ? ATTRIBUTE_RULES[key] : undefined;
    if (rule && key !== "ws.telemetry.redacted" && allowedValue(rule, value)) out[key] = value;
    else dropped += 1;
  }
  if (dropped > 0) out["ws.telemetry.redacted"] = Math.min(dropped, 10_000);
  return out;
}

const SPAN_NAME_RES: readonly RegExp[] = [
  // HTTP server spans: `GET` or `GET /v1/accounts/:accountId`.
  /^(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS|_OTHER)( (\/[A-Za-z0-9_~:{}*-]*)+)?$/,
  // Everything else: `db.transaction feature-flags`, `provider exchange-rates.ratesOn`, `job bank-sync`.
  /^[a-z][a-z0-9]*([._-][a-z0-9]+)*( [a-z][a-z0-9]*([._:-][a-zA-Z0-9]+)*)?$/,
];

/** A span name if it is a technical name, `redacted` otherwise. */
export function redactSpanName(name: string): string {
  if (name.length > 128 || !SPAN_NAME_RES.some((re) => re.test(name))) return REDACTED;
  const parts = name.split(" ");
  // The route part may contain anything a route template allows; the detectors judge the rest.
  return looksPersonal(parts.length > 1 && parts[1]!.startsWith("/") ? parts[1]! : name) ? REDACTED : name;
}

/** A log body or event name if it is a technical name (`api.server_error`), `redacted` otherwise. */
export function redactName(value: AnyValue | undefined): string {
  return typeof value === "string" && value.length <= 64 && NAME_RE.test(value) && !looksPersonal(value)
    ? value
    : REDACTED;
}

/** A version (instrumentation scope, SDK) if it is a plain version, undefined otherwise. */
export function redactVersion(value: string | undefined): string | undefined {
  return value !== undefined &&
    value.length <= 64 &&
    SEMVER_RE.test(value) &&
    !looksPersonal(value.replace(/^[0-9]+\.[0-9]+\.[0-9]+/, ""))
    ? value
    : undefined;
}

const SEVERITY_TEXT_RE = /^(TRACE|DEBUG|INFO|WARN|ERROR|FATAL)[2-4]?$/;

/** A log severity text if it is a severity name (`ERROR`, `WARN2` …), undefined otherwise. */
export function redactSeverityText(value: string | undefined): string | undefined {
  return value !== undefined && SEVERITY_TEXT_RE.test(value) ? value : undefined;
}

const UNIT_RE = /^[A-Za-z0-9{}/%._-]{0,32}$/;

/** A metric unit (`s`, `{call}`) if it is a unit, empty otherwise. */
export function redactUnit(value: string): string {
  return UNIT_RE.test(value) && !looksPersonal(value) ? value : "";
}
