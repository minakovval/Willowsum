import { useEffect, useRef, useState } from "react";
import { useT } from "@willowsum/i18n";
import { Pagination, Skeleton, useRestoredListState, type PageSize } from "@willowsum/ui";

/**
 * CMP-13@PoC Pagination in the design-system gallery, on synthetic records: the first page, the last page, a
 * page that is loading, an empty list (no pagination) and a live list of 1 240 records whose pages load for a
 * moment, move focus to the first row, announce the range and remember page and size when the section is left.
 */
const RECORDS = 1240;
const LOAD_MS = 600;
const SHOWN_ROWS = 3;

interface View {
  page: number;
  pageSize: PageSize;
}

function Static({
  caseId,
  label,
  page,
  loading,
  records,
}: {
  caseId: string;
  label: string;
  page: number;
  loading?: boolean;
  records: number;
}) {
  return (
    <figure className="gallery-pagination__case" data-case={caseId}>
      <figcaption className="ws-text-label ws-muted">{label}</figcaption>
      <Pagination
        page={page}
        recordCount={records}
        pageSize={25}
        loading={loading}
        onChange={() => undefined}
      />
    </figure>
  );
}

function LiveList() {
  const t = useT();
  const [view, setView] = useRestoredListState<View>("gallery-pagination", { page: 1, pageSize: 25 });
  const [loading, setLoading] = useState(false);
  const [shown, setShown] = useState(view);
  const list = useRef<HTMLUListElement>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const first = (shown.page - 1) * shown.pageSize + 1;
  return (
    <figure className="gallery-pagination__case" data-case="pagination-live">
      <figcaption className="ws-text-label ws-muted">{t("gallery.pagination.live")}</figcaption>
      <div className="ws-card gallery-pagination__list">
        {loading ? (
          <Skeleton variant="text" lines={SHOWN_ROWS} />
        ) : (
          <ul ref={list} className="gallery-pagination__rows">
            {Array.from({ length: SHOWN_ROWS }, (_, i) => (
              <li key={first + i}>{t("gallery.pagination.record", { n: String(first + i) })}</li>
            ))}
          </ul>
        )}
        <Pagination
          page={view.page}
          recordCount={RECORDS}
          pageSize={view.pageSize}
          loading={loading}
          firstRow={() => list.current?.querySelector("li") ?? null}
          onChange={(next) => {
            // The range stays until the data arrives (CMP-13 «Завантаження сторінки»).
            setLoading(true);
            window.clearTimeout(timer.current);
            timer.current = window.setTimeout(() => {
              setView(next);
              setShown(next);
              setLoading(false);
            }, LOAD_MS);
          }}
        />
      </div>
    </figure>
  );
}

export function PaginationDemo() {
  const t = useT();
  return (
    <div className="gallery-pagination">
      <p className="ws-muted">{t("gallery.pagination.intro")}</p>
      <div className="gallery-pagination__grid">
        <Static caseId="pagination-first" label={t("gallery.pagination.first")} page={1} records={RECORDS} />
        <Static caseId="pagination-last" label={t("gallery.pagination.last")} page={50} records={RECORDS} />
        <Static
          caseId="pagination-loading"
          label={t("gallery.pagination.loading")}
          page={2}
          loading
          records={RECORDS}
        />
        <figure className="gallery-pagination__case" data-case="pagination-empty">
          <figcaption className="ws-text-label ws-muted">{t("gallery.pagination.empty")}</figcaption>
          <Pagination page={1} recordCount={0} pageSize={25} onChange={() => undefined} />
          <p className="ws-muted">{t("gallery.pagination.emptyNote")}</p>
        </figure>
      </div>
      <LiveList />
    </div>
  );
}
