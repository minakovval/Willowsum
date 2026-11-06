CREATE TABLE records (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, household_id uuid NOT NULL, label text NOT NULL, at timestamptz NOT NULL DEFAULT now());
