-- The one alert letter of each discrepancy period of the daily integrity check (FIN-04@PoC FR 10, AC7; ARC-11; owner
-- decision 2026-11-12: PoC alerts are letters from the app). A period is a run of daily checks with the same findings,
-- keyed by their kinds and counts (`unbalanced-entry=1;empty-entry=0;reversal-mismatch=0`). Append-only like the
-- journal: each row is the next state, `seq` = previous + 1 — a claimed period (its letter goes out), or NULL: no
-- open period (a clean run, or a claim given back because its letter could not be sent). The primary key on `seq`
-- makes a claim atomic across restarts and scheduler instances. Platform data without household_id
-- (schema-exemptions.json): no space, entry or account ids, no amounts, no address, no text of the letter.
CREATE TABLE integrity_alerts (
  seq integer PRIMARY KEY CHECK (seq > 0),
  period text CHECK (period ~ '^[a-z-]{1,32}=[0-9]{1,10}(;[a-z-]{1,32}=[0-9]{1,10}){0,15}$'),
  recorded_at timestamptz NOT NULL
);

REVOKE UPDATE, DELETE, TRUNCATE ON integrity_alerts FROM ws_mod_ledger;
CREATE TRIGGER integrity_alerts_append_only BEFORE UPDATE OR DELETE ON integrity_alerts
  FOR EACH ROW EXECUTE FUNCTION reject_change();
CREATE TRIGGER integrity_alerts_no_truncate BEFORE TRUNCATE ON integrity_alerts
  FOR EACH STATEMENT EXECUTE FUNCTION reject_change();
