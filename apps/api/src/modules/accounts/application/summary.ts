import { Money } from "@willowsum/domain-kernel";
import type { ReportedAmount, ReportedTotal } from "../../fx-rates/index.ts";
import { availableCredit } from "../../liabilities/index.ts";
import {
  groupOf,
  inMoneyTogether,
  maskedNumber,
  netByCurrency,
  shownBalance,
  wholePercents,
  type AccountGroup,
  type AccountKind,
} from "../domain/index.ts";
import type { AccountsDeps, StoredAccount, StoredSubaccount } from "./accounts.ts";

/**
 * «Гроші разом» and the list of «Рахунки» (FIN-01@PoC FR 13, FR 14, FR 18, FR 19, FR 21, FR 22; wave 2 row 12). Every
 * balance is the ledger's (the sum of postings up to today, business rule), read only for the ledger accounts that the
 * space's subaccounts point to (lead decision, #210): a ledger account no account names — a service account or an
 * orphan of a failed create — is never summed or shown. Amounts stay in their currency; the profile currency's value
 * is fx-rates' (`FxReporting.total`: the NBU rate of today or the latest earlier one, «приблизно» when it is older than
 * 3 calendar days — VAL-04, not repeated here). Closed accounts are left out of every total and listed only on request.
 */

/** A sum in the profile currency as fx-rates reports it (unrounded; null only when no amount has a rate — never 0). */
export interface ReportedSum {
  readonly total: Money | null;
  /** «приблизно»: a rate older than 3 calendar days, or an amount without any rate left out. */
  readonly approximate: boolean;
  /** Amounts left out of the total for want of any rate («Курс недоступний»). */
  readonly unavailableCount: number;
}

/** An amount in its own currency with its value in the profile currency and the rate's date. */
export interface ConvertedAmount {
  readonly currency: string;
  readonly amount: Money;
  /** Null without any rate; the amount itself for the profile currency. */
  readonly equivalent: Money | null;
  /** The date of the NBU rate used; null when nothing was converted. */
  readonly rateDate: string | null;
  readonly approximate: boolean;
  /** A currency with restricted convertibility (VAL-04): «Офіційний курс, ринковий може відрізнятися». */
  readonly restricted: boolean;
}

/** One currency of the «Гроші разом» bar and legend (FR 18). */
export interface CurrencyShare extends ConvertedAmount {
  /** Whole percent of the bar; null without a segment (no rate, or not positive). */
  readonly percent: number | null;
}

export interface AccountsSummary {
  /** The profile currency (the space's reporting currency). */
  readonly currency: string;
  readonly moneyTogether: ReportedSum & {
    /** Amounts at a rate older than 3 calendar days (VAL-04 edge case 2). */
    readonly staleRateCount: number;
    /** «курс НБУ на <дата>»: the source and the earliest rate date used; null when nothing was converted. */
    readonly rate: { readonly source: string; readonly date: string } | null;
    /** Largest equivalent first; currencies without a rate last. */
    readonly breakdown: readonly CurrencyShare[];
  };
  /** The «Кредитні» header (FR 19): what is owed on cards, and «Кредити: −<сума>»; both positive debts. */
  readonly credit: { readonly cardDebt: ReportedSum; readonly loanDebt: ReportedSum };
  /** «Джерела даних» (FR 21): active accounts per source. */
  readonly sources: { readonly import: number; readonly manual: number };
}

/** A row of «Рахунки» (FR 13, FR 14, FR 16, FR 19). */
export interface AccountListItem {
  readonly id: string;
  readonly kind: AccountKind;
  readonly group: AccountGroup;
  readonly name: string;
  readonly institution: { readonly name: string; readonly country: string } | null;
  readonly number: { readonly last4: string; readonly masked: string } | null;
  readonly status: "active" | "closed";
  readonly closedOn: string | null;
  readonly source: "manual" | "import";
  /** The latest balance date the account has (lead decision 2026-11-14). */
  readonly updatedOn: string;
  /** The account's balance in the profile currency (a debt negative). */
  readonly inProfileCurrency: ReportedSum;
  /** Per subaccount: its balance in its own currency, then in the profile currency. */
  readonly currencies: readonly ConvertedAmount[];
  readonly creditCard: {
    readonly creditLimit: Money | null;
    readonly debt: Money;
    readonly available: Money | null;
  } | null;
  readonly loan: {
    readonly annualRate: string | null;
    readonly monthlyPayment: Money | null;
    readonly debt: Money;
  } | null;
}

/** Where a page of the list starts: after this account in the order the accounts were added (created, id). */
export interface ListPosition {
  readonly id: string;
}

/** What the summary and the list read from the accounts schema, bound to the caller's space. */
export interface AccountsListTx {
  /** Accounts in the order (created, id); active only unless `includeClosed`. */
  listAccounts(
    householdId: string,
    filter: {
      readonly includeClosed: boolean;
      readonly kinds: readonly AccountKind[] | null;
      readonly after: ListPosition | null;
      readonly limit: number | null;
    },
  ): Promise<StoredAccount[]>;
  /** The subaccounts of these accounts, by account and position. */
  subaccountsOf(householdId: string, accountIds: readonly string[]): Promise<StoredSubaccount[]>;
}

type SummaryDeps = Pick<AccountsDeps, "ledger" | "liabilities" | "fx" | "today" | "reportingCurrency">;

interface Balanced {
  readonly account: StoredAccount;
  readonly subaccounts: readonly { readonly sub: StoredSubaccount; readonly balance: Money }[];
}

/** Today's ledger balance of each subaccount, shown from the holder's side (a debt negative). */
async function withBalances(
  deps: SummaryDeps,
  tx: Pick<AccountsListTx, "subaccountsOf">,
  householdId: string,
  accounts: readonly StoredAccount[],
): Promise<Balanced[]> {
  const today = deps.today();
  const subs =
    accounts.length === 0
      ? []
      : await tx.subaccountsOf(
          householdId,
          accounts.map((a) => a.id),
        );
  const byAccount = new Map<string, StoredSubaccount[]>();
  for (const s of subs) byAccount.set(s.accountId, [...(byAccount.get(s.accountId) ?? []), s]);
  const result: Balanced[] = [];
  for (const account of accounts) {
    const own = byAccount.get(account.id) ?? [];
    // Every account has its main currency (position 0); none would be a broken invariant, not an empty account.
    if (own.length === 0) throw new Error("account without a currency");
    const subaccounts = [];
    for (const sub of own)
      subaccounts.push({
        sub,
        balance: shownBalance(
          account.kind,
          await deps.ledger.balanceAt(householdId, sub.ledgerAccountId, today),
        ),
      });
    result.push({ account, subaccounts });
  }
  return result;
}

function converted(item: ReportedAmount): ConvertedAmount {
  const currency = item.original.currency;
  switch (item.kind) {
    case "reporting-currency":
      return {
        currency,
        amount: item.original,
        equivalent: item.value,
        rateDate: null,
        approximate: false,
        restricted: false,
      };
    case "converted":
      return {
        currency,
        amount: item.original,
        equivalent: item.value,
        rateDate: item.conversion.rateDate,
        approximate: item.conversion.approximate,
        restricted: item.restricted,
      };
    case "rate-unavailable":
      return {
        currency,
        amount: item.original,
        equivalent: null,
        rateDate: null,
        approximate: false,
        restricted: false,
      };
  }
}

const reportedSum = (t: ReportedTotal): ReportedSum => ({
  total: t.total,
  approximate: t.approximate,
  unavailableCount: t.unavailableCount,
});

/** Balances «today» (no date: the latest rate) in the profile currency, one rate query. */
function today(deps: SummaryDeps, amounts: readonly Money[]): Promise<ReportedTotal> {
  return deps.fx.total(
    amounts.map((amount) => ({ amount, date: null })),
    deps.reportingCurrency,
  );
}

/** «Гроші разом», the «Кредитні» header and «Джерела даних» of the caller's space (active accounts only). */
export async function accountsSummary(
  deps: SummaryDeps,
  tx: AccountsListTx,
  householdId: string,
): Promise<AccountsSummary> {
  const accounts = await tx.listAccounts(householdId, {
    includeClosed: false,
    kinds: null,
    after: null,
    limit: null,
  });
  const balanced = await withBalances(deps, tx, householdId, accounts);
  const balancesWhere = (keep: (kind: AccountKind) => boolean) =>
    balanced.filter((b) => keep(b.account.kind)).flatMap((b) => b.subaccounts.map((s) => s.balance));

  const nets = netByCurrency(balancesWhere(inMoneyTogether));
  const debts = (kind: AccountKind) =>
    netByCurrency(balancesWhere((k) => k === kind).map((m) => m.negated()));
  const [together, cards, loans] = await Promise.all([
    today(deps, nets),
    today(deps, debts("credit-card")),
    today(deps, debts("loan")),
  ]);

  const items = together.items.map(converted);
  const ordered = [...items].sort((a, b) => {
    if (a.equivalent === null || b.equivalent === null)
      return a.equivalent === b.equivalent
        ? a.currency.localeCompare(b.currency)
        : a.equivalent === null
          ? 1
          : -1;
    return b.equivalent.compare(a.equivalent) || a.currency.localeCompare(b.currency);
  });
  const percents = wholePercents(ordered.map((i) => i.equivalent?.amount ?? null));
  const rated = items.filter((i) => i.rateDate !== null);
  const earliest = rated.reduce<ConvertedAmount | null>(
    (min, i) => (min === null || i.rateDate! < min.rateDate! ? i : min),
    null,
  );
  const source = earliest
    ? together.items.find((i) => i.kind === "converted" && i.original.currency === earliest.currency)
    : undefined;

  return {
    currency: deps.reportingCurrency,
    moneyTogether: {
      ...reportedSum(together),
      staleRateCount: together.staleRateCount,
      rate:
        earliest && source?.kind === "converted"
          ? { source: source.conversion.source, date: earliest.rateDate! }
          : null,
      breakdown: ordered.map((i, n) => ({ ...i, percent: percents[n] ?? null })),
    },
    credit: { cardDebt: reportedSum(cards), loanDebt: reportedSum(loans) },
    sources: {
      import: accounts.filter((a) => a.source === "import").length,
      manual: accounts.filter((a) => a.source === "manual").length,
    },
  };
}

/** A page of «Рахунки»: one group or both, closed accounts only with «Показати закриті» (FR 22). */
export async function accountsPage(
  deps: SummaryDeps,
  tx: AccountsListTx,
  householdId: string,
  query: {
    readonly group: AccountGroup | null;
    readonly includeClosed: boolean;
    readonly after: ListPosition | null;
    readonly limit: number;
  },
): Promise<{ readonly items: AccountListItem[]; readonly next: ListPosition | null }> {
  const kinds =
    query.group === null
      ? null
      : query.group === "credit"
        ? (["credit-card", "loan"] as const)
        : (["current", "savings", "deposit", "cash"] as const);
  const rows = await tx.listAccounts(householdId, {
    includeClosed: query.includeClosed,
    kinds,
    after: query.after,
    // One more row tells whether a next page exists.
    limit: query.limit + 1,
  });
  const page = rows.slice(0, query.limit);
  const balanced = await withBalances(deps, tx, householdId, page);
  const reported = await today(
    deps,
    balanced.flatMap((b) => b.subaccounts.map((s) => s.balance)),
  );
  let at = 0;
  const items: AccountListItem[] = [];
  for (const { account, subaccounts } of balanced) {
    const currencies = reported.items.slice(at, at + subaccounts.length).map(converted);
    at += subaccounts.length;
    const unavailableCount = currencies.filter((c) => c.equivalent === null).length;
    const total =
      unavailableCount === currencies.length
        ? null
        : currencies.reduce(
            (sum, c) => (c.equivalent ? sum.plus(c.equivalent) : sum),
            Money.zero(deps.reportingCurrency),
          );
    const main = subaccounts[0]!.balance;
    const debt = main.negated();
    const liability =
      groupOf(account.kind) === "credit" ? await deps.liabilities.forAccount(householdId, account.id) : null;
    items.push({
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
      status: account.status,
      closedOn: account.closedOn,
      source: account.source,
      updatedOn: subaccounts.reduce(
        (d, s) => (s.sub.balanceDate > d ? s.sub.balanceDate : d),
        subaccounts[0]!.sub.balanceDate,
      ),
      inProfileCurrency: {
        total,
        approximate: unavailableCount > 0 || currencies.some((c) => c.approximate),
        unavailableCount,
      },
      currencies,
      creditCard:
        account.kind === "credit-card"
          ? {
              creditLimit: liability?.creditLimit ?? null,
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
    });
  }
  const last = page.at(-1);
  return {
    items,
    next: rows.length > query.limit && last ? { id: last.id } : null,
  };
}
