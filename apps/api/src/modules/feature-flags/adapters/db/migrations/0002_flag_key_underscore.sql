-- ws:contract 0001_flags.sql the key rule only widens (it now also allows «_»); every key the previous code can store still passes
-- A flag's key is the plan-catalog feature key from the requirements (ARC-01 FR 7), and those keys may contain «_»
-- (`data.bulk_actions`, DAT-03@PoC). The old rule allowed only [a-z0-9-] in each part, so that flag could never be
-- rolled out. Same shape as FLAG_KEY_PATTERN in domain/catalogue.ts, which `check:flags` applies to every flag.
ALTER TABLE flags DROP CONSTRAINT flags_key_check;
ALTER TABLE flags ADD CONSTRAINT flags_key_check
  CHECK (key ~ '^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*)*$' AND length(key) <= 100);
