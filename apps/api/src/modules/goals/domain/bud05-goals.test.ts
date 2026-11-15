import { Money } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import {
  checkContribution,
  checkGoal,
  envelopeExcess,
  forecastDate,
  goalProgress,
  monthsUntil,
  pacePerMonth,
  paceWindowStart,
  progressPercent,
  requiredMonthly,
} from "./goals.ts";

/** BUD-05@PoC a) (wave 2 row 27): the rules of a goal, pure; every amount is synthetic, the day fixed. */
const TODAY = "2026-10-17";
const eur = (amount: string) => Money.of(amount, "EUR");

describe("BUD-05@PoC: required monthly contribution, progress, pace", () => {
  it("BUD-05@PoC FR 5: (target − collected) ÷ months to the date, rounded up to a whole euro — 3 000 € over 9 months is 334 €", () => {
    expect(monthsUntil("2027-07-01", TODAY)).toBe(9);
    expect(requiredMonthly(eur("4000"), eur("1000"), "2027-07-01", TODAY)?.toDecimalString()).toBe("334");
    // A date this month is still one month away, never a division by 0 (lead decision).
    expect(monthsUntil("2026-10-31", TODAY)).toBe(1);
    expect(requiredMonthly(eur("100.01"), eur("0"), "2026-10-31", TODAY)?.toDecimalString()).toBe("101");
    // Collected: nothing more is required; over the target too.
    expect(requiredMonthly(eur("4000"), eur("4050"), "2027-07-01", TODAY)?.toDecimalString()).toBe("0");
    // A yen goal rounds to a whole yen as well.
    expect(
      requiredMonthly(Money.of("1000", "JPY"), Money.of("0", "JPY"), "2027-01-15", TODAY)?.toDecimalString(),
    ).toBe("334");
  });

  it("BUD-05@PoC EC2: a goal without a date has no required contribution — progress and pace only", () => {
    expect(requiredMonthly(eur("4000"), eur("1000"), null, TODAY)).toBeNull();
    const p = goalProgress({
      target: eur("4000"),
      targetDate: null,
      collected: eur("1000"),
      cameIn: eur("300"),
      windowStart: TODAY,
      today: TODAY,
    });
    expect(p.requiredMonthly).toBeNull();
    expect(p.progressPercent).toBe("25.0");
    expect(p.pace?.toDecimalString()).toBe("300");
    expect(p.overdue).toBe(false);
  });

  it("BUD-05@PoC FR 12, EC3: a date that has passed before the target was reached is «overdue»: offer to extend it, change the amount or close", () => {
    const base = {
      target: eur("4000"),
      collected: eur("1000"),
      cameIn: eur("0"),
      windowStart: TODAY,
      today: TODAY,
    };
    expect(goalProgress({ ...base, targetDate: "2026-10-16" }).overdue).toBe(true);
    expect(goalProgress({ ...base, targetDate: "2026-10-16" }).requiredMonthly).toBeNull();
    expect(goalProgress({ ...base, targetDate: TODAY }).overdue).toBe(false);
    expect(goalProgress({ ...base, collected: eur("4000"), targetDate: "2026-10-16" }).overdue).toBe(false);
  });

  it("BUD-05@PoC FR 4 (server part): progress in percent rounded down to one decimal; «✓ Досягнуто» and «+ N € понад ціль»", () => {
    expect(progressPercent(eur("1000"), eur("4000"))).toBe("25.0");
    expect(progressPercent(eur("200"), eur("1800"))).toBe("11.1");
    expect(progressPercent(eur("3999.99"), eur("4000"))).toBe("99.9");
    const over = goalProgress({
      target: eur("4000"),
      targetDate: "2027-07-01",
      collected: eur("4050"),
      cameIn: eur("50"),
      windowStart: TODAY,
      today: TODAY,
    });
    expect(over.achieved).toBe(true);
    expect(over.overTarget?.toDecimalString()).toBe("50");
    expect(over.forecastDate).toBeNull();
    const short = goalProgress({
      ...{ target: eur("4000"), targetDate: null, cameIn: eur("0") },
      collected: eur("3999.99"),
      windowStart: TODAY,
      today: TODAY,
    });
    expect(short.achieved).toBe(false);
    expect(short.overTarget).toBeNull();
  });

  it("BUD-05@PoC FR 7: the pace is what came in over the last 3 months at most (never before the goal), per month; it gives the forecast date", () => {
    expect(paceWindowStart("2026-01-01", TODAY)).toBe("2026-07-18");
    expect(paceWindowStart("2026-10-01", TODAY)).toBe("2026-10-01");
    expect(paceWindowStart("2026-01-01", "2026-05-31")).toBe("2026-03-01");
    // 900 € over the full 3 months (92 days ≈ 3.02 months) is about 297 € a month.
    const pace = pacePerMonth(eur("900"), "2026-07-18", TODAY)!;
    expect(pace.amount.toDecimalPlaces(2).toFixed(2)).toBe("297.76");
    // A goal of a few days counts as one month: one contribution is not extrapolated.
    expect(pacePerMonth(eur("300"), "2026-10-15", TODAY)?.toDecimalString()).toBe("300");
    expect(pacePerMonth(eur("0"), "2026-10-15", TODAY)).toBeNull();
    // 3 000 € left at 300 € a month: 10 months of 30.4375 days, rounded up: 305 days.
    expect(forecastDate(eur("3000"), eur("300"), TODAY)).toBe("2027-08-18");
    expect(forecastDate(eur("3000"), null, TODAY)).toBeNull();
  });

  it("BUD-05@PoC FR 3: the envelopes of an account never exceed its balance — 4 500 € + 800 € on 5 000 € exceed it by 300 €", () => {
    expect(envelopeExcess(eur("5000"), eur("5300"))?.toDecimalString()).toBe("300");
    expect(envelopeExcess(eur("5000"), eur("5000"))).toBeNull();
    expect(envelopeExcess(eur("5000"), eur("1000"))).toBeNull();
  });
});

describe("BUD-05@PoC: the goal's fields", () => {
  const travel = {
    template: "travel" as const,
    name: " Відпустка в Італії ",
    target: { amount: "4000.00", currency: "EUR" },
  };

  it("BUD-05@PoC FR 2 (server part): without step 2 the goal has one part «Без рахунку — лише позначки» with the start amount 0", () => {
    const r = checkGoal(travel, TODAY);
    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    expect(r.fields.name).toBe("Відпустка в Італії");
    expect(r.fields.partKind).toBe("marks");
    expect(r.fields.accountId).toBeNull();
    expect(r.fields.startAmount.toDecimalString()).toBe("0");
    expect(r.fields.emergencyMonths).toBeNull();
  });

  it("BUD-05@PoC FR 2 (server part): «Рахунок» is required for an own account and an envelope and absent for marks; an own account has no start amount", () => {
    const issues = (input: Parameters<typeof checkGoal>[0]) => {
      const r = checkGoal(input, TODAY);
      return r.kind === "invalid" ? r.issues : [];
    };
    expect(issues({ ...travel, part: { kind: "envelope" } })).toEqual([
      { field: "part.accountId", issue: "required" },
    ]);
    expect(
      issues({ ...travel, part: { kind: "marks", accountId: "00000000-0000-4000-8000-000000000001" } }),
    ).toEqual([{ field: "part.accountId", issue: "marks_only" }]);
    expect(
      issues({
        ...travel,
        part: { kind: "account", accountId: "00000000-0000-4000-8000-000000000001", startAmount: "10" },
      }),
    ).toEqual([{ field: "part.startAmount", issue: "account_part" }]);
    expect(issues({ ...travel, name: "  " })).toEqual([{ field: "name", issue: "required" }]);
    expect(issues({ ...travel, target: { amount: "0", currency: "EUR" } })).toEqual([
      { field: "target.amount", issue: "invalid" },
    ]);
    expect(issues({ ...travel, target: { amount: "10.001", currency: "EUR" } })).toEqual([
      { field: "target.amount", issue: "invalid" },
    ]);
    expect(issues({ ...travel, targetDate: "2026-10-16" })).toEqual([{ field: "targetDate", issue: "past" }]);
    // A stored date that has passed may stay (FR 12).
    expect(checkGoal({ ...travel, targetDate: "2026-10-16" }, TODAY, "2026-10-16").kind).toBe("ok");
  });

  it("BUD-05@PoC: «Подушка безпеки» keeps «Скільки місяців витрат», 3 by default; other templates have none", () => {
    const r = checkGoal({ ...travel, template: "emergency" }, TODAY);
    expect(r.kind === "ok" && r.fields.emergencyMonths).toBe(3);
    expect(checkGoal({ ...travel, template: "emergency", emergencyMonths: 0 }, TODAY).kind).toBe("invalid");
    expect(checkGoal({ ...travel, emergencyMonths: 3 }, TODAY).kind).toBe("invalid");
  });

  it("BUD-05@PoC FR 6: «Внести» — a positive amount in the goal's currency, today or before, never before the goal", () => {
    const goal = { currency: "EUR", createdOn: "2026-10-01" };
    expect(checkContribution({ amount: { amount: "50", currency: "EUR" } }, goal, TODAY)).toMatchObject({
      kind: "ok",
      date: TODAY,
    });
    const issue = (input: Parameters<typeof checkContribution>[0]) => {
      const r = checkContribution(input, goal, TODAY);
      return r.kind === "invalid" ? r.issues[0] : null;
    };
    expect(issue({ amount: { amount: "50", currency: "UAH" } })).toEqual({
      field: "amount.currency",
      issue: "goal_currency",
    });
    expect(issue({ amount: { amount: "0", currency: "EUR" } })).toEqual({
      field: "amount.amount",
      issue: "invalid",
    });
    expect(issue({ amount: { amount: "50", currency: "EUR" }, date: "2026-10-18" })).toEqual({
      field: "date",
      issue: "future",
    });
    expect(issue({ amount: { amount: "50", currency: "EUR" }, date: "2026-09-30" })).toEqual({
      field: "date",
      issue: "before_goal",
    });
  });
});
