import type { ApiClient } from "@willowsum/api-contract";
import { currencyInfo, Decimal, Money as KernelMoney, sumMoney } from "@willowsum/domain-kernel";
import { outcome, type Outcome } from "../../auth/api.ts";
import type { Goal, Money } from "./model.ts";

/**
 * BUD-05@PoC d) (wave 2, row 129): what S-139 «Витратити» reads — the outgoing transactions of the goal's account (any
 * account of the space for a goal of marks) from `GET /v1/goals/{goalId}/spendable`, and what it sends — `POST
 * /v1/goals/{goalId}/spends` with the chosen transactions and their accounts. The API decides what may be spent and
 * what the goal holds afterwards; the screen only sums the chosen amounts (one currency) for the line under the list.
 */
export interface SpendRow {
  readonly id: string;
  readonly accountId: string;
  readonly merchant: string;
  readonly date: string;
  /** The amount without its sign (the part the transaction takes from its account), in the goal's currency. */
  readonly amount: Money;
}

/** FR 8: the list shows at most 6 rows; «показати наступні 6» adds 6 more. */
export const SPEND_PAGE = 6;
/** How many rows one answer of the API brings; the next page comes once the shown rows reach them (#559). */
export const SPEND_FETCH = 48;

/** What the list holds: the rows read so far, how many there are in all, and the cursor of the next page. */
export interface SpendRows {
  readonly rows: readonly SpendRow[];
  readonly count: number;
  readonly next: string | null;
}

/**
 * The transactions the goal may spend, from `GET /v1/goals/{goalId}/spendable` (#559): outgoing, posted, visible,
 * non-transfer, in the goal's currency, on its part's account (any account for a goal of marks) and not spent from any
 * goal yet — the server leaves them out, so «Ще N» counts every one. Newest first; `search` is the field above the
 * list (counterparty and description); `after` continues a list already read.
 */
export async function loadSpendRows(
  api: ApiClient,
  goal: Goal,
  search: string,
  after?: SpendRows,
): Promise<Outcome<SpendRows>> {
  const q = search.trim();
  const list = await outcome(
    api.GET("/v1/goals/{goalId}/spendable", {
      params: {
        path: { goalId: goal.id },
        query: {
          limit: SPEND_FETCH,
          ...(q !== "" ? { search: q } : {}),
          ...(after?.next ? { cursor: after.next } : {}),
        },
      },
    }),
  );
  if (!list.ok) return list;
  const known = new Set(after?.rows.map((r) => r.id));
  const rows = list.data.items
    .filter((t) => !known.has(t.id))
    .map((t) => ({
      id: t.id,
      accountId: t.accountId,
      merchant: t.counterparty ?? t.description ?? "",
      date: t.date,
      amount: {
        amount: new Decimal(t.amount.amount).toFixed(currencyInfo(t.amount.currency).minorUnits),
        currency: t.amount.currency,
      },
    }));
  return {
    ok: true,
    data: { rows: [...(after?.rows ?? []), ...rows], count: list.data.count, next: list.data.nextCursor },
  };
}

/** The sum of the chosen rows, one currency; `null` for none. */
export function chosenSum(rows: readonly SpendRow[], currency: string): Money | null {
  if (rows.length === 0) return null;
  return sumMoney(
    rows.map((r) => KernelMoney.of(r.amount.amount, r.amount.currency)),
    currency,
  ).toJSON();
}

/** The line «у цілі залишиться»: what the goal holds minus the chosen sum, in the goal's currency. */
export function leftAfter(goal: Goal, chosen: Money | null): Money {
  const held = KernelMoney.of(goal.collected.amount, goal.collected.currency);
  return chosen === null
    ? goal.collected
    : held.minus(KernelMoney.of(chosen.amount, chosen.currency)).toJSON();
}

export function spendBody(rows: readonly SpendRow[]) {
  return { transactions: rows.map((r) => ({ transactionId: r.id, accountId: r.accountId })) };
}
