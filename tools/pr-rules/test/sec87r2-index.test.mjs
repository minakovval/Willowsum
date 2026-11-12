// Security re-review of PR #87 (CICD-01), round 2: `label`, `daily` and `alerted` end to end against a local
// stand-in for api.github.com (127.0.0.1 only).
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const INDEX = new URL('../index.mjs', import.meta.url).pathname;
const PATHS = fs.readFileSync(new URL('../lib/paths.mjs', import.meta.url), 'utf8');

/** Run `args` with `route(method, url) → { status?, body } | undefined` as the API; returns { code, stdout, posts }. */
async function run(args, route, pr = {}) {
  const posts = [];
  const server = http.createServer((req, res) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      if (req.method !== 'GET') posts.push({ url: req.url, body: JSON.parse(data || '{}') });
      const r = route(req.method, req.url);
      res.setHeader('content-type', 'application/json');
      if (!r) return res.writeHead(req.method === 'GET' ? 404 : 201).end(req.method === 'GET' ? '{"message":"Not Found"}' : '{}');
      res.writeHead(r.status ?? 200).end(typeof r.body === 'string' ? r.body : JSON.stringify(r.body ?? {}));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-rules-r2-'));
  const event = path.join(dir, 'event.json');
  fs.writeFileSync(event, JSON.stringify({ pull_request: { number: 5, title: 'CICD-01: x', body: '', base: { sha: 'b'.repeat(40) }, head: { repo: { full_name: 'o/r' } }, ...pr } }));
  const env = { PATH: process.env.PATH, GITHUB_API_URL: `http://127.0.0.1:${server.address().port}`, GITHUB_REPOSITORY: 'o/r', GITHUB_TOKEN: 'test-token-not-real', GITHUB_EVENT_PATH: event };
  const result = await new Promise((resolve) => {
    execFile(process.execPath, [INDEX, ...args], { env }, (err, stdout) => resolve({ code: err?.code ?? 0, stdout }));
  });
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
  return { ...result, posts };
}
const labelsSet = (posts) => posts.filter((p) => p.url === '/repos/o/r/issues/5/labels').flatMap((p) => p.body.labels);
const filesRoute = (files, extra = () => undefined) => (method, url) =>
  method === 'GET' && url.startsWith('/repos/o/r/pulls/5/files') ? { body: files } : extra(method, url);

test('SEC87R2: `label` unions the base map when the PR edits the map (a category dropped by the PR still labels it)', async () => {
  const old = PATHS.replace("  money: [\n", "  money: [\n    'apps/web/**',\n");
  const files = [{ filename: 'tools/pr-rules/lib/paths.mjs', status: 'modified', patch: '-x' }, { filename: 'apps/web/src/App.tsx', status: 'modified', patch: '+x' }];
  const r = await run(['label'], filesRoute(files, (m, url) =>
    url.startsWith('/repos/o/r/contents/tools/pr-rules/lib/paths.mjs?ref=bbbb')
      ? { body: { encoding: 'base64', content: Buffer.from(old).toString('base64') } }
      : undefined), { changed_files: 2 });
  assert.equal(r.code, 0, r.stdout);
  assert.ok(labelsSet(r.posts).includes('sensitive:money'), JSON.stringify(labelsSet(r.posts)));
});

test('SEC87R2: `label` treats files beyond the API list as sensitive (changed_files larger than the list)', async () => {
  const files = [{ filename: 'apps/web/src/App.tsx', status: 'modified', patch: '+x' }];
  const r = await run(['label'], filesRoute(files), { changed_files: 3001 });
  assert.ok(labelsSet(r.posts).includes('sensitive:unlisted'), JSON.stringify(labelsSet(r.posts)));
});

test('SEC87R2: `daily` that cannot read the API opens the alert issue, prints no injected command, and fails', async () => {
  const r = await run(['daily', '--issue', '--since', '2026-11-11T00:00:00Z', '--until', '2026-11-12T00:00:00Z'], (method, url) => {
    if (method === 'GET' && url === '/repos/o/r') return { status: 502, body: 'bad gateway\n::error::injected' };
    if (method === 'GET' && url.startsWith('/repos/o/r/issues?')) return { body: [] };
    return undefined;
  });
  assert.notEqual(r.code, 0);
  assert.ok(r.posts.some((p) => p.url === '/repos/o/r/issues' && /HTTP 502/.test(p.body.body)), JSON.stringify(r.posts));
  assert.ok(!/^::error::injected/m.test(r.stdout), r.stdout);
});

test('SEC87R2: `alerted` (the step after findings) fails the run', async () => {
  const r = await run(['alerted'], () => undefined);
  assert.equal(r.code, 1);
  assert.match(r.stdout, /^::error::/m);
});

