import { describe, expect, it } from "vitest";
import { HISTORY_MAX, listProposals, type HistoryCharge, type ProposalDeps } from "./index.ts";

/** BUD-07@PoC a1) (wave 2 row 25): the analysis over its ports — the window it reads and its cap. Data is synthetic. */

function deps(found: readonly HistoryCharge[], asked: unknown[]): ProposalDeps {
  return {
    history: {
      async charges(_householdId, query) {
        asked.push(query);
        return found.slice(0, query.limit);
      },
    },
    merchants: {
      async shownMerchants(_householdId, counterparties) {
        return new Map(counterparties.map((c) => [c, { id: `m-${c}`, name: c }]));
      },
    },
    accountKinds: async (_householdId, ids) => new Map(ids.map((id) => [id, "current"])),
    today: () => "2026-11-16",
  };
}

const charge = (i: number, date: string): HistoryCharge => ({
  id: `t${String(i).padStart(6, "0")}`,
  accountId: "a1",
  date,
  amount: "-9.99",
  currency: "EUR",
  counterparty: "Synth Stream",
});

describe("BUD-07@PoC FR 1: the analysis reads the last 430 days, today included", () => {
  it("BUD-07@PoC FR 1: the window is today − 429 days … today; at most 20 000 transactions, `more` when there were others", async () => {
    const asked: unknown[] = [];
    const monthly = [charge(1, "2026-10-14"), charge(2, "2026-09-14"), charge(3, "2026-08-14")];
    const result = await listProposals(deps(monthly, asked), "h1");
    expect(asked).toEqual([{ from: "2025-09-13", to: "2026-11-16", limit: HISTORY_MAX + 1 }]);
    expect(result.more).toBe(false);
    expect(result.items.map((p) => [p.frequency, p.nextDate, p.transactionIds])).toEqual([
      ["month", "2026-12-14", ["t000003", "t000002", "t000001"]],
    ]);

    const many = Array.from({ length: HISTORY_MAX + 1 }, (_, i) => charge(i, "2026-11-01"));
    expect((await listProposals(deps(many, []), "h1")).more).toBe(true);
  });
});

describe("BUD-07@PoC FR 4: the date of a proposal keeps the series' day of the month", () => {
  it("BUD-07@PoC FR 4: charged on the 31st, the latest on 28 February — the next date is 31 March, not 28 March", async () => {
    const dated = (dates: readonly string[]) => dates.map((d, i) => charge(i, d)).reverse();
    const at = async (dates: readonly string[], today: string) => {
      const d = { ...deps(dated(dates), []), today: () => today };
      return (await listProposals(d, "h1")).items.map((p) => p.nextDate);
    };
    expect(await at(["2025-12-31", "2026-01-31", "2026-02-28"], "2026-03-01")).toEqual(["2026-03-31"]);
    expect(await at(["2026-07-31", "2026-08-31", "2026-09-30"], "2026-10-01")).toEqual(["2026-10-31"]);
    expect(await at(["2026-08-28", "2026-09-28", "2026-10-28"], "2026-11-16")).toEqual(["2026-11-28"]);
  });
});
