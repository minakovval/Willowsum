import { useState } from "react";
import { formatMoney, useI18n, type MessageKey } from "@willowsum/i18n";
import { Pagination, Table, type TableColumn, type TableRow, type TableSortDirection } from "@willowsum/ui";

/**
 * CMP-26@PoC Table in the design-system gallery, on synthetic accounts: a sortable table with the summary, a row
 * selection and Pagination; the same table in containers of 768 px (a table) and 480 px (cards); `flat` in a
 * 400 px widget; and the loading, empty and error states. Amounts are cells formatted for display only.
 */
interface Sample {
  id: string;
  name: MessageKey;
  type: MessageKey;
  when: string;
  value: string;
  /** The place of the row in each order (the demo does not compare amounts). */
  rank: Record<"name" | "when" | "value", number>;
}

const SAMPLES: readonly Sample[] = [
  {
    id: "a",
    name: "gallery.table.acc1",
    type: "gallery.table.typeCurrent",
    when: "12.11.2026 09:30",
    value: "3200.00",
    rank: { name: 4, when: 1, value: 5 },
  },
  {
    id: "b",
    name: "gallery.table.acc2",
    type: "gallery.table.typeCredit",
    when: "11.11.2026 18:05",
    value: "-2400.00",
    rank: { name: 1, when: 2, value: 1 },
  },
  {
    id: "c",
    name: "gallery.table.acc3",
    type: "gallery.table.typeSavings",
    when: "09.11.2026 08:12",
    value: "18450.75",
    rank: { name: 5, when: 4, value: 6 },
  },
  {
    id: "d",
    name: "gallery.table.acc4",
    type: "gallery.table.typeCurrent",
    when: "10.11.2026 21:47",
    value: "415.20",
    rank: { name: 2, when: 3, value: 3 },
  },
  {
    id: "e",
    name: "gallery.table.acc5",
    type: "gallery.table.typeCash",
    when: "02.11.2026 12:00",
    value: "980.00",
    rank: { name: 3, when: 6, value: 4 },
  },
  {
    id: "f",
    name: "gallery.table.acc6",
    type: "gallery.table.typeCurrent",
    when: "01.11.2026 07:20",
    value: "55.00",
    rank: { name: 6, when: 7, value: 2 },
  },
];

type Key = "name" | "when" | "value";

export function TableDemo() {
  const { t, locale } = useI18n();
  const [sort, setSort] = useState<{ key: Key; direction: TableSortDirection }>({
    key: "value",
    direction: "desc",
  });
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set(["b"]));
  const [opened, setOpened] = useState<string | null>(null);
  const [page, setPage] = useState({ page: 1, pageSize: 25 as 25 | 50 | 100 });

  const columns: TableColumn[] = [
    { key: "name", label: t("gallery.table.colName"), width: "34%", sortable: true },
    { key: "type", label: t("gallery.table.colType"), width: "22%" },
    { key: "when", label: t("gallery.table.colWhen"), width: "20%", sortable: true },
    { key: "value", label: t("gallery.table.colValue"), type: "amount", width: "24%", sortable: true },
  ];
  const toRow = (s: Sample): TableRow => ({
    id: s.id,
    label: t(s.name),
    selectLabel: t("gallery.table.rowLabel", { name: t(s.name) }),
    cells: {
      name: t(s.name),
      type: t(s.type),
      when: s.when,
      value: formatMoney(locale, s.value, "EUR"),
    },
  });
  const ordered = [...SAMPLES].sort((x, y) =>
    sort.direction === "asc" ? x.rank[sort.key] - y.rank[sort.key] : y.rank[sort.key] - x.rank[sort.key],
  );
  const rows = ordered.map(toRow);
  const onSort = (key: string) =>
    setSort((s) => ({
      key: key as Key,
      direction: s.key === key && s.direction === "desc" ? "asc" : "desc",
    }));
  const summary = { count: 128, total: formatMoney(locale, "1284560.00", "EUR") };

  const flatColumns: TableColumn[] = [
    { key: "name", label: t("gallery.table.colName"), width: "60%" },
    { key: "value", label: t("gallery.table.colValue"), type: "amount", width: "40%" },
  ];
  const flatRows = SAMPLES.slice(0, 3).map((s) => ({
    id: s.id,
    cells: { name: t(s.name), value: formatMoney(locale, s.value, "EUR") },
  }));

  return (
    <div className="gallery-table">
      <p className="ws-muted">{t("gallery.table.intro")}</p>

      <figure className="gallery-table__case" data-case="table-wide">
        <figcaption className="ws-text-label ws-muted">{t("gallery.table.wide")}</figcaption>
        <Table
          caption={t("gallery.table.caption")}
          columns={columns}
          rows={rows}
          sort={sort}
          onSort={onSort}
          summary={summary}
          selection={{
            selected,
            onChange: (id, checked) =>
              setSelected((prev) => {
                const next = new Set(prev);
                if (checked) next.add(id);
                else next.delete(id);
                return next;
              }),
          }}
          onOpen={(row) => setOpened(row.id)}
          footer={
            <Pagination page={page.page} recordCount={128} pageSize={page.pageSize} onChange={setPage} />
          }
        />
        <p className="ws-muted" role="status">
          {opened ? t("gallery.table.opened", { id: opened }) : t("gallery.table.openHint")}
        </p>
      </figure>

      <figure className="gallery-table__case" data-case="table-768">
        <figcaption className="ws-text-label ws-muted">{t("gallery.table.w768")}</figcaption>
        <div className="gallery-table__box gallery-table__box--768">
          <Table caption={t("gallery.table.caption")} columns={columns} rows={rows.slice(0, 3)} />
        </div>
      </figure>

      <figure className="gallery-table__case" data-case="table-480">
        <figcaption className="ws-text-label ws-muted">{t("gallery.table.w480")}</figcaption>
        <div className="gallery-table__box gallery-table__box--480">
          <Table caption={t("gallery.table.caption")} columns={columns} rows={rows.slice(0, 3)} />
        </div>
      </figure>

      <figure className="gallery-table__case" data-case="table-flat">
        <figcaption className="ws-text-label ws-muted">{t("gallery.table.flat")}</figcaption>
        <div className="gallery-table__box gallery-table__box--flat">
          <Table caption={t("gallery.table.caption")} columns={flatColumns} rows={flatRows} flat />
        </div>
      </figure>

      <figure className="gallery-table__case" data-case="table-loading">
        <figcaption className="ws-text-label ws-muted">{t("gallery.table.loading")}</figcaption>
        <Table caption={t("gallery.table.caption")} columns={columns} rows={[]} state="loading" />
      </figure>

      <figure className="gallery-table__case" data-case="table-empty">
        <figcaption className="ws-text-label ws-muted">{t("gallery.table.empty")}</figcaption>
        <Table caption={t("gallery.table.caption")} columns={columns} rows={[]} state="empty" />
      </figure>

      <figure className="gallery-table__case" data-case="table-error">
        <figcaption className="ws-text-label ws-muted">{t("gallery.table.error")}</figcaption>
        <Table
          caption={t("gallery.table.caption")}
          columns={columns}
          rows={[]}
          state="error"
          error={{ onRetry: () => undefined, code: "WS-4F2A" }}
        />
      </figure>
    </div>
  );
}
