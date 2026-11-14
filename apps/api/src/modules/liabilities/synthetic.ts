// Synthetic liabilities (ARC-03 FR 6) for tests and staging; loaded by tools/synthetic. Never real data.
// Loans with a rate and a monthly payment, one per (synthetic, opaque) account id.
import { defineSyntheticTable } from "@willowsum/synthetic";

export const synthetic = [
  defineSyntheticTable({
    table: "liabilities.liabilities",
    perHousehold: 2,
    *rows({ household, rng, count }) {
      for (let i = 0; i < count; i++)
        yield {
          household_id: household.id,
          id: rng.uuid(),
          account_id: rng.uuid(),
          kind: "loan",
          currency: "EUR",
          annual_rate: "4.2",
          monthly_payment: "650",
          credit_limit: null,
          grace_period_days: null,
        };
    },
  }),
];
