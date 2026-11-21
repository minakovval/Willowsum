import "./budget.css";
import { useMemo, useState } from "react";
import { formatMoney, useI18n, type MessageKey, type Translate } from "@willowsum/i18n";
import { useAuthApi } from "../../auth/api.ts";
import {
  CardFilter,
  CardFilterChips,
  StatusMark,
  UsageStatus,
  type CardFilterSection,
  type FilterChipItem,
} from "@willowsum/ui";
import { categoryMenu, RowMenu, useCategoryActions } from "./CategoryActions.tsx";
import {
  filterCount,
  hasScale,
  matches,
  NO_FILTERS,
  optionalLimits,
  OUTSIDE,
  overspend,
  removeLimit,
  sortRows,
  STATE_VALUES,
  stateValueOf,
  toggled,
  TYPE_VALUES,
  type BudgetView,
  type Filters,
  type Money,
  type Row,
  type Sort,
  type SortKey,
  type StateValue,
  type TypeValue,
} from "./model.ts";

const TYPE_KEYS: Readonly<Record<TypeValue, MessageKey>> = {
  mandatory: "planning.budget.filter.mandatory",
  optional: "planning.budget.filter.optional",
};
const STATE_KEYS: Readonly<Record<StateValue, MessageKey>> = {
  notStarted: "planning.budget.filter.notStarted",
  remaining: "planning.budget.filter.remaining",
  almost: "planning.budget.filter.almost",
  exhausted: "planning.budget.filter.exhausted",
  over: "planning.budget.filter.over",
  outOfPlan: "planning.budget.filter.outOfPlan",
};
const COLUMNS: readonly { key: SortKey; label: MessageKey }[] = [
  { key: "category", label: "planning.budget.col.category" },
  { key: "spent", label: "planning.budget.col.spent" },
  { key: "limit", label: "planning.budget.col.limit" },
  { key: "remaining", label: "planning.budget.col.remaining" },
];
const SUMMARY_FORMS = ["one", "few", "many", "other"] as const;

/** The count in the words of the interface language: «у 4 категоріях». */
function overIn(t: Translate, locale: string, count: number): string {
  const rule = new Intl.PluralRules(locale === "uk" ? "uk-UA" : "en").select(count);
  const form = (SUMMARY_FORMS as readonly string[]).includes(rule) ? rule : "other";
  return t(`planning.budget.sum.overIn.${form}` as MessageKey, { count });
}

/** «Показано 4 з 15 категорій»: the noun follows the total («з 1 категорії», «з 5 категорій»). */
function shownText(t: Translate, locale: string, shown: number, count: number): string {
  const rule = new Intl.PluralRules(locale === "uk" ? "uk-UA" : "en").select(count);
  const form = (SUMMARY_FORMS as readonly string[]).includes(rule) ? rule : "other";
  return t(`planning.budget.shown.${form}` as MessageKey, { shown, total: count });
}

/**
 * BUD-02@PoC d) FR 9, FR 19, FR 20 and GRID-04@PoC FR 2: the card «Категорії» of S-121 — the totals row over the
 * table, the groups and categories (a row: the name, the usage bar with the word of its state under it, spent, limit
 * and the remainder), «Поза планом», «Разом», and the quiet filter in the heading (CMP-32 variant «у картці»). An
 * overspent row says «✕ перевищено» and shows the minus amount only in «Залишок»; the filter changes the table only,
 * not the totals row. `plan` — the future month: only the limits, no fact (S-289).
 */
export function CategoriesCard({
  view,
  plan,
  onChanged,
}: {
  view: BudgetView;
  plan: boolean;
  /** A row action went through (or the budget changed elsewhere): read the page again. */
  onChanged: () => void;
}) {
  const { t, locale } = useI18n();
  const api = useAuthApi();
  const [failed, setFailed] = useState(false);
  const actions = useCategoryActions({ tree: view.tree, onChanged, onCreated: () => onChanged() });
  const treeCategories = useMemo(
    () => new Map(view.tree.groups.flatMap((g) => g.categories).map((c) => [c.id, c])),
    [view],
  );
  /** The «…» of a row (FR 7, FR 22, FR 23); «Без категорії» has none, «Прибрати з бюджету» only a row with a limit. */
  const menuOf = (row: Row) => {
    const category = treeCategories.get(row.id);
    if (!category) return null;
    return (
      <RowMenu
        name={row.name}
        items={categoryMenu(t, {
          rename: () => actions.rename(category),
          removeFromBudget:
            row.limit === null
              ? null
              : () => {
                  setFailed(false);
                  void removeLimit(api, view.version, row.id).then((o) => {
                    // A conflict of versions (the budget changed in another window) is answered by reading it again.
                    if (o.ok || (o.kind === "problem" && o.problem.code === "VERSION_CONFLICT")) onChanged();
                    else setFailed(true);
                  });
                },
          remove: () => actions.remove(category),
        })}
      />
    );
  };
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [sort, setSort] = useState<Sort | undefined>(undefined);
  const money = (m: Money) => formatMoney(locale, m.amount, m.currency);
  const limited = useMemo(() => view.sections.flatMap((s) => s.rows), [view]);
  const all = useMemo(() => [...limited, ...view.outside], [limited, view]);
  const optional = useMemo(() => optionalLimits(limited), [limited]);
  const over = useMemo(() => overspend(limited), [limited]);
  const { totals } = view.period;

  const shownIds = new Set(all.filter((r) => plan || matches(r, filters)).map((r) => r.id + r.groupId));
  const visible = (r: Row) => shownIds.has(r.id + r.groupId);
  const sections = view.sections
    .map((s) => ({ ...s, rows: sortRows(s.rows.filter(visible), sort, locale) }))
    .filter((s) => s.rows.length > 0);
  const outside = sortRows(view.outside.filter(visible), sort, locale);
  const shown = shownIds.size;

  const countOf = (pick: (r: Row) => boolean) => all.filter(pick).length;
  const sectionsOfMenu: CardFilterSection[] = [
    {
      id: "type",
      label: t("planning.budget.filter.type"),
      options: TYPE_VALUES.map((v) => ({
        id: v,
        label: t(TYPE_KEYS[v]),
        count: countOf((r) => (r.mandatory ? "mandatory" : "optional") === v),
        checked: filters.type.has(v),
      })),
    },
    {
      id: "state",
      label: t("planning.budget.filter.state"),
      options: STATE_VALUES.map((v) => ({
        id: v,
        label: t(STATE_KEYS[v]),
        count: countOf((r) => stateValueOf(r) === v),
        checked: filters.state.has(v),
      })),
    },
    {
      id: "groups",
      label: t("planning.budget.filter.groups"),
      options: view.sections.map((s) => ({
        id: s.id,
        label: s.name,
        count: s.rows.length,
        checked: filters.groups.has(s.id),
      })),
    },
  ];
  const onToggle = (section: string, id: string) =>
    setFilters((f) =>
      section === "type"
        ? { ...f, type: toggled(f.type, id as TypeValue) }
        : section === "state"
          ? { ...f, state: toggled(f.state, id as StateValue) }
          : { ...f, groups: toggled(f.groups, id) },
    );

  const chips: FilterChipItem[] = [
    ...[...filters.type].map((v) =>
      chip(
        `type:${v}`,
        t("planning.budget.filter.typeField"),
        t(TYPE_KEYS[v]),
        "planning.budget.filter.chipType",
      ),
    ),
    ...[...filters.state].map((v) =>
      chip(
        `state:${v}`,
        t("planning.budget.filter.stateField"),
        t(STATE_KEYS[v]),
        "planning.budget.filter.chipState",
      ),
    ),
    ...[...filters.groups].map((id) =>
      chip(
        `groups:${id}`,
        t("planning.budget.filter.groupField"),
        view.sections.find((s) => s.id === id)?.name ?? "",
        "planning.budget.filter.chipGroup",
      ),
    ),
  ];
  function chip(id: string, field: string, value: string, key: MessageKey): FilterChipItem {
    return { id, field, value: value.toLowerCase(), text: t(key, { value: value.toLowerCase() }) };
  }
  const remove = (id: string) => {
    const [axis, value = ""] = id.split(/:(.*)/s);
    onToggle(axis === "groups" ? "groups" : (axis ?? ""), value);
  };
  const reset = () => setFilters(NO_FILTERS);
  const active = filterCount(filters);

  const sortBy = (key: SortKey) =>
    setSort((s) =>
      s?.key === key ? { key, direction: s.direction === "asc" ? "desc" : "asc" } : { key, direction: "asc" },
    );
  const ariaSort = (key: SortKey) =>
    sort?.key === key ? (sort.direction === "asc" ? "ascending" : "descending") : undefined;
  const columns = plan ? COLUMNS.filter((c) => c.key === "category" || c.key === "limit") : COLUMNS;
  const cell = (row: Row, key: SortKey) => {
    if (key === "spent") return row.spent ? money(row.spent) : "";
    if (key === "limit") return row.limit ? money(row.limit) : "";
    return row.remaining ? money(row.remaining) : "";
  };
  const label = (row: Row) => row.name || t("planning.budget.uncategorized");

  return (
    <section className="ws-card bud-card" aria-labelledby="bud-cat-title">
      <div className="bud-cat-head">
        <h2 id="bud-cat-title" className="ws-text-heading-3 bud-card-title">
          {t("planning.budget.categories.title")}
        </h2>
        {plan ? null : (
          <CardFilter
            count={active}
            sections={sectionsOfMenu}
            onToggle={onToggle}
            onReset={reset}
            shown={shown}
            all={all.length}
          />
        )}
      </div>
      {plan ? null : <CardFilterChips chips={chips} onRemove={remove} />}
      {failed ? (
        <p role="alert" className="bud-note">
          {t("planning.budget.cat.error")}
        </p>
      ) : null}
      {plan ? null : (
        <dl className="bud-summary">
          <div>
            <dt>{t("planning.budget.sum.spent")}</dt>
            <dd>{totals.spent ? money(totals.spent) : ""}</dd>
            <dd className="bud-sub">{t("planning.budget.sum.spentOf", { limit: money(totals.limits) })}</dd>
          </div>
          {over ? (
            <div>
              <dt>{t("planning.budget.sum.over")}</dt>
              <dd>{money(over)}</dd>
              <dd className="bud-sub">{overIn(t, locale, over.count)}</dd>
            </div>
          ) : null}
        </dl>
      )}
      <table className="bud-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" aria-sort={ariaSort(c.key)}>
                {plan ? (
                  t(c.key === "limit" ? "planning.budget.col.plan" : c.label)
                ) : (
                  <button
                    type="button"
                    className="bud-sort"
                    aria-label={t("planning.budget.sort.by", { column: t(c.label) })}
                    onClick={() => sortBy(c.key)}
                  >
                    {t(c.label)}
                  </button>
                )}
              </th>
            ))}
            <th scope="col">
              <span className="ws-visually-hidden">{t("categories.more")}</span>
            </th>
          </tr>
        </thead>
        {sections.map((s) => (
          <tbody key={s.id} data-group={s.id}>
            <tr className="bud-group">
              <th scope="colgroup" colSpan={columns.length + 1}>
                {s.name}
              </th>
            </tr>
            {s.rows.map((row) => (
              <tr key={row.id} data-state={row.state ?? undefined}>
                <th scope="row">
                  <span className="bud-name">
                    {label(row)}
                    {row.mandatory ? <StatusMark id="v.mandatory" /> : null}
                  </span>
                  {!plan && row.spent && row.limit && hasScale(row) ? (
                    <UsageStatus
                      spent={row.spent.amount}
                      limit={row.limit.amount}
                      mandatory={row.mandatory}
                      optionalLimits={optional}
                    />
                  ) : !plan && row.state && row.state !== "outOfPlan" && row.state !== "limitReached" ? (
                    <StatusMark id={`a.${row.state}`} />
                  ) : null}
                </th>
                {columns.slice(1).map((c) => (
                  <td key={c.key} data-col={c.key}>
                    {cell(row, c.key)}
                  </td>
                ))}
                <td className="bud-menu">{menuOf(row)}</td>
              </tr>
            ))}
          </tbody>
        ))}
        {outside.length > 0 ? (
          <tbody data-group={OUTSIDE}>
            <tr className="bud-group">
              <th scope="colgroup" colSpan={columns.length + 1}>
                <StatusMark id="v.outOfPlan" />
                <span className="bud-sub">{t("planning.budget.outside.note")}</span>
              </th>
            </tr>
            {outside.map((row) => (
              <tr key={row.id} data-state="outOfPlan">
                <th scope="row">
                  <span className="bud-name">{label(row)}</span>
                </th>
                {columns.slice(1).map((c) => (
                  <td key={c.key} data-col={c.key}>
                    {cell(row, c.key)}
                  </td>
                ))}
                <td className="bud-menu">{menuOf(row)}</td>
              </tr>
            ))}
          </tbody>
        ) : null}
        {sections.length === 0 && outside.length === 0 ? (
          <tbody>
            <tr>
              <td colSpan={columns.length + 1}>{t("planning.budget.noMatch")}</td>
            </tr>
          </tbody>
        ) : null}
        <tfoot>
          <tr className="bud-total">
            <th scope="row">{t("planning.budget.total")}</th>
            {columns.slice(1).map((c) => (
              <td key={c.key} data-col={c.key}>
                {c.key === "spent" && totals.spent ? money(totals.spent) : null}
                {c.key === "limit" ? money(totals.limits) : null}
                {c.key === "remaining" && totals.remaining ? money(totals.remaining) : null}
              </td>
            ))}
            <td />
          </tr>
        </tfoot>
      </table>
      {plan || active === 0 ? null : (
        <p className="bud-foot">
          <span className="bud-note">{shownText(t, locale, shown, all.length)}</span>
          <button type="button" className="ws-card-filter-reset" onClick={reset}>
            {t("planning.budget.resetFilters")}
          </button>
        </p>
      )}
      {actions.dialogs}
    </section>
  );
}
