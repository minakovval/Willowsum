import { useEffect, useRef, useState } from "react";
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
  Skeleton,
  TransactionRow,
  TransactionTableHead,
  useRestoredListState,
  type PageTab,
} from "@willowsum/ui";
import { AppLayout } from "../pages/AppLayout.tsx";
import { EmptyState } from "../pages/SectionPage.tsx";
import { childPath, IMPORT_WIZARD_PATH, TRANSACTIONS, transactionPath } from "../routing/routes.ts";
import { hrefFor } from "../routing/useHashPath.ts";
import { useDocumentTitle } from "../useDocumentTitle.ts";
import {
  DEFAULT_VIEW,
  nextSort,
  SORTABLE,
  useTabCounts,
  useTransactionsPage,
  type ListRow,
  type ListSummary,
  type ListView,
  type SummaryTotal,
} from "./list.ts";
import { NewTransactionDialog } from "./NewTransactionDialog.tsx";
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
  const [view, setView] = useRestoredListState<ListView>("transactions", DEFAULT_VIEW, { ready: shown });
  const { state, refreshing, retry } = useTransactionsPage(view);
  if (state.kind === "ready" && !shown) setShown(true);
  const [query, setQuery] = useState(view.search);
  const [originals, setOriginals] = useState(false);
  const rowsRef = useRef<HTMLDivElement>(null);

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
  // FIN-03@PoC AC19: a space without transactions shows the empty state, without the toolbar.
  if (ready && ready.count === 0 && view.search === "" && !refreshing) return <ListEmpty onAdd={onAdd} />;

  const resetSearch = () => {
    setQuery("");
    setView((v) => ({ ...v, search: "", page: 1 }));
  };
  const toolbar = (
    <ListToolbar
      label={t("tx.toolbar")}
      status={ready && view.search !== "" ? counted(t, locale, "tx.found", ready.count) : undefined}
      end={
        <MenuButton
          menuLabel={t("tx.options")}
          ariaLabel={t("tx.options")}
          title={t("tx.options")}
          placement="down"
          align="end"
          className="ws-icon-button"
          items={[
            {
              id: "originals",
              label: t("tx.options.originalCurrencies"),
              icon: "money",
              checked: originals,
              onSelect: () => setOriginals((v) => !v),
            },
          ]}
        >
          <Icon name="options" size={20} inButton />
        </MenuButton>
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
        prefix={<Icon name="search" size={16} />}
      />
    </ListToolbar>
  );

  return (
    <section className="tx-list" aria-busy={refreshing || undefined}>
      {toolbar}
      {originals ? (
        <p className="tx-note ws-muted" role="status">
          {t("tx.options.originalNote")}
        </p>
      ) : null}
      {!ready ? (
        <div className="ws-card tx-table">
          <Skeleton variant="row" lines={8} />
        </div>
      ) : ready.count === 0 ? (
        <NoResults query={view.search} onReset={resetSearch} />
      ) : (
        <>
          <Totals summary={ready.summary} />
          <div className="ws-card tx-table" ref={rowsRef}>
            <TransactionTableHead
              withAsset={false}
              sort={view.sort}
              sortable={SORTABLE}
              onSort={(column) => setView((v) => ({ ...v, sort: nextSort(v.sort, column), page: 1 }))}
            />
            {ready.rows.map((row) => (
              <Row key={row.item.id} row={row} />
            ))}
          </div>
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

function Row({ row }: { row: ListRow }) {
  const { t, locale } = useI18n();
  const { item } = row;
  const time = timeOf(locale, item.recordedAt);
  return (
    <TransactionRow
      layout="table"
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

/** «Нічого не знайдено» and «Скинути фільтри» (FIN-03@PoC «Стани інтерфейсу»). */
function NoResults({ query, onReset }: { query: string; onReset: () => void }) {
  const t = useT();
  return (
    <section className="ws-card tx-state" aria-labelledby="tx-none-title">
      <Icon name="search" size={40} tone="muted" />
      <h2 id="tx-none-title" className="ws-text-heading-3">
        {t("tx.noResults.title")}
      </h2>
      <p className="ws-muted">{t("tx.noResults.search", { query })}</p>
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
