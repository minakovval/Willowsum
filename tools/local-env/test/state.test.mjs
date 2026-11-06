import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { ENV_FILE, SECRET_KEYS, ensureState, parseEnv, readState } from '../lib/state.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ws-local-env-'));
const mode = (p) => fs.statSync(p).mode & 0o777;

test('CICD-04 local / CICD-12 FR2: first run generates every secret by machine, ≥ 32 random bytes', () => {
  const dir = path.join(tmp(), '.state');
  const { values, created } = ensureState(dir);
  assert.equal(created, true);
  for (const key of SECRET_KEYS) {
    assert.ok(Buffer.from(values[key], 'base64url').length >= 32, `${key} has at least 32 bytes`);
  }
  assert.match(values.WS_LOCAL_S3_ACCESS_KEY, /^WSLOCAL[0-9A-F]{16}$/);
});

test('CICD-12 FR5: two machines (fresh state dirs) never share secrets', () => {
  const a = ensureState(path.join(tmp(), '.state')).values;
  const b = ensureState(path.join(tmp(), '.state')).values;
  for (const key of [...SECRET_KEYS, 'WS_LOCAL_S3_ACCESS_KEY']) assert.notEqual(a[key], b[key], key);
});

test('CICD-04 local: credentials are private to the user (dir 0700, file 0600)', () => {
  const dir = path.join(tmp(), '.state');
  ensureState(dir);
  assert.equal(mode(dir), 0o700);
  assert.equal(mode(path.join(dir, ENV_FILE)), 0o600);
});

test('CICD-04 local: a credentials file with looser permissions is tightened back to 0600', () => {
  const dir = path.join(tmp(), '.state');
  const { envPath } = ensureState(dir);
  fs.chmodSync(envPath, 0o644);
  ensureState(dir);
  assert.equal(mode(envPath), 0o600);
  // A rewrite (new key added) also lands in a 0600 file.
  fs.writeFileSync(envPath, fs.readFileSync(envPath, 'utf8').replace(/^WS_LOCAL_S3_BUCKET=.*\n/m, ''));
  fs.chmodSync(envPath, 0o644);
  ensureState(dir);
  assert.equal(mode(envPath), 0o600);
  assert.deepEqual(fs.readdirSync(dir), ['local.env'], 'no temporary file is left behind');
});

test('CICD-04 local: later runs reuse the same credentials, so the database volume keeps working', () => {
  const dir = path.join(tmp(), '.state');
  const first = ensureState(dir);
  const second = ensureState(dir);
  assert.equal(second.created, false);
  assert.deepEqual(second.values, first.values);
  assert.deepEqual(readState(dir).values, first.values);
});

test('CICD-04 local: keys added in a newer tool version are filled in without touching existing ones', () => {
  const dir = path.join(tmp(), '.state');
  const { values, envPath } = ensureState(dir);
  const trimmed = fs
    .readFileSync(envPath, 'utf8')
    .split('\n')
    .filter((l) => !l.startsWith('WS_LOCAL_S3_BUCKET='))
    .join('\n');
  fs.writeFileSync(envPath, trimmed);
  const again = ensureState(dir).values;
  assert.equal(again.WS_LOCAL_PG_PASSWORD, values.WS_LOCAL_PG_PASSWORD);
  assert.equal(parseEnv(fs.readFileSync(envPath, 'utf8')).WS_LOCAL_S3_BUCKET, 'willowsum-files');
});

test('readState returns null before the first start', () => {
  assert.equal(readState(path.join(tmp(), '.state')), null);
});
