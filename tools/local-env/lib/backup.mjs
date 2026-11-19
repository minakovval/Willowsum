// `pnpm local:backup [file]` and `pnpm local:restore <file> [--yes|-y]` (CICD-04@PoC, local mode; plan row 173): a copy of
// the owner's `pnpm local:dev` database `ws_dev` in a file, and back. It protects manual work from an accidental
// deletion of the PostgreSQL volume (`pnpm local:reset`, `docker volume rm`).
//
// Pure parts (names, arguments, messages) are here and unit-tested; index.mjs runs pg_dump / pg_restore.
// Only `ws_dev` on the local server is ever touched: never a test database (`ws_t_…`), never another host (the server
// comes from resolveServer, which accepts only this machine).
import os from 'node:os';
import path from 'node:path';

/** The database of `pnpm local:dev` (DEV_DATABASE in apps/api/scripts/lib/local-dev.ts; a test keeps them equal). */
export const DEV_DATABASE = 'ws_dev';

/** Where `local:backup` writes without a file argument: outside the repository, so `git clean` and a deleted `.state/` keep it. */
export function defaultBackupPath(now = new Date(), home = os.homedir()) {
  const stamp = now.toISOString().replace(/\.\d+Z$/, 'Z').replace(/[-:]/g, '');
  return path.join(home, 'Willowsum-backups', `${DEV_DATABASE}-${stamp}.dump`);
}

/** The file with the module roles (names and rights, no passwords) next to the dump. */
export const rolesFile = (file) => `${file}.roles.sql`;

/** `[file]` for backup; the only accepted option is none. */
export function parseBackupArgs(args) {
  const rest = args.filter((a) => a !== '--');
  const flag = rest.find((a) => a.startsWith('-'));
  if (flag) return { error: `unknown option ${flag}; usage: pnpm local:backup [file]` };
  if (rest.length > 1) return { error: 'usage: pnpm local:backup [file]' };
  return { file: rest[0] };
}

/** `<file> [--yes]` for restore; `-y` is the short form of `--yes`. */
export function parseRestoreArgs(args) {
  const rest = args.filter((a) => a !== '--');
  const unknown = rest.find((a) => a.startsWith('-') && a !== '--yes' && a !== '-y');
  if (unknown) return { error: `unknown option ${unknown}; usage: pnpm local:restore <file> [--yes|-y]` };
  const files = rest.filter((a) => !a.startsWith('-'));
  if (files.length !== 1) return { error: 'usage: pnpm local:restore <file> [--yes|-y]' };
  return { file: files[0], yes: rest.includes('--yes') || rest.includes('-y') };
}

export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

/** The line printed after a backup and after a restore: the path and the size. */
export const fileMessage = (verb, file, bytes) => `${verb}: ${file} (${formatSize(bytes)}, ${bytes} bytes)`;

export const dumpArgs = () => ['-Fc', '--no-password'];
export const restoreArgs = () => ['--exit-on-error', '--no-password'];
export const rolesDumpArgs = () => ['--roles-only', '--no-role-passwords', '--no-password'];

/** The question before the database is overwritten. */
export const confirmQuestion = (file) =>
  `This replaces the local database ${DEV_DATABASE} with the contents of ${file}. Everything now in ${DEV_DATABASE} is lost.\n` +
  'Stop `pnpm local:dev` first. Type "yes" to continue: ';

export const isYes = (answer) => /^\s*yes\s*$/i.test(String(answer));

/** The restore goes into this database first; `ws_dev` is replaced only after pg_restore succeeded. */
export const STAGING_DATABASE = `${DEV_DATABASE}_restore`;

export const stagingSql = () => `DROP DATABASE IF EXISTS ${STAGING_DATABASE};\nCREATE DATABASE ${STAGING_DATABASE};\n`;

/** Plain DROP (no FORCE): it fails while `pnpm local:dev` is still connected, and then `ws_dev` is unchanged. */
export const swapSql = () => `DROP DATABASE IF EXISTS ${DEV_DATABASE};\nALTER DATABASE ${STAGING_DATABASE} RENAME TO ${DEV_DATABASE};\n`;

/** The errors of the roles replay worth showing: «already exists» is expected for every role the cluster has. */
export const roleErrors = (stderr) =>
  String(stderr)
    .split('\n')
    .filter((l) => /^(psql:.*)?ERROR:/.test(l.trim()) && !/already exists/.test(l));

export const dropStagingSql = () => `DROP DATABASE IF EXISTS ${STAGING_DATABASE};\n`;

/**
 * How to run a PostgreSQL client tool against `db`: [command, args, env]. `kind: 'compose'` runs it inside the
 * `pnpm local:up` container (no local client needed); `kind: 'url'` runs the local client against the local server.
 * The password goes through the environment, never argv.
 */
export function toolCommand(server, tool, db, args) {
  if (server.kind === 'compose') {
    const db_ = tool === 'pg_dumpall' ? [] : ['-d', db];
    return ['docker', server.composeArgs(['exec', '-T', 'postgres', tool, '-U', server.user, ...db_, ...args]), {}];
  }
  const u = new URL(server.url);
  const password = decodeURIComponent(u.password);
  u.password = '';
  u.pathname = `/${db}`;
  // libpq lets a `dbname` parameter win over the path: without this the tool would work on another database.
  u.searchParams.delete('dbname');
  return [tool, [`--dbname=${u.toString()}`, ...args], password ? { PGPASSWORD: password } : {}];
}
