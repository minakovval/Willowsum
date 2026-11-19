import type { ReactNode } from "react";
import { currencySymbolOf, formatLocaleOf, formatMoney, useI18n, type MessageKey } from "@willowsum/i18n";
import { Table, type TableColumn, type TableRow } from "@willowsum/ui";
import { ChangeCell } from "./ComparePage.tsx";
import type { YearData } from "./model.ts";

const K = (key: string) => `planning.compare.${key}` as MessageKey;

type Money = { amount: string; currency: string };
type Cell = YearData["year"]["income"]["cells"][number];
type Line = {
  cells: readonly Cell[];
  total: Money;
  plan: Money | null;
  difference: YearData["year"]["income"]["difference"];
};

/**
 * BUD-06@PoC FR 11, AC11, AC14, S-290 «Рік: план і факт»: categories × 12 months — the fact with the «± до плану» of the
 * month under it, a future month shows the plan only (grey), then «Разом за рік», «План», «Різниця»; the row «Дохід» on
 * top, the groups and «Усього витрат». The amounts are the API's decimal strings.
 */
export function YearTable({ data }: { data: YearData }) {
  const { t, locale } = useI18n();
  const { year, names, groups } = data;
  // The note says «суми в €», so a cell shows the number alone (12 months must fit one row).
  const money = (m: Money) =>
    formatMoney(locale, m.amount, m.currency).replace(currencySymbolOf(locale, m.currency), "").trim();
  const month = (period: string) =>
    new Intl.DateTimeFormat(formatLocaleOf(locale), { month: "short", timeZone: "UTC" }).format(
      new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5)) - 1, 1)),
    );

  const columns: TableColumn[] = [
    { key: "category", label: t(K("col.category")), width: "14%" },
    ...year.months.map((m): TableColumn => ({ key: m.period, label: month(m.period), type: "amount" })),
    { key: "total", label: t(K("year.col.total")), type: "amount" },
    { key: "plan", label: t(K("year.col.plan")), type: "amount" },
    { key: "diff", label: t(K("year.col.diff")), type: "amount" },
  ];

  const rowOf = (id: string, name: string, line: Line, strong: boolean, indent: boolean): TableRow => {
    const cells: Record<string, ReactNode> = {
      category: (
        <span className={indent ? "cmp-year-indent" : undefined}>
          {strong ? <strong>{name}</strong> : name}
        </span>
      ),
      total: money(line.total),
      plan: line.plan ? money(line.plan) : t(K("dash")),
      diff: <ChangeCell change={line.difference} short />,
    };
    year.months.forEach((m, i) => {
      const c = line.cells[i];
      cells[m.period] =
        c === undefined ? null : c.fact === null ? (
          <span className="cmp-year-future ws-muted">
            {c.plan ? money(c.plan) : t(K("dash"))}
            <span className="cmp-sub">{t(K("year.plan"))}</span>
          </span>
        ) : (
          <span className="cmp-year-cell">
            {money(c.fact)}
            <span className="cmp-sub">
              <ChangeCell change={c.difference} short />
            </span>
          </span>
        );
    });
    return { id, label: name, cells };
  };

  const rows: TableRow[] = [rowOf("income", t(K("year.income")), year.income, true, false)];
  year.groups.forEach((g, gi) => {
    const gname = g.groupId === null ? t("planning.budget.uncategorized") : (groups.get(g.groupId) ?? "");
    rows.push(rowOf(`g${gi}`, gname, g, true, false));
    g.categories.forEach((c, ci) =>
      rows.push(
        rowOf(
          `g${gi}c${ci}`,
          c.categoryId === null ? t("planning.budget.uncategorized") : (names.get(c.categoryId) ?? ""),
          c,
          false,
          true,
        ),
      ),
    );
  });
  rows.push(rowOf("total", t(K("expenses.total")), year.expenses, true, false));

  return (
    <div className="cmp-body cmp-year">
      <h2 className="ws-text-heading-3">{t(K("year.title"), { year: year.year })}</h2>
      <p className="ws-muted">{t(K("year.note"), { currency: year.currency })}</p>
      <Table
        caption={t(K("year.title"), { year: year.year })}
        columns={columns}
        rows={rows}
        className="cmp-year-table"
      />
    </div>
  );
}
