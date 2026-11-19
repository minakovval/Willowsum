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
  restoreArgs,
  rolesFile,
  STAGING_DATABASE,
  stagingSql,
  swapSql,
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
  assert.deepEqual(parseRestoreArgs(['-y', 'a.dump']), { file: 'a.dump', yes: true }, '-y is the short form of --yes');
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

// Reviewer patch (PR #520): stub PostgreSQL clients on PATH log each call and its stdin, so the order of restore steps
// is checked without a server. `pg_restore --list` fails when FAIL_LIST is set.
const stubs = (extra = {}) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-bk-bin-'));
  const log = path.join(dir, 'calls.log');
  const body = { psql: `cat >> "${log}"; echo 1`, pg_dump: 'printf PGDMP', pg_dumpall: 'echo "CREATE ROLE r;"', pg_restore: 'case "$*" in *--list*) [ -z "$FAIL_LIST" ] ;; esac' };
  for (const [name, cmd] of Object.entries(body)) fs.writeFileSync(path.join(dir, name), `#!/bin/sh\necho "${name} $*" >> "${log}"\n${cmd}\n`, { mode: 0o755 });
  const env = { PATH: `${dir}:${process.env.PATH}`, WS_TEST_PG_ADMIN_URL: 'postgres://postgres@127.0.0.1:1/postgres', ...extra };
  return { env, calls: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '') };
};

test('CICD-04 local: restore without --yes and without a terminal stops before the database is dropped', () => {
  const file = tmpFile();
  fs.writeFileSync(file, 'PGDMP');
  const s = stubs();
  const res = run(['restore', file], s.env);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /add --yes/);
  assert.doesNotMatch(s.calls(), /DROP DATABASE/);
  const yes = stubs();
  assert.equal(run(['restore', file, '--yes'], yes.env).status, 0, 'the stubs reach the drop with --yes');
  assert.match(yes.calls(), /CREATE DATABASE ws_dev_restore;[\s\S]*pg_restore .*ws_dev_restore[\s\S]*DROP DATABASE IF EXISTS ws_dev;/);
});

test('CICD-04 local: restore of a file that is not a backup stops before the database is dropped', () => {
  const file = tmpFile();
  fs.writeFileSync(file, 'not a dump');
  const s = stubs({ FAIL_LIST: '1' });
  const res = run(['restore', file, '--yes'], s.env);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /not a readable PostgreSQL backup/);
  assert.doesNotMatch(s.calls(), /DROP DATABASE/);
});

test('CICD-04 local: the backup and its roles file are readable by the owner only', () => {
  const out = tmpFile();
  const res = run(['backup', out], stubs().env);
  assert.equal(res.status, 0, res.stderr);
  assert.equal(fs.statSync(out).mode & 0o777, 0o600);
  assert.equal(fs.statSync(rolesFile(out)).mode & 0o777, 0o600);
});

test('CICD-04 local: a failed dump or restore never looks like a success; no password in argv, output or roles; a new folder is 0700', () => {
  const failing = (tool, body) => ((s) => (fs.writeFileSync(path.join(s.env.PATH.split(':')[0], tool), `#!/bin/sh\n${body}\n`), s))(stubs());
  const s = stubs({ WS_TEST_PG_ADMIN_URL: 'postgres://postgres:s3cret@127.0.0.1:1/postgres' });
  const out = path.join(path.dirname(tmpFile()), 'new', 'a.dump');
  const res = run(['backup', out], s.env);
  assert.equal(fs.statSync(path.dirname(out)).mode & 0o777, 0o700);
  assert.deepEqual(fs.readdirSync(path.dirname(out)).sort(), ['a.dump', 'a.dump.roles.sql'], 'no temporary file is left');
  assert.match(s.calls(), /^pg_dumpall .*--no-role-passwords/m);
  assert.doesNotMatch(s.calls() + res.stdout + res.stderr, /s3cret/);
  const bad = tmpFile();
  assert.equal(run(['backup', bad], failing('pg_dump', 'exit 3').env).status, 1);
  assert.deepEqual(fs.readdirSync(path.dirname(bad)), [], 'a failed dump leaves no file that looks like a backup');
  fs.writeFileSync(bad, 'PGDMP');
  const broken = run(['restore', bad, '--yes'], failing('pg_restore', 'case "$*" in *--list*) ;; *) exit 3 ;; esac').env);
  assert.equal(broken.status, 1);
  assert.doesNotMatch(broken.stdout, /Restored/);
});

// Fix round 1 (PR #520): B1 and B2 tests from the security review, then the roles replay and the roles file.
test('CICD-04 local: a restore goes into a staging database; ws_dev is replaced only after pg_restore succeeded', () => {
  assert.equal(STAGING_DATABASE, 'ws_dev_restore');
  assert.equal(stagingSql(), 'DROP DATABASE IF EXISTS ws_dev_restore;\nCREATE DATABASE ws_dev_restore;\n');
  assert.equal(swapSql(), 'DROP DATABASE IF EXISTS ws_dev;\nALTER DATABASE ws_dev_restore RENAME TO ws_dev;\n');
  assert.doesNotMatch(swapSql(), /FORCE/, 'a running `pnpm local:dev` makes the restore stop instead of being cut off');
  const file = tmpFile();
  fs.writeFileSync(file, 'PGDMP');
  const s = stubs();
  fs.writeFileSync(path.join(s.env.PATH.split(':')[0], 'pg_restore'), '#!/bin/sh\necho "pg_restore $*" >> "$(dirname "$0")/calls.log"\ncase "$*" in *--list*) ;; *) exit 3 ;; esac\n');
  const res = run(['restore', file, '--yes'], s.env);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /ws_dev is unchanged/);
  assert.match(s.calls(), /^pg_restore --dbname=\S+\/ws_dev_restore /m, 'the restore never writes into ws_dev');
  assert.doesNotMatch(s.calls(), /DROP DATABASE IF EXISTS ws_dev;/, 'ws_dev is not dropped when the restore failed');
  assert.match(s.calls(), /DROP DATABASE IF EXISTS ws_dev_restore;\n$/, 'the staging database is dropped afterwards');
});

test('CICD-04 local: a `dbname` parameter in WS_TEST_PG_ADMIN_URL cannot send a tool to another database', () => {
  const [, args] = toolCommand({ kind: 'url', url: 'postgres://postgres@127.0.0.1:5432/postgres?dbname=ws_t_other&sslmode=disable' }, 'pg_restore', 'ws_dev', []);
  assert.deepEqual(args, ['--dbname=postgres://postgres@127.0.0.1:5432/ws_dev?sslmode=disable']);
});

test('CICD-04 local: roles that could not be replayed are reported; a failed replay stops with ws_dev unchanged', () => {
  const file = tmpFile();
  fs.writeFileSync(file, 'PGDMP');
  fs.writeFileSync(rolesFile(file), 'CREATE ROLE postgres;\nALTER ROLE r WITH LOGIN;\n');
  const replay = (status) => {
    const s = stubs();
    const psql = `#!/bin/sh\necho "psql $*" >> "$(dirname "$0")/calls.log"\nin=$(cat); echo "$in" >> "$(dirname "$0")/calls.log"\ncase "$in" in *"CREATE ROLE"*) echo 'ERROR:  role "postgres" already exists' >&2; echo 'ERROR:  role "r" does not exist' >&2; exit ${status} ;; esac\necho 1\n`;
    fs.writeFileSync(path.join(s.env.PATH.split(':')[0], 'psql'), psql);
    return { s, res: run(['restore', file, '--yes'], s.env) };
  };
  const warned = replay(0);
  assert.equal(warned.res.status, 0, warned.res.stderr);
  assert.match(warned.res.stderr, /not applied[\s\S]*role "r" does not exist/);
  assert.doesNotMatch(warned.res.stderr, /already exists/, '«already exists» is expected and not reported');
  const failed = replay(2);
  assert.equal(failed.res.status, 1);
  assert.match(failed.res.stderr, /roles[\s\S]*ws_dev is unchanged/);
  assert.doesNotMatch(failed.s.calls(), /pg_restore --dbname=\S+\/ws_dev_restore /, 'no restore after a failed replay');
  assert.doesNotMatch(failed.s.calls(), /DROP DATABASE IF EXISTS ws_dev;/);
  assert.match(failed.s.calls(), /DROP DATABASE IF EXISTS ws_dev_restore;\n$/);
});

test('CICD-04 local: backup never writes the roles file through a link left at its path', () => {
  const out = tmpFile();
  const target = path.join(path.dirname(out), 'elsewhere.sql');
  fs.symlinkSync(target, rolesFile(out));
  const res = run(['backup', out], stubs().env);
  assert.equal(res.status, 1);
  assert.equal(fs.existsSync(target), false, 'the link target is not created');
  assert.equal(fs.existsSync(out), false, 'no backup without its roles file');
  assert.deepEqual(fs.readdirSync(path.dirname(out)), ['a.dump.roles.sql'], 'no temporary file is left');
});
