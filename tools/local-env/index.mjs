#!/usr/bin/env node
// Local environment (CICD-04@PoC): one command starts PostgreSQL, mail and S3 storage in Docker.
//
//   pnpm local:up      start (first run generates local credentials), wait until healthy, create the bucket
//   pnpm local:status  services, health and where to connect (secrets are never printed)
//   pnpm local:smoke   end-to-end check of all three services
//   pnpm local:down    stop; data is kept
//   pnpm local:reset   stop and delete all local data (volumes), then start empty
//   pnpm local:dev     the whole app for a person to click through: starts the services above, then the API, worker,
//                      scheduler and web dev server on the persistent database ws_dev (apps/api/scripts/local-dev.ts);
//                      `--fresh` starts with an empty database. With WS_TEST_PG_ADMIN_URL: that server, no Docker
//   pnpm local:backup [file]            a copy of the pnpm local:dev database ws_dev in a file (lib/backup.mjs)
//   pnpm local:restore <file> [--yes|-y]  replace ws_dev with the copy; asks first unless --yes (or -y)
//   pnpm db:test       a throwaway test database for this agent; prints DATABASE_URL with the password hidden and
//                      writes the full URL to infra/local/.state/db-test/<name>.env (0600, git-ignored; lib/db-test.mjs)
//                      `pnpm db:test drop <name>`, `pnpm db:test list`,
//                      `pnpm db:test run -- <command>`: a fresh database, DATABASE_URL set, a cluster-wide lock
//                      held (integration runs on one cluster queue up), the database dropped afterwards
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, STATE_DIR, compose, composeArgs, dockerAvailable, dockerRunning } from './lib/docker.mjs';
import { ensureBucket, ensureWritable, localDevS3Env, withoutLocalS3 } from './lib/s3.mjs';
import { connectionInfo } from './lib/info.mjs';
import { ensureState, readState } from './lib/state.mjs';
import {
  DEV_DATABASE,
  confirmQuestion,
  defaultBackupPath,
  dumpArgs,
  fileMessage,
  isYes,
  parseBackupArgs,
  parseRestoreArgs,
  dropStagingSql,
  restoreArgs,
  roleErrors,
  rolesDumpArgs,
  rolesFile,
  STAGING_DATABASE,
  stagingSql,
  swapSql,
  toolCommand,
} from './lib/backup.mjs';
import readline from 'node:readline/promises';
import { HOLDER_PID_ENV, LOCK_DATABASE } from '../test-guards/cluster-lock.mjs';
import { backupBesideKey, defaultKmsKeyFile, keyReminder } from './lib/kms-key.mjs';
import {
  LOCK_NAME,
  PREFIX,
  adminUrlFromState,
  createdMessage,
  databaseUrl,
  dbEnvContent,
  dbEnvFile,
  isTestDbName,
  psqlConnection,
  resolveServer,
  testDbName,
} from './lib/db-test.mjs';

const rel = (p) => path.relative(REPO_ROOT, p);

function fail(message) {
  console.error(`local-env: ${message}`);
  process.exit(1);
}

function requireDocker() {
  if (!dockerAvailable()) fail('Docker with the compose plugin is required (docker compose version failed).');
  if (!dockerRunning()) fail('Docker is installed but not running. Open Docker Desktop, wait until it says it is running, then run this command again.');
}

async function up() {
  requireDocker();
  const { values, envPath, created } = ensureState(STATE_DIR);
  if (created) console.log(`Generated local credentials in ${rel(envPath)}.`);
  const res = compose(envPath, ['up', '-d', '--wait', '--wait-timeout', '180']);
  if (res.status !== 0) fail('services did not become healthy; see `pnpm local:status` and `docker compose logs`.');
  const bucket = await ensureBucket(values);
  await ensureWritable(values);
  console.log(`Bucket ${values.WS_LOCAL_S3_BUCKET}: ${bucket}, writable.`);
  console.log(`\nLocal environment is up.\n${connectionInfo(values, rel(envPath))}`);
}

function down({ volumes = false } = {}) {
  requireDocker();
  const state = readState(STATE_DIR);
  if (!state) return console.log('Local environment was never started.');
  const res = compose(state.envPath, ['down', '--remove-orphans', ...(volumes ? ['--volumes'] : [])]);
  if (res.status !== 0) fail('docker compose down failed.');
  console.log(volumes ? 'Stopped; local data deleted.' : 'Stopped; local data kept.');
}

function status() {
  requireDocker();
  const state = readState(STATE_DIR);
  if (!state) return console.log('Local environment was never started. Run `pnpm local:up`.');
  compose(state.envPath, ['ps']);
  console.log(`\n${connectionInfo(state.values, rel(state.envPath))}`);
}

function smoke() {
  const res = spawnSync(process.execPath, ['--test', path.join(REPO_ROOT, 'tools/local-env/test/smoke.it.mjs')], {
    stdio: 'inherit',
  });
  process.exit(res.status ?? 1);
}

// ---- pnpm db:test ----

const hasPsql = () => !spawnSync('psql', ['--version'], { encoding: 'utf8' }).error;

/** The admin connection: [command, args, env] for psql, plus the host-side superuser URL. */
async function adminConnection() {
  const server = resolveServer({ env: process.env, docker: dockerAvailable() });
  if (server.kind === 'none') fail(server.message);
  if (server.kind === 'url') {
    if (!hasPsql()) fail('psql is required with WS_TEST_PG_ADMIN_URL.');
    const c = psqlConnection(server.url);
    const l = psqlConnection(databaseUrl(server.url, LOCK_DATABASE));
    return { url: server.url, argv: ['psql', c.args], env: c.env, lockArgv: ['psql', l.args], lockEnv: l.env };
  }
  // The local:up stack: start (or create) it, then run psql inside the container (no local psql needed).
  const { values, envPath } = ensureState(STATE_DIR);
  const res = compose(envPath, ['up', '-d', '--wait', '--wait-timeout', '180', 'postgres']);
  if (res.status !== 0) fail('PostgreSQL did not become healthy; see `pnpm local:status`.');
  const url = adminUrlFromState(values);
  const psqlIn = (db) => ['exec', '-T', 'postgres', 'psql', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-U', values.WS_LOCAL_PG_USER, '-d', db];
  return {
    url,
    argv: ['docker', composeArgs(envPath, psqlIn(values.WS_LOCAL_PG_DB))],
    env: {},
    lockArgv: ['docker', composeArgs(envPath, psqlIn(LOCK_DATABASE))],
    lockEnv: {},
  };
}

function sql(admin, text) {
  const [cmd, args] = admin.argv;
  const res = spawnSync(cmd, args, { input: text, encoding: 'utf8', env: { ...process.env, ...admin.env } });
  if (res.error || res.status !== 0) fail(`psql failed: ${(res.stderr || res.error?.message || '').trim()}`);
  return res.stdout.trim();
}

function currentTag() {
  const res = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: process.cwd(), encoding: 'utf8' });
  return res.status === 0 ? res.stdout.trim() : path.basename(process.cwd());
}

function createDb(admin) {
  const name = testDbName(currentTag());
  sql(admin, `CREATE DATABASE ${name};\n`);
  return name;
}

function dropDb(admin, name) {
  if (!isTestDbName(name)) fail(`not a test database name (${PREFIX}<tag>_<8 hex>): ${name}`);
  sql(admin, `DROP DATABASE IF EXISTS ${name} WITH (FORCE);\n`);
}

/**
 * Holds the cluster-wide advisory lock (tools/test-guards/cluster-lock.mjs) in a psql session on the `postgres`
 * database until `release()` is called; resolves to `{ release, pid }`, pid of the session that holds it.
 */
function lockCluster(admin) {
  const [cmd, args] = admin.lockArgv;
  const child = spawn(cmd, args, { env: { ...process.env, ...admin.lockEnv }, stdio: ['pipe', 'pipe', 'inherit'] });
  return new Promise((resolve, reject) => {
    let out = '';
    child.on('error', reject);
    child.on('exit', (code) => reject(new Error(`lock session ended (${code})`)));
    child.stdout.on('data', (d) => {
      out += d;
      const locked = /PID\s+(\d+)\s+LOCKED/.exec(out);
      if (locked) {
        child.removeAllListeners('exit');
        resolve({ pid: locked[1], release: () => child.stdin.end() });
      }
    });
    child.stdin.write(`\\echo PID\nSELECT pg_backend_pid();\nSELECT pg_advisory_lock(hashtext('${LOCK_NAME}'));\n\\echo LOCKED\n`);
  });
}

async function dbTest() {
  const [sub = 'create', ...rest] = process.argv.slice(3);
  const admin = await adminConnection();
  if (sub === 'create') {
    const name = createDb(admin);
    const url = databaseUrl(admin.url, name);
    const file = dbEnvFile(STATE_DIR, name);
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, dbEnvContent(url), { mode: 0o600 });
    console.log(createdMessage(name, url, rel(file)));
  } else if (sub === 'drop') {
    if (!rest[0]) fail('usage: pnpm db:test drop <name>');
    dropDb(admin, rest[0]);
    fs.rmSync(dbEnvFile(STATE_DIR, rest[0]), { force: true });
    console.log(`Dropped ${rest[0]}.`);
  } else if (sub === 'list') {
    console.log(sql(admin, `SELECT datname FROM pg_database WHERE datname LIKE '${PREFIX}%' ORDER BY 1;\n`) || '(none)');
  } else if (sub === 'run') {
    const cmd = rest[0] === '--' ? rest.slice(1) : rest;
    if (!cmd.length) fail('usage: pnpm db:test run -- <command…>');
    console.log('Waiting for the cluster lock (one integration run per PostgreSQL cluster)…');
    const { release, pid } = await lockCluster(admin);
    const name = createDb(admin);
    let status = 1;
    try {
      const res = spawnSync(cmd[0], cmd.slice(1), { stdio: 'inherit', env: { ...process.env, DATABASE_URL: databaseUrl(admin.url, name), [HOLDER_PID_ENV]: pid } });
      status = res.status ?? 1;
    } finally {
      dropDb(admin, name);
      release();
    }
    process.exitCode = status;
  } else {
    fail('usage: pnpm db:test [create|drop <name>|list|run -- <command…>]');
  }
}

// ---- pnpm local:dev ----

async function dev() {
  const server = resolveServer({ env: process.env, docker: dockerAvailable() });
  if (server.kind === 'none') fail(server.message);
  let url = server.url;
  // The role processes share the S3 storage started here (the API stores an import's original, the worker reads it);
  // without Docker (WS_TEST_PG_ADMIN_URL) the script gives them one directory instead.
  let s3 = {};
  if (server.kind === 'compose') {
    await up();
    const { values } = readState(STATE_DIR);
    url = adminUrlFromState(values);
    s3 = localDevS3Env(values);
  }
  const script = path.join(REPO_ROOT, 'apps/api/scripts/local-dev.ts');
  const child = spawn(process.execPath, [script, ...process.argv.slice(3)], {
    cwd: path.join(REPO_ROOT, 'apps/api'),
    stdio: 'inherit',
    env: { ...withoutLocalS3(process.env), ...s3, DATABASE_URL: url },
  });
  // Ctrl+C reaches both; the child stops the app and exits, this process follows it.
  process.on('SIGINT', () => {});
  await new Promise((resolve) => child.on('exit', (code) => resolve((process.exitCode = code ?? 1))));
}

// ---- pnpm local:backup / pnpm local:restore ----

/** The server of `pnpm local:dev`: the same choice as `dev` (WS_TEST_PG_ADMIN_URL, local only, or the compose stack). */
function backupServer() {
  const server = resolveServer({ env: process.env, docker: dockerAvailable() });
  if (server.kind === 'none') fail(server.message);
  if (server.kind === 'url') {
    if (spawnSync('pg_dump', ['--version']).error || spawnSync('pg_restore', ['--version']).error) fail('pg_dump and pg_restore are required with WS_TEST_PG_ADMIN_URL.');
    return server;
  }
  requireDocker();
  const state = readState(STATE_DIR);
  if (!state) fail('Local environment was never started. Run `pnpm local:dev` first.');
  const res = compose(state.envPath, ['up', '-d', '--wait', '--wait-timeout', '180', 'postgres']);
  if (res.status !== 0) fail('PostgreSQL did not become healthy; see `pnpm local:status`.');
  return { kind: 'compose', user: state.values.WS_LOCAL_PG_USER, composeArgs: (a) => composeArgs(state.envPath, a) };
}

/** Runs a client tool; `stdin` and `stdout` are file descriptors or 'pipe'. Returns the spawn result. */
function runTool(server, tool, db, args, { stdin = 'ignore', stdout = 'pipe', input } = {}) {
  const [cmd, argv, env] = toolCommand(server, tool, db, args);
  return spawnSync(cmd, argv, { env: { ...process.env, ...env }, stdio: [input !== undefined ? 'pipe' : stdin, stdout, 'pipe'], input, encoding: input ? 'utf8' : undefined, maxBuffer: 1 << 30 });
}

const stderrOf = (res) => String(res.stderr ?? res.error?.message ?? '').trim();

function hasDevDatabase(server) {
  const res = runTool(server, 'psql', 'postgres', ['-X', '-q', '-At', '-c', `SELECT 1 FROM pg_database WHERE datname = '${DEV_DATABASE}'`]);
  if (res.status !== 0) fail(`psql failed: ${stderrOf(res)}`);
  return String(res.stdout).trim() === '1';
}

async function backup() {
  const parsed = parseBackupArgs(process.argv.slice(3));
  if (parsed.error) fail(parsed.error);
  const file = path.resolve(parsed.file ?? defaultBackupPath());
  if (fs.existsSync(file) || fs.existsSync(rolesFile(file))) fail(`${file} already exists; it is never overwritten. Give another file name.`);
  // NFR-01@PoC FR 3: a copy of the database never travels with the installation's master key.
  if (backupBesideKey(file)) fail(`${file} is in the folder of the master key file; keep backups somewhere else.`);
  const server = backupServer();
  if (!hasDevDatabase(server)) fail(`The database ${DEV_DATABASE} does not exist yet: run \`pnpm local:dev\` first.`);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  const fd = fs.openSync(tmp, 'wx', 0o600);
  let res;
  try {
    res = runTool(server, 'pg_dump', DEV_DATABASE, dumpArgs(), { stdout: fd });
  } finally {
    fs.closeSync(fd);
  }
  if (res.status !== 0) {
    fs.rmSync(tmp, { force: true });
    fail(`pg_dump failed: ${stderrOf(res)}`);
  }
  const roles = runTool(server, 'pg_dumpall', 'postgres', rolesDumpArgs());
  if (roles.status !== 0) {
    fs.rmSync(tmp, { force: true });
    fail(`pg_dumpall failed: ${stderrOf(roles)}`);
  }
  try {
    // `wx`: never through a file or link that appeared at this path after the check above.
    fs.writeFileSync(rolesFile(file), roles.stdout, { mode: 0o600, flag: 'wx' });
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    fail(`Could not write ${rolesFile(file)}: ${err.message}`);
  }
  fs.renameSync(tmp, file);
  console.log(fileMessage('Saved', file, fs.statSync(file).size));
  console.log(fileMessage('Roles (no passwords)', rolesFile(file), fs.statSync(rolesFile(file)).size));
  console.log(`Restore with: pnpm local:restore ${file}`);
  console.log(keyReminder());
}

async function restore() {
  const parsed = parseRestoreArgs(process.argv.slice(3));
  if (parsed.error) fail(parsed.error);
  const file = path.resolve(parsed.file);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) fail(`No such file: ${file}`);
  const server = backupServer();
  const open = () => fs.openSync(file, 'r');
  // Check the file is a PostgreSQL archive before anything is dropped.
  let fd = open();
  const check = runTool(server, 'pg_restore', 'postgres', ['--list'], { stdin: fd });
  fs.closeSync(fd);
  if (check.status !== 0) fail(`${file} is not a readable PostgreSQL backup (pg_restore --list failed): ${stderrOf(check)}`);
  console.log(fileMessage('Backup', file, fs.statSync(file).size));
  if (!parsed.yes) {
    if (!process.stdin.isTTY) fail('Restore replaces the database: run it in a terminal and answer, or add --yes.');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(confirmQuestion(file));
    rl.close();
    if (!isYes(answer)) fail('Cancelled; the database is unchanged.');
  }
  const sql = (input, args = ['-X', '-q', '-v', 'ON_ERROR_STOP=1']) => runTool(server, 'psql', 'postgres', args, { input });
  const staging = sql(stagingSql());
  if (staging.status !== 0) fail(`Could not create ${STAGING_DATABASE}: ${stderrOf(staging)}\nThe database ${DEV_DATABASE} is unchanged.`);
  // Module roles belong to the cluster: after a deleted volume they are gone. Errors «already exists» are fine;
  // any other error is printed, and a psql that could not run at all stops the restore.
  if (fs.existsSync(rolesFile(file))) {
    const roles = sql(fs.readFileSync(rolesFile(file), 'utf8'), ['-X', '-q']);
    if (roles.status !== 0) {
      sql(dropStagingSql());
      fail(`Could not replay the roles from ${rolesFile(file)}: ${stderrOf(roles)}\nThe database ${DEV_DATABASE} is unchanged.`);
    }
    const errors = roleErrors(stderrOf(roles));
    if (errors.length) console.error(`local-env: warning: some roles from ${rolesFile(file)} were not applied:\n${errors.join('\n')}`);
  }
  fd = open();
  const res = runTool(server, 'pg_restore', STAGING_DATABASE, restoreArgs(), { stdin: fd });
  fs.closeSync(fd);
  if (res.status !== 0) {
    sql(dropStagingSql());
    fail(`pg_restore failed: ${stderrOf(res)}\nThe database ${DEV_DATABASE} is unchanged.`);
  }
  const swap = sql(swapSql());
  if (swap.status !== 0) {
    const kept = hasDevDatabase(server);
    if (kept) sql(dropStagingSql());
    fail(`Could not replace ${DEV_DATABASE} (is \`pnpm local:dev\` still running? stop it): ${stderrOf(swap)}\n${kept ? `The database ${DEV_DATABASE} is unchanged.` : `The restored copy is in ${STAGING_DATABASE}; run the restore again.`}`);
  }
  console.log(`Restored ${DEV_DATABASE} from ${file}. Start the app: pnpm local:dev`);
  console.log(`Its encrypted fields open only with the master key file of the installation that made the backup (${defaultKmsKeyFile()}).`);
}

const commands = {
  up,
  down: () => down(),
  reset: async () => {
    // Create the state first: after `.state/` was deleted, the old volumes (with the old database password)
    // must still be removed, and compose needs the variables to resolve the file.
    ensureState(STATE_DIR);
    down({ volumes: true });
    await up();
  },
  status,
  smoke,
  'db-test': dbTest,
  dev,
  backup,
  restore,
};

const name = process.argv[2];
if (!commands[name]) fail(`usage: node tools/local-env/index.mjs <${Object.keys(commands).join('|')}>`);
try {
  await commands[name]();
} catch (err) {
  fail(err.message);
}
