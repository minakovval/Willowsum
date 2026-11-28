import { useEffect, useRef, useState } from "react";
import { formatDate, formatMoney, useI18n, type MessageKey } from "@willowsum/i18n";
import {
  AmountField,
  CategoryDisc,
  Dialog,
  Field,
  FormDialog,
  FormMore,
  SearchSelect,
  Select,
  type SearchGroup,
} from "@willowsum/ui";
import { outcome, useAuthApi, type Outcome } from "../auth/api.ts";
import {
  codeOf,
  counted,
  FIELDS,
  OPERATORS,
  type Condition,
  type ConditionField,
  type Matches,
  type Operator,
  type Refs,
  type Rule,
  type RuleBody,
  type Run,
} from "./api.ts";

/** What the page learns when the dialog saved the rule (and, when asked, started the run on existing transactions). */
export interface Saved {
  readonly rule: Rule;
  /** FR 11: the id of an earlier rule with the same conditions, or null. */
  readonly duplicateOf: string | null;
  readonly run: Run | null;
  /** The run could not start: the text to show; the rule itself is saved. */
  readonly runError: MessageKey | null;
}

/** One line of «Умови»: field · operator · value, as the form holds it. */
interface Row {
  readonly key: number;
  readonly field: ConditionField;
  readonly operator: Operator;
  readonly text: string;
  /** The amount as the decimal string the field gave (never a number), `null` — empty. */
  readonly amount: string | null;
  readonly currency: string;
  readonly accountId: string;
}

const TEXT_MAX = 200;
const TAGS_MAX = 20;
const TAG_MAX = 60;
/** How long the count of matching transactions waits after the last change of the conditions. */
const COUNT_DELAY_MS = 300;
const FOLD = (s: string) => s.normalize("NFC").trim().toLocaleLowerCase("uk");

/** The row of a stored condition (an account that no longer exists leaves the value empty: the user picks again). */
function rowOf(c: Condition | null, key: number, refs: Refs, currency: string): Row {
  const base = { key, text: "", amount: null, currency, accountId: "" };
  if (c === null) return { ...base, field: "merchant", operator: "equals" };
  if (c.field === "amount")
    return {
      ...base,
      field: "amount",
      operator: c.operator,
      amount: c.value.amount,
      currency: c.value.currency,
    };
  if (c.field === "account")
    return {
      ...base,
      field: "account",
      operator: "equals",
      accountId: refs.accounts.some((a) => a.id === c.value) ? c.value : "",
    };
  return { ...base, field: c.field, operator: c.operator, text: c.value };
}

/** A line the user has finished; the server checks the rest (amount > 0 and its digits, the account of the space). */
function conditionOf(r: Row): Condition | null {
  switch (r.field) {
    case "merchant":
    case "description": {
      const value = r.text.normalize("NFC").trim();
      return value === "" || value.length > TEXT_MAX || /[\r\n]/.test(value)
        ? null
        : { field: r.field, operator: r.operator as "equals" | "contains", value };
    }
    case "amount":
      return r.amount === null || !/[1-9]/.test(r.amount)
        ? null
        : {
            field: "amount",
            operator: r.operator as "equals" | "greater" | "less",
            value: { amount: r.amount, currency: r.currency },
          };
    case "account":
      return r.accountId === "" ? null : { field: "account", operator: "equals", value: r.accountId };
  }
}

/** «авто, дім» → ["авто", "дім"]: trimmed, a tag once however it is written. */
function tagsOf(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(",")) {
    const tag = raw.normalize("NFC").trim();
    if (tag === "" || seen.has(FOLD(tag))) continue;
    seen.add(FOLD(tag));
    out.push(tag);
  }
  return out;
}

type Count =
  | { readonly kind: "idle" }
  | { readonly kind: "counting" }
  | { readonly kind: "ready"; readonly data: Matches }
  | { readonly kind: "error" };

/**
 * S-198 «Правило категорії» (BUD-14@PoC FR 4, 5, 7, 11; canvas PocMoneyRuleEdit, PocMoneyRuleEditStep2 and the «Тексти»
 * board PocMoneyRulesTexts) over `FormDialog`: «Умови*» (field · operator · value, «+ Додати умову», «Мають
 * виконуватися всі умови»), «Категорія*», the collapsed «Додатково» («Теги», «Лише для рахунків») and the box «Застосувати
 * до N наявних транзакцій, що підходять» with «Показати». The N is the server's count of the draft (`POST
 * /v1/category-rules/matches`, nothing is written); without the box a saved rule acts only on new transactions (AC9).
 * The two steps of the board are one form here: the view asks for one form with «Додатково» (PR body).
 */
export function RuleDialog({
  rule,
  prefill,
  suggestion,
  refs,
  onClose,
  onSaved,
  onSuggestion,
}: {
  /** The rule to change; `null` — a new one. */
  rule: Rule | null;
  /**
   * BUD-21@PoC FR 21: the pencil of a suggestion on «Пропозиції правил» (S-301) opens this dialog with the suggestion's
   * conditions, category and tags. Saving changes only the suggestion (`onSuggestion`): no rule is created, and there is
   * no box «Застосувати до N наявних транзакцій, що підходять».
   */
  suggestion?: {
    readonly conditions: readonly Condition[];
    readonly categoryId: string;
    readonly tags: readonly string[];
  };
  onSuggestion?: (body: RuleBody) => void;
  /** A new rule started from a merchant (BUD-14@PoC FR 13): its conditions come filled in; ignored when `rule` is set. */
  prefill?: readonly Condition[];
  refs: Refs;
  onClose: () => void;
  onSaved?: (saved: Saved) => void;
}) {
  const { t, locale } = useI18n();
  const api = useAuthApi();
  /** Keys of the lines added by «+ Додати умову»; the first lines have the keys 0…9. */
  const next = useRef(10);
  const currencies = [...new Set(refs.accounts.flatMap((a) => a.currencies))].sort();
  const currency = refs.accounts.find((a) => !a.closed)?.currencies[0] ?? currencies[0] ?? "EUR";
  const [rows, setRows] = useState<readonly Row[]>(() => {
    const start = rule?.conditions ?? suggestion?.conditions ?? prefill ?? [];
    return (start.length > 0 ? start : [null]).map((c, i) => rowOf(c, i, refs, currency));
  });
  const knownCategory = (id: string | undefined) =>
    id !== undefined && (refs.categories?.byId.has(id) ?? false) ? id : "";
  const [categoryId, setCategoryId] = useState(knownCategory(rule?.categoryId ?? suggestion?.categoryId));
  const [tagText, setTagText] = useState((rule?.tags ?? suggestion?.tags ?? []).join(", "));
  const [accountIds, setAccountIds] = useState<readonly string[]>(
    () => rule?.accountIds.filter((id) => refs.accounts.some((a) => a.id === id)) ?? [],
  );
  // The box is ticked for one draft: changing the conditions or the accounts un-ticks it (the N is another).
  const [applyFor, setApplyFor] = useState<string | null>(null);
  const [result, setResult] = useState<{ draft: string; value: Count } | null>(null);
  const [listing, setListing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const conditions = rows.map(conditionOf);
  const complete = conditions.every((c): c is Condition => c !== null);
  const tags = tagsOf(tagText);
  const tagsBroken = tags.length > TAGS_MAX || tags.some((x) => [...x].length > TAG_MAX);
  const accounts = accountIds.length > 0 ? accountIds : undefined;

  // N наявних, що підходять: the server counts the draft; a change of the conditions counts again (FR 7).
  const draft = complete && !suggestion ? JSON.stringify([conditions, accountIds]) : "";
  useEffect(() => {
    if (draft === "") return;
    let live = true;
    const timer = window.setTimeout(() => {
      const [list, ids] = JSON.parse(draft) as [Condition[], string[]];
      void outcome(
        api.POST("/v1/category-rules/matches", {
          body: { conditions: list, ...(ids.length > 0 ? { accountIds: ids } : {}) },
        }),
      ).then((o) => {
        if (live) setResult({ draft, value: o.ok ? { kind: "ready", data: o.data } : { kind: "error" } });
      });
    }, COUNT_DELAY_MS);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [api, draft]);
  const count: Count =
    draft === "" ? { kind: "idle" } : result?.draft === draft ? result.value : { kind: "counting" };
  const apply = applyFor === draft && count.kind === "ready" && count.data.count > 0;

  const patchRow = (key: number, change: Partial<Row>) =>
    setRows((all) => all.map((r) => (r.key === key ? { ...r, ...change } : r)));
  const setField = (key: number, field: ConditionField) =>
    patchRow(key, {
      field,
      operator: OPERATORS[field][0]!,
      text: "",
      amount: null,
      accountId: "",
    });

  // A service category («Переказ») is offered only as the suggestion's own category (BUD-21 FR 16, FR 21).
  const own = suggestion?.categoryId;
  const groups: SearchGroup[] = (refs.categories?.groups ?? [])
    .filter((g) => g.kind !== "service" || g.categories.some((c) => c.id === own))
    .map((g) => ({
      id: g.id,
      title: g.name,
      options: g.categories
        .filter((c) => (g.kind !== "service" || c.id === own) && (!c.hidden || c.id === categoryId))
        .map((c) => ({
          value: c.id,
          label: c.name,
          leading: <CategoryDisc color={c.color} icon={c.icon} iconTone={c.iconTone} />,
        })),
    }))
    .filter((g) => g.options.length > 0);

  const submit = async () => {
    if (busy || !complete || categoryId === "") return;
    setBusy(true);
    setError(null);
    const list = conditions as Condition[];
    const body: RuleBody = {
      conditions: list,
      categoryId,
      tags,
      ...(accounts ? { accountIds: [...accountIds] } : {}),
    };
    if (suggestion) {
      setBusy(false);
      onSuggestion?.(body);
      return;
    }
    const o: Outcome<Rule & { duplicateOf: string | null }> = rule
      ? await outcome(
          api.PATCH("/v1/category-rules/{ruleId}", {
            params: { path: { ruleId: rule.id } },
            body: { ...body, accountIds: [...accountIds] },
          }),
        )
      : await outcome(api.POST("/v1/category-rules", { body }));
    if (!o.ok) {
      setBusy(false);
      setError(
        codeOf(o) === "LIMIT_REACHED"
          ? t("rules.error.limit", { limit: 500 })
          : `${t("rules.error.save")}${o.kind === "problem" && o.supportId ? ` ${t("rules.code", { code: o.supportId })}` : ""}`,
      );
      return;
    }
    let run: Run | null = null;
    let runError: MessageKey | null = null;
    if (apply) {
      const r = await outcome(
        api.POST("/v1/category-rules/{ruleId}/apply", { params: { path: { ruleId: o.data.id } }, body: {} }),
      );
      if (r.ok) run = r.data;
      else
        runError =
          codeOf(r) === "RULE_RUN_RUNNING"
            ? "rules.run.running"
            : codeOf(r) === "RULE_NEEDS_ATTENTION"
              ? "rules.run.needsAttention"
              : "rules.run.error";
    }
    setBusy(false);
    onSaved?.({ rule: o.data, duplicateOf: o.data.duplicateOf, run, runError });
  };

  const operatorLabel = (op: Operator) => t(`rules.op.${op}` as MessageKey);
  const emptyRow = rows.some((r) => conditionOf(r) === null);
  const matches = count.kind === "ready" ? count.data : null;

  return (
    <>
      <FormDialog
        open={!listing}
        onClose={onClose}
        title={suggestion ? t("suggestions.edit.title") : t("rules.dialog.title")}
        text={suggestion ? t("suggestions.edit.text") : undefined}
        closeLabel={t("shell.close")}
        busy={busy}
        error={error}
        editing={rule !== null || suggestion !== undefined}
        fields={[
          { id: "conditions", label: t("rules.conditions"), required: true, empty: emptyRow },
          { id: "category", label: t("rules.category"), required: true, empty: categoryId === "" },
          {
            id: "tags",
            label: t("rules.tags"),
            empty: tags.length === 0,
            error: tagsBroken ? t("rules.tags.error") : null,
          },
        ]}
        submitLabel={suggestion ? t("suggestions.edit.save") : t("rules.save")}
        busyLabel={t("rules.saving")}
        onSubmit={() => void submit()}
      >
        {(form) => (
          <div className="rules-form">
            <fieldset className="rules-conditions">
              <legend>
                {t("rules.conditions")}
                <span aria-hidden="true"> *</span>
              </legend>
              {rows.map((r) => (
                <div className="rules-cond" key={r.key}>
                  <Select
                    label={t("rules.field.label")}
                    value={r.field}
                    onChange={(v) => setField(r.key, v as ConditionField)}
                    options={FIELDS.map((f) => ({ value: f, label: t(`rules.field.${f}` as MessageKey) }))}
                  />
                  <Select
                    label={t("rules.operator.label")}
                    value={r.operator}
                    onChange={(v) => patchRow(r.key, { operator: v as Operator })}
                    options={OPERATORS[r.field].map((op) => ({ value: op, label: operatorLabel(op) }))}
                  />
                  {r.field === "amount" ? (
                    <div className="rules-cond-amount">
                      <AmountField
                        label={t("rules.value.label")}
                        value={r.amount}
                        currency={r.currency}
                        onChange={(amount) => patchRow(r.key, { amount })}
                        suffix={null}
                      />
                      <Select
                        label={t("rules.currency.label")}
                        value={r.currency}
                        onChange={(v) => patchRow(r.key, { currency: v })}
                        options={[...new Set([...currencies, r.currency])]
                          .sort()
                          .map((c) => ({ value: c, label: c }))}
                      />
                    </div>
                  ) : r.field === "account" ? (
                    <Select
                      label={t("rules.value.label")}
                      value={r.accountId}
                      placeholder={t("rules.account.choose")}
                      onChange={(v) => patchRow(r.key, { accountId: v })}
                      options={refs.accounts
                        .filter((a) => !a.closed || a.id === r.accountId)
                        .map((a) => ({ value: a.id, label: a.label }))}
                    />
                  ) : (
                    <Field
                      label={t("rules.value.label")}
                      value={r.text}
                      maxLength={TEXT_MAX}
                      onChange={(text) => patchRow(r.key, { text })}
                    />
                  )}
                  <button
                    type="button"
                    className="rules-cond-remove"
                    aria-label={t("rules.removeCondition")}
                    title={t("rules.removeCondition")}
                    disabled={rows.length === 1}
                    onClick={() => setRows((all) => all.filter((x) => x.key !== r.key))}
                  >
                    <span aria-hidden="true">×</span>
                  </button>
                </div>
              ))}
              <div className="rules-cond-foot">
                <button
                  type="button"
                  className="rules-link"
                  disabled={rows.length >= 10}
                  onClick={() => setRows((all) => [...all, rowOf(null, next.current++, refs, currency)])}
                >
                  {t("rules.addCondition")}
                </button>
                <span className="ws-muted">{t("rules.allMust")}</span>
              </div>
            </fieldset>

            <SearchSelect
              label={t("rules.category")}
              required
              value={categoryId}
              onChange={setCategoryId}
              groups={groups}
              searchLabel={t("rules.category.search")}
            />

            <FormMore label={t("rules.more")} fields={["tags"]}>
              <Field
                label={t("rules.tags")}
                value={tagText}
                hint={t("rules.tags.hint")}
                error={form.errorOf("tags")}
                onChange={setTagText}
                onBlur={form.leave("tags")}
              />
              {refs.accounts.length > 0 ? (
                <fieldset className="rules-accounts">
                  <legend>{t("rules.accounts")}</legend>
                  <p className="ws-muted">{t("rules.accounts.hint")}</p>
                  {refs.accounts
                    .filter((a) => !a.closed || accountIds.includes(a.id))
                    .map((a) => (
                      <label key={a.id} className="rules-account">
                        <input
                          type="checkbox"
                          checked={accountIds.includes(a.id)}
                          onChange={(e) =>
                            setAccountIds((all) =>
                              e.target.checked ? [...all, a.id] : all.filter((id) => id !== a.id),
                            )
                          }
                        />
                        <span>{a.label}</span>
                      </label>
                    ))}
                </fieldset>
              ) : null}
            </FormMore>

            <div className="rules-apply" aria-live="polite">
              {count.kind === "counting" ? (
                <p className="ws-muted">{t("rules.apply.counting")}</p>
              ) : count.kind === "error" ? (
                <p className="ws-muted">{t("rules.apply.failed")}</p>
              ) : matches ? (
                matches.count === 0 ? (
                  <p className="ws-muted">{t("rules.apply.none")}</p>
                ) : (
                  <div className="rules-apply-row">
                    <label>
                      <input
                        type="checkbox"
                        checked={apply}
                        onChange={(e) => setApplyFor(e.target.checked ? draft : null)}
                      />
                      <span>{counted(t, locale, "rules.apply", matches.count)}</span>
                    </label>
                    <button type="button" className="rules-link" onClick={() => setListing(true)}>
                      {t("rules.show")}
                    </button>
                  </div>
                )
              ) : null}
            </div>
          </div>
        )}
      </FormDialog>
      <Dialog
        open={listing}
        onClose={() => setListing(false)}
        title={t("rules.matches.title")}
        closeLabel={t("shell.close")}
        size="wide"
        align="start"
        actions={[{ label: t("rules.matches.close"), variant: "primary", onClick: () => setListing(false) }]}
      >
        {matches ? <MatchList matches={matches} /> : null}
      </Dialog>
    </>
  );
}

/** «Показати»: the transactions of the draft with the sum per currency; nothing is changed (FR 7, AC2, AC12). */
function MatchList({ matches }: { matches: Matches }) {
  const { t, locale } = useI18n();
  const total = matches.totals.map((m) => formatMoney(locale, m.amount, m.currency)).join(", ");
  return (
    <div className="rules-matches">
      <p>{counted(t, locale, "rules.matches.summary", matches.count, { total })}</p>
      <p className="ws-muted">
        {t("rules.matches.note")}
        {matches.truncated || matches.items.length < matches.count
          ? ` ${t("rules.matches.truncated", { count: matches.items.length })}`
          : ""}
      </p>
      <table className="rules-matches-table">
        <thead>
          <tr>
            <th scope="col">{t("rules.matches.date")}</th>
            <th scope="col">{t("rules.matches.counterparty")}</th>
            <th scope="col">{t("rules.matches.amount")}</th>
          </tr>
        </thead>
        <tbody>
          {matches.items.map((m) => (
            <tr key={m.transactionId}>
              <td>{formatDate(locale, m.date)}</td>
              <td>{m.counterparty ?? "—"}</td>
              <td>{formatMoney(locale, m.amount.amount, m.amount.currency, { signed: true })}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
