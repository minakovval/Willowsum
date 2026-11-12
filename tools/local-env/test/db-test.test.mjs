// `pnpm db:test` (owner decision 2026-11-12): pure parts — names, URLs, server choice. No database needed.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  adminUrlFromState,
  createdMessage,
  databaseUrl,
  dbEnvContent,
  dbEnvFile,
  isTestDbName,
  psqlConnection,
  redactUrl,
  resolveServer,
  sanitizeTag,
  testDbName,
} from '../lib/db-test.mjs';

const PW = ['not', 'a', 'real', 'value'].join('-');

test('names are unique, safe identifiers that drop accepts; other names are refused', () => {
  assert.equal(sanitizeTag('claude/adoring-cray-feh4dh-tooling'), 'cray_feh4dh_tooling');
  assert.equal(sanitizeTag('A;DROP TABLE x--'), 'a_drop_table_x');
  assert.equal(sanitizeTag(''), 'agent');
  assert.equal(sanitizeTag('///'), 'agent');
  const a = testDbName('main');
  const b = testDbName('main');
  assert.notEqual(a, b);
  assert.match(a, /^ws_t_main_[0-9a-f]{8}$/);
  assert.ok(testDbName('x'.repeat(200), 'abcdef01').length <= 63);
  assert.equal(isTestDbName(a), true);
  for (const bad of ['postgres', 'willowsum', 'ws_it_abcdef012345', 'ws_t_x_abcdef01; DROP DATABASE y', 'ws_t__abcdef01', 'WS_T_X_ABCDEF01']) {
    assert.equal(isTestDbName(bad), false, bad);
  }
});

test('URLs: the database is swapped, credentials kept; psql gets the password through the environment', () => {
  const admin = `postgres://u:${PW}@127.0.0.1:5432/postgres`;
  assert.equal(databaseUrl(admin, 'ws_t_x_abcdef01'), `postgres://u:${PW}@127.0.0.1:5432/ws_t_x_abcdef01`);
  const c = psqlConnection(admin);
  assert.equal(c.env.PGPASSWORD, PW);
  assert.ok(!c.args.join(' ').includes(PW), 'no password in argv');
  assert.ok(c.args.includes('ON_ERROR_STOP=1'));
  const state = { WS_LOCAL_PG_PORT: '5433', WS_LOCAL_PG_USER: 'willowsum', WS_LOCAL_PG_PASSWORD: PW, WS_LOCAL_PG_DB: 'willowsum' };
  assert.equal(adminUrlFromState(state), `postgres://willowsum:${PW}@127.0.0.1:5433/willowsum`);
  const msg = createdMessage('ws_t_x_abcdef01', databaseUrl(admin, 'ws_t_x_abcdef01'), 'infra/local/.state/db-test/ws_t_x_abcdef01.env');
  assert.ok(!msg.includes(PW), 'create never prints the password');
  assert.match(msg, /^DATABASE_URL \(password hidden\): postgres:\/\/u:\*\*\*@127\.0\.0\.1:5432\/ws_t_x_abcdef01$/m);
  assert.match(msg, /infra\/local\/\.state\/db-test\/ws_t_x_abcdef01\.env/);
  assert.ok(!redactUrl(`postgres://u@h/d?password=${PW}`).includes(PW));
  assert.equal(dbEnvFile('/s', 'ws_t_x_abcdef01'), '/s/db-test/ws_t_x_abcdef01.env');
  assert.equal(dbEnvContent("postgres://u:a'b@h/d"), "DATABASE_URL='postgres://u:a'\\''b@h/d'\n");
});

test('server: WS_TEST_PG_ADMIN_URL wins, else the local:up stack with Docker, else a clear error', () => {
  const url = `postgres://u:${PW}@127.0.0.1:5432/postgres`;
  assert.deepEqual(resolveServer({ env: { WS_TEST_PG_ADMIN_URL: url }, docker: true }), { kind: 'url', url });
  assert.equal(resolveServer({ env: { WS_TEST_PG_ADMIN_URL: 'mysql://x' }, docker: true }).kind, 'none');
  assert.equal(resolveServer({ env: {}, docker: true }).kind, 'compose');
  const none = resolveServer({ env: {}, docker: false });
  assert.equal(none.kind, 'none');
  assert.match(none.message, /WS_TEST_PG_ADMIN_URL/);
});
