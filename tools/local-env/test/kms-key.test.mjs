import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { defaultBackupPath } from '../lib/backup.mjs';
import { backupBesideKey, defaultKmsKeyFile, keyReminder } from '../lib/kms-key.mjs';

// NFR-01@PoC FR 3 (security review of #722): the installation's master key file is kept apart from every backup of the
// database; a backup alone opens no encrypted field.
test('NFR-01@PoC FR 3: the key file lives outside the repository and outside the backup folder', () => {
  const home = '/home/owner';
  const key = defaultKmsKeyFile(home);
  assert.equal(key, '/home/owner/.config/willowsum/local-kms-key.json');
  const backup = defaultBackupPath(new Date('2026-11-26T10:00:00Z'), home);
  assert.notEqual(path.dirname(backup), path.dirname(key));
  assert.equal(backupBesideKey(backup, key), false);
});

test('NFR-01@PoC FR 3: a backup into the key file\'s folder is refused', () => {
  const key = '/home/owner/.config/willowsum/local-kms-key.json';
  assert.equal(backupBesideKey('/home/owner/.config/willowsum/ws_dev.dump', key), true);
  assert.equal(backupBesideKey('/home/owner/.config/willowsum/sub/ws_dev.dump', key), true);
  assert.equal(backupBesideKey('/home/owner/.config/willowsum-other/ws_dev.dump', key), false);
  assert.equal(backupBesideKey('/home/owner/Willowsum-backups/ws_dev.dump', key), false);
});

test('NFR-01@PoC FR 3: after a backup the owner is told the key is not in it and where it is', () => {
  const line = keyReminder('/home/owner/.config/willowsum/local-kms-key.json');
  assert.match(line, /\/home\/owner\/\.config\/willowsum\/local-kms-key\.json is NOT in this backup/);
  assert.match(line, /cannot be opened/);
});
