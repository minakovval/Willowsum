// Security review of PR #87 (CICD-01): the GitHub client and the alert issue fail closed. A stubbed `fetch`
// stands in for api.github.com; no network.
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { fetchDailyInput, upsertAlertIssue } from '../lib/fetch.mjs';
import { client } from '../lib/github.mjs';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Serve `routes` (pathname+search → { status, body, link }) and record every request. */
function serve(routes) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const key = `${init.method ?? 'GET'} ${u.pathname}${u.search}`;
    calls.push({ key, body: init.body ? JSON.parse(init.body) : undefined, auth: init.headers?.authorization });
    const r = typeof routes === 'function' ? routes(key, u) : routes[key];
    if (!r) return new Response('{"message":"Not Found"}', { status: 404 });
    return new Response(r.status === 204 ? null : JSON.stringify(r.body ?? {}), {
      status: r.status ?? 200,
      headers: r.link ? { link: r.link } : {},
    });
  };
  return calls;
}
const gh = () => client({ token: 'test-token-not-real', repo: 'o/r' });

test('SEC87: an API error is never read as an empty answer (the client throws)', async () => {
  serve({});
  await assert.rejects(gh().get('/{repo}/pulls/1/reviews'), /HTTP 404/);
  serve({ 'GET /repos/o/r/pulls/1/reviews?per_page=100': { status: 502, body: { message: 'bad gateway' } } });
  await assert.rejects(gh().paginate('/{repo}/pulls/1/reviews?per_page=100'), /HTTP 502/);
});

test('SEC87: pagination follows every next link (reviews after the first 100 are read)', async () => {
  const page = (n, next) => ({ body: Array.from({ length: 100 }, (_, i) => ({ id: n * 100 + i })), link: next ? `<https://api.github.com/repositories/1/pulls/1/reviews?per_page=100&page=${n + 2}>; rel="next"` : undefined });
  serve({
    'GET /repos/o/r/pulls/1/reviews?per_page=100': page(0, true),
    'GET /repos/o/r/pulls/1/reviews?per_page=100&page=2': page(1, true),
    'GET /repos/o/r/pulls/1/reviews?per_page=100&page=3': { body: [{ id: 'last' }] },
  });
  const all = await gh().paginate('/{repo}/pulls/1/reviews?per_page=100');
  assert.equal(all.length, 201);
  assert.equal(all.at(-1).id, 'last');
});

test('SEC87: the token goes only to the API host; next links keep the owner/name form', async () => {
  const calls = serve({
    'GET /repos/o/r/x': { body: [1], link: '<https://api.github.com/repositories/9/x?page=2>; rel="next"' },
    'GET /repos/o/r/x?page=2': { body: [2] },
  });
  await gh().paginate('/{repo}/x');
  assert.deepEqual(calls.map((c) => c.key), ['GET /repos/o/r/x', 'GET /repos/o/r/x?page=2']);
});

test('SEC87-B2: a list cut at `max` while more pages remain is an error, not a shorter list', async () => {
  // 1001 reviews: the newest («Security verdict: Changes requested») would be dropped and an older «Ready» win.
  serve((key) => {
    const m = /page=(\d+)/.exec(key);
    const n = m ? Number(m[1]) : 1;
    return { body: Array.from({ length: 100 }, (_, i) => ({ id: n * 100 + i })), link: `<https://api.github.com/repos/o/r/pulls/1/reviews?per_page=100&page=${n + 1}>; rel="next"` };
  });
  await assert.rejects(gh().paginate('/{repo}/pulls/1/reviews?per_page=100'), /more than|truncat/i);
});

test('SEC87: the alert issue: comments on the open one, ignores PRs with the label, otherwise opens a new one', async () => {
  const calls = serve({
    'POST /repos/o/r/labels': { status: 422, body: { message: 'already_exists' } },
    'GET /repos/o/r/issues?labels=main-check&state=open&per_page=10': { body: [{ number: 5, pull_request: {}, html_url: 'pr', user: { login: 'github-actions[bot]' } }, { number: 7, html_url: 'issue7', user: { login: 'github-actions[bot]' } }] },
    'POST /repos/o/r/issues/7/comments': { status: 201, body: {} },
  });
  assert.equal(await upsertAlertIssue(gh(), 'report', { until: '2026-11-12T00:00:00Z' }), 'issue7');
  assert.equal(calls.at(-1).body.body, 'report');
  // Closed by an attacker → nothing open → a new issue is opened (the alert cannot be suppressed by closing).
  const calls2 = serve({
    'POST /repos/o/r/labels': { status: 422, body: {} },
    'GET /repos/o/r/issues?labels=main-check&state=open&per_page=10': { body: [] },
    'POST /repos/o/r/issues': { status: 201, body: { html_url: 'new' } },
  });
  assert.equal(await upsertAlertIssue(gh(), 'report', { until: '2026-11-12T00:00:00Z' }), 'new');
  assert.deepEqual(calls2.at(-1).body.labels, ['main-check']);
});

test('SEC87-N7: an open `main-check` issue opened by someone else is not used for the alert', async () => {
  // An issue the owner has unsubscribed from (or that another account opened and locked) would swallow alerts.
  const calls = serve({
    'POST /repos/o/r/labels': { status: 422, body: {} },
    'GET /repos/o/r/issues?labels=main-check&state=open&per_page=10': { body: [{ number: 3, html_url: 'decoy', user: { login: 'someone' } }] },
    'POST /repos/o/r/issues': { status: 201, body: { html_url: 'new' } },
  });
  assert.equal(await upsertAlertIssue(gh(), 'report', { until: '2026-11-12T00:00:00Z' }), 'new');
  assert.ok(!calls.some((c) => c.key === 'POST /repos/o/r/issues/3/comments'));
});

test('SEC87-B2: more merged PRs than five pages of closed PRs is an error, not a silent skip', async () => {
  const since = new Date('2026-11-11T11:00:00Z');
  const until = new Date('2026-11-12T12:00:00Z');
  serve((key) => {
    if (key === 'GET /repos/o/r') return { body: { default_branch: 'main', owner: { login: 'o' } } };
    if (key === 'GET /repos/o/r/branches/main') return { body: { commit: { sha: 'c'.repeat(40) } } };
    if (key.startsWith('GET /repos/o/r/activity')) return { body: [] };
    if (key.startsWith('GET /repos/o/r/commits?')) return { body: [] };
    if (key.startsWith('GET /repos/o/r/pulls?state=closed')) {
      // 100 closed-unmerged PRs per page, all updated inside the window: the merged PR is on page 6.
      return { body: Array.from({ length: 100 }, (_, i) => ({ number: i, merged_at: null, updated_at: '2026-11-12T11:00:00Z' })) };
    }
    if (key.startsWith('GET /repos/o/r/pulls?state=all')) return { body: [] };
    if (key.startsWith('GET /repos/o/r/branches?')) return { body: [] };
    return undefined;
  });
  await assert.rejects(fetchDailyInput(gh(), { since, until }), /more|truncat|page/i);
});

