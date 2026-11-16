import { Money } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import { listProposals, nextPaymentDate, type HistoryCharge, type ProposalDeps } from "./index.ts";

/** BUD-07@PoC a2) (wave 2 row 25): the proposals filtered by freshness and by the user's decisions. Synthetic data. */

function deps(found: readonly HistoryCharge[], today: string): ProposalDeps {
  return {
    history: { charges: async () => found },
    merchants: {
      async shownMerchants(_householdId, counterparties) {
        return new Map(counterparties.map((c) => [c, { id: `m-${c}`, name: c }]));
      },
    },
    accountKinds: async (_householdId, ids) => new Map(ids.map((id) => [id, "current"])),
    today: () => today,
  };
}

const charges = (counterparty: string, amount: string, dates: readonly string[]): HistoryCharge[] =>
  dates.map((date, i) => ({
    id: `${counterparty}-${i}`,
    accountId: "a1",
    date,
    amount,
    currency: "EUR",
    counterparty,
  }));

describe("BUD-07@PoC FR 2, EC3: a series whose latest charge is older than one interval + 3 days is not proposed", () => {
  it("BUD-07@PoC EC3: the subscription was probably cancelled — the monthly series charged last on 10 September", async () => {
    const history = charges("Synth Gym", "-40.00", ["2026-07-10", "2026-08-10", "2026-09-10"]);
    expect((await listProposals(deps(history, "2026-10-13"), "h1")).items).toHaveLength(1);
    expect((await listProposals(deps(history, "2026-10-14"), "h1")).items).toEqual([]);
  });

  it("BUD-07@PoC FR 2: two old series of one merchant at different prices, charged at the same time, are not proposed (#315, п. 9)", async () => {
    const history = [
      ...charges("Synth Apps", "-0.99", ["2026-02-01", "2026-03-03", "2026-04-02"]),
      ...charges("Synth Apps", "-9.99", ["2026-02-15", "2026-03-17", "2026-04-16"]).map((h) => ({
        ...h,
        id: `${h.id}-b`,
      })),
    ];
    expect((await listProposals(deps(history, "2026-05-05"), "h1")).items).toHaveLength(2);
    expect((await listProposals(deps(history, "2026-11-16"), "h1")).items).toEqual([]);
  });
});

describe("BUD-07@PoC FR 4: no proposals for a merchant that is a payment; none for a rejected series", () => {
  const history = [
    ...charges("Synth Stream", "-9.99", ["2026-08-14", "2026-09-14", "2026-10-14"]),
    ...charges("Synth Music", "-5.99", ["2026-08-07", "2026-09-07", "2026-10-07", "2026-11-07"]),
  ];

  it("BUD-07@PoC FR 4: after a confirmation the merchant is a regular payment — none of its series is proposed", async () => {
    const all = await listProposals(deps(history, "2026-11-16"), "h1");
    expect(all.items.map((p) => p.merchant.name)).toEqual(["Synth Music", "Synth Stream"]);
    const after = await listProposals(deps(history, "2026-11-16"), "h1", {
      merchantIds: new Set(["m-Synth Stream"]),
      rejections: [],
    });
    expect(after.items.map((p) => p.merchant.name)).toEqual(["Synth Music"]);
  });

  it("BUD-07@PoC FR 4: after «Не регулярний» the series is not proposed — even once its first charge left the window", async () => {
    const rejection = {
      merchantId: "m-Synth Music",
      type: "expense" as const,
      frequency: "month" as const,
      variable: false,
      expected: Money.of("5.99", "EUR"),
      transactionIds: ["Synth Music-0"],
    };
    const decided = { merchantIds: new Set<string>(), rejections: [rejection] };
    const now = await listProposals(deps(history, "2026-11-16"), "h1", decided);
    expect(now.items.map((p) => p.merchant.name)).toEqual(["Synth Stream"]);
    // The first charge is out of the 430 days: the key changed, the series is still the rejected one.
    const later = await listProposals(
      deps(
        history.filter((h) => h.id !== "Synth Music-0"),
        "2026-11-16",
      ),
      "h1",
      decided,
    );
    expect(later.items.map((p) => p.merchant.name)).toEqual(["Synth Stream"]);
  });
});

describe("BUD-07@PoC FR 6: the next date of a payment", () => {
  it("BUD-07@PoC FR 6: the next date of the schedule on or after today; none once the end date has passed", () => {
    const rent = { anchorDate: "2026-01-31", frequency: "month" as const, endDate: null };
    expect(nextPaymentDate(rent, "2026-11-16")).toBe("2026-11-30");
    expect(nextPaymentDate({ ...rent, endDate: "2026-11-30" }, "2026-11-16")).toBe("2026-11-30");
    expect(nextPaymentDate({ ...rent, endDate: "2026-11-29" }, "2026-11-16")).toBeNull();
  });
});
