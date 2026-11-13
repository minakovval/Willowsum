// `pnpm db:test` (owner decision 2026-11-12): a throwaway test database for each agent, so agents working in
// parallel (up to 3 branches) do not share one database.
//
// Pure parts (names, URLs, where the server is) are here and unit-tested; index.mjs runs psql.
//
// Limitation (PostgreSQL design): roles are per cluster, not per database. The integration tests set the
// passwords of the module login roles (ws_mod_<schema>, ws_context, ws_probe) and some drop and recreate roles,
// so two integration runs on one cluster break each other even in separate databases. `pnpm db:test run -- …`
// therefore takes a cluster-wide lock (an advisory lock in the admin database) around the command: integration
// runs on one cluster queue up instead of colliding. Run-scoped role names would remove the queue but touch the
// isolation guard (ADR-0002); they are a follow-up.
import crypto from 'node:crypto';
import path from 'node:path';

/** Prefix of every database this tool creates; `drop` refuses any other name. */
export const PREFIX = 'ws_t_';
// The lock itself (name, database, holder variable): tools/test-guards/cluster-lock.mjs, shared with the integration
// config's globalSetup so that a bare `vitest` or `pnpm test:integration` run queues too.
export { LOCK_NAME } from '../../test-guards/cluster-lock.mjs';
const MAX_IDENTIFIER = 63; // PostgreSQL NAMEDATALEN - 1

/** A tag (branch or worktree name) as a short identifier part: lower case, [a-z0-9_], at most 20 characters. */
export function sanitizeTag(tag) {
  const clean = String(tag ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(-20)
    .replace(/^_+/, '');
  return clean || 'agent';
}

/** A unique database name: ws_t_<tag>_<8 random hex>. */
export function testDbName(tag, random = crypto.randomBytes(4).toString('hex')) {
  const name = `${PREFIX}${sanitizeTag(tag)}_${random}`;
  if (name.length > MAX_IDENTIFIER) throw new Error(`database name too long: ${name}`);
  return name;
}

/** Only names this tool could have created (so `drop` can never remove another database). */
export function isTestDbName(name) {
  return /^ws_t_[a-z0-9_]{1,20}_[0-9a-f]{8}$/.test(String(name));
}

/** The admin URL with another database. */
export function databaseUrl(adminUrl, name) {
  const u = new URL(adminUrl);
  u.pathname = `/${name}`;
  return u.toString();
}

/** The superuser URL of the `pnpm local:up` PostgreSQL, from its generated state (host side). */
export function adminUrlFromState(values) {
  const u = new URL('postgres://127.0.0.1');
  u.port = values.WS_LOCAL_PG_PORT;
  u.username = values.WS_LOCAL_PG_USER;
  u.password = values.WS_LOCAL_PG_PASSWORD;
  u.pathname = `/${values.WS_LOCAL_PG_DB}`;
  return u.toString();
}

/**
 * Which PostgreSQL to use: WS_TEST_PG_ADMIN_URL (a superuser URL, e.g. a machine's own cluster) wins; else the
 * `pnpm local:up` stack (started if Docker is there); else an error that says what to do.
 * @returns {{ kind: 'url', url: string } | { kind: 'compose' } | { kind: 'none', message: string }}
 */
export function resolveServer({ env, docker }) {
  const url = env.WS_TEST_PG_ADMIN_URL;
  if (url) {
    if (!/^postgres(ql)?:\/\//.test(url)) return { kind: 'none', message: 'WS_TEST_PG_ADMIN_URL must be a postgres:// URL.' };
    return { kind: 'url', url };
  }
  if (docker) return { kind: 'compose' };
  return {
    kind: 'none',
    message:
      'No PostgreSQL: start Docker (the tool then runs `pnpm local:up`), or set WS_TEST_PG_ADMIN_URL to a superuser URL of a local PostgreSQL 17.',
  };
}

/** psql connection arguments and environment for a URL; the password goes through PGPASSWORD, not argv. */
export function psqlConnection(url) {
  const u = new URL(url);
  const password = decodeURIComponent(u.password);
  u.password = '';
  return { args: ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-d', u.toString()], env: password ? { PGPASSWORD: password } : {} };
}

/** The URL with its password (and any `password=` parameter) hidden, for printing. */
export function redactUrl(url) {
  const u = new URL(url);
  if (u.password) u.password = '***';
  u.searchParams.delete('password');
  return u.toString();
}

/** Where `create` writes the full DATABASE_URL (git-ignored state directory, mode 0600). */
export function dbEnvFile(stateDir, name) {
  return path.join(stateDir, 'db-test', `${name}.env`);
}

/** The env file's content: shell- and dotenv-compatible (`. file`, `node --env-file=file`). */
export function dbEnvContent(url) {
  return `DATABASE_URL='${url.replace(/'/g, `'\\''`)}'\n`;
}

/**
 * Lines printed after `create`: the name, the URL with the password hidden, and the file with the full URL.
 * Secrets are never printed (agent output ends up in chat; AGENTS.md, info.mjs).
 */
export function createdMessage(name, url, envFile) {
  return [
    `Test database: ${name}`,
    `DATABASE_URL (password hidden): ${redactUrl(url)}`,
    `Full URL in ${envFile} (git-ignored): set -a; . ${envFile}; set +a`,
    `Drop it when done: pnpm db:test drop ${name}`,
  ].join('\n');
}
