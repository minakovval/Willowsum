#!/usr/bin/env node
// Local environment (CICD-04@PoC): one command starts PostgreSQL, mail and S3 storage in Docker.
//
//   pnpm local:up      start (first run generates local credentials), wait until healthy, create the bucket
//   pnpm local:status  services, health and where to connect (secrets are never printed)
//   pnpm local:smoke   end-to-end check of all three services
//   pnpm local:down    stop; data is kept
//   pnpm local:reset   stop and delete all local data (volumes), then start empty
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { REPO_ROOT, STATE_DIR, compose, dockerAvailable } from './lib/docker.mjs';
import { ensureBucket } from './lib/s3.mjs';
import { ensureState, readState } from './lib/state.mjs';

const rel = (p) => path.relative(REPO_ROOT, p);

function fail(message) {
  console.error(`local-env: ${message}`);
  process.exit(1);
}

function requireDocker() {
  if (!dockerAvailable()) fail('Docker with the compose plugin is required (docker compose version failed).');
}

function connectionInfo(values, envPath) {
  return [
    `PostgreSQL 17  127.0.0.1:${values.WS_LOCAL_PG_PORT}  db=${values.WS_LOCAL_PG_DB} user=${values.WS_LOCAL_PG_USER}`,
    `SMTP           127.0.0.1:${values.WS_LOCAL_SMTP_PORT}  user=${values.WS_LOCAL_SMTP_USER} (AUTH PLAIN; mail never leaves the machine)`,
    `Mail web UI    http://127.0.0.1:${values.WS_LOCAL_MAIL_UI_PORT}`,
    `S3             http://127.0.0.1:${values.WS_LOCAL_S3_PORT}  bucket=${values.WS_LOCAL_S3_BUCKET} region=${values.WS_LOCAL_S3_REGION} (path-style)`,
    `Credentials    ${rel(envPath)} (generated, git-ignored)`,
  ].join('\n');
}

async function up() {
  requireDocker();
  const { values, envPath, created } = ensureState(STATE_DIR);
  if (created) console.log(`Generated local credentials in ${rel(envPath)}.`);
  const res = compose(envPath, ['up', '-d', '--wait', '--wait-timeout', '180']);
  if (res.status !== 0) fail('services did not become healthy; see `pnpm local:status` and `docker compose logs`.');
  const bucket = await ensureBucket(values);
  console.log(`Bucket ${values.WS_LOCAL_S3_BUCKET}: ${bucket}.`);
  console.log(`\nLocal environment is up.\n${connectionInfo(values, envPath)}`);
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
  console.log(`\n${connectionInfo(state.values, state.envPath)}`);
}

function smoke() {
  const res = spawnSync(process.execPath, ['--test', path.join(REPO_ROOT, 'tools/local-env/test/smoke.it.mjs')], {
    stdio: 'inherit',
  });
  process.exit(res.status ?? 1);
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
};

const name = process.argv[2];
if (!commands[name]) fail(`usage: node tools/local-env/index.mjs <${Object.keys(commands).join('|')}>`);
try {
  await commands[name]();
} catch (err) {
  fail(err.message);
}
