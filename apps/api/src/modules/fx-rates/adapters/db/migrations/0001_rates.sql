-- Exchange rate history (VAL-05@PoC; ARC-05): official rates of each currency to the hryvnia, with their date and
-- source, and the record of every successful update. Reference data of the platform, not of a space, so the
-- tables have no household_id (schema-exemptions.json). Rates are NUMERIC(38,18), never floats.

-- 1 `currency` = `rate` UAH on `rate_date`, published by `source` (e.g. NBU). One rate per currency and date:
-- a later update of the same date replaces it.
CREATE TABLE rates (
  rate_date date NOT NULL,
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3,5}$' AND currency <> 'UAH'),
  rate numeric(38,18) NOT NULL CHECK (rate > 0),
  source text NOT NULL CHECK (length(source) BETWEEN 1 AND 32),
  fetched_at timestamptz NOT NULL,
  PRIMARY KEY (rate_date, currency)
);

-- Each successful update: when it finished («оновлено <дата і час>»), which implementation and for which date.
CREATE TABLE updates (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  feed text NOT NULL CHECK (length(feed) BETWEEN 1 AND 32),
  requested_date date NOT NULL,
  currencies integer NOT NULL CHECK (currencies > 0),
  completed_at timestamptz NOT NULL
);
CREATE INDEX updates_completed_at ON updates (completed_at);
