import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { connectionInfo } from '../lib/info.mjs';
import { SECRET_KEYS, ensureState } from '../lib/state.mjs';

test('CICD-12 FR1: status and up output never contain a secret value', () => {
  const { values } = ensureState(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ws-local-env-')), '.state'));
  const out = connectionInfo(values, 'infra/local/.state/local.env');
  for (const key of SECRET_KEYS) assert.ok(!out.includes(values[key]), `${key} is not printed`);
  for (const service of ['PostgreSQL 17', 'SMTP', 'Mail web UI', 'S3']) assert.ok(out.includes(service), service);
});
