-- Feature flags and module kill switches (CICD-06). Changed only through the module's internal interface
-- (FlagAdmin), which writes an audit entry for every change.

-- Rollout state of a flag; a flag without a row is «off» (a new function ships off). Platform-wide settings,
-- no customer data (schema-exemptions.json). The key is a key of the flag catalogue in code.
CREATE TABLE flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE CHECK (key ~ '^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$' AND length(key) <= 100),
  stage text NOT NULL CHECK (stage IN ('off', 'test', 'share', 'all')),
  -- Share of spaces in % for «share» (1–99); 0 for «off» and «test», 100 for «all».
  percent smallint NOT NULL CHECK (
    (stage = 'share' AND percent BETWEEN 1 AND 99)
    OR (stage IN ('off', 'test') AND percent = 0)
    OR (stage = 'all' AND percent = 100)
  ),
  -- When the rollout last reached «all» (CICD-06 FR 2: a release flag leaves the code ≤ 30 days later).
  fully_enabled_at timestamptz CHECK ((stage = 'all') = (fully_enabled_at IS NOT NULL)),
  changed_at timestamptz NOT NULL DEFAULT now()
);

-- Kill switch of a module (CICD-06 FR 3): a module with `disabled` answers «temporarily unavailable» on all
-- its routes. Platform-wide settings, no customer data (schema-exemptions.json).
CREATE TABLE kill_switches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module text NOT NULL UNIQUE CHECK (module ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$' AND length(module) <= 63),
  disabled boolean NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);

-- Test spaces (CICD-06 FR 1: stage «test»). A space is a test space while it has a row with unmarked_at
-- NULL; earlier rows keep the history. Customer-data table: the migration runner adds the household policy,
-- so the flag check reads only the caller's own row.
CREATE TABLE test_households (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL,
  marked_at timestamptz NOT NULL DEFAULT now(),
  unmarked_at timestamptz,
  CHECK (unmarked_at IS NULL OR unmarked_at >= marked_at)
);
CREATE UNIQUE INDEX test_households_current ON test_households (household_id) WHERE unmarked_at IS NULL;
