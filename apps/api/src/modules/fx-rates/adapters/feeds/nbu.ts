import { Decimal, isCurrencyCode } from "@willowsum/domain-kernel";
import { z } from "zod";
import {
  createProviderClient,
  createProviderHttp,
  defineProviderPort,
  ProviderError,
  type FetchFn,
  type ProviderClientOptions,
} from "../../../../platform/adapters/index.ts";
import { NBU_SOURCE, PIVOT_CURRENCY, type PivotRate } from "../../domain/index.ts";
import type { FxRateFeed } from "../../application/index.ts";

/**
 * Official rates to the hryvnia (VAL-05 FR 3, ARC-05). A read: safe to repeat. Sends only the date and the
 * answer format, nothing about any space.
 */
export const OFFICIAL_RATES_PORT = defineProviderPort("official-fx-rates", {
  dailyRates: { idempotent: true, fields: ["date", "json"], path: "exchange" },
});

/** The public statistics feed of the National Bank of Ukraine; no account or key (docs/ops/integrations.md). */
export const NBU_BASE_URL = "https://bank.gov.ua/NBUStatService/v1/statdirectory";

export interface NbuFeedOptions {
  readonly baseUrl?: string;
  readonly fetch?: FetchFn;
  readonly clock?: ProviderClientOptions["clock"];
  readonly random?: ProviderClientOptions["random"];
  readonly policy?: ProviderClientOptions["policy"];
}

/** At most 20 integer digits and 18 decimals: exactly what NUMERIC(38,18) stores, so nothing is rounded or overflows. */
const RATE_RE = /^(0|[1-9]\d{0,19})(\.\d{1,18})?$/;

/**
 * Plausibility bound of an official rate, in UAH for one unit. The NBU list spans about 0.0003 UAH (the cheapest
 * currencies) to about 1.7·10^5 UAH (a troy ounce of gold, XAU). A rate outside 10^-6 … 10^7 is a broken or hostile
 * answer, not a market move (over 300 times below the smallest and 90 times above the largest), so the whole
 * answer is refused and the stored history keeps the last good rates (VAL-05 FR 4).
 */
export const NBU_RATE_MIN = "0.000001";
export const NBU_RATE_MAX = "10000000";
const item = z.object({
  cc: z.string(),
  // A JSON number, kept as its source text (a string rate is not the NBU format and is refused).
  rate: z.object({ numberText: z.string().regex(RATE_RE) }),
  exchangedate: z.string().regex(/^\d{2}\.\d{2}\.\d{4}$/),
});

/**
 * The NBU answers `[{ "cc": "EUR", "rate": 45.0123, "exchangedate": "12.11.2026", … }]`, the rate a JSON number
 * for one unit. A JSON number read by `JSON.parse` is already a float, so the rate is taken from the source text of
 * the answer and becomes a Decimal directly (AGENTS.md «Money»).
 */
export function parseNbuRates(text: string, requestedDate: string): PivotRate[] {
  const body: unknown = JSON.parse(text, (key, value, context?: { source?: string }) =>
    key === "rate" && typeof value === "number" && context?.source !== undefined
      ? { numberText: context.source }
      : value,
  );
  const items = z.array(item).min(1).parse(body);
  const rates: PivotRate[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    // Units the platform does not know (the SDR «XDR») are skipped; the hryvnia is the pivot itself.
    if (!isCurrencyCode(it.cc) || it.cc === PIVOT_CURRENCY) continue;
    const [day, month, year] = it.exchangedate.split(".");
    const date = `${year}-${month}-${day}`;
    // A later date is refused. Requiring exactly the asked date waits for a check of the live feed on a weekend
    // date (security review of PR #120; follow-up for the first deployment).
    if (date > requestedDate) throw new Error("A rate of a later date than asked");
    // Two rates of one currency would make the stored one depend on the order of the answer.
    if (seen.has(it.cc)) throw new Error("A currency listed twice");
    seen.add(it.cc);
    const rate = new Decimal(it.rate.numberText);
    if (rate.lte(0)) throw new Error("A rate is positive");
    if (rate.lt(NBU_RATE_MIN) || rate.gt(NBU_RATE_MAX)) throw new Error("A rate outside the plausible range");
    rates.push({ currency: it.cc, rate, date, source: NBU_SOURCE });
  }
  if (rates.length === 0) throw new Error("No known currency in the answer");
  return rates;
}

/** Working implementation (ARC-05 FR 2): `GET <base>/exchange?date=YYYYMMDD&json=` over the adapter kit. */
export function nbuRateFeed(options: NbuFeedOptions = {}): FxRateFeed {
  const client = createProviderClient({
    provider: "official-fx-rates:nbu",
    ...(options.clock ? { clock: options.clock } : {}),
    ...(options.random ? { random: options.random } : {}),
    ...(options.policy ? { policy: options.policy } : {}),
  });
  const http = createProviderHttp({
    baseUrl: options.baseUrl ?? NBU_BASE_URL,
    client,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  const op = OFFICIAL_RATES_PORT.operations.dailyRates;
  return {
    name: "nbu",
    async dailyRates(date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("A rates date is YYYY-MM-DD");
      // The answer is checked inside the call, so a broken answer counts towards the breaker.
      return http.getText(op, { date: date.replaceAll("-", ""), json: "" }, (text) => {
        try {
          return parseNbuRates(text, date);
        } catch {
          throw new ProviderError("invalid-response", client.provider, op.name);
        }
      });
    },
  };
}
