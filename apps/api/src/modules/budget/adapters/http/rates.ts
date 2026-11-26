import { z } from "zod";
import type { PeriodPlan } from "../../domain/index.ts";

/**
 * BUD-02@PoC FR 24: a rate the plan converts a category currency at — 1 unit of `currency` is `rate` of the budget's
 * currency, of `date`; `rate` and `date` null — the currency has no rate (its lines count 0, «Курс недоступний»).
 */
export const planRatesSchema = z
  .array(z.object({ currency: z.string(), rate: z.string().nullable(), date: z.string().nullable() }))
  .meta({
    description:
      "BUD-02 FR 24: the rates the limits and income plans of other currencies are converted into the budget's currency at — today's for the current and future periods, the last day's of a finished one (kept in its snapshot). 1 unit of `currency` is `rate` of the budget's currency, of `date`; null — no rate (the lines count 0). Not empty — the totals that hold such a line are shown with «≈» and the hint names the rate and its date; empty — no «≈»",
  });

/** FR 24: the rates of a plan for `planRatesSchema`. */
export const ratesOut = (plan: Pick<PeriodPlan, "rates" | "missingRates">) => [
  ...(plan.rates ?? []).map((r) => ({ currency: r.currency, rate: r.rate.toFixed(), date: r.date })),
  ...(plan.missingRates ?? []).map((currency) => ({ currency, rate: null, date: null })),
];
