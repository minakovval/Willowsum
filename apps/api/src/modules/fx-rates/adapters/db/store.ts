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
  };
}
