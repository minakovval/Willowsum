import { Money } from "@willowsum/domain-kernel";
import type { FxReporting } from "../../fx-rates/index.ts";
import type { Ledger } from "../../ledger/index.ts";
import {
  availableCredit,
  checkTerms,
  termsMissing,
  type Liabilities,
  type Liability,
} from "../../liabilities/index.ts";
import { liveAdjustment, type AdjustmentView } from "./adjustments.ts";
import { AUDIT_MASK } from "../../audit/index.ts";
import type { AuditValue, HandOff, HandOffAudit, HandOffSubaccount } from "./hand-off.ts";
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
 * 3. the account, a subaccount per currency with the id of its ledger account, and the Owner with 100 % from the
 *    opening date;
 * 4. the hand-off job (ARC-04 FR 2, hand-off.ts), in the same transaction: per currency the ledger account and one
 *    ledger event «Початковий залишок» on its date (none for a zero balance — nothing moves); a loan or a credit card:
 *    its liability with the terms (`liabilities`); the audit entry (П-10).
 *
 * The hand-off runs only after this transaction commits (the route right away, the worker if that fails): a failure
 * anywhere before the commit leaves nothing in another module, and nothing here waits on another module's pool
 * while it holds the accounts connection, except the space's key for a full number (household).
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
  /** «Строк дії» of a credit card (FIN-12 FR 4): YYYY-MM; null for every other kind. */
  readonly cardExpiry: string | null;
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
  /**
   * ARC-04 FR 2: the hand-off of this change to the other modules, enqueued in this transaction (the accounts queue,
   * job `accounts.hand-off`); `changeId` makes each kind change its own job.
   */
  enqueueHandOff(householdId: string, handOff: HandOff, changeId: string): Promise<void>;
  account(householdId: string, accountId: string): Promise<StoredAccount | null>;
  subaccounts(householdId: string, accountId: string): Promise<StoredSubaccount[]>;
  owners(householdId: string, accountId: string): Promise<StoredOwner[]>;
  /** The account's row, locked until the transaction ends (FIN-12: one change of an account at a time). */
  lockAccount(householdId: string, accountId: string): Promise<StoredAccount | null>;
  /** «Основне» (FIN-12 FR 4–6): the name, the kind and the kind's own fields of the account. */
  updateSettings(
    householdId: string,
    account: Pick<
      StoredAccount,
      "id" | "name" | "kind" | "annualRate" | "depositOpenedOn" | "depositMaturesOn" | "cardExpiry"
    >,
  ): Promise<void>;
  /** «Реквізити» (FIN-12 FR 4): the institution, the number (last 4 and sealed), the note, the card's expiry, the rate. */
  updateDetails(
    householdId: string,
    account: Pick<
      StoredAccount,
      | "id"
      | "institutionName"
      | "institutionCountry"
      | "institutionKey"
      | "numberLast4"
      | "numberSealed"
      | "note"
      | "cardExpiry"
      | "annualRate"
    >,
  ): Promise<void>;
  /** «Закритий» with its date, or active again (FIN-12 FR 7–9). */
  setStatus(
    householdId: string,
    accountId: string,
    status: StoredAccount["status"],
    closedOn: string | null,
  ): Promise<void>;
}

/** The space's key for sensitive fields (household `SpaceKeys`, ARC-06 FR 2). */
export interface NumberSeal {
  seal(householdId: string, field: string, plaintext: string): Promise<string>;
  open(householdId: string, field: string, sealed: string): Promise<string>;
}

/** The space's audit log (П-10): who created which account, the number masked. */
export interface AccountAudit extends HandOffAudit {
  /** Closed or reopened (FIN-12 FR 7–9): the status and date before and after, and how a balance was settled. */
  statusChanged(
    householdId: string,
    actorAccountId: string,
    before: Pick<StoredAccount, "id" | "status" | "closedOn">,
    after: {
      readonly status: StoredAccount["status"];
      readonly closedOn: string | null;
      readonly settlement:
        | ({ readonly amounts: readonly { readonly currency: string; readonly balance: Money }[] } & (
            { readonly kind: "transfer"; readonly toAccountId: string } | { readonly kind: "adjustment" }
          ))
        | null;
    },
  ): Promise<void>;
  /**
   * «Основне» or «Реквізити» changed (FIN-12 FR 4, FR 6): every changed field with its value before and after; a
   * `sensitive` one (the sealed number, the note) is masked by the log itself (NFR-01 FR 6).
   */
  settingsChanged(
    householdId: string,
    actorAccountId: string,
    accountId: string,
    changes: readonly {
      readonly field: string;
      readonly before: string | null;
      readonly after: string | null;
      readonly sensitive?: boolean;
    }[],
  ): Promise<void>;
  /**
   * One currency's balance moved by «Перенести на інший рахунок» (FIN-12 FR 7), recorded right after its ledger entry
   * committed, before the closing itself.
   */
  transferred(
    householdId: string,
    actorAccountId: string,
    account: Pick<StoredAccount, "id">,
    transfer: {
      readonly toAccountId: string;
      readonly currency: string;
      readonly amount: Money;
      readonly entryId: string;
    },
  ): Promise<void>;
  /**
   * The adjustment of «Оновити залишок» on a subaccount created, changed or deleted (FIN-12 FR 15, FIN-04 FR 11, AC7):
   * amount and date before and after; by the user, or by the system for a statement's recount.
   */
  adjustmentChanged(
    householdId: string,
    actor: { readonly kind: "user"; readonly id: string } | { readonly kind: "system" },
    channel: "web" | "import",
    subaccount: Pick<StoredSubaccount, "id" | "accountId" | "currency">,
    before: { readonly entryId: string; readonly amount: Money; readonly date: string } | null,
    after: { readonly entryId: string; readonly amount: Money; readonly date: string } | null,
  ): Promise<void>;
}

export interface AccountsDeps {
  readonly ledger: Pick<
    Ledger,
    | "openAccount"
    | "post"
    | "balanceAt"
    | "correct"
    | "reverse"
    | "liveEntries"
    | "latestOperationDate"
    | "hasLiveEntries"
  >;
  readonly liabilities: Pick<Liabilities, "register" | "forAccount" | "changeKind">;
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

/** What was written, for the answer when the hand-off has not finished yet (the ledger shows no balance then). */
export interface CreatedAccount {
  readonly account: StoredAccount;
  readonly subaccounts: readonly StoredSubaccount[];
  readonly owner: StoredOwner;
}

export type CreateResult =
  | {
      readonly kind: "created";
      readonly accountId: string;
      /** Run it once the transaction has committed (ARC-04 FR 2); the worker runs it too. */
      readonly handOff: HandOff;
      readonly created: CreatedAccount;
    }
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
    /** The account being changed (FIN-12 FR 4): it is no duplicate of itself. */
    readonly exceptAccountId?: string;
  },
): Promise<Duplicate | null> {
  if (!probe.number) return null;
  for (const c of await tx.duplicateCandidates(householdId, probe.institutionKey, probe.number.last4)) {
    if (c.id === probe.exceptAccountId) continue;
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
    cardExpiry: null,
    openedOn: draft.openedOn,
    status: "active",
    closedOn: null,
    source: "manual",
  };
  await tx.insertAccount(householdId, account);

  const ledgerType = ledgerTypeOf(draft.kind);
  const subaccounts: StoredSubaccount[] = [];
  const handOffSubaccounts: HandOffSubaccount[] = [];
  for (const [position, opening] of draft.currencies.entries()) {
    const subaccount: StoredSubaccount = {
      id: deps.newId(),
      accountId: account.id,
      currency: opening.balance.currency,
      position,
      // The ledger account is opened by the hand-off under this id, after the commit (ARC-04).
      ledgerAccountId: deps.newId(),
      balanceDate: opening.date,
    };
    await tx.insertSubaccount(householdId, subaccount);
    subaccounts.push(subaccount);
    handOffSubaccounts.push({
      subaccountId: subaccount.id,
      ledgerAccountId: subaccount.ledgerAccountId,
      ledgerType,
      currency: subaccount.currency,
      opening: opening.balance.isZero()
        ? null
        : openingEventAmount(draft.kind, opening.balance).toDecimalString(),
      date: opening.date,
    });
  }

  const owner: StoredOwner = {
    ownerAccountId: caller.accountId,
    share: OWNER_SHARE.toFixed(),
    validFrom: draft.openedOn,
    validTo: null,
  };
  await tx.insertOwner(householdId, account.id, owner);

  const handOff: HandOff = {
    kind: "account-created",
    accountId: account.id,
    actorAccountId: caller.accountId,
    subaccounts: handOffSubaccounts,
    liability: draft.liability ?? null,
    audit: accountCreatedValues(
      account,
      draft.currencies.map((c) => ({ currency: c.balance.currency, balance: c.balance, date: c.date })),
      owner,
      maskedNumber,
    ),
  };
  await tx.enqueueHandOff(householdId, handOff, account.id);
  return { kind: "created", accountId: account.id, handOff, created: { account, subaccounts, owner } };
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
  /** The date of «Закритий» (FIN-12 FR 7, FR 8); null while active. */
  readonly closedOn: string | null;
  readonly source: "manual" | "import";
  readonly openedOn: string;
  readonly owners: readonly StoredOwner[];
  /** Per currency, the balance today from the ledger, shown from the holder's side (a debt is negative). */
  readonly currencies: readonly {
    readonly currency: string;
    readonly balance: Money;
    readonly balanceDate: string;
  }[];
  /** The adjustments of «Оновити залишок» in effect, at most one per currency (FIN-12 FR 14, FR 15). */
  readonly adjustments: readonly (AdjustmentView & { readonly currency: string })[];
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
    /** «Строк дії» (FIN-12 FR 4): YYYY-MM, or null. */
    readonly cardExpiry: string | null;
  } | null;
  readonly loan: {
    readonly annualRate: string | null;
    readonly monthlyPayment: Money | null;
    readonly debt: Money;
    /** «Додайте ставку і платіж» (FIN-12 FR 5, AC12): the rate or the monthly payment is not entered yet. */
    readonly termsMissing: boolean;
  } | null;
}

/** The account with its balances today; null when the caller's space has no such account (another space's too). */
export async function accountView(
  deps: {
    readonly ledger: Pick<AccountsDeps["ledger"], "balanceAt" | "liveEntries">;
    readonly liabilities: Pick<AccountsDeps["liabilities"], "forAccount">;
    readonly today: AccountsDeps["today"];
  },
  tx: Pick<AccountsTx, "account" | "subaccounts" | "owners">,
  householdId: string,
  accountId: string,
): Promise<AccountView | null> {
  const account = await tx.account(householdId, accountId);
  if (!account) return null;
  const today = deps.today();
  const subaccounts = await tx.subaccounts(householdId, accountId);
  const currencies = [];
  const adjustments = [];
  for (const s of subaccounts) {
    const ledgerBalance = await deps.ledger.balanceAt(householdId, s.ledgerAccountId, today);
    currencies.push({
      currency: s.currency,
      balance: shownBalance(account.kind, ledgerBalance),
      balanceDate: s.balanceDate,
    });
    const adjustment = await liveAdjustment(deps, householdId, s);
    if (adjustment)
      adjustments.push({ ...adjustment, currency: s.currency, permanent: account.source === "manual" });
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
    closedOn: account.closedOn,
    source: account.source,
    openedOn: account.openedOn,
    owners: await tx.owners(householdId, accountId),
    currencies,
    adjustments,
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
            cardExpiry: account.cardExpiry,
          }
        : null,
    loan:
      account.kind === "loan"
        ? {
            annualRate: liability?.annualRate ?? null,
            monthlyPayment: liability?.monthlyPayment ?? null,
            debt,
            termsMissing: liability === null || termsMissing(liability),
          }
        : null,
  };
}

/**
 * The new account as it was written, for the create's answer when its hand-off has not finished (ARC-04): without the
 * ledger or liabilities, so it cannot fail — the balances are those of a ledger that has nothing yet (0), and the
 * terms come once the hand-off has registered them. The worker finishes the hand-off; a read then shows them.
 */
export async function createdAccountView(
  deps: Pick<AccountsDeps, "today">,
  householdId: string,
  created: CreatedAccount,
): Promise<AccountView> {
  const currencyOf = new Map(created.subaccounts.map((s) => [s.ledgerAccountId, s.currency]));
  const view = await accountView(
    {
      today: deps.today,
      ledger: {
        balanceAt: async (_householdId, ledgerAccountId) => Money.zero(currencyOf.get(ledgerAccountId)!),
        liveEntries: async () => [],
      },
      liabilities: { forAccount: async () => null },
    },
    {
      account: async () => created.account,
      subaccounts: async () => [...created.subaccounts],
      owners: async () => [created.owner],
    },
    householdId,
    created.account.id,
  );
  return view!;
}

/**
 * The account's entry in the space's log (FIN-01 FR 17, П-10): every field with its new value. The full number is
 * never in it (only whether one is sealed), the last 4 characters as «••1234» (FIN-01 AC7); the sealed flag and the
 * note are sensitive and masked here already, so the hand-off's payload carries neither.
 */
export function accountCreatedValues(
  account: StoredAccount,
  currencies: readonly { readonly currency: string; readonly balance: Money; readonly date: string }[],
  owner: StoredOwner,
  masked: (last4: string) => string,
): AuditValue[] {
  const value = (field: string, after: string | null, sensitive = false): AuditValue => ({
    field,
    after: sensitive && after !== null ? AUDIT_MASK : after,
    sensitive,
  });
  return [
    value("kind", account.kind),
    value("name", account.name),
    value("institutionName", account.institutionName),
    value("institutionCountry", account.institutionCountry),
    value("number", account.numberSealed === null ? null : "sealed", true),
    value("numberLast4", account.numberLast4 === null ? null : masked(account.numberLast4)),
    value("note", account.note, true),
    value("annualRate", account.annualRate),
    value("depositOpenedOn", account.depositOpenedOn),
    value("depositMaturesOn", account.depositMaturesOn),
    value("openedOn", account.openedOn),
    value("status", account.status),
    value("source", account.source),
    ...currencies.flatMap((c, i) => [
      value(`currencies.${i}.currency`, c.currency),
      value(`currencies.${i}.openingBalance`, c.balance.toDecimalString()),
      value(`currencies.${i}.balanceDate`, c.date),
    ]),
    value("owners.0.ownerAccountId", owner.ownerAccountId),
    value("owners.0.share", owner.share),
    value("owners.0.validFrom", owner.validFrom),
  ];
}
