// Security review #92: `changes` fails closed end to end — an API error or a list shorter than the PR's
// changed_files runs every heavy job. A local HTTP server stands in for api.github.com (127.0.0.1 only).
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const INDEX = new URL('../index.mjs', import.meta.url).pathname;

async function changes({ status = 200, files, changedFiles }) {
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url.startsWith('/repos/o/r/pulls/5/files')) return res.writeHead(status).end(JSON.stringify(status === 200 ? files : { message: 'boom' }));
    return res.writeHead(404).end('{"message":"Not Found"}');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sec92-'));
  const event = path.join(dir, 'event.json');
  const output = path.join(dir, 'output');
  fs.writeFileSync(event, JSON.stringify({ pull_request: { number: 5, title: 'CICD-01: x', body: '', changed_files: changedFiles, base: { sha: 'b'.repeat(40) } } }));
  const env = {
    PATH: process.env.PATH,
    GITHUB_API_URL: `http://127.0.0.1:${server.address().port}`,
    GITHUB_REPOSITORY: 'o/r',
    GITHUB_TOKEN: 'test-token-not-real',
    GITHUB_EVENT_PATH: event,
    GITHUB_OUTPUT: output,
  };
  const code = await new Promise((resolve) => execFile(process.execPath, [INDEX, 'changes'], { env }, (err) => resolve(err?.code ?? 0)));
  server.close();
  const out = fs.existsSync(output) ? fs.readFileSync(output, 'utf8') : '';
  fs.rmSync(dir, { recursive: true, force: true });
  return { code, out };
}

const ALL = 'web=true\napi=true\nlocal-env=true\ninfra=true\ne2e=true\n';

test('sec92: the files API failing runs every heavy job', async () => {
  for (const status of [500, 403, 404]) {
    const r = await changes({ status, changedFiles: 1 });
    assert.equal(r.out, ALL, String(status));
  }
});

test('sec92: a list shorter than changed_files (the 3000-file cap) runs every heavy job', async () => {
  const docs = [{ filename: 'docs/x.md', status: 'modified' }];
  assert.equal((await changes({ files: docs, changedFiles: 3001 })).out, ALL);
  assert.equal((await changes({ files: docs, changedFiles: 1 })).out, 'web=false\napi=false\nlocal-env=false\ninfra=false\ne2e=false\n');
});
