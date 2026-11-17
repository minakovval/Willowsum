import { useState } from "react";
import { useI18n } from "@willowsum/i18n";
import {
  ReviewAnnouncement,
  TransactionRow,
  TransactionTableHead,
  type TransactionCategory,
  type TransactionColumn,
  type TransactionSort,
} from "@willowsum/ui";

/**
 * CMP-28@PoC TransactionRow in the design-system gallery, on synthetic values: every state of the card, a queue
 * whose «Підтвердити» waits for a pretend server and then removes the row with the count read out, the table form
 * with its columns, and the loading skeleton.
 */
const CONFIRM_MS = 800;

export function TransactionRowDemo() {
  const { t } = useI18n();
  const food: TransactionCategory = { name: t("gallery.transactionRow.catFood"), icon: "budget", tone: 2 };
  const fuel: TransactionCategory = {
    name: t("gallery.transactionRow.catFuel"),
    icon: "transactions",
    tone: 3,
  };
  const salary: TransactionCategory = { name: t("gallery.transactionRow.catSalary"), icon: "money", tone: 6 };
  const transfer: TransactionCategory = {
    name: t("gallery.transactionRow.catTransfer"),
    icon: "transactions",
    tone: "transfer",
  };
  const [queue, setQueue] = useState(["a", "b", "c"]);
  const [sort, setSort] = useState<TransactionSort>({ column: "when", direction: "desc" });
  const sortBy = (column: TransactionColumn) =>
    setSort((s) =>
      s.column === column
        ? { column, direction: s.direction === "asc" ? "desc" : "asc" }
        : { column, direction: "asc" },
    );
  const [remaining, setRemaining] = useState<number | null>(null);
  const confirm = (id: string) => () =>
    new Promise<void>((resolve) =>
      window.setTimeout(() => {
        setQueue((q) => {
          const next = q.filter((x) => x !== id);
          setRemaining(next.length);
          return next;
        });
        resolve();
      }, CONFIRM_MS),
    );
  const [selected, setSelected] = useState(false);
  const caption = (key: Parameters<typeof t>[0]) => (
    <h3 className="ws-text-label ws-muted gallery-rows__caption">{t(key)}</h3>
  );

  return (
    <div className="gallery-rows">
      <p className="ws-muted">{t("gallery.transactionRow.intro")}</p>

      {caption("gallery.transactionRow.states")}
      <div className="ws-card gallery-rows__list" data-case="tx-states">
        <TransactionRow
          merchant={t("gallery.transactionRow.silpo")}
          date="2026-11-02"
          category={food}
          amount={{ value: "-42.90", currency: "EUR" }}
          onOpen={() => undefined}
        />
        <TransactionRow
          merchant={t("gallery.transactionRow.salary")}
          date="2026-11-01"
          category={salary}
          amount={{ value: "2400.00", currency: "EUR" }}
          onOpen={() => undefined}
        />
        <TransactionRow
          merchant={t("gallery.transactionRow.fop")}
          date="2026-10-28"
          category={null}
          amount={{ value: "-120.00", currency: "EUR" }}
          onOpen={() => undefined}
        />
        <TransactionRow
          merchant={t("gallery.transactionRow.silpo")}
          date="2026-10-27"
          category={food}
          amount={{ value: "-42.90", currency: "EUR" }}
          possibleDuplicate
          onMerge={() => undefined}
          onOpen={() => undefined}
        />
        <TransactionRow
          merchant={t("gallery.transactionRow.transferTo")}
          date="2026-10-31"
          category={transfer}
          amount={{ value: "-200.00", currency: "EUR" }}
          transfer
          pending
          onOpen={() => undefined}
        />
        <TransactionRow
          merchant={t("gallery.transactionRow.rent")}
          date="2026-10-30"
          category={food}
          amount={{ value: "-86.40", currency: "EUR" }}
          split={3}
          tags={[t("gallery.transactionRow.tagHome"), t("gallery.transactionRow.tagMonthly")]}
          note
          onOpen={() => undefined}
        />
      </div>

      {caption("gallery.transactionRow.queue")}
      <div className="ws-card gallery-rows__list" data-case="tx-queue">
        {queue.map((id, i) => (
          <TransactionRow
            key={id}
            merchant={t(i === 1 ? "gallery.transactionRow.silpo" : "gallery.transactionRow.wog")}
            date="2026-10-29"
            category={fuel}
            amount={{ value: i === 1 ? "-42.90" : "-56.20", currency: "EUR" }}
            review
            onConfirm={confirm(id)}
            onChangeCategory={() => undefined}
            onOpen={() => undefined}
          />
        ))}
        {queue.length === 0 && (
          <p className="ws-muted gallery-rows__empty">{t("gallery.transactionRow.queueEmpty")}</p>
        )}
        <ReviewAnnouncement remaining={remaining} />
      </div>

      {caption("gallery.transactionRow.table")}
      <div className="ws-card gallery-rows__list" data-case="tx-table">
        <TransactionTableHead selectable />
        <TransactionRow
          layout="table"
          merchant={t("gallery.transactionRow.silpo")}
          date="2026-11-02"
          time="08:02"
          category={food}
          asset="—"
          account={t("gallery.transactionRow.accMain")}
          amount={{ value: "-42.90", currency: "EUR" }}
          selected={selected}
          onSelectedChange={setSelected}
          onOpen={() => undefined}
        />
        <TransactionRow
          layout="table"
          merchant={t("gallery.transactionRow.salary")}
          date="2026-11-01"
          time="18:30"
          category={salary}
          asset="—"
          account={t("gallery.transactionRow.accSavings")}
          amount={{ value: "3400.00", currency: "EUR" }}
          onSelectedChange={() => undefined}
          onOpen={() => undefined}
        />
      </div>

      {caption("gallery.transactionRow.tableSortable")}
      <div className="ws-card gallery-rows__list" data-case="tx-table-sortable">
        <TransactionTableHead
          withAsset={false}
          sort={sort}
          sortable={["merchant", "when", "amount"]}
          onSort={sortBy}
        />
        <TransactionRow
          layout="table"
          withAsset={false}
          merchant={t("gallery.transactionRow.silpo")}
          date="2026-11-02"
          time="08:02"
          category={food}
          account={t("gallery.transactionRow.accMain")}
          amount={{ value: "-42.90", currency: "EUR" }}
          onOpen={() => undefined}
        />
        <TransactionRow
          layout="table"
          withAsset={false}
          merchant={t("gallery.transactionRow.wog")}
          date="2026-10-31"
          time="19:22"
          category={fuel}
          account={t("gallery.transactionRow.accMain")}
          amount={{ value: "-54.20", currency: "EUR" }}
          pending
          onOpen={() => undefined}
        />
      </div>

      {caption("gallery.transactionRow.loading")}
      <div className="ws-card gallery-rows__list" data-case="tx-loading">
        <TransactionRow merchant="" date="2026-11-02" amount={{ value: "0", currency: "EUR" }} loading />
      </div>
    </div>
  );
}
