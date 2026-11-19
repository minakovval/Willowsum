import { useId, useState } from "react";
import { formatMoney, useI18n, type MessageKey, type Translate } from "@willowsum/i18n";
import { currencyPlaces, displayAmount, Icon, StatusMark } from "@willowsum/ui";
import { NO_VALUE, PlanCellInput } from "./PlanCellInput.tsx";
import type { Money, PlanCell, PlanRow, PlanSection, PlanView, RowLabel } from "./model.ts";

const mm = (period: string): string => period.slice(5, 7);

/** The month in the words of the catalogue («Листопад»): lower case inside a sentence in Ukrainian (as S-289). */
export const monthWord = (t: Translate, locale: string, period: string): string => {
  const name = t(`planning.budget.month.${mm(period)}` as MessageKey);
  return locale === "uk" ? name.toLocaleLowerCase("uk-UA") : name;
};

export function labelText(t: Translate, label: RowLabel): string {
  switch (label.kind) {
    case "name":
      return label.name;
    case "incomePlan":
      return t("planning.plan.row.incomePlan");
    case "incomeOther":
      return t("planning.plan.row.incomeOther");
    case "savings":
      return t("planning.plan.row.savings");
    case "debtMinimum":
      return t("planning.plan.row.debtMinimum", { name: label.name });
    case "debtExtra":
      return t("planning.plan.row.debtExtra", { name: label.name });
  }
}

export type CommitHandler = (row: PlanRow, cell: PlanCell, text: string) => void;

/**
 * BUD-17@PoC FR 1, FR 2, FR 7 (S-126): the grid «рядки × 12 місяців». Sections fold (the button of the section's
 * name); a cell is edited in place; the sums and «Не розподілено» are the server's, shown as they come. The grid is one
 * table that scrolls sideways inside its card, with the name of the row held in place — there is no card layout for
 * narrow screens (FR 7, П-25).
 */
export function PlanTable({
  view,
  pending,
  onCommit,
}: {
  view: PlanView;
  /** The texts being saved by cell, `kind:lineId:period`. */
  pending: Readonly<Record<string, string>>;
  onCommit: CommitHandler;
}) {
  const { t, locale } = useI18n();
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const base = useId();
  const places = currencyPlaces(view.currency);
  const text = (m: Money | null) => (m === null ? NO_VALUE : displayAmount(locale, m.amount, places).text);
  const toggle = (id: string) =>
    setFolded((s) => {
      const next = new Set(s);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <div className="plan-scroll" role="region" aria-label={t("planning.plan.table")} tabIndex={0}>
      <table className="plan-table">
        <thead>
          <tr>
            <th scope="col" className="plan-name">
              {t("planning.plan.col.row")}
            </th>
            {view.months.map((m) => (
              <th
                key={m.period}
                scope="col"
                data-mode={m.mode}
                aria-label={`${t(`planning.budget.month.${mm(m.period)}` as MessageKey)} ${m.period.slice(0, 4)}`}
              >
                {t("planning.plan.col.month", {
                  month: t(`planning.plan.month.${mm(m.period)}` as MessageKey),
                  year: m.period.slice(2, 4),
                })}
              </th>
            ))}
          </tr>
        </thead>
        {view.sections.map((s) => (
          <SectionRows
            key={s.id}
            section={s}
            view={view}
            id={`${base}-${s.id}`}
            folded={folded.has(s.id)}
            onToggle={() => toggle(s.id)}
            text={text}
            pending={pending}
            onCommit={onCommit}
          />
        ))}
        <tfoot>
          <tr className="plan-unallocated">
            <th scope="row" className="plan-name">
              <span className="plan-label">{t("planning.plan.row.unallocated")}</span>
              <span className="plan-hint">{t("planning.plan.row.unallocatedHint")}</span>
            </th>
            {view.unallocated.map((u, i) => (
              <td key={view.months[i]?.period ?? i}>
                {u === null ? (
                  NO_VALUE
                ) : u.kind === "deficit" ? (
                  <StatusMark
                    id="v.deficit"
                    params={{ amount: formatMoney(locale, u.amount.amount, u.amount.currency) }}
                  />
                ) : (
                  text(u.amount)
                )}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function SectionRows({
  section,
  view,
  id,
  folded,
  onToggle,
  text,
  pending,
  onCommit,
}: {
  section: PlanSection;
  view: PlanView;
  id: string;
  folded: boolean;
  onToggle: () => void;
  text: (m: Money | null) => string;
  pending: Readonly<Record<string, string>>;
  onCommit: CommitHandler;
}) {
  const { t, locale } = useI18n();
  const name = t(`planning.plan.section.${section.id}` as MessageKey);
  return (
    <tbody id={id} data-section={section.id}>
      <tr className="plan-section">
        <th scope="row" className="plan-name">
          <button
            type="button"
            className="plan-fold"
            aria-expanded={!folded}
            aria-controls={id}
            onClick={onToggle}
          >
            <Icon name={folded ? "chevron-right" : "chevron-down"} size={16} />
            {name}
          </button>
        </th>
        {view.months.map((m, i) => (
          <td key={m.period}>{text(section.totals[i] ?? null)}</td>
        ))}
      </tr>
      {section.items.map((item) =>
        item.type === "group" ? (
          <tr key={`g-${item.id}`} className="plan-group" hidden={folded}>
            <th scope="rowgroup" colSpan={view.months.length + 1} className="plan-name">
              {item.name}
            </th>
          </tr>
        ) : (
          <tr key={item.row.id} className="plan-row" hidden={folded} data-row={item.row.id}>
            <th scope="row" className="plan-name">
              <span className="plan-label" title={labelText(t, item.row.label)}>
                {labelText(t, item.row.label)}
              </span>
              {item.row.locked ? (
                <span className="plan-lock" role="img" aria-label={t("planning.plan.locked")}>
                  <Icon name="lock" size={16} />
                </span>
              ) : null}
            </th>
            {item.row.cells.map((cell) => {
              const key = cell.edit ? `${cell.edit.kind}:${cell.edit.lineId ?? ""}:${cell.period}` : "";
              return (
                <td key={cell.period}>
                  <PlanCellInput
                    amount={cell.amount}
                    currency={view.currency}
                    label={t("planning.plan.cell", {
                      row: labelText(t, item.row.label),
                      month: monthWord(t, locale, cell.period),
                    })}
                    pending={cell.edit ? pending[key] : undefined}
                    onCommit={cell.edit ? (value) => onCommit(item.row, cell, value) : undefined}
                  />
                </td>
              );
            })}
          </tr>
        ),
      )}
    </tbody>
  );
}
