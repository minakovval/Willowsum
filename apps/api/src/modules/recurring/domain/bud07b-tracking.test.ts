import { Money } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import { trackPayment, type Candidate, type ChargeMark, type TrackInput } from "./index.ts";

/**
 * BUD-07@PoC b1) (wave 2 row 26): the statuses of a payment's charges, the expected amount and the payment's state.
 * Pure rules with a fixed «today»; every amount is synthetic.
 */

const eur = (a: string) => Money.of(a, "EUR");

let seq = 0;
function charge(date: string, amount: string, more: Partial<Candidate> = {}): Candidate {
  seq += 1;
  return {
    id: `t${seq}`,
    date,
    amount: eur(amount),
    value: eur(amount),
    converted: false,
    approximate: false,
    merchant: true,
    category: false,
    ...more,
  };
}

function track(more: Partial<TrackInput> & Pick<TrackInput, "today">) {
  return trackPayment({
    frequency: "month",
    anchorDate: "2026-06-05",
    endDate: null,
    createdOn: "2026-06-01",
    keptOn: null,
    type: "expense",
    base: eur("40.00"),
    variable: false,
    marks: new Map(),
    candidates: [],
    from: "2025-09-12",
    ...more,
  });
}

const statusOf = (t: ReturnType<typeof track>, dueOn: string) => t.charges.find((c) => c.dueOn === dueOn);
const skipped = (markedOn: string): ChargeMark => ({ kind: "skipped", markedOn });

describe("BUD-07@PoC FR 8, FR 9: a charge is paid by a transaction within ± 3 days of its date", () => {
  it("BUD-07@PoC FR 8: of the merchant at 0,5–2 of the expected amount; else of the category within ± 10 %", () => {
    const t = track({
      today: "2026-09-20",
      candidates: [
        charge("2026-06-05", "40.00"),
        charge("2026-07-05", "44.50", { merchant: false, category: true }), // > 10 % — not this payment
        charge("2026-08-03", "43.90", { merchant: false, category: true }),
        charge("2026-09-06", "80.00"), // twice is still a payment of the merchant
      ],
    });
    expect(t.charges.map((c) => [c.dueOn, c.status])).toEqual([
      ["2026-06-05", "paid"],
      ["2026-07-05", "overdue"],
      ["2026-08-05", "paid"],
      ["2026-09-05", "paid"],
      ["2026-10-05", "expected"],
    ]);
    expect(statusOf(t, "2026-08-05")).toMatchObject({ paidOn: "2026-08-03", amount: eur("43.90") });
  });

  it("BUD-07@PoC FR 8: each transaction pays one charge — the closest; a charge takes the closest of two", () => {
    const a = charge("2026-06-04", "40.00");
    const b = charge("2026-06-07", "40.00");
    const t = track({ today: "2026-06-20", candidates: [a, b] });
    expect(statusOf(t, "2026-06-05")).toMatchObject({ status: "paid", transactionId: a.id });
    expect(t.used).toEqual([a.id]);
  });

  it("BUD-07@PoC EC2: a date on a weekend — the window is ± 3 days (paid 3 days late is on time; 4 days is not)", () => {
    const t = track({
      today: "2026-08-30",
      candidates: [charge("2026-06-08", "40.00"), charge("2026-07-01", "40.00")],
    });
    expect(statusOf(t, "2026-06-05")!.status).toBe("paid");
    expect(statusOf(t, "2026-07-05")!.status).toBe("overdue");
  });

  it("BUD-07@PoC FR 9: «Очікується» while the window is open; «Прострочено на N дн.» from its last day", () => {
    const base = { today: "2026-06-07", candidates: [] as Candidate[] };
    expect(statusOf(track(base), "2026-06-05")).toMatchObject({ status: "expected", overdueDays: null });
    expect(statusOf(track({ ...base, today: "2026-06-08" }), "2026-06-05")).toMatchObject({
      status: "overdue",
      overdueDays: 3,
    });
  });

  it("BUD-07@PoC AC10: «Садочок» 300 € on the 5th, today the 10th, no payment — «Прострочено на 5 дн.»", () => {
    const t = track({
      today: "2026-11-10",
      base: eur("300.00"),
      createdOn: "2026-10-01",
      anchorDate: "2026-10-05",
    });
    expect(statusOf(t, "2026-11-05")).toMatchObject({ status: "overdue", overdueDays: 5 });
  });

  it("BUD-07@PoC FR 9: a paid charge is «сплачено» with its transaction; a charge still to come is «очікується»", () => {
    const paid = charge("2026-11-05", "40.00");
    const t = track({
      today: "2026-11-16",
      anchorDate: "2026-10-05",
      createdOn: "2026-10-05",
      candidates: [paid],
    });
    expect(statusOf(t, "2026-11-05")).toMatchObject({
      status: "paid",
      transactionId: paid.id,
      paidOn: "2026-11-05",
    });
    expect(statusOf(t, "2026-12-05")).toMatchObject({ status: "expected", transactionId: null });
  });

  it("BUD-07@PoC FR 17: a charge is a projection — without its transaction (hidden, deleted) it is unpaid again", () => {
    const paid = charge("2026-11-05", "40.00");
    const input = { today: "2026-11-16", anchorDate: "2026-10-05", createdOn: "2026-10-05" };
    expect(statusOf(track({ ...input, candidates: [paid] }), "2026-11-05")!.status).toBe("paid");
    expect(statusOf(track({ ...input, candidates: [] }), "2026-11-05")!.status).toBe("overdue");
  });

  it("BUD-07@PoC FR 9: an income charge has the same statuses («Отримано», «Дохід не надійшов»)", () => {
    const t = track({
      today: "2026-11-16",
      type: "income",
      anchorDate: "2026-10-10",
      createdOn: "2026-10-01",
    });
    expect(statusOf(t, "2026-11-10")).toMatchObject({ status: "overdue", overdueDays: 6 });
  });
});

describe("BUD-07@PoC FR 8: an overdue charge is paid late by a later transaction of the merchant", () => {
  it("BUD-07@PoC AC11: two November transactions — the first pays November, the second October («із запізненням»)", () => {
    const nov = charge("2026-11-10", "40.00");
    const late = charge("2026-11-12", "40.00");
    const t = track({
      today: "2026-11-16",
      anchorDate: "2026-09-10",
      createdOn: "2026-09-01",
      candidates: [charge("2026-09-10", "40.00"), nov, late],
    });
    expect(statusOf(t, "2026-11-10")).toMatchObject({ status: "paid", transactionId: nov.id });
    expect(statusOf(t, "2026-10-10")).toMatchObject({
      status: "paid-late",
      transactionId: late.id,
      paidOn: "2026-11-12",
    });
    expect(t.missesInRow).toBe(0);
  });

  it("BUD-07@PoC FR 8: late only by the merchant, and only until the next charge's window closes", () => {
    const byCategory = charge("2026-11-01", "40.00", { merchant: false, category: true });
    const tooLate = charge("2026-11-14", "40.00");
    const t = track({
      today: "2026-11-30",
      anchorDate: "2026-10-10",
      createdOn: "2026-10-01",
      candidates: [byCategory, charge("2026-11-10", "40.00"), tooLate],
    });
    expect(statusOf(t, "2026-10-10")!.status).toBe("overdue");
    expect(t.used).not.toContain(tooLate.id);
  });

  it("BUD-07@PoC AC12: salary due on the 10th, none by the 13th — «Дохід не надійшов · 3 дн.»; then «Отримано із запізненням»", () => {
    const salary = {
      type: "income" as const,
      base: eur("2150.00"),
      anchorDate: "2026-10-10",
      createdOn: "2026-10-01",
      candidates: [charge("2026-10-10", "2150.00")],
    };
    expect(statusOf(track({ ...salary, today: "2026-11-13" }), "2026-11-10")).toMatchObject({
      status: "overdue",
      overdueDays: 3,
    });
    const arrived = charge("2026-11-14", "2150.00");
    const after = track({ ...salary, today: "2026-11-16", candidates: [...salary.candidates, arrived] });
    expect(statusOf(after, "2026-11-10")).toMatchObject({ status: "paid-late", paidOn: "2026-11-14" });
  });
});

describe("BUD-07@PoC FR 9, FR 21: «Прострочено» stays until paid or marked «Пропущено» by the user", () => {
  it("BUD-07@PoC AC15: «Спортзал» 40 € due 5 October, unpaid; on 20 November it is still «Прострочено на 46 дн.»", () => {
    const t = track({ today: "2026-11-20", anchorDate: "2026-10-05", createdOn: "2026-09-20" });
    expect(statusOf(t, "2026-10-05")).toMatchObject({ status: "overdue", overdueDays: 46 });
  });

  it("BUD-07@PoC AC16: «Позначити пропущеним» — «Пропущено», and a transaction in its window no longer pays it", () => {
    const inWindow = charge("2026-10-06", "40.00");
    const t = track({
      today: "2026-10-20",
      anchorDate: "2026-09-05",
      createdOn: "2026-09-01",
      candidates: [charge("2026-09-05", "40.00"), inWindow],
      marks: new Map([["2026-10-05", skipped("2026-10-20")]]),
    });
    expect(statusOf(t, "2026-10-05")).toMatchObject({
      status: "skipped",
      transactionId: null,
      markedOn: "2026-10-20",
    });
    expect(t.used).not.toContain(inWindow.id);
  });

  it("BUD-07@PoC AC14: «Зарахувати за вересень» — the skipped September is «Сплачено із запізненням», one miss less", () => {
    // Another counterparty without a category: nothing matches it by itself.
    const tx = charge("2026-10-25", "45.00", { merchant: false });
    const base = {
      today: "2026-11-16",
      anchorDate: "2026-09-05",
      createdOn: "2026-09-01",
      candidates: [tx],
    };
    const before = track({ ...base, marks: new Map([["2026-09-05", skipped("2026-10-01")]]) });
    expect(before.missesInRow).toBe(3);
    const after = track({
      ...base,
      marks: new Map<string, ChargeMark>([
        ["2026-09-05", { kind: "settled", transactionId: tx.id, markedOn: "2026-11-16" }],
      ]),
    });
    expect(statusOf(after, "2026-09-05")).toMatchObject({
      status: "paid-late",
      transactionId: tx.id,
      paidOn: "2026-10-25",
    });
    expect(after.missesInRow).toBe(2);
  });
});

describe("BUD-07@PoC FR 10: misses in a row make a payment «Можливо, скасований»", () => {
  it("BUD-07@PoC AC4: September «Пропущено», October «Прострочено на 6 дн.» — «Можливо, скасований»", () => {
    const t = track({
      today: "2026-10-11",
      anchorDate: "2026-08-05",
      createdOn: "2026-08-01",
      candidates: [charge("2026-08-05", "40.00")],
      marks: new Map([["2026-09-05", skipped("2026-09-20")]]),
    });
    expect(statusOf(t, "2026-10-05")).toMatchObject({ status: "overdue", overdueDays: 6 });
    expect(t).toMatchObject({ missesInRow: 2, state: "possibly-cancelled" });
  });

  it("BUD-07@PoC AC5: a weekly payment missed twice in a row is not flagged; the third miss flags it", () => {
    const weekly = { frequency: "week" as const, anchorDate: "2026-11-02", createdOn: "2026-11-01" };
    const two = track({ ...weekly, today: "2026-11-19", candidates: [charge("2026-11-02", "40.00")] });
    expect(two).toMatchObject({ missesInRow: 2, state: "active" });
    const three = track({ ...weekly, today: "2026-11-26", candidates: [charge("2026-11-02", "40.00")] });
    expect(three).toMatchObject({ missesInRow: 3, state: "possibly-cancelled" });
  });

  it("BUD-07@PoC FR 10: «Сплачено із запізненням» is no miss; «Залишити» counts the misses anew", () => {
    const base = {
      today: "2026-11-16",
      anchorDate: "2026-09-05",
      createdOn: "2026-09-01",
      candidates: [charge("2026-09-05", "40.00")],
    };
    expect(track(base).state).toBe("possibly-cancelled");
    expect(track({ ...base, keptOn: "2026-11-16" })).toMatchObject({ missesInRow: 0, state: "active" });
  });

  it("BUD-07@PoC EC4: rent added today, paid in cash before — the charges before the day added are no misses", () => {
    const t = track({
      today: "2026-11-16",
      anchorDate: "2026-01-05",
      createdOn: "2026-11-16",
      base: eur("650.00"),
    });
    expect(t.charges.map((c) => c.dueOn)).toEqual(["2026-12-05"]);
    expect(t).toMatchObject({ missesInRow: 0, state: "active" });
  });
});

describe("BUD-07@PoC FR 11: the expected amount follows the charges", () => {
  it("BUD-07@PoC AC3: streaming used to cost 15,49 €; a charge of 17,99 € (> 5 %) — the expected amount is 17,99 €", () => {
    const up = charge("2026-11-14", "17.99");
    const t = track({
      today: "2026-11-16",
      anchorDate: "2026-10-14",
      createdOn: "2026-10-14",
      base: eur("15.49"),
      candidates: [charge("2026-10-14", "15.49"), up],
    });
    expect(t.expected).toEqual(eur("17.99"));
    expect(t.changes).toEqual([
      { from: eur("15.49"), to: eur("17.99"), on: "2026-11-14", transactionId: up.id },
    ]);
  });

  it("BUD-07@PoC FR 11: within 5 % — unchanged; a charge the user saw when adding the payment changes nothing", () => {
    const near = track({
      today: "2026-11-16",
      anchorDate: "2026-10-14",
      createdOn: "2026-10-14",
      base: eur("15.49"),
      candidates: [charge("2026-11-14", "16.20")],
    });
    expect(near.expected).toEqual(eur("15.49"));
    // Confirmed on 16 November with 17,99 € although the anchor charge (14 October) was 15,49 €.
    const edited = track({
      today: "2026-11-16",
      anchorDate: "2026-10-14",
      createdOn: "2026-11-16",
      base: eur("17.99"),
      candidates: [charge("2026-10-14", "15.49"), charge("2026-11-14", "15.49")],
    });
    expect(edited.expected).toEqual(eur("17.99"));
  });

  it("BUD-07@PoC AC13: Netflix 9,99 € → 11,99 € paid 30 October — «Сплачено 30 жовт.» and «▲ 2,00 €» from 9,99 €", () => {
    const t = track({
      today: "2026-11-16",
      anchorDate: "2026-07-30",
      createdOn: "2026-07-30",
      base: eur("9.99"),
      candidates: [
        charge("2026-07-30", "9.99"),
        charge("2026-08-30", "9.99"),
        charge("2026-09-30", "9.99"),
        charge("2026-10-30", "11.99"),
      ],
    });
    expect(statusOf(t, "2026-10-30")).toMatchObject({ status: "paid", paidOn: "2026-10-30" });
    expect(t.amountChange).toMatchObject({ from: eur("9.99"), to: eur("11.99"), on: "2026-10-30" });
    expect(t.amountChange!.to.minus(t.amountChange!.from)).toEqual(eur("2.00"));
  });

  it("BUD-07@PoC EC1: a variable amount — the expected amount is the average of the last 3 charges", () => {
    const t = track({
      today: "2026-11-16",
      anchorDate: "2026-08-28",
      createdOn: "2026-08-28",
      base: eur("80.00"),
      variable: true,
      candidates: [
        charge("2026-08-28", "80.00"),
        charge("2026-09-28", "95.00"),
        charge("2026-10-28", "100.00"),
      ],
    });
    expect(t.expected).toEqual(eur("91.67"));
  });

  it("BUD-07@PoC EC5: the salary changes — the expected income is updated", () => {
    const t = track({
      today: "2026-11-16",
      type: "income",
      anchorDate: "2026-10-10",
      createdOn: "2026-10-01",
      base: eur("2150.00"),
      candidates: [charge("2026-10-10", "2150.00"), charge("2026-11-10", "2400.00")],
    });
    expect(t.expected).toEqual(eur("2400.00"));
  });
});

describe("BUD-07@PoC FR 12: a charge in another currency is matched after the conversion", () => {
  const gbp = (a: string) => Money.of(a, "GBP");
  const base = {
    today: "2026-11-16",
    anchorDate: "2026-10-14",
    createdOn: "2026-10-01",
    base: gbp("10.00"),
  };

  it("BUD-07@PoC AC7: 10,00 £ expected, 11,50 € charged at 1 GBP = 1,15 € — paid; the expected amount is unchanged", () => {
    const c = charge("2026-11-14", "11.50", { value: gbp("10.00"), converted: true });
    const t = track({
      ...base,
      candidates: [charge("2026-10-14", "10.00", { amount: gbp("10.00"), value: gbp("10.00") }), c],
    });
    expect(statusOf(t, "2026-11-14")).toMatchObject({
      status: "paid",
      amount: eur("11.50"),
      approximate: false,
    });
    expect(t.expected).toEqual(gbp("10.00"));
  });

  it("BUD-07@PoC FR 12: within ± 10 % only; at the nearest earlier rate «приблизно»; without a rate — not matched", () => {
    const far = charge("2026-11-14", "13.50", { value: gbp("11.74"), converted: true });
    expect(statusOf(track({ ...base, candidates: [far] }), "2026-11-14")!.status).toBe("expected");
    const near = charge("2026-11-14", "11.50", { value: gbp("10.00"), converted: true, approximate: true });
    const t = track({ ...base, candidates: [near] });
    expect(t).toMatchObject({ approximate: true });
    const none = charge("2026-11-14", "11.50", { value: null, converted: true });
    expect(statusOf(track({ ...base, candidates: [none] }), "2026-11-14")!.status).toBe("expected");
  });
});
