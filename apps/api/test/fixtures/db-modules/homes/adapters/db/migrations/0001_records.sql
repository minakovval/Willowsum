CREATE TABLE records (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), household_id uuid NOT NULL, label text NOT NULL, at timestamptz NOT NULL DEFAULT now());
