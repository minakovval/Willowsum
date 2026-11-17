import type { AccountsDeps, AccountsTx, Caller } from "./accounts.ts";
import type { HandOff } from "./hand-off.ts";
import { settingsHandOff } from "./settings.ts";

/**
 * «Обране» (FIN-01@PoC FR 20; owner decision 2026-11-16, item 2а): the star of an account, set or cleared. It is a
 * display flag, so a closed account changes it too (FIN-12@PoC FR 8: «доступний лише для читання, крім прапорців
 * показу»). In the accounts transaction with the account's row locked, so two stars at once make one change:
 *
 * 1. the same value again writes nothing and has no audit entry;
 * 2. otherwise the flag, and the audit entry with the value before and after as a hand-off job of the same
 *    transaction (`settings-changed`, ARC-04 FR 2): written once it has committed, right away or by the worker.
 *
 * The ledger and the other modules are never touched.
 */

export type DisplayResult =
  | { readonly kind: "updated"; readonly handOff: HandOff }
  | { readonly kind: "unchanged" }
  | { readonly kind: "not-found" };

export interface DisplayInput {
  readonly favourite: boolean;
}

export async function updateAccountDisplay(
  deps: Pick<AccountsDeps, "newId">,
  tx: AccountsTx,
  caller: Caller,
  accountId: string,
  input: DisplayInput,
): Promise<DisplayResult> {
  const account = await tx.lockAccount(caller.householdId, accountId);
  if (!account) return { kind: "not-found" };
  if (account.favourite === input.favourite) return { kind: "unchanged" };
  await tx.setFavourite(caller.householdId, accountId, input.favourite);
  const handOff = await settingsHandOff(deps, tx, caller, accountId, [
    {
      field: "favourite",
      before: String(account.favourite),
      after: String(input.favourite),
      sensitive: false,
    },
  ]);
  return { kind: "updated", handOff };
}
