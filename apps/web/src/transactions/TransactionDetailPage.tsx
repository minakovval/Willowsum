import { useId, useState } from "react";
import {
  formatDate,
  formatLocaleOf,
  formatMoney,
  speakMoney,
  useI18n,
  useT,
  type Locale,
  type MessageKey,
} from "@willowsum/i18n";
import {
  Amount,
  Badge,
  Button,
  ConfirmDialog,
  Icon,
  IconButton,
  MenuButton,
  merchantInitials,
  Skeleton,
  Tooltip,
  type MenuItem,
  type TransactionCategory,
} from "@willowsum/ui";
import { useAuthApi } from "../auth/api.ts";
import { AppLayout } from "../pages/AppLayout.tsx";
import { NotFoundPage } from "../pages/NotFoundPage.tsx";
import {
  rootOf,
  SECTIONS,
  TRANSACTIONS,
  transactionHistoryPath,
  transactionIdOf,
} from "../routing/routes.ts";
import { hrefFor, useHashPath } from "../routing/useHashPath.ts";
import { useDocumentTitle } from "../useDocumentTitle.ts";
import { ChangeRuleDialog } from "../rules/ChangeRuleDialog.tsx";
import { splitAction } from "./api.ts";
import { AttributeRows, SplitRow } from "./DetailAttributes.tsx";
import {
  loadDetail,
  runAction,
  useLoaded,
  type CategorySource,
  type DetailAction,
  type DetailData,
  type TransactionDetail,
} from "./detail.ts";
import { filteredTransactionsPath } from "./filters.ts";
import { BankDescriptionRow, StatementFacts } from "./StatementFacts.tsx";
import { ManualPairDialog } from "./ManualPairDialog.tsx";
import { TransferDifference } from "./TransferDifference.tsx";
import { OneOffSwitch } from "./OneOffSwitch.tsx";
import { SplitDialog } from "./SplitDialog.tsx";
import "./transactionDetail.css";

const SOURCE_KEYS: Readonly<Record<Exclude<CategorySource, "none">, MessageKey>> = {
  manual: "txDetail.source.manual",
  rule: "txDetail.source.rule",
  merchant: "txDetail.source.merchant",
  bank: "txDetail.source.bank",
  dictionary: "txDetail.source.dictionary",
};

/**
 * S-047 «Деталь транзакції» (FIN-03@PoC FR 11, FR 16, FR 18, FR 20, FR 27; canvas PocMoneyTxDetail,
 * PocMoneyTxDetailNoReceipt; «Тексти» PocMoneyTxDetailTexts) at `/money/transactions/:id`, opened from a row of S-046
 * and from «Нова транзакція» (S-048). The heading: initials, the counterparty, «дата, час · рахунок · стан», the
 * marks and the amount, the menu «…» and «✕» back to the list; then «Категорія» with its source and «Опис». A
 * transaction of another space, or one deleted, is «Не знайдено» (FIN-03@PoC AC12).
 */
export function TransactionDetailPage() {
  const transactionId = transactionIdOf(useHashPath()) ?? "";
  // Another transaction is a fresh page: nothing of the previous one stays on screen while the next one loads.
  return <Detail key={transactionId} transactionId={transactionId} />;
}

function Detail({ transactionId }: { transactionId: string }) {
  const t = useT();
  const { state, retry, update } = useLoaded(transactionId, loadDetail);
  const ready = state.kind === "ready" ? state.data : null;
  const title = ready ? counterpartyOf(t, ready) : t("page.transaction");
  useDocumentTitle(title);
  if (state.kind === "missing") return <NotFoundPage />;
  return (
    <AppLayout sectionId="money" pageId={TRANSACTIONS.id}>
      <Crumbs current={title} />
      {state.kind === "loading" ? (
        <section className="ws-card txd">
          <h1 className="ws-text-heading-2 txd-name">{title}</h1>
          <Skeleton variant="row" lines={4} />
        </section>
      ) : state.kind === "error" ? (
        <section className="ws-card txd">
          <h1 className="ws-text-heading-2 txd-name">{title}</h1>
          <LoadError body={t("txDetail.error.body")} supportId={state.supportId} retry={retry} />
        </section>
      ) : (
        <Card
          data={state.data}
          reload={retry}
          replace={(transaction) => update((d) => ({ ...d, transaction }))}
        />
      )}
    </AppLayout>
  );
}

export const counterpartyOf = (t: ReturnType<typeof useT>, d: DetailData) =>
  d.transaction.counterparty ?? t("accountCard.tx.noCounterparty");

/** UX-09@PoC item 8: «Гроші › Транзакції › <контрагент>»; «Історія змін» adds «› Історія змін» after the counterparty. */
export function Crumbs({
  current,
  trail = [],
}: {
  current: string;
  trail?: { label: string; href: string }[];
}) {
  const t = useT();
  const money = SECTIONS.find((s) => s.id === "money")!;
  return (
    <nav className="ws-breadcrumbs" aria-label={t("shell.breadcrumbs")}>
      <ol>
        <li>
          <a href={hrefFor(rootOf(money).path)}>{t(money.label)}</a>
        </li>
        <li>
          <a href={hrefFor(TRANSACTIONS.path)}>{t(TRANSACTIONS.label)}</a>
        </li>
        {trail.map((c) => (
          <li key={c.href}>
            <a href={c.href}>{c.label}</a>
          </li>
        ))}
        <li aria-current="page">{current}</li>
      </ol>
    </nav>
  );
}

/** «2 лист. 2026 р., 09:14»: the date of the transaction, then the time it was recorded in the browser's time zone. */
function whenOf(locale: Locale, date: string, recordedAt: string): string {
  const day = formatDate(locale, date);
  const at = new Date(recordedAt);
  if (Number.isNaN(at.getTime())) return day;
  const time = new Intl.DateTimeFormat(formatLocaleOf(locale), { hour: "2-digit", minute: "2-digit" }).format(
    at,
  );
  return `${day}, ${time}`;
}

type Open = "none" | "delete" | "split" | "pair";

export function Card({
  data,
  reload,
  replace,
}: {
  data: DetailData;
  reload: () => void;
  /** A saved change answers with the transaction: it replaces the shown one in place (focus stays). */
  replace: (t: TransactionDetail) => void;
}) {
  const { t, locale } = useI18n();
  const api = useAuthApi();
  const titleId = useId();
  const [open, setOpen] = useState<Open>("none");
  const [busy, setBusy] = useState(false);
  const [ruleOpen, setRuleOpen] = useState(false);
  const [failure, setFailure] = useState<{ supportId?: string } | null>(null);
  const tx = data.transaction;
  const merchant = counterpartyOf(t, data);
  const amount = tx.amount;
  const merged = tx.mergedDuplicates.length > 0;

  const act = async (action: DetailAction) => {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    const o = await runAction(api, tx.id, action);
    setBusy(false);
    if (!o.ok) {
      setFailure(o.kind === "problem" && o.supportId ? { supportId: o.supportId } : {});
      return;
    }
    // FIN-03@PoC FR 16, AC10: a deleted transaction is gone; the list is where the user goes back to.
    if (action === "delete") window.location.assign(hrefFor(TRANSACTIONS.path));
    else if (action === "unsplit") replace(o.data as TransactionDetail);
    else reload();
  };

  const line = [
    whenOf(locale, tx.date, tx.recordedAt),
    data.account,
    t(tx.status === "pending" ? "newTx.status.pending" : "newTx.status.posted"),
  ]
    .filter(Boolean)
    .join(" · ");
  const marks: { label: string; tone: "info" | "attention" | "neutral" }[] = [];
  if (tx.hidden) marks.push({ label: t("txDetail.hidden"), tone: "neutral" });
  if (data.possibleDuplicate) marks.push({ label: t("transactionRow.possibleDuplicate"), tone: "attention" });
  if (tx.transfer) marks.push({ label: t("transactionRow.transfer"), tone: "neutral" });
  if (merged) marks.push({ label: t("txDetail.merged"), tone: "neutral" });
  // BUD-13@PoC FR 8, FIN-03@PoC FR 23: «розділено» / «розділено на N міс.», as in the row of the list.
  if (tx.split)
    marks.push({
      label:
        tx.split.mode === "months"
          ? t("transactionRow.splitMonths", { count: tx.split.parts.length })
          : t("transactionRow.split"),
      tone: "neutral",
    });
  // A merged duplicate keeps its attributes; a side of a transfer is never split (BUD-13@PoC edge case 6).
  const attributesLocked = tx.mergedInto !== null;
  const canSplit = !attributesLocked && tx.transfer === null;
  // BUD-06@PoC FR 8: only an expense that is no side of a transfer, and only while `transactions.one-off` is on.
  const oneOffShown = data.oneOffOn && tx.type === "expense" && tx.transfer === null;
  const similar = tx.counterparty ? hrefFor(filteredTransactionsPath({ merchant: tx.counterparty })) : null;

  return (
    <section className="ws-card txd" aria-labelledby={titleId}>
      <div className="txd-head">
        <span className="ws-tx-logo" aria-hidden="true">
          {merchantInitials(merchant)}
        </span>
        <div className="txd-title">
          <h1 id={titleId} className="ws-text-heading-2 txd-name">
            {merchant}
          </h1>
          <p className="ws-muted">{line}</p>
          {marks.length > 0 ? (
            <p className="txd-marks">
              {marks.map((m) => (
                <Badge key={m.label} label={m.label} tone={m.tone} />
              ))}
            </p>
          ) : null}
        </div>
        <p className="txd-amount">
          <Amount
            value={formatMoney(locale, amount.amount, amount.currency)}
            spoken={speakMoney(locale, amount.amount, amount.currency)}
          />
        </p>
        <MoreMenu
          data={data}
          onDelete={() => {
            // A failed hide stays the page's own error; the confirmation opens clean.
            setFailure(null);
            setOpen("delete");
          }}
          onAction={(a) => void act(a)}
          onPair={() => {
            setFailure(null);
            setOpen("pair");
          }}
        />
        <Tooltip text={t("shell.close")}>
          <a className="ws-icon-button" href={hrefFor(TRANSACTIONS.path)} aria-label={t("shell.close")}>
            <Icon name="close" size={20} inButton />
          </a>
        </Tooltip>
      </div>
      {failure && open === "none" ? (
        <div className="txd-error" role="alert">
          <p className="txd-error-title">{t("tx.error.title")}</p>
          <p>{t("txDetail.action.error")}</p>
          {failure.supportId ? (
            <p className="ws-muted">{t("tx.error.code", { code: failure.supportId })}</p>
          ) : null}
        </div>
      ) : null}
      <dl className="txd-facts">
        <div>
          <dt>{t("newTx.category")}</dt>
          <dd>
            <CategoryChip category={data.category} />
            {data.categorySource !== "none" ? (
              <span className="ws-muted">{t(SOURCE_KEYS[data.categorySource])}</span>
            ) : null}
            {/* BUD-14@PoC FR 13: the pencil opens the rule of this merchant, or a new one with the merchant filled in. */}
            <IconButton icon="edit" label={t("rules.edit")} onClick={() => setRuleOpen(true)} />
          </dd>
        </div>
        {tx.description ? (
          <div>
            <dt>{t("newTx.description")}</dt>
            <dd>{tx.description}</dd>
          </div>
        ) : null}
        <BankDescriptionRow transaction={tx} />
        <AttributeRows transaction={tx} locked={attributesLocked} onSaved={replace} />
        {tx.split ? (
          <SplitRow
            split={tx.split}
            names={data.names}
            action={
              canSplit ? (
                <Button
                  label={t("txDetail.unsplit")}
                  size="sm"
                  variant="quiet"
                  onClick={() => void act("unsplit")}
                />
              ) : null
            }
          />
        ) : null}
      </dl>
      <TransferDifference transaction={tx} />
      <StatementFacts transaction={tx} />
      {oneOffShown ? <OneOffSwitch transaction={tx} onSaved={replace} /> : null}
      {canSplit || similar ? (
        // BUD-13@PoC FR 1, FR 10: «Розділити» and «Схожі транзакції» (canvas PocMoneyTxDetail).
        <div className="txd-actions txd-attr-actions">
          {canSplit ? (
            <Button
              label={t("tx.split.open")}
              onClick={() => {
                setFailure(null);
                setOpen("split");
              }}
            />
          ) : null}
          {similar ? <Button label={t("txDetail.similar")} icon="search" href={similar} /> : null}
        </div>
      ) : null}
      {ruleOpen ? <ChangeRuleDialog transactionId={tx.id} onClose={() => setRuleOpen(false)} /> : null}
      {open === "split" ? (
        <SplitDialog
          transaction={tx}
          summary={[
            merchant,
            formatMoney(locale, amount.amount, amount.currency),
            formatDate(locale, tx.date),
            data.account,
          ]
            .filter(Boolean)
            .join(" · ")}
          categories={data.splitCategories}
          onSave={splitAction(api, tx.id)}
          onSaved={(saved) => {
            setOpen("none");
            replace(saved);
          }}
          onClose={() => setOpen("none")}
        />
      ) : null}
      {open === "pair" ? (
        <ManualPairDialog
          transaction={tx}
          onPaired={(saved) => {
            setOpen("none");
            replace(saved);
          }}
          onClose={() => setOpen("none")}
        />
      ) : null}
      {merged ? (
        // FIN-03@PoC FR 11: the merged record has «Об'єднано» and the action «Роз'єднати» (edge case 4).
        <div className="txd-actions">
          <Button label={t("txDetail.unmerge")} onClick={() => void act("unmerge")} />
        </div>
      ) : null}
      <ConfirmDialog
        open={open === "delete"}
        onClose={() => {
          setOpen("none");
          setFailure(null);
        }}
        title={t("txDetail.delete.title")}
        text={t("txDetail.delete.text")}
        closeLabel={t("shell.close")}
        cancelLabel={t("newTx.cancel")}
        confirmLabel={t("txDetail.delete.confirm")}
        busyLabel={t("txDetail.delete.busy")}
        busy={busy}
        error={
          failure ? (
            <span>
              {/* CMP-21@PoC «Стани»: a failed action inside the dialog starts with «Помилка». */}
              <strong>{t("field.error.word")}</strong> {t("txDetail.action.error")}
              {failure.supportId ? ` ${t("tx.error.code", { code: failure.supportId })}` : ""}
            </span>
          ) : undefined
        }
        onConfirm={() => void act("delete")}
      />
    </section>
  );
}

/**
 * «…» «Ще дії» (FIN-03@PoC FR 27; canvas PocMoneyTxDetail): «Приховати транзакцію» only for a «Можливий дубль» that is
 * no side of a transfer (FR 18) — «Показати транзакцію» once hidden (FR 16); «Історія змін»; «Видалити» for a transaction
 * entered by hand, last, after a separator — not while duplicates are merged into it (the server refuses with
 * `TRANSACTION_MERGED`; «Роз'єднати» comes first). «Історія змін» opens its own page (CMP-21@PoC). «Позначити як переказ» (IMP-03@PoC FR 24: a free transaction only) opens the list of
 * candidates; «Об'єднати з іншою» comes with its screen: the menu shows no item that does nothing (PR body).
 */
function MoreMenu({
  data,
  onDelete,
  onAction,
  onPair,
}: {
  data: DetailData;
  onDelete: () => void;
  onAction: (action: DetailAction) => void;
  onPair: () => void;
}) {
  const t = useT();
  const tx = data.transaction;
  const items: MenuItem[] = [];
  if (tx.hidden && tx.mergedInto === null)
    items.push({ id: "show", label: t("txDetail.menu.show"), icon: "eye", onSelect: () => onAction("show") });
  else if (!tx.hidden && data.possibleDuplicate && tx.transfer === null)
    items.push({
      id: "hide",
      label: t("txDetail.menu.hide"),
      icon: "eye-off",
      onSelect: () => onAction("hide"),
    });
  // IMP-03@PoC FR 24: «Позначити як переказ» — a free transaction only (no pair, not hidden, not merged).
  if (!tx.hidden && tx.transfer === null && tx.mergedInto === null)
    items.push({ id: "pair", label: t("txDetail.menu.pair"), icon: "share", onSelect: onPair });
  items.push({
    id: "history",
    label: t("txDetail.menu.history"),
    icon: "list",
    href: hrefFor(transactionHistoryPath(tx.id)),
  });
  if (tx.source === "manual" && tx.mergedDuplicates.length === 0)
    items.push({
      id: "delete",
      label: t("txDetail.menu.delete"),
      icon: "trash",
      danger: true,
      onSelect: onDelete,
    });
  return (
    <MenuButton
      menuLabel={t("txDetail.more")}
      ariaLabel={t("txDetail.more")}
      title={t("txDetail.more")}
      placement="down"
      align="end"
      className="ws-icon-button"
      items={items}
    >
      <Icon name="more" size={20} inButton />
    </MenuButton>
  );
}

/** The category as the list shows it (CMP-28): the icon on its coloured circle; «Без категорії» — a dashed chip. */
function CategoryChip({ category }: { category: TransactionCategory | null }) {
  const t = useT();
  if (!category)
    return <span className="ws-tx-category ws-tx-category-none">{t("transactionRow.uncategorized")}</span>;
  return (
    <span className="ws-tx-category">
      <span className="ws-tx-category-dot" data-tone={category.tone ?? "transfer"} aria-hidden="true">
        <Icon name={category.icon ?? "other"} size={16} />
      </span>
      <span className="ws-tx-category-name">{category.name}</span>
    </span>
  );
}

/** «✕ Помилка», what failed, «Спробувати ще раз» and «Код: …» (canvas PocStates). */
export function LoadError({
  body,
  supportId,
  retry,
}: {
  body: string;
  supportId: string | undefined;
  retry: () => void;
}) {
  const t = useT();
  return (
    <div className="txd-state" role="alert">
      <p className="txd-error-title">{t("tx.error.title")}</p>
      <p>{body}</p>
      <Button label={t("tx.error.retry")} onClick={retry} />
      {supportId ? <p className="ws-muted">{t("tx.error.code", { code: supportId })}</p> : null}
    </div>
  );
}
