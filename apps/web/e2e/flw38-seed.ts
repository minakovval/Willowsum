import { eur, dayOf, kyivToday, monthOf, shiftMonth, type World } from "./world.ts";

/**
 * The history of the FLW-38@PoC end-to-end run, relative to today (M = this month): a budget that began in M-6 with
 * the plan «Продукти» 2 600 €, «Кафе і ресторани» 600 €, «Дім» 200 € and income 4 000 €.
 * - M-1 (the finished month of «Підсумок періоду»): income 4 000 €; «Продукти» 2 × 1 250 €; «Кафе і ресторани» 8 × 62,50 € = 500 €;
 *   «Дім» 100 € — expenses 3 100 €, net flow 900 €, savings rate 22,5 % (AC5).
 * - M-4 … M-2: income 4 000 €; «Продукти» 2 × 1 250 €; «Кафе і ресторани» 2 × 130 € = 260 € (the average of 3 months, AC1); «Дім» 100 €.
 * - M-3 also «Ремонт даху» 3 500 € in «Дім» (AC3); M-6 and M-5 only «Дім» 100 € and no income (EC1): six months, so
 *   the average of 6 months is of six.
 * - M (this month): «Кафе і ресторани» 40 € on the 1st.
 * Nothing is older than the budget (M-6), so «Той самий період минулого року» has no base (AC4).
 */
export interface History {
  readonly m: string;
  readonly accountId: string;
  readonly roofRepairId: string;
  /** «Продукти» 1 250 € of M-1 on the 20th: the transaction EC2 splits. */
  readonly splittableId: string;
  /** The expenses of M-1 as `[day, amount]`, to count the days 1…d of «Попередній період» (AC2). */
  readonly previousMonthExpenses: readonly (readonly [number, string])[];
}

export async function seedHistory(w: World): Promise<History> {
  const m = monthOf(kyivToday());
  const first = shiftMonth(m, -7);
  const accountId = await w.account({
    kind: "current",
    name: "Поточний",
    balance: eur("20000.00"),
    balanceDate: dayOf(first, 1),
  });
  const [groceries, cafes, home] = await Promise.all(
    ["Продукти", "Кафе і ресторани", "Дім"].map((name) => w.categoryId(name)),
  );
  await w.budgetSince(shiftMonth(m, -6), {
    incomePlan: eur("4000.00"),
    limits: [
      { categoryId: groceries, amount: eur("2600.00") },
      { categoryId: cafes, amount: eur("600.00") },
      { categoryId: home, amount: eur("200.00") },
    ],
  });
  const previousMonthExpenses: [number, string][] = [];
  const spend = async (month: string, day: number, amount: string, category: string, who?: string) => {
    const id = await w.transaction(accountId, `-${amount}`, dayOf(month, day), category, who);
    if (month === shiftMonth(m, -1)) previousMonthExpenses.push([day, amount]);
    return id;
  };
  // The first transaction of the history is on the 1st: the averages count only months that begin after it (BUD-06 FR 4).
  await spend(shiftMonth(m, -6), 1, "100.00", "Дім");
  await spend(shiftMonth(m, -5), 3, "100.00", "Дім");
  for (const back of [4, 3, 2]) {
    const month = shiftMonth(m, -back);
    await w.transaction(accountId, "4000.00", dayOf(month, 2), "Зарплата");
    await spend(month, 5, "1250.00", "Продукти");
    await spend(month, 20, "1250.00", "Продукти");
    await spend(month, 8, "130.00", "Кафе і ресторани");
    await spend(month, 22, "130.00", "Кафе і ресторани");
    await spend(month, 3, "100.00", "Дім");
  }
  const previous = shiftMonth(m, -1);
  await w.transaction(accountId, "4000.00", dayOf(previous, 2), "Зарплата");
  await spend(previous, 5, "1250.00", "Продукти");
  const splittableId = await spend(previous, 20, "1250.00", "Продукти");
  for (const day of [3, 6, 9, 12, 15, 18, 21, 24]) await spend(previous, day, "62.50", "Кафе і ресторани");
  await spend(previous, 4, "100.00", "Дім");
  const roofRepairId = await w.transaction(
    accountId,
    "-3500.00",
    dayOf(shiftMonth(m, -3), 14),
    "Дім",
    "Ремонт даху",
  );
  await w.transaction(accountId, "-40.00", dayOf(m, 1), "Кафе і ресторани");
  return { m, accountId, roofRepairId, splittableId, previousMonthExpenses };
}
