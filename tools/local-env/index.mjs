#!/usr/bin/env node
// Local environment (CICD-04@PoC): one command starts PostgreSQL, mail and S3 storage in Docker.
//
//   pnpm local:up      start (first run generates local credentials), wait until healthy, create the bucket
//   pnpm local:status  services, health and where to connect (secrets are never printed)
//   pnpm local:smoke   end-to-end check of all three services
//   pnpm local:down    stop; data is kept
//   pnpm local:reset   stop and delete all local data (volumes), then start empty
//   pnpm db:test       a throwaway test database for this agent; prints DATABASE_URL with the password hidden and
//                      writes the full URL to infra/local/.state/db-test/<name>.env (0600, git-ignored; lib/db-test.mjs)
//                      `pnpm db:test drop <name>`, `pnpm db:test list`,
//                      `pnpm db:test run -- <command>`: a fresh database, DATABASE_URL set, a cluster-wide lock
//                      held (integration runs on one cluster queue up), the database dropped afterwards
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, STATE_DIR, compose, composeArgs, dockerAvailable } from './lib/docker.mjs';
import { ensureBucket, ensureWritable } from './lib/s3.mjs';
import { connectionInfo } from './lib/info.mjs';
import { ensureState, readState } from './lib/state.mjs';
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
    return { url: server.url, argv: ['psql', c.args], env: c.env };
  }
  // The local:up stack: start (or create) it, then run psql inside the container (no local psql needed).
  const { values, envPath } = ensureState(STATE_DIR);
  const res = compose(envPath, ['up', '-d', '--wait', '--wait-timeout', '180', 'postgres']);
  if (res.status !== 0) fail('PostgreSQL did not become healthy; see `pnpm local:status`.');
  const url = adminUrlFromState(values);
  const inside = ['exec', '-T', 'postgres', 'psql', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-U', values.WS_LOCAL_PG_USER, '-d', values.WS_LOCAL_PG_DB];
  return { url, argv: ['docker', composeArgs(envPath, inside)], env: {} };
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

/** Holds the cluster-wide advisory lock in a psql session until `release()` is called. */
function lockCluster(admin) {
  const [cmd, args] = admin.argv;
  const child = spawn(cmd, args, { env: { ...process.env, ...admin.env }, stdio: ['pipe', 'pipe', 'inherit'] });
  return new Promise((resolve, reject) => {
    let out = '';
    child.on('error', reject);
    child.on('exit', (code) => reject(new Error(`lock session ended (${code})`)));
    child.stdout.on('data', (d) => {
      out += d;
      if (out.includes('LOCKED')) {
        child.removeAllListeners('exit');
        resolve(() => {
          child.stdin.end();
        });
      }
    });
    child.stdin.write(`SELECT pg_advisory_lock(hashtext('${LOCK_NAME}'));\n\\echo LOCKED\n`);
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
    const release = await lockCluster(admin);
    const name = createDb(admin);
    let status = 1;
    try {
      const res = spawnSync(cmd[0], cmd.slice(1), { stdio: 'inherit', env: { ...process.env, DATABASE_URL: databaseUrl(admin.url, name) } });
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
};

const name = process.argv[2];
if (!commands[name]) fail(`usage: node tools/local-env/index.mjs <${Object.keys(commands).join('|')}>`);
try {
  await commands[name]();
} catch (err) {
  fail(err.message);
}
