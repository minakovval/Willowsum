// CICD-01 (ADR-0008): the `label` and `description` commands end to end — a local HTTP server stands in for
// api.github.com (127.0.0.1 only), the event comes from a file, as in the workflow.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const INDEX = new URL('../index.mjs', import.meta.url).pathname;

/** Run a command against a fake API serving `files` for PR 5; returns { code, stdout, posts }. */
async function run(command, { files, title = 'CICD-01: x', body = '', fork = false }) {
  const posts = [];
  const server = http.createServer((req, res) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      if (req.method === 'POST') posts.push({ url: req.url, body: JSON.parse(data || '{}') });
      res.setHeader('content-type', 'application/json');
      if (req.method === 'GET' && req.url.startsWith('/repos/o/r/pulls/5/files')) return res.end(JSON.stringify(files));
      if (req.method === 'GET') return res.writeHead(404).end('{"message":"Not Found"}');
      return res.writeHead(201).end('{}');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-rules-'));
  const event = path.join(dir, 'event.json');
  const pr = { number: 5, title, body, changed_files: files.length, base: { sha: 'b'.repeat(40) }, head: { repo: { full_name: fork ? 'x/r' : 'o/r' } } };
  fs.writeFileSync(event, JSON.stringify({ pull_request: pr }));
  const env = {
    PATH: process.env.PATH,
    GITHUB_API_URL: `http://127.0.0.1:${server.address().port}`,
    GITHUB_REPOSITORY: 'o/r',
    GITHUB_TOKEN: 'test-token-not-real',
    GITHUB_EVENT_PATH: event,
  };
  const result = await new Promise((resolve) => {
    execFile(process.execPath, [INDEX, command], { env }, (err, stdout) => resolve({ code: err?.code ?? 0, stdout }));
  });
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
  return { ...result, posts };
}
const labelsSet = (posts) => posts.filter((p) => p.url === '/repos/o/r/issues/5/labels').flatMap((p) => p.body.labels);

test('review #87 item 4a: `label` classifies a renamed file by its old name too', async () => {
  const files = [{ filename: 'apps/web/src/x.ts', previous_filename: 'apps/api/src/modules/ledger/x.ts', status: 'renamed' }];
  const r = await run('label', { files });
  assert.equal(r.code, 0, r.stdout);
  assert.deepEqual(labelsSet(r.posts), ['sensitive', 'sensitive:money']);
});

test('review #87 item 3: `label` adds `owner-decision` for rule and requirement files; a fork PR gets no labels', async () => {
  const files = [{ filename: 'AGENTS.md', status: 'modified', patch: '+x' }];
  assert.deepEqual(labelsSet((await run('label', { files })).posts), ['owner-decision']);
  assert.deepEqual(labelsSet((await run('label', { files, fork: true })).posts), []);
});

test('review #87 item 9: `label` logs file names without newlines or workflow commands', async () => {
  const files = [{ filename: 'infra/a\n::error::x.tf', status: 'added', patch: '+x' }];
  const r = await run('label', { files });
  assert.ok(!/^::error::x/m.test(r.stdout), r.stdout);
});

test('review #87 item 4a: `description` needs «Sensitive areas touched» ticked for a file renamed out of a sensitive path', async () => {
  const files = [{ filename: 'apps/web/src/x.ts', previous_filename: 'infra/start/x.tf', status: 'renamed' }];
  const body = '## Requirement\nx\n## Acceptance criteria covered\nx\n## How it was tested\n- [x] tests\n## Sensitive areas touched\n- [ ] yes\n';
  const r = await run('description', { files, body });
  assert.equal(r.code, 1, r.stdout);
  assert.match(r.stdout, /infrastructure/);
  assert.equal((await run('description', { files, body: body.replace('- [ ] yes', '- [x] yes') })).code, 0);
});

test('CI minutes: `changes` skips heavy jobs for a docs-only PR and runs all of them for code', async () => {
  const docs = await run('changes', { files: [{ filename: 'docs/ops/integrations.md', status: 'modified' }] });
  assert.equal(docs.code, 0, docs.stdout);
  assert.match(docs.stdout, /^web=false\napi=false\nlocal-env=false\ninfra=false$/m);
  const code = await run('changes', { files: [{ filename: 'infra/start/network.tf', status: 'modified' }] });
  assert.match(code.stdout, /^web=true\napi=true\nlocal-env=false\ninfra=true$/m);
});
