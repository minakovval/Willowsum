-- The one alert letter of each stale period (VAL-05@PoC FR 4, AC2; owner decision 2026-11-12: PoC alerts are
-- letters from the app). A period is everything after one successful update (`period` = its completion time in
-- ISO 8601, or `never` before the first one). The primary key makes the claim atomic across restarts and scheduler
-- instances. Platform data without household_id (schema-exemptions.json): no address, no text of the letter.
CREATE TABLE stale_alerts (
  period text PRIMARY KEY CHECK (period = 'never' OR period ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'),
  claimed_at timestamptz NOT NULL
);
