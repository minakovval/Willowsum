// Security re-review of PR #87 (CICD-01), round 3: the window gap reaches the daily input and the report end to
// end (stubbed API on 127.0.0.1 only).
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import http from 'node:http';
import { afterEach, test } from 'node:test';
import { fetchDailyInput } from '../lib/fetch.mjs';
import { client } from '../lib/github.mjs';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});
const route = (key, { runsFail = false } = {}) => {
  if (key.includes('/actions/workflows/')) return runsFail ? { status: 502, body: { message: 'bad gateway' } } : { body: { workflow_runs: [] } };
  if (key === 'GET /repos/o/r') return { body: { default_branch: 'main', owner: { login: 'o' } } };
  if (key === 'GET /repos/o/r/branches/main') return { body: { commit: { sha: 'c'.repeat(40) } } };
  if (key.startsWith('GET /repos/o/r/activity') || key.startsWith('GET /repos/o/r/commits?')) return { body: [] };
  if (key.startsWith('GET /repos/o/r/pulls?') || key.startsWith('GET /repos/o/r/branches?')) return { body: [] };
  if (key.startsWith('GET /repos/o/r/issues?')) return { body: [] };
  return undefined;
};

test('SEC87R3: fetchDailyInput keeps the gap mark in the window', async () => {
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const r = route(`${init.method ?? 'GET'} ${u.pathname}${u.search}`);
    return r ? new Response(JSON.stringify(r.body), { status: r.status ?? 200 }) : new Response('{"message":"Not Found"}', { status: 404 });
  };
  const gh = client({ token: 'test-token-not-real', repo: 'o/r' });
  const input = await fetchDailyInput(gh, { since: new Date('2026-11-11T05:00:00Z'), until: new Date('2026-11-12T06:00:00Z'), note: 'n', gap: true });
  assert.equal(input.window.gap, true);
});

test('SEC87R3: `daily` without --since reports a window that could not start at the last checked run', async () => {
  const server = http.createServer((req, res) => {
    const r = route(`${req.method} ${req.url}`, { runsFail: true });
    res.setHeader('content-type', 'application/json');
    if (!r) return res.writeHead(req.method === 'GET' ? 404 : 201).end(req.method === 'GET' ? '{"message":"Not Found"}' : '{}');
    res.writeHead(r.status ?? 200).end(JSON.stringify(r.body));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const env = { PATH: process.env.PATH, GITHUB_API_URL: `http://127.0.0.1:${server.address().port}`, GITHUB_REPOSITORY: 'o/r', GITHUB_TOKEN: 'test-token-not-real' };
  const index = new URL('../index.mjs', import.meta.url).pathname;
  const out = await new Promise((resolve) =>
    execFile(process.execPath, [index, 'daily', '--until', '2026-11-12T06:00:00Z'], { env }, (err, stdout) => resolve({ code: err?.code ?? 0, stdout })),
  );
  server.close();
  assert.match(out.stdout, /вікно перевірки/, out.stdout);
  assert.notEqual(out.code, 0, 'a gap is an alert');
});

