import { Money } from "@willowsum/domain-kernel";
import type { Entry, Ledger } from "../../ledger/index.ts";
import type { LiveAdjustment } from "../domain/index.ts";

/**
 * The adjustment of «Оновити залишок» (FIN-12 FR 14, FR 15; FIN-04 FR 11): a ledger event `balance-adjustment` of a
 * subaccount against «Коригування». Its record is the journal itself — at most one is in effect per subaccount.
 */
export const ADJUSTMENT = "balance-adjustment";

/** What of a subaccount the adjustment is read by. */
interface Subaccount {
  readonly id: string;
  readonly currency: string;
  readonly ledgerAccountId: string;
}

/** The adjustment as the API shows it: permanent on a manual account, temporary on an imported one (FR 15). */
export interface AdjustmentView extends LiveAdjustment {
  readonly permanent: boolean;
}

/** The one live adjustment of a subaccount, from the holder's side; null when there is none. */
export async function liveAdjustment(
  deps: { readonly ledger: Pick<Ledger, "liveEntries"> },
  householdId: string,
  subaccount: Subaccount,
): Promise<LiveAdjustment | null> {
  const live = await deps.ledger.liveEntries(
    householdId,
    { module: "accounts", id: subaccount.id },
    ADJUSTMENT,
  );
  const entry = live.at(-1);
  return entry ? adjustmentOf(entry, subaccount) : null;
}

/**
 * The adjustment of an entry: one posting of the subaccount against «Коригування». The event's amount moves the shown
 * balance on either ledger type (debiting a liability lowers the debt), so it is the debits minus the credits.
 */
export function adjustmentOf(entry: Entry, subaccount: Subaccount): LiveAdjustment {
  let amount = Money.zero(subaccount.currency);
  for (const p of entry.postings) {
    if (p.debitAccountId === subaccount.ledgerAccountId) amount = amount.plus(p.amount);
    if (p.creditAccountId === subaccount.ledgerAccountId) amount = amount.minus(p.amount);
  }
  return { entryId: entry.id, amount, date: entry.operationDate };
}
