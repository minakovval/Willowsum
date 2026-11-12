import { Decimal } from "@willowsum/domain-kernel";
import type { ModuleDatabase } from "../../../../platform/db/module-db.ts";
import type { FxRateStore, RatesOfDate } from "../../application/index.ts";

/** The rate history through the module's own role (ARC-01; tables in migrations/0001_rates.sql). */
export function databaseFxRateStore(db: ModuleDatabase): FxRateStore {
  return {
    async saveUpdate({ rates, feed, requestedDate, completedAt }) {
      const at = new Date(completedAt);
      await db.transaction(async (q) => {
        await q.query(
          `INSERT INTO rates (rate_date, currency, rate, source, fetched_at)
           SELECT d, c, r::numeric, s, $5 FROM unnest($1::date[], $2::text[], $3::text[], $4::text[]) AS t(d, c, r, s)
           ON CONFLICT (rate_date, currency)
           DO UPDATE SET rate = EXCLUDED.rate, source = EXCLUDED.source, fetched_at = EXCLUDED.fetched_at`,
          [
            rates.map((r) => r.date),
            rates.map((r) => r.currency),
            rates.map((r) => r.rate.toFixed()),
            rates.map((r) => r.source),
            at,
          ],
        );
        await q.query(
          `INSERT INTO updates (feed, requested_date, currencies, completed_at) VALUES ($1, $2, $3, $4)`,
          [feed, requestedDate, rates.length, at],
        );
      });
    },
    async lastSuccessAt() {
      const { rows } = await db.transaction((q) =>
        q.query<{ at: Date | null }>(`SELECT max(completed_at) AS at FROM updates`),
      );
      return rows[0]?.at ? rows[0].at.getTime() : null;
    },
    async claimStaleAlert(period, at) {
      const { rows } = await db.transaction((q) =>
        q.query(
          `INSERT INTO stale_alerts (period, claimed_at) VALUES ($1, $2) ON CONFLICT (period) DO NOTHING RETURNING period`,
          [period, new Date(at)],
        ),
      );
      return rows.length === 1;
    },
    async releaseStaleAlert(period) {
      await db.transaction((q) => q.query(`DELETE FROM stale_alerts WHERE period = $1`, [period]));
    },
    async ratesOnOrBefore(currencies, date): Promise<RatesOfDate | null> {
      const wanted = [...new Set(currencies)];
      return db.transaction(async (q) => {
        if (wanted.length === 0) {
          // UAH to UAH needs no rate; the date and source still come from the latest stored rates.
          const { rows } = await q.query<{ d: string; s: string }>(
            `SELECT to_char(rate_date, 'YYYY-MM-DD') AS d, source AS s FROM rates
             WHERE rate_date <= $1::date ORDER BY rate_date DESC LIMIT 1`,
            [date],
          );
          return rows[0] ? { date: rows[0].d, source: rows[0].s, rates: new Map() } : null;
        }
        // The nearest date on or before the requested one with every wanted currency from one source (FR 3).
        const { rows } = await q.query<{ d: string; s: string; c: string; r: string }>(
          `WITH day AS (
             SELECT rate_date, source FROM rates
             WHERE currency = ANY($1::text[]) AND rate_date <= $2::date
             GROUP BY rate_date, source HAVING count(*) = $3
             ORDER BY rate_date DESC LIMIT 1)
           SELECT to_char(r.rate_date, 'YYYY-MM-DD') AS d, r.source AS s, r.currency AS c, r.rate::text AS r
           FROM rates r JOIN day USING (rate_date, source) WHERE r.currency = ANY($1::text[])`,
          [wanted, date, wanted.length],
        );
        if (rows.length === 0) return null;
        return {
          date: rows[0]!.d,
          source: rows[0]!.s,
          rates: new Map(rows.map((row) => [row.c, new Decimal(row.r)])),
        };
      });
    },
    async ratesOnOrBeforeEach(requests) {
      if (requests.length === 0) return [];
      // Each request names one or two currencies, sorted: (a, b), b null for one.
      const keyed = requests.map((r) => {
        const wanted = [...new Set(r.currencies)].sort();
        if (wanted.length < 1 || wanted.length > 2)
          throw new Error("fx-rates: each request needs one or two currencies");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date)) throw new Error("fx-rates: a request date is YYYY-MM-DD");
        return { a: wanted[0]!, b: wanted[1] ?? null, date: r.date };
      });
      const key = (a: string, b: string | null, date: string) => `${a}|${b ?? ""}|${date}`;
      // One query for every request (security review of PR #129: no lookup per currency and day). `days`: the
      // dates with rates of every currency of a pair from one source, up to the latest requested date. For each
      // requested date the window carries forward the latest such day on or before it (a day sorts before a
      // request of the same date), so a rate from after the requested date is never picked.
      const { rows } = await db.transaction((q) =>
        q.query<{
          a: string;
          b: string | null;
          asked: string;
          d: string | null;
          s: string | null;
          ra: string | null;
          rb: string | null;
        }>(
          `WITH req AS (
             SELECT DISTINCT a, b, d FROM unnest($1::text[], $2::text[], $3::date[]) AS t(a, b, d)),
           pairs AS (SELECT DISTINCT a, b FROM req),
           days AS (
             SELECT p.a, p.b, r.rate_date, r.source,
                    max(r.rate) FILTER (WHERE r.currency = p.a) AS ra,
                    max(r.rate) FILTER (WHERE r.currency = p.b) AS rb
             FROM pairs p JOIN rates r ON r.currency = p.a OR r.currency = p.b
             WHERE r.rate_date <= (SELECT max(d) FROM req)
             GROUP BY p.a, p.b, r.rate_date, r.source
             HAVING count(*) = CASE WHEN p.b IS NULL THEN 1 ELSE 2 END),
           marks AS (
             SELECT a, b, d AS at, NULL::date AS day, 1 AS kind FROM req
             UNION ALL
             SELECT a, b, rate_date, rate_date, 0 FROM days),
           latest AS (
             SELECT a, b, at, kind,
                    max(day) OVER (PARTITION BY a, b ORDER BY at, kind ROWS UNBOUNDED PRECEDING) AS day
             FROM marks)
           SELECT l.a, l.b, to_char(l.at, 'YYYY-MM-DD') AS asked, to_char(y.rate_date, 'YYYY-MM-DD') AS d,
                  y.source AS s, y.ra::text AS ra, y.rb::text AS rb
           FROM latest l
           LEFT JOIN days y ON y.a = l.a AND y.b IS NOT DISTINCT FROM l.b AND y.rate_date = l.day
           WHERE l.kind = 1`,
          [keyed.map((k) => k.a), keyed.map((k) => k.b), keyed.map((k) => k.date)],
        ),
      );
      const found = new Map<string, RatesOfDate | null>();
      for (const row of rows) {
        const rates = new Map<string, Decimal>();
        if (row.d !== null && row.s !== null && row.ra !== null) {
          rates.set(row.a, new Decimal(row.ra));
          if (row.b !== null && row.rb !== null) rates.set(row.b, new Decimal(row.rb));
        }
        found.set(
          key(row.a, row.b, row.asked),
          rates.size === 0 ? null : { date: row.d!, source: row.s!, rates },
        );
      }
      return keyed.map((k) => found.get(key(k.a, k.b, k.date)) ?? null);
    },
  };
}
