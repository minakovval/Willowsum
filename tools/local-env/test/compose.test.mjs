// Static rules for infra/local/compose.yaml (no Docker needed).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { COMPOSE_FILE, REPO_ROOT } from '../lib/docker.mjs';

const text = fs.readFileSync(COMPOSE_FILE, 'utf8');
const body = text
  .split('\n')
  .filter((l) => !l.trimStart().startsWith('#'))
  .join('\n');

// Image → licence. CICD-02: dependency licences only from the allowed list (MIT, Apache-2.0, BSD, ISC …).
const ALLOWED_IMAGES = {
  postgres: 'PostgreSQL (permissive, BSD-like)',
  'axllent/mailpit': 'MIT',
  'chrislusf/seaweedfs': 'Apache-2.0',
};

const images = [...body.matchAll(/^\s+image:\s*(\S+)\s*$/gm)].map((m) => m[1]);

test('CICD-04 local: the stack has a database, a mail server and S3-compatible storage', () => {
  for (const service of ['postgres', 'mail', 's3']) {
    assert.match(body, new RegExp(`^  ${service}:\\s*$`, 'm'), `service ${service}`);
  }
  assert.equal(images.length, 3);
});

test('ARC-03 FR1: the database is PostgreSQL 17 and runs in UTC', () => {
  assert.match(images.find((i) => i.startsWith('postgres:')), /^postgres:17\.\d+-alpine@/);
  assert.match(body, /^\s+TZ: UTC$/m);
  assert.match(body, /^\s+PGTZ: UTC$/m);
});

test('CICD-03 FR3 / CICD-02: every image is pinned to a version and a digest, licence allowed', () => {
  for (const image of images) {
    const m = /^([a-z0-9./-]+):([A-Za-z0-9._-]+)@sha256:[0-9a-f]{64}$/.exec(image);
    assert.ok(m, `${image} is pinned as name:version@sha256:<digest>`);
    assert.notEqual(m[2], 'latest', `${image} uses a version tag`);
    assert.ok(ALLOWED_IMAGES[m[1]], `${m[1]} has a licence from the allowed list`);
  }
});

test('CICD-04 local: services are reachable only from this machine (ports on 127.0.0.1)', () => {
  const ports = [...body.matchAll(/^\s+- "([^"]+)"$/gm)].map((m) => m[1]).filter((p) => /:\d+$/.test(p));
  assert.ok(ports.length >= 4, 'database, SMTP, mail UI and S3 ports are published');
  for (const port of ports) assert.match(port, /^127\.0\.0\.1:/, port);
});

test('CICD-12 FR1: no credential values in the compose file, only generated variables', () => {
  for (const m of body.matchAll(/^\s+([A-Z_]*(PASSWORD|SECRET|AUTH|USER)[A-Z_]*):\s*(.+)$/gm)) {
    const [, key, , value] = m;
    if (/^"(true|false)"$/.test(value)) continue; // switches, not credentials
    assert.match(value, /^\$\{WS_LOCAL_[A-Z0-9_]+:\?run pnpm local:up\}(:\$\{WS_LOCAL_[A-Z0-9_]+:\?run pnpm local:up\})?$/, key);
  }
});

test('CICD-04 local: every service has a health check, so one command waits until all are ready', () => {
  const services = body.split(/^  (?=[a-z0-9-]+:\s*$)/m).slice(1).filter((s) => !s.startsWith('postgres-data'));
  const named = services.filter((s) => /^(postgres|mail|s3):/.test(s));
  assert.equal(named.length, 3);
  for (const s of named) assert.match(s, /healthcheck:\n\s+test:/, s.split(':')[0]);
});

test('CICD-12 FR1: generated state is git-ignored', () => {
  // `git check-ignore -q` takes exactly one path.
  for (const file of ['infra/local/.state/local.env', 'infra/local/.state/anything-else']) {
    const res = spawnSync('git', ['check-ignore', '-q', file], { cwd: REPO_ROOT });
    assert.equal(res.status, 0, `${file} is ignored by git`);
  }
});

test('CICD-04 local: the S3 gateway accepts only the generated key (one identity, from variables)', () => {
  const config = /^configs:\n {2}s3-identities:\n {4}content: \|\n((?: {6}.*\n)+)/m.exec(body);
  assert.ok(config, 'configs.s3-identities.content is defined');
  const json = JSON.parse(config[1].replaceAll(/\$\{(WS_LOCAL_[A-Z0-9_]+):\?run pnpm local:up\}/g, '<$1>'));
  assert.equal(json.identities.length, 1);
  assert.deepEqual(json.identities[0].credentials, [
    { accessKey: '<WS_LOCAL_S3_ACCESS_KEY>', secretKey: '<WS_LOCAL_S3_SECRET_KEY>' },
  ]);
  assert.match(body, /- source: s3-identities\n\s+target: \/etc\/willowsum\/s3\.json\n/);
});
