import { useEffect, useId, useRef, useState } from "react";
import { formatNumber, useI18n } from "@willowsum/i18n";
import { Button } from "../button/Button.tsx";

/** CMP-13@PoC: the page sizes of a server-side list. */
export const PAGE_SIZES = [25, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZES)[number];

export interface PaginationChange {
  /** The page to show, from 1. A new page size always comes with page 1 (CMP-13 «Поведінка», AC3). */
  page: number;
  pageSize: PageSize;
}

export interface PaginationProps {
  /** The page shown now, from 1. */
  page: number;
  /** All records of the list (with the filters applied), the «1 240» of «1–25 з 1 240». 0: nothing is shown. */
  recordCount: number;
  pageSize: PageSize;
  onChange: (next: PaginationChange) => void;
  /** A page is loading: both arrows and the size are disabled; the range stays until the data arrives. */
  loading?: boolean | undefined;
  /**
   * The first row of the list. After a move to another page, once the data is there, focus goes to this row
   * (CMP-13 «Клавіатура і екранний читач»); a row without `tabindex` gets `tabindex="-1"` first.
   */
  firstRow?: (() => HTMLElement | null) | undefined;
  className?: string | undefined;
}

const clamp = (n: number, min: number, max: number) => Math.min(Math.max(n, min), max);

/**
 * CMP-13@PoC Pagination: «Рядків на сторінці [25 ˅] · 1–25 з 1 240 ‹ ›» in one `nav` block under a list that is
 * paged on the server. The consumer owns `page`, `recordCount` and `pageSize`. A disabled arrow stays visible and is
 * described by its reason (read, not shown: the block is one row). A polite live region announces the new range
 * once a move has finished, and focus goes to the first row. Text comes from `@willowsum/i18n`.
 */
export function Pagination({
  page,
  recordCount: total,
  pageSize,
  onChange,
  loading = false,
  firstRow,
  className,
}: PaginationProps) {
  const { t, locale } = useI18n();
  const sizeId = useId();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const current = clamp(page, 1, pages);
  const from = (current - 1) * pageSize + 1;
  const to = Math.min(current * pageSize, total);
  const num = (n: number) => formatNumber(locale, String(n));
  const range = { from: num(from), to: num(to), total: num(total) };

  // A move the user started: announced (and, for a page change, focused) when the data has arrived, not before.
  const pending = useRef<"page" | "size" | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const rangeText = t("pagination.shown", range);
  const firstRowRef = useRef(firstRow);
  useEffect(() => {
    firstRowRef.current = firstRow;
  });
  useEffect(() => {
    if (pending.current === null || loading) return;
    if (pending.current === "page") {
      const row = firstRowRef.current?.();
      if (row) {
        if (!row.hasAttribute("tabindex")) row.setAttribute("tabindex", "-1");
        row.focus();
      }
    }
    pending.current = null;
    setAnnouncement(rangeText);
  }, [current, pageSize, total, loading, rangeText]);

  if (total <= 0) return null; // CMP-13 «Порожній список»: no pagination.

  const move = (next: PaginationChange) => {
    pending.current = next.pageSize === pageSize ? "page" : "size";
    onChange(next);
  };
  const first = current <= 1;
  const last = current >= pages;
  const unavailable = (atEdge: boolean, edge: "pagination.reason.first" | "pagination.reason.last") =>
    loading ? t("pagination.reason.loading") : atEdge ? t(edge) : undefined;
  const prevReason = unavailable(first, "pagination.reason.first");
  const nextReason = unavailable(last, "pagination.reason.last");

  return (
    <nav
      className={className ? `ws-pagination ${className}` : "ws-pagination"}
      aria-label={t("pagination.label")}
    >
      <label className="ws-pagination__size" htmlFor={sizeId}>
        <span>{t("pagination.pageSize")}</span>
        <select
          id={sizeId}
          className="ws-pagination__select"
          value={pageSize}
          disabled={loading}
          onChange={(e) => move({ page: 1, pageSize: Number(e.target.value) as PageSize })}
        >
          {PAGE_SIZES.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </label>
      <span className="ws-pagination__range">{t("pagination.range", range)}</span>
      <span className="ws-pagination__arrows">
        <Button
          variant="secondary"
          iconOnly
          icon="chevron-left"
          label={t("pagination.previous")}
          className="ws-pagination__arrow"
          {...(prevReason === undefined ? {} : { disabled: true as const, disabledReason: prevReason })}
          onClick={() => move({ page: current - 1, pageSize })}
        />
        <Button
          variant="secondary"
          iconOnly
          icon="chevron-right"
          label={t("pagination.next")}
          className="ws-pagination__arrow"
          {...(nextReason === undefined ? {} : { disabled: true as const, disabledReason: nextReason })}
          onClick={() => move({ page: current + 1, pageSize })}
        />
      </span>
      <span role="status" className="ws-visually-hidden">
        {announcement}
      </span>
    </nav>
  );
}
