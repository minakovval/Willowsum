// Where `pnpm local:dev` keeps the installation's master key file (NFR-01@PoC FR 3, NFR-15@PoC FR 26; security review
// of #722): outside the repository (so no `git add`, `git clean` or deleted `.state/` touches it), outside the database
// and so outside every `pnpm local:backup` copy, and outside the backup folder. The API makes it with a random key on
// the first start (apps/api/src/platform/adapters/kms/key-file.ts). Shared by apps/api/scripts/lib/local-dev.ts and
// lib/backup.mjs.
import os from 'node:os';
import path from 'node:path';

export function defaultKmsKeyFile(home = os.homedir()) {
  return path.join(home, '.config', 'willowsum', 'local-kms-key.json');
}

const isInside = (child, parent) => {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

/** True when a backup at `file` would sit in the key file's folder: a copy of the database must not travel with its key. */
export function backupBesideKey(file, keyFile = defaultKmsKeyFile()) {
  return isInside(path.resolve(file), path.dirname(path.resolve(keyFile)));
}

/** Printed after every backup: the key is not in it, and the backup alone opens no encrypted field. */
export const keyReminder = (keyFile = defaultKmsKeyFile()) =>
  `The master key file ${keyFile} is NOT in this backup (by design). Keep your own copy of it apart from the backup ` +
  '(e.g. in a password manager): without it the encrypted fields in this backup cannot be opened.';
