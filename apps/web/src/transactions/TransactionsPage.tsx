import { useCallback, useEffect, useRef, useState } from "react";
import {
  formatLocaleOf,
  formatMoney,
  useI18n,
  useT,
  type Locale,
  type MessageKey,
  type Translate,
} from "@willowsum/i18n";
import {
  Button,
  Field,
  Icon,
  ListToolbar,
  MenuButton,
  PageTabs,
  Pagination,
  SelectionBar,
  Skeleton,
  TransactionRow,
  TransactionTableHead,
  useRestoredListState,
  type PageTab,
} from "@willowsum/ui";
import { AppLayout } from "../pages/AppLayout.tsx";
import { EmptyState } from "../pages/SectionPage.tsx";
import { useRuleCount } from "../rules/api.ts";
import { childPath, IMPORT_WIZARD_PATH, TRANSACTIONS, transactionPath } from "../routing/routes.ts";
import { hrefFor } from "../routing/useHashPath.ts";
import { useDocumentTitle } from "../useDocumentTitle.ts";
import {
  DEFAULT_VIEW,
  isListView,
  listFilter,
  nextSort,
  SEARCH_MAX_LENGTH,
  SORTABLE,
  useFilterChoices,
  useTabCounts,
  useTransactionsPage,
  type ListRow,
  type ListSummary,
  type ListView,
  type SummaryTotal,
} from "./list.ts";
import { activeCount, filtersFromHash, NO_FILTERS } from "./filters.ts";
import { NewTransactionDialog } from "./NewTransactionDialog.tsx";
import { ReviewQueue } from "./ReviewQueue.tsx";
import { TransactionFilters } from "./TransactionFilters.tsx";
import { BulkBanner } from "./BulkBanner.tsx";
import { BulkDialog } from "./BulkDialog.tsx";
import {
  selectionBody,
  useBulkProgress,
  useSelectionSum,
  type BulkAction,
  type BulkReport,
  type Selection,
} from "./bulk.ts";
import "./transactions.css";

export type TransactionsTab = "list" | "review" | "pairs";

/** How long the search waits after the last key before it asks the server. */
const SEARCH_DELAY_MS = 300;
const FORMS = ["one", "few", "many", "other"] as const;

/** A counted phrase in the interface language: «1 транзакція за найближчим курсом», «без 2 записів: немає курсу». */
function counted(t: Translate, locale: Locale, base: string, count: number): string {
  const rule = new Intl.PluralRules(formatLocaleOf(locale)).select(count);
  const form = (FORMS as readonly string[]).includes(rule) ? rule : "other";
  return t(`${base}.${form}` as MessageKey, { count });
}

/**
 * S-046 «Гроші → Транзакції» (FIN-03@PoC FR 13, FR 21, FR 25; DAT-01@PoC; canvas PocMoneyTx, PocMoneyTxEmpty,
 * PocMoneyTxLoading, PocMoneyTxError, PocMoneyTxNoResults, «Тексти» PocMoneyTxTexts): the header with «Імпортувати
 * виписку», «Історія імпорту» and «Нова транзакція»; the tabs «Транзакції» · «До розбору · N» · «Пари · N»; the list
 * toolbar, the totals, the table and the pagination. `newTransaction` — `/money/transactions/new`: the form is open.
 */
export function TransactionsPage({
  tab = "list",
  newTransaction = false,
}: {
  tab?: TransactionsTab;
  newTransaction?: boolean;
}) {
  const t = useT();
  const title = t(TRANSACTIONS.label);
  useDocumentTitle(title);
  const [adding, setAdding] = useState(newTransaction);
  const [created, setCreated] = useState(0);
  const counts = useTabCounts();
  const close = () => {
    setAdding(false);
    if (newTransaction) window.location.replace(hrefFor(TRANSACTIONS.path));
  };
  // FR 25, AC16: an empty queue shows the name only; «Пари · N» the same way.
  const tabs: PageTab[] = [
    { id: "list", label: t("tx.tab.list"), href: hrefFor(TRANSACTIONS.path) },
    {
      id: "review",
      label: counts.review ? t("tx.tab.reviewCount", { count: counts.review }) : t("tx.tab.review"),
      href: hrefFor(childPath("review")),
    },
    {
      id: "pairs",
      label: counts.pairs ? t("tx.tab.pairsCount", { count: counts.pairs }) : t("tx.tab.pairs"),
      href: hrefFor(childPath("pairs")),
    },
  ];
  return (
    <AppLayout sectionId="money" pageId={TRANSACTIONS.id}>
      <div className="app-page-head">
        <h1>{title}</h1>
        <div className="app-page-actions">
          <RulesMenu />
          <Button
            variant="primary"
            icon="upload"
            label={t("action.importStatement")}
            href={hrefFor(IMPORT_WIZARD_PATH)}
          />
          <a className="app-quiet-link" href={hrefFor(childPath("importHistory"))}>
            {t("action.importHistory")}
          </a>
          <Button label={t("newTx.title")} onClick={() => setAdding(true)} />
        </div>
      </div>
      <PageTabs label={t("tx.tabs")} tabs={tabs} selected={tab} panelId="tx-panel">
        {tab === "list" ? (
          <TransactionsList key={created} onAdd={() => setAdding(true)} />
        ) : tab === "review" ? (
          <ReviewQueue />
        ) : (
          <EmptyState icon={TRANSACTIONS.icon} />
        )}
      </PageTabs>
      <NewTransactionDialog open={adding} onClose={close} onCreated={() => setCreated((n) => n + 1)} />
    </AppLayout>
  );
}

function TransactionsList({ onAdd }: { onAdd: () => void }) {
  const { t, locale } = useI18n();
  // DAT-01@PoC FR 7, AC1: page, size, sort and search come back with the list; the scroll position once the rows are.
  const [shown, setShown] = useState(false);
  const [view, setView] = useRestoredListState<ListView>("transactions", DEFAULT_VIEW, {
    ready: shown,
    valid: isListView,
  });
  const { state, refreshing, retry, refresh } = useTransactionsPage(view);
  if (state.kind === "ready" && !shown) setShown(true);
  const ready0 = state.kind === "ready" ? state.data : null;

  // DAT-03@PoC FR 1: the selection; it is cleared when the conditions of the list change (search, filters, sort) —
  // not on another page — and after an action ran.
  const conditions = JSON.stringify([view.search, view.filters, view.sort]);
  const [picked, setPicked] = useState<{ key: string; value: Selection | null }>({
    key: conditions,
    value: null,
  });
  const selection = picked.key === conditions ? picked.value : null;
  const select = (value: Selection | null) => setPicked({ key: conditions, value });
  const headCheck = useRef<HTMLInputElement>(null);
  const [dialog, setDialog] = useState<BulkAction | null>(null);
  const onFinished = useCallback(() => refresh(), [refresh]);
  const progress = useBulkProgress(onFinished);
  const sum = useSelectionSum(selection, ready0?.summary ?? null, t, locale);
  const [query, setQuery] = useState(view.search);
  const rowsRef = useRef<HTMLDivElement>(null);
  const choices = useFilterChoices();

  // FIN-03@PoC FR 33: a link with `?account=` or `?merchant=` opens the list with that one filter, from page 1 (set
  // while rendering, so no request goes out for the stored view first); the query is then dropped from the address
  // so that «назад» and a reload come back to the list as the user left it.
  const [linked, setLinked] = useState(() => filtersFromHash(window.location.hash));
  if (linked) {
    setLinked(null);
    setQuery("");
    setView((v) => ({ ...v, page: 1, search: "", filters: linked }));
  }
  useEffect(() => {
    if (filtersFromHash(window.location.hash))
      window.history.replaceState(window.history.state, "", hrefFor(TRANSACTIONS.path));
  }, []);

  // The search asks the server once typing stops, from the first page (DAT-01@PoC FR 5).
  useEffect(() => {
    if (query === view.search) return;
    const timer = window.setTimeout(
      () => setView((v) => ({ ...v, search: query, page: 1 })),
      SEARCH_DELAY_MS,
    );
    return () => window.clearTimeout(timer);
  }, [query, view.search, setView]);

  if (state.kind === "off") return <EmptyState icon={TRANSACTIONS.icon} />;
  if (state.kind === "error") return <ListError supportId={state.supportId} retry={retry} />;
  const ready = state.kind === "ready" ? state.data : null;
  const filtered = activeCount(view.filters) > 0;
  // FIN-03@PoC AC19: a space without transactions shows the empty state, without the toolbar.
  if (ready && ready.count === 0 && view.search === "" && !filtered && !refreshing)
    return <ListEmpty onAdd={onAdd} />;

  // DAT-03@PoC FR 1, CMP-73: ticked rows, or «усі за фільтром» less the rows unticked by hand.
  const isSelected = (id: string) =>
    selection === null
      ? false
      : selection.kind === "ids"
        ? selection.ids.has(id)
        : !selection.excluded.has(id);
  const count =
    selection === null
      ? 0
      : selection.kind === "ids"
        ? selection.ids.size
        : Math.max(0, (ready?.count ?? 0) - selection.excluded.size);
  const pageChecked = !!ready && ready.rows.length > 0 && ready.rows.every((r) => isSelected(r.item.id));
  const tick = (rows: readonly ListRow[], on: boolean) => {
    if (selection?.kind === "filter") {
      const excluded = new Set(selection.excluded);
      for (const r of rows) {
        if (on) excluded.delete(r.item.id);
        else excluded.add(r.item.id);
      }
      select((ready?.count ?? 0) - excluded.size > 0 ? { kind: "filter", excluded } : null);
      return;
    }
    const ids = new Map(selection?.ids ?? []);
    for (const r of rows) {
      if (on) ids.set(r.item.id, nameOf(r));
      else ids.delete(r.item.id);
    }
    select(ids.size > 0 ? { kind: "ids", ids } : null);
  };
  const names = new Map([
    ...(ready?.rows.map((r) => [r.item.id, nameOf(r)] as const) ?? []),
    ...(selection?.kind === "ids" ? selection.ids : []),
  ]);

  // «Скинути фільтри» (FIN-03@PoC «Стани інтерфейсу»): the search and every filter.
  const resetAll = () => {
    setQuery("");
    setView((v) => ({ ...v, search: "", filters: NO_FILTERS, page: 1 }));
  };
  // CMP-60@PoC «Стани», GRID-02@PoC FR 11: «Параметри» has one item, «Показати оригінальні валюти», which needs a
  // converted amount per row from the server; until the list returns one, the item and so the button are not shown.
  const toolbar = (
    <ListToolbar
      label={t("tx.toolbar")}
      status={
        ready && (view.search !== "" || filtered) ? counted(t, locale, "tx.found", ready.count) : undefined
      }
    >
      <Field
        label={t("tx.search.label")}
        labelHidden
        type="search"
        size="search"
        value={query}
        onChange={setQuery}
        placeholder={t("tx.search.placeholder")}
        maxLength={SEARCH_MAX_LENGTH}
        prefix={<Icon name="search" size={16} />}
      />
      <TransactionFilters
        filters={view.filters}
        onChange={(filters) => setView((v) => ({ ...v, filters, page: 1 }))}
        accounts={choices.accounts}
        tags={choices.tags}
        names={choices.names}
      />
    </ListToolbar>
  );

  return (
    <section className="tx-list" aria-busy={refreshing || undefined}>
      {toolbar}
      {!ready ? (
        <div className="ws-card tx-table">
          <Skeleton variant="row" lines={8} />
        </div>
      ) : ready.count === 0 ? (
        <NoResults query={view.search} onReset={resetAll} />
      ) : (
        <>
          <Totals summary={ready.summary} />
          {progress.tracked ? (
            <BulkBanner
              tracked={progress.tracked}
              failed={progress.failed}
              reload={progress.reload}
              now={Date.now}
              onChanged={refresh}
            />
          ) : null}
          {count > 0 ? (
            <SelectionBar
              count={count}
              sum={sum}
              filterCount={ready.count}
              allSelected={selection?.kind === "filter"}
              excluded={selection?.kind === "filter" ? selection.excluded.size : 0}
              busy={progress.tracked?.report?.status === "running"}
              actions={(["setCategory", "addTags", "confirmCategory"] as const).map((a) => ({
                id: a,
                label: t(`bulk.action.${a}`),
                icon: a === "confirmCategory" ? "check" : "tag",
                onSelect: () => setDialog(a),
              }))}
              onSelectAll={pageChecked ? () => select({ kind: "filter", excluded: new Set() }) : undefined}
              onSelectPage={() =>
                select({ kind: "ids", ids: new Map(ready.rows.map((r) => [r.item.id, nameOf(r)])) })
              }
              onClear={() => {
                select(null);
                headCheck.current?.focus();
              }}
            />
          ) : null}
          <div className="ws-card tx-table" ref={rowsRef}>
            <TransactionTableHead
              withAsset={false}
              sort={view.sort}
              sortable={SORTABLE}
              onSort={(column) => setView((v) => ({ ...v, sort: nextSort(v.sort, column), page: 1 }))}
              selectPage={{
                checked: pageChecked,
                label: t("bulk.selectPage"),
                onChange: (on) => tick(ready.rows, on),
              }}
              selectPageRef={headCheck}
            />
            {ready.rows.map((row) => (
              <Row
                key={row.item.id}
                row={row}
                selected={isSelected(row.item.id)}
                onSelectedChange={(on) => tick([row], on)}
              />
            ))}
          </div>
          <BulkDialog
            key={dialog ?? ""}
            action={dialog}
            count={count}
            selection={selectionBody(selection ?? { kind: "ids", ids: new Map() }, listFilter(view))}
            names={names}
            onClose={() => setDialog(null)}
            onStarted={(report: BulkReport) => {
              setDialog(null);
              select(null);
              if (report.status !== "running") refresh();
            }}
          />
          <Pagination
            className="tx-pagination"
            page={view.page}
            pageSize={view.pageSize}
            recordCount={ready.count}
            loading={refreshing}
            onChange={(next) => setView((v) => ({ ...v, ...next }))}
            firstRow={() => rowsRef.current?.querySelector<HTMLElement>(".ws-row-open") ?? null}
          />
        </>
      )}
    </section>
  );
}

/** The row's name as the list shows it, for the examples of «Що станеться». */
const nameOf = (row: ListRow) => row.item.counterparty ?? "—";

function Row({
  row,
  selected,
  onSelectedChange,
}: {
  row: ListRow;
  selected: boolean;
  onSelectedChange: (selected: boolean) => void;
}) {
  const { t, locale } = useI18n();
  const { item } = row;
  const time = timeOf(locale, item.recordedAt);
  return (
    <TransactionRow
      layout="table"
      selected={selected}
      onSelectedChange={onSelectedChange}
      withAsset={false}
      merchant={item.counterparty ?? t("accountCard.tx.noCounterparty")}
      date={item.date}
      time={time}
      category={row.category}
      account={row.account}
      amount={{ value: item.amount.amount, currency: item.amount.currency }}
      pending={item.status === "pending"}
      transfer={item.transfer !== null}
      split={item.split ? (item.split.mode === "months" ? item.split.parts.length : true) : undefined}
      tags={item.tags.map((tag) => tag.name)}
      note={item.note !== null && item.note !== ""}
      href={hrefFor(transactionPath(item.id))}
    />
  );
}

/** The time under the date: when the transaction was recorded, in the browser's time zone («09:14»). */
function timeOf(locale: Locale, instant: string): string | undefined {
  const at = new Date(instant);
  if (Number.isNaN(at.getTime())) return undefined;
  return new Intl.DateTimeFormat(formatLocaleOf(locale), { hour: "2-digit", minute: "2-digit" }).format(at);
}

/**
 * The totals above the table (FIN-03@PoC FR 13, DAT-01@PoC FR 12): «Надходження», «Списання» and «Різниця» in the
 * profile currency at the official rate of each transaction's date; «приблизно» and the count of nearest-rate
 * transactions, or «без N записів: немає курсу» with the partial total; no total at all when no record has a rate.
 */
function Totals({ summary }: { summary: ListSummary }) {
  const { t, locale } = useI18n();
  const parts: { key: string; label: MessageKey; total: SummaryTotal }[] = [
    { key: "income", label: "tx.summary.income", total: summary.income },
    { key: "expense", label: "tx.summary.expense", total: summary.expense },
    { key: "difference", label: "tx.summary.difference", total: summary.difference },
  ];
  const marks: string[] = [];
  const all = summary.difference;
  if (all.approximate) marks.push(t("tx.summary.approximate"));
  if (all.nearestRateCount > 0) marks.push(counted(t, locale, "tx.summary.nearest", all.nearestRateCount));
  if (all.noRateCount > 0) marks.push(counted(t, locale, "tx.summary.noRate", all.noRateCount));
  return (
    <div className="tx-totals" role="group" aria-label={t("tx.summary.label")}>
      {parts.map((p) => (
        <span key={p.key} className="tx-total">
          <span className="ws-muted">{t(p.label)}</span>{" "}
          <span className="ws-tabular tx-total-amount">
            {p.total.total
              ? formatMoney(locale, p.total.total.amount, p.total.total.currency, { signed: true })
              : "—"}
          </span>
        </span>
      ))}
      {all.converted ? (
        <span className="ws-muted">{t("tx.summary.converted", { currency: summary.currency })}</span>
      ) : null}
      {marks.length > 0 ? <span className="tx-total-marks">{marks.join(" · ")}</span> : null}
    </div>
  );
}

/**
 * BUD-14@PoC FR 4: «…» → «Правила категорій» (S-197); the item shows the number of rules. Not shown while the function
 * is switched off for the space.
 */
function RulesMenu() {
  const t = useT();
  const count = useRuleCount();
  if (count === "off") return null;
  return (
    <MenuButton
      menuLabel={t("rules.menu.label")}
      ariaLabel={t("rules.menu.label")}
      title={t("rules.menu.label")}
      placement="down"
      align="end"
      className="ws-icon-button"
      items={[
        {
          id: "rules",
          label: count === null ? t("rules.menu.item") : t("rules.menu.itemCount", { count }),
          icon: "list",
          href: hrefFor(childPath("rules")),
        },
      ]}
    >
      <Icon name="more" size={20} inButton />
    </MenuButton>
  );
}

/** FIN-03@PoC AC19: «Транзакцій ще немає» with «Імпортувати виписку» and «Додати вручну». */
function ListEmpty({ onAdd }: { onAdd: () => void }) {
  const t = useT();
  return (
    <section className="ws-card tx-state" aria-labelledby="tx-empty-title">
      <Icon name="transactions" size={40} tone="muted" />
      <h2 id="tx-empty-title" className="ws-text-heading-3">
        {t("tx.empty.title")}
      </h2>
      <p className="ws-muted">{t("tx.empty.body")}</p>
      <div className="app-page-actions">
        <Button icon="upload" label={t("action.importStatement")} href={hrefFor(IMPORT_WIZARD_PATH)} />
        <Button label={t("tx.empty.add")} onClick={onAdd} />
      </div>
    </section>
  );
}

/** «Нічого не знайдено» and «Скинути фільтри» (FIN-03@PoC «Стани інтерфейсу», DAT-01@PoC «Стани інтерфейсу»). */
function NoResults({ query, onReset }: { query: string; onReset: () => void }) {
  const t = useT();
  return (
    <section className="ws-card tx-state" aria-labelledby="tx-none-title">
      <Icon name="search" size={40} tone="muted" />
      <h2 id="tx-none-title" className="ws-text-heading-3">
        {t("tx.noResults.title")}
      </h2>
      <p className="ws-muted">{query ? t("tx.noResults.search", { query }) : t("tx.noResults.filters")}</p>
      <Button label={t("tx.noResults.reset")} onClick={onReset} />
    </section>
  );
}

/** «✕ Помилка», what failed, «Спробувати ще раз» and «Код: …» (canvas PocMoneyTxError, PocStates). */
function ListError({ supportId, retry }: { supportId: string | undefined; retry: () => void }) {
  const t = useT();
  return (
    <section className="ws-card tx-state" role="alert">
      <p className="tx-error-title">{t("tx.error.title")}</p>
      <p>{t("tx.error.body")}</p>
      <Button label={t("tx.error.retry")} onClick={retry} />
      {supportId ? <p className="ws-muted">{t("tx.error.code", { code: supportId })}</p> : null}
    </section>
  );
}
