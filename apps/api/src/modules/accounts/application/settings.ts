import {
  accountName,
  fieldsForKind,
  kindChange,
  type AccountKind,
  type FieldIssue,
} from "../domain/index.ts";
import type { AccountsDeps, AccountsTx, Caller, StoredAccount } from "./accounts.ts";

/**
 * «Рахунок → Налаштування» → «Основне» (FIN-12@PoC FR 4–6, AC1, AC2, AC11, AC12; wave 2 row 13 b): renaming an account
 * and changing its kind within its group. In the accounts transaction with the account's row locked:
 *
 * 1. the change is checked against the account as it is — nothing is written for a refusal or for no change;
 * 2. «Кредит» ↔ «Кредитна картка» only without transactions: no ledger entry in effect besides «Початковий залишок»
 *    on any of its currencies (an adjustment of «Оновити залишок» is a transaction, FR 14); then the liability takes
 *    the new kind (`liabilities`, its own transaction and audit entry);
 * 3. the account's name, kind and the kind's own fields;
 * 4. the audit entry with every changed field before and after, last before this transaction commits (FR 6).
 *
 * The ledger is never touched: the ledger type (asset or liability) is the group's, so the transactions and their
 * postings stay as they are (FR 6). The liability is another module's transaction, committed before this one (#210):
 * a failure after it leaves the liability with the new kind and the account with the old one; the same request again
 * finds the liability changed already (it writes nothing) and finishes the change.
 */

export type SettingsResult =
  | { readonly kind: "updated" }
  | { readonly kind: "unchanged" }
  | { readonly kind: "not-found" }
  | { readonly kind: "closed" }
  | { readonly kind: "other-group" }
  | { readonly kind: "has-transactions" }
  | { readonly kind: "invalid"; readonly issues: readonly FieldIssue[] };

export interface SettingsInput {
  readonly name?: string | undefined;
  readonly kind?: AccountKind | undefined;
}

/** «Початковий залишок» is the account's starting point, not a transaction (FIN-01 FR 7; a lead decision). */
const NOT_TRANSACTIONS = ["opening-balance"] as const;

export async function updateAccountSettings(
  deps: Pick<AccountsDeps, "ledger" | "liabilities" | "audit">,
  tx: AccountsTx,
  caller: Caller,
  accountId: string,
  input: SettingsInput,
): Promise<SettingsResult> {
  const { householdId } = caller;
  const account = await tx.lockAccount(householdId, accountId);
  if (!account) return { kind: "not-found" };
  // «Закритий» is read-only except the display flags (FR 8).
  if (account.status === "closed") return { kind: "closed" };

  let name = account.name;
  if (input.name !== undefined) {
    const parsed = accountName(input.name);
    if (parsed === null) return { kind: "invalid", issues: [{ field: "name", issue: "invalid" }] };
    name = parsed;
  }

  let after: StoredAccount = { ...account, name };
  if (input.kind !== undefined) {
    const subaccounts = await tx.subaccounts(householdId, accountId);
    const change = kindChange(account.kind, input.kind, subaccounts.length);
    switch (change.kind) {
      case "same":
        break;
      case "other-group":
        return { kind: "other-group" };
      case "multi-currency":
        return { kind: "invalid", issues: [{ field: "kind", issue: "multi_currency" }] };
      case "credit": {
        for (const s of subaccounts)
          if (await deps.ledger.hasLiveEntries(householdId, s.ledgerAccountId, NOT_TRANSACTIONS))
            return { kind: "has-transactions" };
        const changed = await deps.liabilities.changeKind(householdId, {
          actorAccountId: caller.accountId,
          accountId,
          kind: change.to,
        });
        if (changed.kind === "not-found") throw new Error("a credit account without its liability");
        // «Строк дії» is a card's (FR 4): a loan has none; the audit entry keeps the value dropped.
        after = {
          ...after,
          kind: change.to,
          cardExpiry: change.to === "credit-card" ? account.cardExpiry : null,
        };
        break;
      }
      case "cash":
        after = { ...after, kind: input.kind, ...fieldsForKind(input.kind, account) };
        break;
    }
  }

  const changes = SETTINGS_FIELDS.filter((field) => account[field] !== after[field]);
  if (changes.length === 0) return { kind: "unchanged" };
  await tx.updateSettings(householdId, after);
  await deps.audit.settingsChanged(
    householdId,
    caller.accountId,
    accountId,
    changes.map((field) => ({ field, before: account[field], after: after[field] })),
  );
  return { kind: "updated" };
}

/** The fields «Основне» changes, as the audit entry names them. */
export const SETTINGS_FIELDS = [
  "name",
  "kind",
  "annualRate",
  "depositOpenedOn",
  "depositMaturesOn",
  "cardExpiry",
] as const satisfies readonly (keyof StoredAccount)[];
