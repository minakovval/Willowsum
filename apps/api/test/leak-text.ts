/**
 * The text of a response body for a «does not contain» leak check (#563).
 *
 * A problem body carries a random hex `supportId` (the trace id, 32 hex characters), which holds any short
 * number by chance (`"10"`, `"77"`, `"430"`): a check on the raw body fails at random (#557). This returns the
 * body re-serialised without the random fields, so a real leak (an amount, a name, an id in any other field)
 * is still in it. A body that is not JSON is returned as it is.
 *
 * Use it in every leak check on a response body: `expect(leakText(res.body)).not.toContain(value)`; the rule
 * in tools/test-guards/leak-checks.mjs flags `expect(<response>.body).not.toContain(...)`.
 */
export const RANDOM_BODY_FIELDS: readonly string[] = ["supportId", "requestId", "traceId"];

function withoutRandom(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutRandom);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !RANDOM_BODY_FIELDS.includes(key))
      .map(([key, inner]) => [key, withoutRandom(inner)]),
  );
}

export function leakText(body: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return body;
  }
  return JSON.stringify(withoutRandom(parsed));
}
