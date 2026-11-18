import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import {
  DEV_DATABASE,
  confirmQuestion,
  defaultBackupPath,
  dumpArgs,
  fileMessage,
  formatSize,
  isYes,
  parseBackupArgs,
  parseRestoreArgs,
  recreateSql,
  restoreArgs,
  rolesFile,
  toolCommand,
} from '../lib/backup.mjs';

const index = new URL('../index.mjs', import.meta.url).pathname;
const run = (args, env = {}) =>
  spawnSync(process.execPath, [index, ...args], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: os.tmpdir(), ...env }, input: '' });
const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ws-bk-')), 'a.dump');

test('CICD-04 local: backup and restore work on the database of `pnpm local:dev` and nothing else', () => {
  const src = fs.readFileSync(new URL('../../../apps/api/scripts/lib/local-dev.ts', import.meta.url), 'utf8');
  assert.equal(/DEV_DATABASE = "([a-z_]+)"/.exec(src)?.[1], DEV_DATABASE);
  assert.doesNotMatch(DEV_DATABASE, /^ws_t_/, 'never a test database');
  assert.equal(recreateSql(), `DROP DATABASE IF EXISTS ws_dev;\nCREATE DATABASE ws_dev;\n`);
  assert.doesNotMatch(recreateSql(), /FORCE/, 'a running `pnpm local:dev` makes the restore stop instead of being cut off');
});

test('CICD-04 local: the default backup file is outside the repository, named by the UTC time', () => {
  const file = defaultBackupPath(new Date('2026-11-18T07:05:09.123Z'), '/home/owner');
  assert.equal(file, '/home/owner/Willowsum-backups/ws_dev-20261118T070509Z.dump');
  assert.equal(rolesFile(file), `${file}.roles.sql`);
});

test('CICD-04 local: backup takes one optional file, restore one file and --yes; anything else is refused', () => {
  assert.deepEqual(parseBackupArgs([]), { file: undefined });
  assert.deepEqual(parseBackupArgs(['--', 'a.dump']), { file: 'a.dump' });
  assert.match(parseBackupArgs(['--yes']).error, /unknown option/);
  assert.ok(parseBackupArgs(['a', 'b']).error);
  assert.deepEqual(parseRestoreArgs(['a.dump']), { file: 'a.dump', yes: false });
  assert.deepEqual(parseRestoreArgs(['a.dump', '--yes']), { file: 'a.dump', yes: true });
  assert.ok(parseRestoreArgs([]).error, 'the file is required');
  assert.match(parseRestoreArgs(['a.dump', '--force']).error, /unknown option/);
});

test('CICD-04 local: restore asks before it overwrites; only a clear «yes» continues', () => {
  assert.match(confirmQuestion('/x/a.dump'), /replaces the local database ws_dev/);
  assert.match(confirmQuestion('/x/a.dump'), /pnpm local:dev/);
  for (const a of ['yes', ' YES\n', 'Yes']) assert.equal(isYes(a), true, a);
  for (const a of ['', 'y', 'no', 'yes please', undefined]) assert.equal(isYes(a), false, String(a));
});

test('CICD-04 local: the path and the size are printed', () => {
  assert.equal(formatSize(512), '512 B');
  assert.equal(formatSize(2628), '2.6 KiB');
  assert.equal(formatSize(5 * 1024 * 1024), '5.0 MiB');
  assert.equal(fileMessage('Saved', '/x/a.dump', 2628), 'Saved: /x/a.dump (2.6 KiB, 2628 bytes)');
});

test('CICD-04 local: the dump is a custom-format archive and a restore stops at the first error', () => {
  assert.ok(dumpArgs().includes('-Fc'));
  assert.ok(restoreArgs().includes('--exit-on-error'));
});

test('CICD-04 local: tools run in the container of `local:up`, or the local client with the password in the environment', () => {
  const compose = { kind: 'compose', user: 'willowsum', composeArgs: (a) => ['compose', ...a] };
  const [cmd, args, env] = toolCommand(compose, 'pg_dump', 'ws_dev', ['-Fc']);
  assert.equal(cmd, 'docker');
  assert.deepEqual(args, ['compose', 'exec', '-T', 'postgres', 'pg_dump', '-U', 'willowsum', '-d', 'ws_dev', '-Fc']);
  assert.deepEqual(env, {});
  const [c2, a2, e2] = toolCommand({ kind: 'url', url: 'postgres://postgres:s3cret@127.0.0.1:5432/postgres' }, 'pg_restore', 'ws_dev', ['--list']);
  assert.equal(c2, 'pg_restore');
  assert.deepEqual(a2, ['--dbname=postgres://postgres@127.0.0.1:5432/ws_dev', '--list']);
  assert.deepEqual(e2, { PGPASSWORD: 's3cret' });
  assert.ok(!JSON.stringify(a2).includes('s3cret'), 'no password in argv');
});

test('CICD-04 local: backup and restore never reach another host', () => {
  const remote = { WS_TEST_PG_ADMIN_URL: 'postgres://postgres@db.example.com:5432/postgres' };
  const file = tmpFile();
  fs.writeFileSync(file, 'x');
  const out = tmpFile();
  for (const args of [['backup', out], ['restore', file, '--yes']]) {
    const res = run(args, remote);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /must point at this machine/);
  }
  assert.equal(fs.existsSync(out), false);
});

test('CICD-04 local: restore of a missing file or without a file stops before anything is touched', () => {
  assert.match(run(['restore']).stderr, /usage: pnpm local:restore/);
  assert.match(run(['restore', '/nonexistent/a.dump', '--yes']).stderr, /No such file/);
});

test('CICD-04 local: backup never overwrites an existing file', () => {
  const file = tmpFile();
  fs.writeFileSync(file, 'keep');
  const res = run(['backup', file]);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /never overwritten/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'keep');
});
