-- A device is its browser and system without versions (owner decision 2026-11-14; ACC-04@PoC FR 4, AC6; NFR-15@PoC
-- FR 29), no longer the whole user agent: a browser update is not a new device. Expand only, and nothing is lost.
--
-- Scheme 1: the history of the previous release, the SHA-256 of `device:<user agent>`. The text is not kept, so it
-- cannot be renamed here; sign-in still recognises such a row by the same user agent and replaces it with the new key
-- (no extra letter). Scheme 2: the SHA-256 of `device:<browser>/<os>` (e.g. `device:chrome/windows`). The default is 1
-- because code of the previous release, which may still run during a deploy, writes scheme-1 digests; the new code
-- always writes 2.
ALTER TABLE sign_in_devices ADD COLUMN key_scheme smallint NOT NULL DEFAULT 1 CHECK (key_scheme IN (1, 2));

-- What the history can already name: a device a «Це був не я» link names by browser and system gets its new key now,
-- with the same first and last sign-in (its old row stays, so the previous release's code still finds it).
INSERT INTO sign_in_devices (account_id, device_digest, first_seen_at, last_seen_at, key_scheme)
SELECT d.account_id, sha256(convert_to('device:' || l.device_browser || '/' || l.device_os, 'UTF8')),
       min(d.first_seen_at), max(d.last_seen_at), 2
  FROM sign_in_devices d
  JOIN not_me_links l ON l.account_id = d.account_id AND l.device_digest = d.device_digest
 WHERE d.key_scheme = 1
 GROUP BY d.account_id, l.device_browser, l.device_os
ON CONFLICT (account_id, device_digest) DO NOTHING;
