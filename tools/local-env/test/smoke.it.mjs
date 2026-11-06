// Smoke test against the running local stack (CICD-04, row «Локальне»). Run after `pnpm local:up`:
// `pnpm local:smoke`. CI runs it on every PR (job local-env). Writes only synthetic values.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STATE_DIR } from '../lib/docker.mjs';
import { mailApiUrl, mailCount, pgAuthRequest, psql, s3Request, s3Url, sendMail, token } from '../lib/smoke.mjs';
import { readState } from '../lib/state.mjs';

const state = readState(STATE_DIR);
if (!state) throw new Error('The local environment was never started: run `pnpm local:up` first.');
const { values, envPath } = state;

test('CICD-04 local / ARC-03 FR1: PostgreSQL 17 answers, in UTC, with NUMERIC(38,18) amounts', () => {
  assert.match(psql(envPath, values, 'show server_version'), /^17\./);
  assert.equal(psql(envPath, values, 'show timezone'), 'UTC');
  assert.equal(psql(envPath, values, "select '12345.678900000000000001'::numeric(38,18)"), '12345.678900000000000001');
});

test('CICD-04 local: PostgreSQL on the published port demands SCRAM-SHA-256 password authentication', async () => {
  const auth = await pgAuthRequest(values);
  assert.equal(auth.code, 10, 'AuthenticationSASL, not trust (0) or cleartext (3)');
  assert.ok(auth.mechanisms.includes('SCRAM-SHA-256'), auth.mechanisms.join(','));
});

test('CICD-04 local: mail sent over SMTP is caught locally and visible in the mail API', async () => {
  const subject = `ws-smoke-${token()}`;
  await sendMail(values, {
    user: values.WS_LOCAL_SMTP_USER,
    password: values.WS_LOCAL_SMTP_PASSWORD,
    from: 'no-reply@example.test',
    to: 'synthetic.member@example.test',
    subject,
    text: 'Synthetic smoke message.',
  });
  assert.equal(await mailCount(values, `subject:"${subject}"`), 1);
});

test('CICD-04 local: SMTP refuses a wrong password', async () => {
  await assert.rejects(
    sendMail(values, {
      user: values.WS_LOCAL_SMTP_USER,
      password: 'wrong-password',
      from: 'no-reply@example.test',
      to: 'synthetic.member@example.test',
      subject: 'never delivered',
      text: 'x',
    }),
    /SMTP step AUTH got 535/,
  );
});

test('CICD-04 local: the mail web UI and API refuse access without the generated login', async () => {
  const res = await fetch(mailApiUrl(values, '/api/v1/messages'));
  assert.equal(res.status, 401);
});

test('CICD-04 local: S3 storage stores and returns an object with the generated key', async () => {
  const url = s3Url(values, values.WS_LOCAL_S3_BUCKET, `smoke/${token()}.txt`);
  const content = `synthetic ${token()}`;
  const put = await s3Request(values, 'PUT', url, content);
  assert.equal(put.status, 200, await put.text());
  const get = await s3Request(values, 'GET', url);
  assert.equal(get.status, 200);
  assert.equal(await get.text(), content);
  const del = await s3Request(values, 'DELETE', url);
  assert.equal(del.status, 204);
});

test('ARC-06 FR4: S3 storage refuses unsigned and wrongly signed access', async () => {
  const url = s3Url(values, values.WS_LOCAL_S3_BUCKET, `smoke/${token()}.txt`);
  const anonymous = await fetch(url, { method: 'PUT', body: 'x' });
  assert.equal(anonymous.status, 403);
  const wrong = await s3Request({ ...values, WS_LOCAL_S3_SECRET_KEY: 'wrong-secret' }, 'PUT', url, 'x');
  assert.equal(wrong.status, 403);
  const list = await fetch(s3Url(values, values.WS_LOCAL_S3_BUCKET));
  assert.equal(list.status, 403);
});
