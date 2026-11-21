import { useEffect, useRef, useState } from "react";
import { formatMoney, useI18n } from "@willowsum/i18n";
import { Decimal } from "@willowsum/domain-kernel";
import { AmountField, Button, Icon, Popover } from "@willowsum/ui";
import { outcome, useAuthApi } from "../../auth/api.ts";
import type { Category } from "../../categories/api.ts";
import type { BudgetView, Money, Row } from "./model.ts";

/**
 * BUD-02@PoC FR 7, AC 12: the limit of a category is set, changed and added on the page «Бюджет» in place — the pencil
 * «Змінити ліміт» of a row (and «Задати ліміт» of a row of «Поза планом», board PocPlanBudget) opens the limit popover
 * from the row, with no modal dialog; «Додати категорію» in the heading of a group adds an editable row at the bottom of
 * the group (board PocPlanBudgetAddCat): the category's list («Поза планом · є витрати», then the categories without a
 * limit, then «Нова категорія…»), the limit field with the 3-month average as its placeholder, the switch
 * «обов’язкова» and «✓» / «✕». A change goes through `PATCH /v1/budget/plan` with the version the user saw and is
 * effective from the current period (the server's rule); «обов’язкова» is the category's attribute (BUD-01), saved on it.
 */

/** `PATCH /v1/budget/plan` with one limit; a conflict of versions is answered by reading the page again. */
async function saveLimit(
  api: ReturnType<typeof useAuthApi>,
  version: number,
  categoryId: string,
  amount: Money,
): Promise<"ok" | "conflict" | "failed"> {
  const o = await outcome(
    api.PATCH("/v1/budget/plan", { body: { version, limits: [{ categoryId, amount }] } }),
  );
  if (o.ok) return "ok";
  return o.kind === "problem" && o.problem.code === "VERSION_CONFLICT" ? "conflict" : "failed";
}

/** The pencil «Змінити ліміт» of a limited row, or «Задати ліміт» of a row of «Поза планом», and its popover. */
export function LimitButton({
  row,
  version,
  currency,
  onSaved,
}: {
  row: Row;
  version: number;
  currency: string;
  /** Saved, or the budget changed elsewhere: read the page again. */
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const api = useAuthApi();
  const host = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<string | null>(row.limit?.amount ?? null);
  const [problem, setProblem] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const set = row.limit === null;
  const label = t(set ? "planning.budget.limit.setOf" : "planning.budget.limit.editOf", { name: row.name });
  const close = () => {
    setOpen(false);
    setValue(row.limit?.amount ?? null);
    setProblem(false);
    setFailed(false);
  };
  const save = async () => {
    if (busy || value === null || problem) return;
    setBusy(true);
    setFailed(false);
    const r = await saveLimit(api, version, row.id, { amount: value, currency });
    setBusy(false);
    if (r === "failed") setFailed(true);
    else {
      setOpen(false);
      onSaved();
    }
  };
  return (
    <span className="ws-popover-host bud-limit-host" ref={host}>
      {set ? (
        <button
          type="button"
          className="ws-card-filter-reset"
          aria-label={label}
          onClick={() => setOpen(true)}
        >
          {t("planning.budget.limit.set")}
        </button>
      ) : (
        <button
          type="button"
          className="ws-icon-button bud-limit-edit"
          aria-label={label}
          title={t("planning.budget.limit.edit")}
          onClick={() => setOpen(true)}
        >
          <Icon name="edit" size={16} inButton />
        </button>
      )}
      <Popover open={open} onClose={close} label={label} anchor={host}>
        <form
          className="bud-limit-form"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <AmountField
            label={t("planning.budget.limit.field")}
            currency={currency}
            value={value}
            onChange={(v, p) => {
              setValue(v);
              setProblem(p !== null);
            }}
          />
          {failed ? <p role="alert">{t("planning.budget.cat.error")}</p> : null}
          <div className="bud-mandatory-actions">
            <Button label={t("categories.form.cancel")} onClick={close} />
            <Button label={t("categories.form.save")} variant="primary" type="submit" loading={busy} />
          </div>
        </form>
      </Popover>
    </span>
  );
}

/** What the add row offers: the categories of «Поза планом» with spending, then those without a limit. */
export interface AddChoices {
  readonly outside: readonly { readonly category: Category; readonly spent: Money }[];
  readonly noLimit: readonly Category[];
}

/**
 * The choices of the add row (FR 7): «Поза планом · є витрати» — the rows of «Поза планом» with spending this month, in
 * their order; then every other expense category of the tree without a limit, not hidden, in the tree's order.
 * `created` — a category «Нова категорія…» just made, not in the tree read before it.
 */
export function addChoices(view: BudgetView, created: readonly Category[]): AddChoices {
  const limited = new Set(view.sections.flatMap((s) => s.rows.map((r) => r.id)));
  const all = [...view.tree.groups.flatMap((g) => g.categories), ...created];
  const byId = new Map(all.map((c) => [c.id, c]));
  const outside: { category: Category; spent: Money }[] = [];
  for (const r of view.outside) {
    const c = byId.get(r.id);
    if (c && c.kind === "expense" && !c.hidden && r.spent && new Decimal(r.spent.amount).gt(0))
      outside.push({ category: c, spent: r.spent });
  }
  const taken = new Set([...limited, ...outside.map((o) => o.category.id)]);
  const noLimit = all.filter((c) => c.kind === "expense" && !c.hidden && !taken.has(c.id));
  return { outside, noLimit };
}

const NEW = "__new";

/**
 * The editable row «Додати категорію» at the bottom of a group (FR 7, board PocPlanBudgetAddCat). «Нова категорія…»
 * opens the dialog of a new category in this group (FR 23); the new one is chosen in the list at once.
 */
export function AddRow({
  view,
  groupId,
  columns,
  created,
  onNew,
  onCancel,
  onSaved,
}: {
  view: BudgetView;
  groupId: string;
  /** The columns after «Категорія» (the limit field goes under «Ліміт»); then the menu column takes ✓ and ✕. */
  columns: readonly string[];
  /** Categories «Нова категорія…» made while the row is open (the newest last: it is the one chosen). */
  created: readonly Category[];
  onNew: (groupId: string) => void;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const { t, locale } = useI18n();
  const api = useAuthApi();
  const currency = view.period.totals.limits.currency;
  const choices = addChoices(view, created);
  const [picked, setPicked] = useState<string>("");
  const newest = created[created.length - 1]?.id ?? null;
  const [seen, setSeen] = useState<string | null>(null);
  if (newest !== seen) {
    setSeen(newest);
    if (newest !== null) setPicked(newest);
  }
  const [value, setValue] = useState<string | null>(null);
  const [problem, setProblem] = useState(false);
  const [mandatory, setMandatory] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const averages = useAverages();
  const all = [...choices.outside.map((o) => o.category), ...choices.noLimit];
  const category = all.find((c) => c.id === picked) ?? null;
  const essential = mandatory ?? category?.essential === true;
  const average = category ? averages.get(category.id) : undefined;
  const money = (m: Money) => formatMoney(locale, m.amount, m.currency);
  const ready = category !== null && value !== null && !problem && !busy;
  const confirm = async () => {
    if (!ready || !category || value === null) return;
    setBusy(true);
    setFailed(false);
    const r = await saveLimit(api, view.version, category.id, { amount: value, currency });
    if (r === "ok" && essential !== (category.essential === true)) {
      const o = await outcome(
        api.PATCH("/v1/categories/{categoryId}", {
          params: { path: { categoryId: category.id } },
          body: { essential },
        }),
      );
      if (!o.ok) {
        setBusy(false);
        setFailed(true);
        return;
      }
    }
    setBusy(false);
    if (r === "failed") setFailed(true);
    else onSaved();
  };
  return (
    <tr className="bud-add-row" aria-label={t("planning.budget.cat.add.row")}>
      <th scope="row">
        <select
          className="auth-input bud-add-category"
          aria-label={t("planning.budget.cat.add.category")}
          value={picked}
          onChange={(e) => {
            if (e.target.value === NEW) onNew(groupId);
            else {
              setPicked(e.target.value);
              setMandatory(null);
            }
          }}
        >
          <option value="" disabled>
            {t("planning.budget.cat.add.category")}
          </option>
          {choices.outside.length > 0 ? (
            <optgroup label={t("planning.budget.cat.add.outside")}>
              {choices.outside.map((o) => (
                <option key={o.category.id} value={o.category.id}>
                  {t("planning.budget.cat.add.outsideSpent", {
                    name: o.category.name,
                    amount: money(o.spent),
                  })}
                </option>
              ))}
            </optgroup>
          ) : null}
          {choices.noLimit.length > 0 ? (
            <optgroup label={t("planning.budget.cat.add.noLimit")}>
              {choices.noLimit.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </optgroup>
          ) : null}
          <option value={NEW}>{t("planning.budget.cat.new")}</option>
        </select>
        <label className="bud-mandatory-field">
          <input
            type="checkbox"
            checked={essential}
            disabled={category === null}
            onChange={(e) => setMandatory(e.target.checked)}
          />
          <span>{t("planning.budget.cat.add.mandatory")}</span>
        </label>
      </th>
      {columns.map((key) =>
        key === "limit" ? (
          <td key={key} className="bud-add-limit">
            <AmountField
              label={t("planning.budget.limit.field")}
              labelHidden
              currency={currency}
              value={value}
              placeholder={
                average ? t("planning.budget.cat.add.average", { amount: money(average) }) : undefined
              }
              onChange={(v, p) => {
                setValue(v);
                setProblem(p !== null);
              }}
            />
          </td>
        ) : (
          <td key={key} />
        ),
      )}
      <td className="bud-add-cells">
        <button
          type="button"
          className="ws-icon-button"
          aria-label={t("planning.budget.cat.add.confirm")}
          title={t("planning.budget.cat.add.confirm")}
          aria-disabled={!ready || undefined}
          onClick={() => void confirm()}
        >
          <Icon name="check" size={16} inButton />
        </button>
        <button
          type="button"
          className="ws-icon-button"
          aria-label={t("planning.budget.cat.add.cancel")}
          title={t("planning.budget.cat.add.cancel")}
          onClick={onCancel}
        >
          <Icon name="close" size={16} inButton />
        </button>
        {failed ? (
          <span role="alert" className="bud-note">
            {t("planning.budget.cat.error")}
          </span>
        ) : null}
      </td>
    </tr>
  );
}

/**
 * The 3-month averages of the expense categories for the placeholder of the limit field (FR 7: «підказка середніх
 * витрат за 3 міс. у полі») — the same figures the wizard shows (`GET /v1/budget/wizard`); none without the history.
 */
function useAverages(): ReadonlyMap<string, Money> {
  const api = useAuthApi();
  const [averages, setAverages] = useState<ReadonlyMap<string, Money>>(new Map());
  useEffect(() => {
    let live = true;
    void outcome(api.GET("/v1/budget/wizard")).then((o) => {
      if (live && o.ok)
        setAverages(new Map(o.data.fromSpending.categories.map((c) => [c.categoryId, c.average])));
    });
    return () => {
      live = false;
    };
  }, [api]);
  return averages;
}
