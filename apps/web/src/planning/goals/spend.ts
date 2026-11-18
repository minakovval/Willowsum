import type { ApiClient } from "@willowsum/api-contract";
import { Decimal, Money as KernelMoney, sumMoney } from "@willowsum/domain-kernel";
import { outcome, type Outcome } from "../../auth/api.ts";
import type { Goal, Money } from "./model.ts";

/**
 * BUD-05@PoC d) (wave 2, row 129): what S-139 «Витратити» reads — the outgoing transactions of the goal's account (any
 * account of the space for a goal of marks) from `GET /v1/transactions`, and what it sends — `POST
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
/** One answer of the list is read in full (the largest page the API gives); the rest is told in the log. */
export const SPEND_FETCH = "100" as const;

/**
 * The outgoing, posted, visible, non-transfer transactions in the goal's currency, newest first, that are not spent
 * from a goal yet (`goal.spends` holds this goal's; the API refuses a transaction spent from another one).
 * `search` is the field above the list (counterparty and description).
 */
export async function loadSpendRows(
  api: ApiClient,
  goal: Goal,
  search: string,
): Promise<Outcome<readonly SpendRow[]>> {
  const filter = ["type.eq:out", "transfer.eq:false", "hidden.eq:false", "status.eq:posted"];
  if (goal.part.kind !== "marks" && goal.part.accountId !== null)
    filter.push(`accountId.eq:${goal.part.accountId}`);
  const q = search.trim();
  if (q !== "") filter.push(`search.has:${q}`);
  const list = await outcome(
    api.GET("/v1/transactions", {
      params: { query: { pageSize: SPEND_FETCH, sort: "-date", filter } },
    }),
  );
  if (!list.ok) return list;
  const spent = new Set(goal.spends.map((s) => s.transactionId));
  const rows = list.data.items
    .filter(
      (t) =>
        t.type === "expense" &&
        t.transfer === null &&
        !spent.has(t.id) &&
        t.amount.currency === goal.target.currency,
    )
    .map((t) => ({
      id: t.id,
      accountId: t.accountId,
      merchant: t.counterparty ?? t.description ?? "",
      date: t.date,
      amount: { amount: new Decimal(t.amount.amount).abs().toFixed(2), currency: t.amount.currency },
    }));
  return { ok: true, data: rows };
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
