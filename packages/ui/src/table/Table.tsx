import { type KeyboardEvent, type ReactNode } from "react";
import { formatNumber, useI18n, type MessageKey } from "@willowsum/i18n";
import { Button } from "../button/Button.tsx";
import { Skeleton } from "../skeleton/Skeleton.tsx";
import { TruncatedText } from "../tooltip/Tooltip.tsx";

export type TableSortDirection = "asc" | "desc";

export interface TableColumn {
  /** Key of the cell in `TableRow.cells` and of the sort. */
  key: string;
  /** The heading text (the consumer's, from i18n). */
  label: string;
  /** `end` for amounts; text stays at the start. An `amount` column is always at the end. */
  align?: "start" | "end";
  /** `amount`: tabular digits, aligned to the end, never truncated by the table (the consumer abbreviates). */
  type?: "text" | "amount" | "badge";
  /** A share of the container, «30%»: the schema decides, the cell text never does (CMP-26 «Вміст»). */
  width?: string;
  /** A column the ColumnPicker hid is not drawn. */
  hidden?: boolean;
  /** The heading is a button that sorts (the consumer owns the order). */
  sortable?: boolean;
}

export interface TableRow {
  id: string;
  /** A string is one line cut with «…» and a tooltip; a node (an amount, a badge) is drawn as it is. */
  cells: Readonly<Record<string, ReactNode>>;
  /** The accessible name of the row's selection box and of the open action, e.g. «Вибрати Кредитна ··9021». */
  label?: string;
}

export interface TableProps {
  /** The table's accessible name (`aria-label`). */
  caption: string;
  columns: readonly TableColumn[];
  rows: readonly TableRow[];
  /** `ready` (default), `loading` (skeleton rows), `empty`, `error`. */
  state?: "ready" | "loading" | "empty" | "error";
  sort?: { key: string; direction: TableSortDirection } | undefined;
  /** A heading was pressed: the consumer picks the direction (the same column flips it). */
  onSort?: ((key: string) => void) | undefined;
  /** The summary line over the table: the record count (formatted here) and the total (a cell from the consumer). */
  summary?: { count: number; total?: ReactNode } | undefined;
  /** Widget variant: 44 px rows, 12 px padding; rows stay rows in a narrow container. */
  flat?: boolean;
  /** Bulk-action mode: the first column holds a checkbox per row. */
  selection?:
    | {
        selected: ReadonlySet<string>;
        onChange: (id: string, checked: boolean) => void;
      }
    | undefined;
  /** A row that opens its record: focusable, Enter and a click open it. */
  onOpen?: ((row: TableRow) => void) | undefined;
  /** The empty state; by default a short text. */
  empty?: ReactNode;
  /** The error state: «Спробувати ще раз» and the support code. */
  error?: { onRetry: () => void; code?: string | undefined } | undefined;
  /** Pagination (CMP-13) or any footer under the table. */
  footer?: ReactNode;
  className?: string | undefined;
}

const FORMS = ["one", "few", "many", "other"] as const;

function countText(
  t: (key: MessageKey, values?: Record<string, string>) => string,
  locale: Parameters<typeof formatNumber>[0],
  count: number,
): string {
  const rule = new Intl.PluralRules(locale === "en" ? "en" : "uk").select(count);
  const form = (FORMS as readonly string[]).includes(rule) ? rule : "other";
  return t(`table.summary.count.${form}` as MessageKey, { count: formatNumber(locale, String(count)) });
}

/**
 * CMP-26@PoC Table: a dense, semantic table (`table`, `th scope`, a sort button with `aria-sort`) that never
 * scrolls sideways: in a container narrower than 520 px every row is a card (CSS container query, `.ws-dtable`).
 * The consumer owns the rows, the order and the money: amounts arrive as cells, nothing is calculated here.
 * Loading is a skeleton, empty and error are states in the frame.
 */
export function Table({
  caption,
  columns,
  rows,
  state = "ready",
  sort,
  onSort,
  summary,
  flat = false,
  selection,
  onOpen,
  empty,
  error,
  footer,
  className,
}: TableProps) {
  const { t, locale } = useI18n();
  const shown = columns.filter((c) => !c.hidden);

  const rowKeys = (e: KeyboardEvent<HTMLTableRowElement>, row: TableRow) => {
    // Enter on the row itself opens it; Enter on a checkbox or a link inside keeps its own meaning.
    if (e.key === "Enter" && e.target === e.currentTarget) {
      e.preventDefault();
      onOpen?.(row);
    }
  };

  const cls = ["ws-dtable-wrap", flat ? "ws-dtable-wrap--flat" : "", className ?? ""]
    .filter(Boolean)
    .join(" ");
  const showSummary = summary && (state === "ready" || state === "empty");

  return (
    <div className={cls}>
      <div className="ws-dtable-frame">
        {showSummary && (
          <p className="ws-dtable-summary" data-testid="table-summary">
            <span>{countText(t, locale, summary.count)}</span>
            {summary.total !== undefined && (
              <>
                <span aria-hidden="true"> · </span>
                <span className="ws-dtable-total">{summary.total}</span>
              </>
            )}
          </p>
        )}
        {state === "loading" && (
          <div className="ws-dtable-state">
            <Skeleton variant="row" lines={5} />
          </div>
        )}
        {state === "empty" && (
          <div className="ws-dtable-state ws-dtable-state--empty">
            {empty ?? <p className="ws-muted">{t("table.empty")}</p>}
          </div>
        )}
        {state === "error" && (
          <div className="ws-dtable-state" role="alert">
            <p className="ws-dtable-error-title">{t("table.error.title")}</p>
            <p>{t("table.error.body")}</p>
            <Button label={t("table.error.retry")} onClick={() => error?.onRetry()} />
            {error?.code ? <p className="ws-muted">{t("table.error.code", { code: error.code })}</p> : null}
          </div>
        )}
        {state === "ready" && (
          <table className="ws-dtable" aria-label={caption}>
            <colgroup>
              {selection && <col className="ws-dtable-selectcol" />}
              {shown.map((c) => (
                <col key={c.key} {...(c.width ? { style: { width: c.width } } : {})} />
              ))}
            </colgroup>
            <thead>
              <tr>
                {selection && (
                  <th scope="col" className="ws-dtable-select">
                    <span className="ws-visually-hidden">{t("table.select")}</span>
                  </th>
                )}
                {shown.map((c) => {
                  const active = sort?.key === c.key ? sort.direction : undefined;
                  const end = c.align === "end" || c.type === "amount";
                  return (
                    <th
                      key={c.key}
                      scope="col"
                      className={end ? "ws-dtable-end" : undefined}
                      aria-sort={
                        c.sortable
                          ? active === "asc"
                            ? "ascending"
                            : active === "desc"
                              ? "descending"
                              : "none"
                          : undefined
                      }
                    >
                      {c.sortable && onSort ? (
                        <button
                          type="button"
                          className="ws-dtable-sort"
                          data-sort={active ?? "none"}
                          onClick={() => onSort(c.key)}
                        >
                          <span>{c.label}</span>
                          <span className="ws-dtable-arrow" aria-hidden="true">
                            {active === "asc" ? "▲" : active === "desc" ? "▼" : "↕"}
                          </span>
                        </button>
                      ) : (
                        c.label
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const selected = selection?.selected.has(row.id) ?? false;
                return (
                  <tr
                    key={row.id}
                    className="ws-dtable-row"
                    data-selected={selected ? "true" : undefined}
                    data-open={onOpen ? "true" : undefined}
                    tabIndex={onOpen ? 0 : undefined}
                    aria-label={onOpen ? row.label : undefined}
                    onKeyDown={onOpen ? (e) => rowKeys(e, row) : undefined}
                    onClick={
                      onOpen
                        ? (e) => {
                            if ((e.target as HTMLElement).closest("input, button, a")) return;
                            onOpen(row);
                          }
                        : undefined
                    }
                  >
                    {selection && (
                      <td className="ws-dtable-select">
                        <input
                          type="checkbox"
                          className="ws-row-check"
                          checked={selected}
                          aria-label={row.label ?? row.id}
                          onChange={(e) => selection.onChange(row.id, e.target.checked)}
                        />
                      </td>
                    )}
                    {shown.map((c, i) => {
                      const cell = row.cells[c.key];
                      const end = c.align === "end" || c.type === "amount";
                      return (
                        <td
                          key={c.key}
                          data-label={c.label}
                          data-first={i === 0 ? "true" : undefined}
                          className={
                            [
                              end ? "ws-dtable-end ws-tabular" : "",
                              c.type === "badge" ? "ws-dtable-badge" : "",
                            ]
                              .filter(Boolean)
                              .join(" ") || undefined
                          }
                        >
                          {typeof cell === "string" && c.type !== "amount" ? (
                            <TruncatedText text={cell} />
                          ) : (
                            cell
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {footer && state !== "error" && <div className="ws-dtable-footer">{footer}</div>}
      </div>
    </div>
  );
}
