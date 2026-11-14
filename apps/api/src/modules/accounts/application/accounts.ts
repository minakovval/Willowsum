import type { Money } from "@willowsum/domain-kernel";
import type { FxReporting } from "../../fx-rates/index.ts";
import type { Ledger } from "../../ledger/index.ts";
import { availableCredit, checkTerms, type Liabilities, type Liability } from "../../liabilities/index.ts";
import {
  checkNewAccount,
  depositAccrual,
  groupOf,
  institutionKey,
  ledgerTypeOf,
  maskedNumber,
  openingEventAmount,
  OWNER_SHARE,
  sameNumber,
  shownBalance,
  type AccountKind,
  type AccountNumber,
  type DepositAccrual,
  type FieldIssue,
  type NewAccount,
  type NewAccountInput,
} from "../domain/index.ts";

/**
 * Creating and reading money accounts (FIN-01@PoC FR 1–8, FR 12, FR 16, FR 17, FR 25). The caller's space comes from
 * the session (П-5): every port is bound to it. Creating an account, in the accounts transaction (under a lock of the
 * space's creations, so two requests cannot both pass the duplicate check):
 *
 * 1. the form is checked (`checkNewAccount`; a loan's and a card's terms by `liabilities`) and the duplicate rule
 *    applied (same institution, number or IBAN and currency) — nothing is written for an invalid form or a duplicate;
 * 2. the full number is sealed with the space's key (ARC-06 FR 2), only its last 4 characters stay in the clear;
 * 3. the account, a subaccount per currency with its ledger account, and the Owner with 100 % from the opening date;
 * 4. per currency one ledger event «Початковий залишок» on its date (none for a zero balance — nothing moves);
 * 5. a loan or a credit card: its liability with the terms (`liabilities`);
 * 6. the audit entry (П-10), last, before the accounts transaction commits.
 *
 * Steps 4–6 are other modules' transactions, committed before this one (as in household's rename): a failure rolls
 * this one back but may leave a ledger account, an entry or a liability that no account points to; they carry the
 * ids of this attempt only and are never shown. Atomic hand-over comes with events (ARC-04).
 */

/** The sealed field of an account's number in the space's key scheme (household `SpaceKeys`). */
export const NUMBER_FIELD = "accounts.number";

export interface StoredAccount {
  readonly id: string;
  readonly kind: AccountKind;
  readonly name: string;
  readonly institutionName: string | null;
  readonly institutionCountry: string | null;
  readonly institutionKey: string;
  readonly numberLast4: string | null;
  readonly numberSealed: string | null;
  readonly note: string | null;
  readonly annualRate: string | null;
  readonly depositOpenedOn: string | null;
  readonly depositMaturesOn: string | null;
  readonly openedOn: string;
  readonly status: "active" | "closed";
  /** The date of «Закритий» (FIN-01 FR 15, FR 22); closing comes with FIN-12 (wave 2 row 13). */
  readonly closedOn: string | null;
  readonly source: "manual" | "import";
}

export interface StoredSubaccount {
  readonly id: string;
  readonly accountId: string;
  readonly currency: string;
  readonly position: number;
  readonly ledgerAccountId: string;
  readonly balanceDate: string;
}

export interface StoredOwner {
  readonly ownerAccountId: string;
  /** Percent, a decimal string. */
  readonly share: string;
  readonly validFrom: string;
  readonly validTo: string | null;
}

/** An existing account the duplicate rule compares with. */
export interface DuplicateCandidate {
  readonly id: string;
  readonly name: string;
  readonly institutionName: string | null;
  readonly numberLast4: string;
  readonly numberSealed: string | null;
  readonly currencies: readonly string[];
}

/** One transaction of the accounts schema, bound to the caller's space. */
export interface AccountsTx {
  /** Serialises the space's account creations until the transaction ends. */
  lockCreations(householdId: string): Promise<void>;
  /** Accounts of the same institution with these last 4 characters. */
  duplicateCandidates(
    householdId: string,
    institutionKey: string,
    last4: string,
  ): Promise<DuplicateCandidate[]>;
  insertAccount(householdId: string, account: StoredAccount): Promise<void>;
  insertSubaccount(householdId: string, subaccount: StoredSubaccount): Promise<void>;
  insertOwner(householdId: string, accountId: string, owner: StoredOwner): Promise<void>;
  account(householdId: string, accountId: string): Promise<StoredAccount | null>;
  subaccounts(householdId: string, accountId: string): Promise<StoredSubaccount[]>;
  owners(householdId: string, accountId: string): Promise<StoredOwner[]>;
}

/** The space's key for sensitive fields (household `SpaceKeys`, ARC-06 FR 2). */
export interface NumberSeal {
  seal(householdId: string, field: string, plaintext: string): Promise<string>;
  open(householdId: string, field: string, sealed: string): Promise<string>;
}

/** The space's audit log (П-10): who created which account, the number masked. */
export interface AccountAudit {
  accountCreated(
    householdId: string,
    actorAccountId: string,
    account: StoredAccount,
    subaccounts: readonly { readonly currency: string; readonly balance: Money; readonly date: string }[],
    owner: StoredOwner,
  ): Promise<void>;
}

export interface AccountsDeps {
  readonly ledger: Pick<Ledger, "openAccount" | "post" | "balanceAt">;
  readonly liabilities: Pick<Liabilities, "register" | "forAccount">;
  readonly seal: NumberSeal;
  readonly audit: AccountAudit;
  readonly newId: () => string;
  /** Balances in the profile currency at the official NBU rate (fx-rates, VAL-04): «Гроші разом» and the list. */
  readonly fx: Pick<FxReporting, "total">;
  /** The profile currency (the space's reporting currency; EUR for every space in this release, ACC-06). */
  readonly reportingCurrency: string;
  /** Today's date (YYYY-MM-DD) for balances and a deposit's accrual; from the clock, never read here. */
  readonly today: () => string;
}

export interface Caller {
  readonly householdId: string;
  /** The member's account (identity); in this release always the space's Owner. */
  readonly accountId: string;
}

/** «Такий рахунок уже є: <установа> ••<4 символи>» with «Відкрити наявний» (FIN-01 FR 25, AC15). */
export interface Duplicate {
  readonly accountId: string;
  /** The institution's name, or the account's name when it has none. */
  readonly institution: string;
  readonly maskedNumber: string;
}

export type CreateResult =
  | { readonly kind: "created"; readonly accountId: string }
  | { readonly kind: "invalid"; readonly issues: readonly FieldIssue[] }
  | { readonly kind: "duplicate"; readonly duplicate: Duplicate };

function checkForm(input: NewAccountInput): { account: NewAccount } | { issues: readonly FieldIssue[] } {
  const checked = checkNewAccount(input);
  if ("issues" in checked) return checked;
  if (checked.account.liability) {
    const terms = checkTerms(checked.account.liability);
    if ("issues" in terms) return { issues: terms.issues.map((i) => ({ field: i.field, issue: i.issue })) };
  }
  return checked;
}

/**
 * The account that a new one would duplicate (FIN-01 FR 25): the same institution, the same number or IBAN (in full
 * when both are kept, else by the last 4 characters) and a currency in common. Without a number nothing is a
 * duplicate. Sealed numbers are opened only for accounts that already match by institution and last 4 characters.
 */
export async function findDuplicate(
  deps: Pick<AccountsDeps, "seal">,
  tx: Pick<AccountsTx, "duplicateCandidates">,
  householdId: string,
  probe: {
    readonly institutionKey: string;
    readonly number: AccountNumber | null;
    readonly currencies: readonly string[];
  },
): Promise<Duplicate | null> {
  if (!probe.number) return null;
  for (const c of await tx.duplicateCandidates(householdId, probe.institutionKey, probe.number.last4)) {
    if (!c.currencies.some((currency) => probe.currencies.includes(currency))) continue;
    const full =
      probe.number.full !== null && c.numberSealed !== null
        ? await deps.seal.open(householdId, NUMBER_FIELD, c.numberSealed)
        : null;
    if (!sameNumber(probe.number, { last4: c.numberLast4, full })) continue;
    return {
      accountId: c.id,
      institution: c.institutionName ?? c.name,
      maskedNumber: maskedNumber(c.numberLast4),
    };
  }
  return null;
}

export async function createAccount(
  deps: AccountsDeps,
  tx: AccountsTx,
  caller: Caller,
  input: NewAccountInput,
): Promise<CreateResult> {
  const checked = checkForm(input);
  if ("issues" in checked) return { kind: "invalid", issues: checked.issues };
  const draft = checked.account;
  const { householdId } = caller;
  const key = institutionKey(draft.institution);

  await tx.lockCreations(householdId);
  const duplicate = await findDuplicate(deps, tx, householdId, {
    institutionKey: key,
    number: draft.number,
    currencies: draft.currencies.map((c) => c.balance.currency),
  });
  if (duplicate) return { kind: "duplicate", duplicate };

  const account: StoredAccount = {
    id: deps.newId(),
    kind: draft.kind,
    name: draft.name,
    institutionName: draft.institution?.name ?? null,
    institutionCountry: draft.institution?.country ?? null,
    institutionKey: key,
    numberLast4: draft.number?.last4 ?? null,
    numberSealed:
      draft.number?.full != null ? await deps.seal.seal(householdId, NUMBER_FIELD, draft.number.full) : null,
    note: draft.note,
    annualRate: draft.annualRate,
    depositOpenedOn: draft.depositOpenedOn,
    depositMaturesOn: draft.depositMaturesOn,
    openedOn: draft.openedOn,
    status: "active",
    closedOn: null,
    source: "manual",
  };
  await tx.insertAccount(householdId, account);

  const type = ledgerTypeOf(draft.kind);
  for (const [position, opening] of draft.currencies.entries()) {
    const id = deps.newId();
    const currency = opening.balance.currency;
    const ledgerAccount = await deps.ledger.openAccount(
      householdId,
      { module: "accounts", id },
      { type, currency },
    );
    await tx.insertSubaccount(householdId, {
      id,
      accountId: account.id,
      currency,
      position,
      ledgerAccountId: ledgerAccount.id,
      balanceDate: opening.date,
    });
    if (!opening.balance.isZero())
      await deps.ledger.post(householdId, {
        source: { module: "accounts", id },
        idempotencyKey: `accounts.opening:${id}`,
        operationDate: opening.date,
        event: {
          type: "opening-balance",
          account: ledgerAccount.id,
          amount: openingEventAmount(draft.kind, opening.balance),
        },
      });
  }

  const owner: StoredOwner = {
    ownerAccountId: caller.accountId,
    share: OWNER_SHARE.toFixed(),
    validFrom: draft.openedOn,
    validTo: null,
  };
  await tx.insertOwner(householdId, account.id, owner);

  if (draft.liability) {
    const registered = await deps.liabilities.register(householdId, {
      actorAccountId: caller.accountId,
      accountId: account.id,
      terms: draft.liability,
    });
    if (registered.kind !== "registered") throw new Error("liability terms refused after they were checked");
  }

  await deps.audit.accountCreated(
    householdId,
    caller.accountId,
    account,
    draft.currencies.map((c) => ({ currency: c.balance.currency, balance: c.balance, date: c.date })),
    owner,
  );
  return { kind: "created", accountId: account.id };
}

/** An account as the API answers it: the number only by its last 4 characters (FIN-01 AC7). */
export interface AccountView {
  readonly id: string;
  readonly kind: AccountKind;
  readonly group: "cash" | "credit";
  readonly name: string;
  readonly institution: { readonly name: string; readonly country: string } | null;
  readonly number: { readonly last4: string; readonly masked: string } | null;
  readonly note: string | null;
  readonly status: "active" | "closed";
  readonly source: "manual" | "import";
  readonly openedOn: string;
  readonly owners: readonly StoredOwner[];
  /** Per currency, the balance today from the ledger, shown from the holder's side (a debt is negative). */
  readonly currencies: readonly {
    readonly currency: string;
    readonly balance: Money;
    readonly balanceDate: string;
  }[];
  readonly savings: { readonly annualRate: string | null } | null;
  readonly deposit: {
    readonly annualRate: string | null;
    readonly openedOn: string | null;
    readonly maturesOn: string | null;
    readonly accrual: DepositAccrual | null;
  } | null;
  readonly creditCard: {
    readonly annualRate: string | null;
    readonly creditLimit: Money | null;
    readonly gracePeriodDays: number | null;
    readonly debt: Money;
    readonly available: Money | null;
  } | null;
  readonly loan: {
    readonly annualRate: string | null;
    readonly monthlyPayment: Money | null;
    readonly debt: Money;
  } | null;
}

/** The account with its balances today; null when the caller's space has no such account (another space's too). */
export async function accountView(
  deps: Pick<AccountsDeps, "ledger" | "liabilities" | "today">,
  tx: Pick<AccountsTx, "account" | "subaccounts" | "owners">,
  householdId: string,
  accountId: string,
): Promise<AccountView | null> {
  const account = await tx.account(householdId, accountId);
  if (!account) return null;
  const today = deps.today();
  const subaccounts = await tx.subaccounts(householdId, accountId);
  const currencies = [];
  for (const s of subaccounts) {
    const ledgerBalance = await deps.ledger.balanceAt(householdId, s.ledgerAccountId, today);
    currencies.push({
      currency: s.currency,
      balance: shownBalance(account.kind, ledgerBalance),
      balanceDate: s.balanceDate,
    });
  }
  // Every account has its main currency (position 0); none would be a broken invariant, not an empty account.
  if (currencies.length === 0) throw new Error("account without a currency");
  const main = currencies[0]!.balance;
  const liability: Liability | null =
    groupOf(account.kind) === "credit" ? await deps.liabilities.forAccount(householdId, accountId) : null;
  const debt = main.negated();
  return {
    id: account.id,
    kind: account.kind,
    group: groupOf(account.kind),
    name: account.name,
    institution:
      account.institutionName !== null && account.institutionCountry !== null
        ? { name: account.institutionName, country: account.institutionCountry }
        : null,
    number:
      account.numberLast4 !== null
        ? { last4: account.numberLast4, masked: maskedNumber(account.numberLast4) }
        : null,
    note: account.note,
    status: account.status,
    source: account.source,
    openedOn: account.openedOn,
    owners: await tx.owners(householdId, accountId),
    currencies,
    savings: account.kind === "savings" ? { annualRate: account.annualRate } : null,
    deposit:
      account.kind === "deposit"
        ? {
            annualRate: account.annualRate,
            openedOn: account.depositOpenedOn,
            maturesOn: account.depositMaturesOn,
            accrual: depositAccrual(
              main,
              {
                annualRate: account.annualRate,
                openedOn: account.depositOpenedOn,
                maturesOn: account.depositMaturesOn,
              },
              today,
            ),
          }
        : null,
    creditCard:
      account.kind === "credit-card"
        ? {
            annualRate: liability?.annualRate ?? null,
            creditLimit: liability?.creditLimit ?? null,
            gracePeriodDays: liability?.gracePeriodDays ?? null,
            debt,
            available: liability?.creditLimit ? availableCredit(liability.creditLimit, debt) : null,
          }
        : null,
    loan:
      account.kind === "loan"
        ? {
            annualRate: liability?.annualRate ?? null,
            monthlyPayment: liability?.monthlyPayment ?? null,
            debt,
          }
        : null,
  };
}
