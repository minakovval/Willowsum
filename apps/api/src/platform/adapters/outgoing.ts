import { OutgoingFieldError } from "./errors.ts";
import { pathPlaceholders, type ProviderOperation } from "./port.ts";

/**
 * Field paths of a payload (ARC-05 FR 5): nested object keys as `a.b`, array items as `a[]`. Only leaves are
 * listed (an empty object or array counts as a leaf), so `{ a: { b: 1 } }` gives `a.b`.
 */
export function payloadFields(payload: unknown, prefix = ""): string[] {
  if (Array.isArray(payload)) {
    const path = `${prefix}[]`;
    if (payload.length === 0) return [path];
    return [...new Set(payload.flatMap((item) => payloadFields(item, path)))];
  }
  if (payload !== null && typeof payload === "object") {
    const entries = Object.entries(payload as Record<string, unknown>).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return prefix === "" ? [] : [prefix];
    return entries.flatMap(([key, value]) => payloadFields(value, prefix === "" ? key : `${prefix}.${key}`));
  }
  return prefix === "" ? [] : [prefix];
}

/** A path is allowed when it is listed or lies below a listed path. */
function covered(field: string, allowed: readonly string[]): boolean {
  return allowed.some((a) => field === a || field.startsWith(`${a}.`) || field.startsWith(`${a}[]`));
}

/** Fields of `payload` that the operation does not declare, sorted. */
export function undeclaredFields(operation: ProviderOperation, payload: unknown): string[] {
  return [...new Set(payloadFields(payload).filter((f) => !covered(f, operation.fields)))].sort();
}

/** Throws before anything is sent when the payload has a field the operation does not declare. */
export function assertOutgoing(provider: string, operation: ProviderOperation, payload: unknown): void {
  const extra = undeclaredFields(operation, payload);
  if (extra.length > 0) throw new OutgoingFieldError(provider, operation.name, extra);
}

const escapeRe = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Matches the end of a request path against an operation's path template (`rates/{date}`). */
function templateRe(template: string): RegExp {
  const parts = template
    .split("/")
    .map((segment) => (/^\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(segment) ? "[^/]+" : escapeRe(segment)));
  return new RegExp(`(^|/)${parts.join("/")}$`);
}

/** Pseudo-field reported when a request path does not follow the operation's path template. */
export const UNDECLARED_PATH = "<undeclared path>";

/**
 * What an HTTP request sends: its query parameter names, the field paths of its JSON body and — given the
 * operation — the placeholders of its path template (a path that does not follow the template is reported as
 * `<undeclared path>`).
 */
export async function requestFields(request: Request, operation?: ProviderOperation): Promise<string[]> {
  const url = new URL(request.url);
  const fields = [...url.searchParams.keys()];
  if (operation && operation.path !== "") {
    if (templateRe(operation.path).test(url.pathname)) fields.push(...pathPlaceholders(operation.path));
    else fields.push(UNDECLARED_PATH);
  }
  const body = await request.clone().text();
  if (body !== "") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      // A non-JSON body cannot be checked field by field: report it as one undeclared field.
      return [...new Set([...fields, "<non-json body>"])];
    }
    fields.push(...payloadFields(parsed));
  }
  return [...new Set(fields)];
}

/**
 * For tests (ARC-05 FR 5, «перелік полів … перевіряється тестом»): every field of every recorded request that
 * the operation does not declare, path placeholders included. An adapter test records the requests its working
 * implementation makes (`recordingFetch`) and expects this to be empty.
 */
export async function outgoingFieldViolations(
  operation: ProviderOperation,
  requests: readonly Request[],
): Promise<string[]> {
  const found = new Set<string>();
  for (const request of requests) {
    for (const field of await requestFields(request, operation))
      if (!covered(field, operation.fields)) found.add(field);
  }
  return [...found].sort();
}
