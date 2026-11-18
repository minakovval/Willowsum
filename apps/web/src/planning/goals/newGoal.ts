import type { ApiClient, operations } from "@willowsum/api-contract";
import { Decimal } from "@willowsum/domain-kernel";
import { outcome } from "../../auth/api.ts";
import type { Goal, Money, PartKind } from "./model.ts";

type Json<T> = T extends { responses: { 200: { content: { "application/json": infer B } } } } ? B : never;
type Template = Goal["template"];
export type CreateBody = NonNullable<operations["createGoal"]["requestBody"]>["content"]["application/json"];
export type PatchBody = NonNullable<operations["updateGoal"]["requestBody"]>["content"]["application/json"];
type AccountItem = Json<operations["listAccounts"]>["items"][number];

/** The steps of BUD-05@PoC FR 2 (S-138): «1 Основне · 2 Де лежать гроші». */
export const MAIN = 0;
export const WHERE = 1;

export const TEMPLATES: readonly Template[] = ["travel", "purchase", "emergency", "custom"];
export const PART_KINDS: readonly PartKind[] = ["account", "envelope", "marks"];
export const NAME_MAX = 60;
export const MONTHS_DEFAULT = 3;
export const MONTHS_MAX = 120;

/** What the form holds. Amounts stay decimal strings (`null` — empty), never numbers. */
export interface GoalValues {
  template: Template;
  name: string;
  target: string | null;
  targetProblem: boolean;
  date: string;
  months: string;
  kind: PartKind;
  accountId: string;
  start: string | null;
  startProblem: boolean;
}

/**
 * BUD-05@PoC FR 2: a goal made without opening step 2 is one part «Без рахунку — лише позначки» with the start 0
 * (the server does it when `part` is left out), so the form starts with that part.
 */
export function initialValues(template: Template = "travel"): GoalValues {
  return {
    template,
    name: "",
    target: null,
    targetProblem: false,
    date: "",
    months: String(MONTHS_DEFAULT),
    kind: "marks",
    accountId: "",
    start: null,
    startProblem: false,
  };
}

/** «Змінити ціль»: every field starts with what the goal has; the start of a part on an account is not its own. */
export function valuesOf(goal: Goal): GoalValues {
  return {
    template: goal.template,
    name: goal.name,
    target: goal.target.amount,
    targetProblem: false,
    date: goal.targetDate ?? "",
    months: String(goal.emergencyMonths ?? MONTHS_DEFAULT),
    kind: goal.part.kind,
    accountId: goal.part.accountId ?? "",
    start: goal.part.kind === "account" ? null : goal.part.startAmount.amount,
    startProblem: false,
  };
}

export const monthsOf = (text: string): number | null =>
  /^\d{1,3}$/.test(text.trim()) ? Number(text) : null;
export const monthsValid = (text: string) => {
  const n = monthsOf(text);
  return n !== null && n >= 1 && n <= MONTHS_MAX;
};

export const isPositive = (amount: string | null) => amount !== null && new Decimal(amount).gt(0);

/** The part of the request: the account only for a separate account and an envelope, the start only for the rest. */
function partOf(v: GoalValues): NonNullable<CreateBody["part"]> {
  if (v.kind === "marks") return { kind: "marks", startAmount: v.start ?? "0" };
  if (v.kind === "account") return { kind: "account", accountId: v.accountId };
  return { kind: "envelope", accountId: v.accountId, startAmount: v.start ?? "0" };
}

const samePart = (v: GoalValues, goal: Goal) =>
  v.kind === goal.part.kind &&
  (v.kind === "marks" ? "" : v.accountId) === (goal.part.accountId ?? "") &&
  (v.kind === "account" || new Decimal(v.start ?? "0").eq(goal.part.startAmount.amount));

/** `POST /v1/goals`: the amounts go as the decimal strings the fields hold. */
export function createBody(v: GoalValues, currency: string): CreateBody {
  return {
    template: v.template,
    name: v.name.trim(),
    target: { amount: v.target ?? "0", currency },
    targetDate: v.date === "" ? null : v.date,
    ...(v.template === "emergency" ? { emergencyMonths: monthsOf(v.months) ?? MONTHS_DEFAULT } : {}),
    part: partOf(v),
  };
}

/** `PATCH /v1/goals/{id}`: only what changed, so an untouched part is never sent again (no lock, no recheck). */
export function patchBody(v: GoalValues, goal: Goal): PatchBody {
  const body: PatchBody = {};
  if (v.template !== goal.template) body.template = v.template;
  if (v.name.trim() !== goal.name) body.name = v.name.trim();
  if (v.target !== null && !new Decimal(v.target).eq(goal.target.amount))
    body.target = { amount: v.target, currency: goal.target.currency };
  if ((v.date === "" ? null : v.date) !== goal.targetDate) body.targetDate = v.date === "" ? null : v.date;
  if (v.template === "emergency" && (monthsOf(v.months) ?? MONTHS_DEFAULT) !== (goal.emergencyMonths ?? null))
    body.emergencyMonths = monthsOf(v.months) ?? MONTHS_DEFAULT;
  if (!samePart(v, goal)) body.part = partOf(v);
  return body;
}

/** A cash-group account the goal's part may sit on: open, with a wallet in the goal's currency. */
export interface AccountChoice {
  readonly id: string;
  readonly name: string;
  readonly mask: string | null;
  readonly balance: Money;
}

export function choicesOf(items: readonly AccountItem[], currency: string): AccountChoice[] {
  const out: AccountChoice[] = [];
  for (const a of items) {
    const wallet = a.currencies.find((c) => c.currency === currency);
    if (a.status !== "active" || a.group !== "cash" || !wallet) continue;
    out.push({
      id: a.id,
      name: a.name,
      mask: a.number?.masked ?? null,
      balance: { amount: wallet.amount.amount, currency },
    });
  }
  return out;
}

export interface FormContext {
  readonly currency: string;
  readonly accounts: readonly AccountChoice[];
}

/** The accounts (every page) and, for a new goal, the currency of the space the goal is counted in. */
export async function loadFormContext(
  api: ApiClient,
  currencyOf: string | null,
  fallback: string,
): Promise<FormContext> {
  const items: AccountItem[] = [];
  let cursor: string | undefined;
  const space = currencyOf === null ? outcome(api.GET("/v1/space")) : null;
  for (let page = 0; page < 20; page++) {
    const o = await outcome(api.GET("/v1/accounts", { params: { query: cursor ? { cursor } : {} } }));
    if (!o.ok) break;
    items.push(...o.data.items);
    if (!o.data.nextCursor) break;
    cursor = o.data.nextCursor;
  }
  const s = space ? await space : null;
  const currency = currencyOf ?? (s?.ok ? s.data.reportingCurrency : fallback);
  return { currency, accounts: choicesOf(items, currency) };
}

/**
 * The free part of an account for a new envelope: the API gives `freeBalance` (balance less every envelope) on each
 * envelope goal of the account; an account with none has all its balance free. One currency (the goal's); `null` when
 * another goal sits on the account as a separate account (nothing is free beside it) or the sum cannot be shown.
 */
export function freeOn(account: AccountChoice, goals: readonly Goal[]): Money | null {
  const here = goals.filter((g) => g.part.accountId === account.id);
  if (here.some((g) => g.part.kind === "account")) return null;
  const envelope = here.find((g) => g.part.freeBalance !== null);
  if (!envelope?.part.freeBalance) return account.balance;
  return envelope.part.freeBalance.currency === account.balance.currency ? envelope.part.freeBalance : null;
}

/** «стартова сума … · прогрес 11,1 %»: down to 0,1 as the API shows it (FR 4). */
export function progressOf(amount: string | null, target: string | null): string | null {
  if (amount === null || target === null || !new Decimal(target).gt(0)) return null;
  return new Decimal(amount).div(target).times(100).toDecimalPlaces(1, Decimal.ROUND_DOWN).toFixed();
}

export const minus = (a: Money, b: string): Money => ({
  currency: a.currency,
  amount: new Decimal(a.amount).minus(b).toFixed(),
});
