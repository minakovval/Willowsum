import { OutgoingFieldError } from "./errors.ts";
import type { ProviderOperation } from "./port.ts";

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

/** What an HTTP request sends: its query parameter names and the field paths of its JSON body. */
export async function requestFields(request: Request): Promise<string[]> {
  const fields = [...new URL(request.url).searchParams.keys()];
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
 * the operation does not declare. An adapter test records the requests its working implementation makes
 * (`recordingFetch`) and expects this to be empty.
 */
export async function outgoingFieldViolations(
  operation: ProviderOperation,
  requests: readonly Request[],
): Promise<string[]> {
  const found = new Set<string>();
  for (const request of requests) {
    for (const field of await requestFields(request)) if (!covered(field, operation.fields)) found.add(field);
  }
  return [...found].sort();
}
