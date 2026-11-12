// Security review #92 (blocking): `pnpm db:test` (create) printed the superuser password inside DATABASE_URL;
// agent output ends up in chat (AGENTS.md: secrets never go to chat; info.mjs never prints secret values).
// Fixed: the password is hidden; the full URL goes to a git-ignored 0600 file.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createdMessage, databaseUrl, isTestDbName, sanitizeTag } from '../lib/db-test.mjs';

const PW = ['not', 'a', 'real', 'value'].join('-');

test('sec92: create never prints the admin password', () => {
  const url = databaseUrl(`postgres://su:${PW}@127.0.0.1:5432/postgres`, 'ws_t_x_abcdef01');
  const msg = createdMessage('ws_t_x_abcdef01', url, 'infra/local/.state/db-test/ws_t_x_abcdef01.env');
  assert.ok(!msg.includes(PW), msg.replaceAll(PW, '<PW>'));
});

test('sec92: drop refuses look-alike names (newline, quotes, upper case, too long, wrong hex)', () => {
  for (const bad of ['ws_t_x_abcdef01\n', 'ws_t_x_abcdef01\nDROP DATABASE postgres', '"ws_t_x_abcdef01"', 'ws_t_x_ABCDEF01', `ws_t_${'a'.repeat(21)}_abcdef01`, 'ws_t_x_abcdef0g', 'ws_t_x_abcdef012', ' ws_t_x_abcdef01']) {
    assert.equal(isTestDbName(bad), false, JSON.stringify(bad));
  }
  for (const tag of ['a"; DROP DATABASE postgres; --', "x'y", 'a b\nc', '../../etc', 'Ж']) assert.match(sanitizeTag(tag), /^[a-z0-9_]{1,20}$/, tag);
});
