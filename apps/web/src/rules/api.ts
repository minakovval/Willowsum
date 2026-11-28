import { useCallback, useEffect, useState } from "react";
import type { ApiClient, paths } from "@willowsum/api-contract";
import { formatLocaleOf, formatMoney, type Locale, type MessageKey, type Translate } from "@willowsum/i18n";
import { outcome, useAuthApi, type Outcome } from "../auth/api.ts";
import { loadCategories, type Categories } from "../transactions/review.ts";
import { failed, type Loaded } from "../transactions/list.ts";

/**
 * BUD-14@PoC c) (wave 2, row 120): what S-197 «Правила категорій» and S-198 «Правило категорії» read and write on the
 * merged server parts (module `categorization`, README «Правила категорій»): the rules in priority order, create,
 * change, move, delete, the matches of a draft («Показати»), and the runs «Застосувати до N наявних» with «Відмінити».
 * The screen holds no money logic: an amount is a decimal string the server checks, shown with `formatMoney`.
 */
export type Rule =
  paths["/v1/category-rules"]["get"]["responses"]["200"]["content"]["application/json"]["items"][number];
export type Condition = Rule["conditions"][number];
export type Run =
  paths["/v1/category-rule-runs/{runId}"]["get"]["responses"]["200"]["content"]["application/json"];
export type Matches =
  paths["/v1/category-rules/matches"]["post"]["responses"]["200"]["content"]["application/json"];
export type RuleBody = paths["/v1/category-rules"]["post"]["requestBody"]["content"]["application/json"];

export type ConditionField = Condition["field"];
export type Operator = "equals" | "contains" | "greater" | "less";
/** The operators each field offers (BUD-14 FR 5): text — equals, contains; amount — equals, greater, less; account — equals. */
export const OPERATORS: Readonly<Record<ConditionField, readonly Operator[]>> = {
  merchant: ["equals", "contains"],
  description: ["equals", "contains"],
  amount: ["equals", "greater", "less"],
  account: ["equals"],
};
export const FIELDS: readonly ConditionField[] = ["merchant", "description", "amount", "account"];

/** An account as the rule screens need it: its label («Поточний ··4417»), currencies and whether it is open. */
export interface AccountRef {
  readonly id: string;
  readonly label: string;
  readonly currencies: readonly string[];
  readonly closed: boolean;
}

/** The space's categories and accounts: names for the table and choices for the dialog. */
export interface Refs {
  readonly categories: Categories | null;
  readonly accounts: readonly AccountRef[];
}

const MAX_ACCOUNT_PAGES = 20;

export async function loadAccounts(api: ApiClient): Promise<AccountRef[]> {
  const rows: AccountRef[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_ACCOUNT_PAGES; page++) {
    const o = await outcome(
      api.GET("/v1/accounts", {
        params: { query: { limit: 100, includeClosed: "true", ...(cursor ? { cursor } : {}) } },
      }),
    );
    if (!o.ok) return rows;
    for (const a of o.data.items)
      rows.push({
        id: a.id,
        label: a.number ? `${a.name} ··${a.number.last4}` : a.name,
        currencies: a.currencies.map((c) => c.currency),
        closed: a.status !== "active",
      });
    cursor = o.data.nextCursor ?? undefined;
    if (!cursor) break;
  }
  return rows;
}

/**
 * The rules (kept on screen while they are read again) and the categories and accounts they name. A list of names that
 * fails to load leaves the table readable: the category cell shows «—».
 */
export function useRules(): {
  rules: Loaded<readonly Rule[]>;
  refs: Refs;
  reload: () => void;
} {
  const api = useAuthApi();
  const [attempt, setAttempt] = useState(0);
  const [rules, setRules] = useState<Loaded<readonly Rule[]>>({ kind: "loading" });
  const [refs, setRefs] = useState<Refs>({ categories: null, accounts: [] });
  useEffect(() => {
    let live = true;
    void outcome(api.GET("/v1/category-rules")).then((o) => {
      if (live) setRules(o.ok ? { kind: "ready", data: o.data.items } : failed(o));
    });
    return () => {
      live = false;
    };
  }, [api, attempt]);
  useEffect(() => {
    let live = true;
    void Promise.all([loadCategories(api), loadAccounts(api)]).then(([c, accounts]) => {
      if (live) setRefs({ categories: c.kind === "ready" ? c.data : null, accounts });
    });
    return () => {
      live = false;
    };
  }, [api, attempt]);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { rules, refs, reload };
}

/**
 * The number on «Правила категорій» of the «…» menu of «Транзакції» (BUD-14 FR 4). `off` — the function is switched
 * off for the space: the menu is not shown; `null` — not read yet or the read failed: the item shows no number.
 */
export function useRuleCount(): number | null | "off" {
  const api = useAuthApi();
  const [count, setCount] = useState<number | null | "off">(null);
  useEffect(() => {
    let live = true;
    void outcome(api.GET("/v1/category-rules")).then((o) => {
      if (!live) return;
      if (o.ok) setCount(o.data.items.length);
      else setCount(failed(o).kind === "off" ? "off" : null);
    });
    return () => {
      live = false;
    };
  }, [api]);
  return count;
}

const FORMS = ["one", "few", "many", "other"] as const;

/** A counted phrase in the interface language: `base` + «.one» / «.few» / «.many» / «.other». */
export function counted(
  t: Translate,
  locale: Locale,
  base: string,
  count: number,
  more: Record<string, string> = {},
): string {
  const rule = new Intl.PluralRules(formatLocaleOf(locale)).select(count);
  const form = (FORMS as readonly string[]).includes(rule) ? rule : "other";
  return t(`${base}.${form}` as MessageKey, { count, ...more });
}

/** One condition as the table reads it: «Мерчант = Сільпо», «Опис містить «KYIVSTAR»», «Сума > 40,00 €». */
export function conditionText(
  t: Translate,
  locale: Locale,
  c: Condition,
  accounts: readonly AccountRef[],
  first: boolean,
): string {
  const name = t(`rules.field.${c.field}` as MessageKey);
  const field = first ? name : name.toLocaleLowerCase(formatLocaleOf(locale));
  const value =
    c.field === "amount"
      ? formatMoney(locale, c.value.amount, c.value.currency)
      : c.field === "account"
        ? (accounts.find((a) => a.id === c.value)?.label ?? t("rules.accounts.gone"))
        : c.value;
  return t(`rules.cond.${c.operator}` as MessageKey, { field, value });
}

/** «Якщо Мерчант = WOG · сума > 40,00 €». */
export function ruleText(t: Translate, locale: Locale, rule: Rule, accounts: readonly AccountRef[]): string {
  const parts = rule.conditions.map((c, i) => conditionText(t, locale, c, accounts, i === 0));
  return t("rules.cond.if", { conditions: parts.join(" · ") });
}

/** The category of the tree by id (name, colour, icon), or `undefined` — deleted, or the tree did not load. */
export function categoryOf(refs: Refs, id: string) {
  for (const g of refs.categories?.groups ?? []) {
    const c = g.categories.find((x) => x.id === id);
    if (c) return c;
  }
  return undefined;
}

/** The problem code of a failed answer, if it had one. */
export const codeOf = (o: Outcome<unknown>): string | undefined =>
  !o.ok && o.kind === "problem" ? o.problem.code : undefined;
