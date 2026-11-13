-- Security review of #129 (test/sec129-list.it.test.ts): list declarations the list engine must refuse or accept.
-- Tie-breakers: `row_id` (its own unique key) and `entry_ref` (unique within the household) are accepted, `entry_id`
-- (no unique key) is refused. Rate dates: `posted_on` is accepted, `booked_on` (may be empty) and `booked_at`
-- (timestamptz) are refused.
CREATE TABLE loose_entries (
  row_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL,
  entry_ref uuid NOT NULL DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL DEFAULT gen_random_uuid(),
  posted_on date NOT NULL DEFAULT current_date,
  booked_on date,
  booked_at timestamptz NOT NULL DEFAULT now(),
  amount numeric(38, 18) NOT NULL,
  currency text NOT NULL,
  UNIQUE (household_id, entry_ref)
);
