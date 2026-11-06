-- Every rule of the ARC-03 schema check, broken once (test/schema.it.test.ts).
CREATE TABLE plain (id int);
CREATE TABLE exempted (id int);
CREATE TABLE amounts (
  household_id uuid NOT NULL,
  amount numeric(12, 2) NOT NULL,
  currency text NOT NULL,
  fee_amount numeric(38, 18),
  price real,
  total double precision,
  cash money,
  quantity numeric,
  created timestamp,
  opens time,
  ok_at timestamptz,
  ok_on date,
  data_region text
);
CREATE VIEW leaky AS SELECT household_id, amount FROM amounts;
CREATE VIEW safe WITH (security_invoker = true) AS SELECT household_id FROM amounts;
CREATE MATERIALIZED VIEW snapshot AS SELECT 1 AS x;
CREATE FUNCTION elevated() RETURNS int LANGUAGE sql SECURITY DEFINER AS 'SELECT 1';
