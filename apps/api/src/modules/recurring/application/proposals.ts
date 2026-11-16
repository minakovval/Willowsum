import { Money } from "@willowsum/domain-kernel";
import {
  addDays,
  detectSeries,
  nextDate,
  scheduleAnchor,
  type Charge,
  type Frequency,
} from "../domain/index.ts";

/**
 * The proposals of regular payments (BUD-07@PoC FR 1–5, AC1, AC6; wave 2 row 25 — part a1): the series found each time
 * they are read, from the space's transactions as they are now — a transaction entered, changed, hidden or deleted is in
 * the next read at once (FR 5 «при відкритті екрана»). Nothing is stored by the analysis itself.
 */

/** FR 1: the days of transactions the analysis reads, today included. */
export const HISTORY_DAYS = 430;
/** The most transactions one analysis reads (newest first); `more` tells the window had older ones. */
export const HISTORY_MAX = 20_000;

export interface HistoryCharge {
  readonly id: string;
  readonly accountId: string;
  readonly date: string;
  /** Signed in `currency`: minus — an expense. */
  readonly amount: string;
  readonly currency: string;
  readonly counterparty: string;
}

export interface ProposalDeps {
  /** Module transactions' `TransactionHistory`. */
  readonly history: {
    charges(
      householdId: string,
      query: { readonly from: string; readonly to: string; readonly limit: number },
    ): Promise<readonly HistoryCharge[]>;
  };
  /** Module merchants' `MerchantDirectory`. */
  readonly merchants: {
    shownMerchants(
      householdId: string,
      counterparties: readonly string[],
    ): Promise<ReadonlyMap<string, { readonly id: string; readonly name: string }>>;
  };
  /** The kind of each account (module accounts' directory): FR 4 — no proposals from a «Кредит» account. */
  readonly accountKinds: (
    householdId: string,
    accountIds: readonly string[],
  ) => Promise<ReadonlyMap<string, string>>;
  /** «Сьогодні» of the space. */
  readonly today: () => string;
}

export interface Proposal {
  /** The series' key: merchant, type, currency, frequency and its first charge. */
  readonly key: string;
  readonly merchant: { readonly id: string; readonly name: string };
  /** FR 6 «тип (витрата або дохід)». */
  readonly type: "expense" | "income";
  readonly frequency: Frequency;
  /** FR 3: «змінна». */
  readonly variable: boolean;
  /** FR 4 «очікувану суму»: positive, in the currency of the charges. */
  readonly expectedAmount: Money;
  /** FR 4 «дату»: the next date of the schedule anchored at the latest charge — on or after today, after that charge. */
  readonly nextDate: string;
  readonly lastDate: string;
  /** The account of the latest charge («рахунок списання»). */
  readonly accountId: string;
  /** The charges of the series, oldest first. */
  readonly transactionIds: readonly string[];
}

/** FR 4: a loan account («Кредит») — its payments are the account's monthly payment (FR 16), never a proposal. */
const LOAN = "loan";

/** FR 1–4: the proposals of the space, by next date, then merchant name, then key. */
export async function listProposals(
  deps: ProposalDeps,
  householdId: string,
): Promise<{ readonly items: readonly Proposal[]; readonly more: boolean }> {
  const today = deps.today();
  const found = await deps.history.charges(householdId, {
    from: addDays(today, -(HISTORY_DAYS - 1)),
    to: today,
    limit: HISTORY_MAX + 1,
  });
  const more = found.length > HISTORY_MAX;
  const history = found.slice(0, HISTORY_MAX);
  const kinds = await deps.accountKinds(householdId, [...new Set(history.map((h) => h.accountId))]);
  const charges = history.filter((h) => kinds.get(h.accountId) !== LOAN);
  const merchants = await deps.merchants.shownMerchants(householdId, [
    ...new Set(charges.map((h) => h.counterparty)),
  ]);

  // FR 1: by merchant; a series is of one type and one currency.
  const groups = new Map<
    string,
    { merchant: { id: string; name: string }; type: Proposal["type"]; charges: HistoryCharge[] }
  >();
  for (const h of charges) {
    const merchant = merchants.get(h.counterparty);
    if (!merchant) continue;
    const type: Proposal["type"] = h.amount.startsWith("-") ? "expense" : "income";
    const key = `${merchant.id}:${type}:${h.currency}`;
    const group = groups.get(key) ?? { merchant, type, charges: [] as HistoryCharge[] };
    group.charges.push(h);
    groups.set(key, group);
  }

  const items: Proposal[] = [];
  for (const [groupKey, group] of groups) {
    const byId = new Map(group.charges.map((h) => [h.id, h]));
    const input: Charge[] = group.charges.map((h) => ({
      id: h.id,
      date: h.date,
      amount: Money.of(h.amount.replace(/^-/, ""), h.currency),
    }));
    for (const series of detectSeries(input)) {
      const first = series.charges[0]!;
      const last = series.charges.at(-1)!;
      items.push({
        key: `${groupKey}:${series.frequency}:${first.id}`,
        merchant: group.merchant,
        type: group.type,
        frequency: series.frequency,
        variable: series.variable,
        expectedAmount: series.expected,
        nextDate: nextDate(
          scheduleAnchor(
            series.charges.map((c) => c.date),
            series.frequency,
          ),
          series.frequency,
          today > last.date ? today : addDays(last.date, 1),
        ),
        lastDate: last.date,
        accountId: byId.get(last.id)!.accountId,
        transactionIds: series.charges.map((c) => c.id),
      });
    }
  }
  items.sort(
    (a, b) =>
      a.nextDate.localeCompare(b.nextDate) ||
      a.merchant.name.localeCompare(b.merchant.name, "uk") ||
      a.key.localeCompare(b.key),
  );
  return { items, more };
}
