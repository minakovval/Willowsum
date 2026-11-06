// Thin wrapper around `docker compose` for the local stack.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const LOCAL_DIR = path.join(REPO_ROOT, 'infra/local');
export const COMPOSE_FILE = path.join(LOCAL_DIR, 'compose.yaml');
export const STATE_DIR = path.join(LOCAL_DIR, '.state');

export function composeArgs(envPath, args) {
  return ['compose', '-f', COMPOSE_FILE, '--env-file', envPath, ...args];
}

/** Runs docker compose; output goes to the terminal unless capture is set. */
export function compose(envPath, args, { capture = false, input } = {}) {
  const res = spawnSync('docker', composeArgs(envPath, args), {
    cwd: REPO_ROOT,
    stdio: capture ? ['pipe', 'pipe', 'pipe'] : ['pipe', 'inherit', 'inherit'],
    input,
    encoding: 'utf8',
  });
  if (res.error) throw new Error(`docker is not available: ${res.error.message}`);
  return res;
}

export function dockerAvailable() {
  const res = spawnSync('docker', ['compose', 'version'], { encoding: 'utf8' });
  return !res.error && res.status === 0;
}
