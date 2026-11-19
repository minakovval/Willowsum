/**
 * The text of a response body for a «does not contain» leak check (#563).
 *
 * A problem body carries a random hex `supportId` (the trace id, 32 hex characters), which holds any short
 * number by chance (`"10"`, `"77"`, `"430"`): a check on the raw body fails at random (#557). This returns the
 * raw body with only that value blanked: every other byte stays as the server sent it (no re-serialising, so
 * a large number or an escape is not changed), and a `supportId` that is not 32 hex characters is kept, so a
 * value leaked into that field is still caught. A body that is not JSON is checked the same way.
 *
 * Use it in every leak check on a response body: `expect(leakText(res.body)).not.toContain(value)`; the rule
 * in tools/test-guards/leak-checks.mjs flags `expect(<response>.body).not.toContain(...)`.
 */
const RANDOM_SUPPORT_ID = /"supportId":"[0-9a-f]{32}"/g;

export function leakText(body: string): string {
  return body.replace(RANDOM_SUPPORT_ID, '"supportId":""');
}
