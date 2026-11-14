import { ACCOUNT_NAME_MAX, groupOf, oneLine, type AccountKind } from "./accounts.ts";

/**
 * «Рахунок → Налаштування» → «Основне» (FIN-12@PoC FR 4–6): the name and the kind of an account, as pure rules. The
 * kind changes only within its group («Готівкові», «Кредитні»): the ledger type of the account (asset or liability) and
 * so every posting stays as it is (FR 6).
 */

/** What a kind change needs, or why it is refused. */
export type KindChange =
  /** The same kind: nothing changes. */
  | { readonly kind: "same" }
  /** «Тип можна змінити лише в межах групи» (FR 5, AC2). */
  | { readonly kind: "other-group" }
  /** A multi-currency account is a current account (FIN-01 FR 12): it keeps that kind (a lead decision). */
  | { readonly kind: "multi-currency" }
  /** «Кредит» ↔ «Кредитна картка»: only without transactions (FR 5, AC11, AC12); the liability changes kind too. */
  | { readonly kind: "credit"; readonly to: "loan" | "credit-card" }
  /** Within «Готівкові». */
  | { readonly kind: "cash" };

export function kindChange(from: AccountKind, to: AccountKind, currencies: number): KindChange {
  if (from === to) return { kind: "same" };
  if (groupOf(from) !== groupOf(to)) return { kind: "other-group" };
  if (groupOf(to) === "credit") return { kind: "credit", to: to as "loan" | "credit-card" };
  if (currencies > 1) return { kind: "multi-currency" };
  return { kind: "cash" };
}

/** The fields of the accounts row that belong to a kind (FIN-01 FR 3, FR 8). */
export interface KindFields {
  /** «Ощадний», «Депозит»: percent per year. */
  readonly annualRate: string | null;
  readonly depositOpenedOn: string | null;
  readonly depositMaturesOn: string | null;
}

/**
 * The kind's own fields after a change within «Готівкові»: those the new kind has are kept (the rate of «Ощадний» and
 * «Депозит»), the others dropped (a deposit's dates on any other kind; a rate on «Поточний» or «Готівка»). The audit
 * entry keeps the values dropped (FR 6).
 */
export function fieldsForKind(kind: AccountKind, fields: KindFields): KindFields {
  return {
    annualRate: kind === "savings" || kind === "deposit" ? fields.annualRate : null,
    depositOpenedOn: kind === "deposit" ? fields.depositOpenedOn : null,
    depositMaturesOn: kind === "deposit" ? fields.depositMaturesOn : null,
  };
}

/** «Назва*» (FIN-01 FR 3): one line of 1–80 characters, as in «Новий рахунок»; null when it is not one. */
export function accountName(text: string): string | null {
  return oneLine(text, ACCOUNT_NAME_MAX);
}
