import { formatDate, useI18n, type MessageKey } from "@willowsum/i18n";
import { useEffect, useRef, useState, type Ref } from "react";
import { Badge, type BadgeTone } from "../badge/Badge.tsx";
import { Button } from "../button/Button.tsx";
import { Icon, type IconName } from "../icons/Icon.tsx";
import { IconButton } from "../icons/IconButton.tsx";
import { useHideAmounts } from "../privacy/HideAmounts.tsx";
import { Skeleton } from "../skeleton/Skeleton.tsx";
import { useTooltip } from "../tooltip/Tooltip.tsx";
import {
  RowAmount,
  RowCheckbox,
  RowOpenArea,
  spokenRowAmount,
  useIsCut,
  type RowMoney,
  type RowOpen,
} from "./rowParts.tsx";

/** The category of a transaction: its name, an icon on a coloured circle (chart palette tone 1–8, or the service «Переказ»). */
export interface TransactionCategory {
  name: string;
  icon?: IconName | undefined;
  tone?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | "transfer" | undefined;
}

export interface TransactionRowProps extends RowOpen {
  /** The merchant's name, one line; the initials on a grey tile come from it (there are no logos in PoC). */
  merchant: string;
  /** The calendar date, `YYYY-MM-DD`. */
  date: string;
  /** `null` or nothing: the dashed «Без категорії» chip, without an icon. */
  category?: TransactionCategory | null | undefined;
  /** A decimal string with its sign: spending «-42.90» (shown with a real minus), income «2400.00» (no sign). */
  amount: RowMoney;
  /** Needs review: a 6 px left stripe, the «! Перевірити» badge instead of the category, «Підтвердити» and «Змінити категорію». */
  review?: boolean | undefined;
  /** The bank authorised but did not post the operation; the amount may change. */
  pending?: boolean | undefined;
  possibleDuplicate?: boolean | undefined;
  /** A transfer between own accounts. */
  transfer?: boolean | undefined;
  /** Split: `true`, or the number of months it is split into («розділено на 3 міс.»). */
  split?: boolean | number | undefined;
  /** Tags: an icon whose tooltip lists them. */
  tags?: readonly string[] | undefined;
  /** Has a note: an icon. */
  note?: boolean | undefined;
  /** «Підтвердити»: the button is busy until the returned promise settles; the consumer removes the row after the server confirmed. */
  onConfirm?: (() => unknown) | undefined;
  onChangeCategory?: (() => void) | undefined;
  /** «Об’єднати» of a possible duplicate. */
  onMerge?: (() => void) | undefined;
  /** `list` (a list and the «До розбору» queue) or `table` (the columns of the transactions table). */
  layout?: "list" | "table" | undefined;
  /** Table columns «Актив», «Рахунок» and the time under the date. */
  asset?: string | undefined;
  /** The table has the «Актив» column (CMP-28); the list «Транзакції» of FIN-03@PoC FR 13 has none. */
  withAsset?: boolean | undefined;
  account?: string | undefined;
  time?: string | undefined;
  /** The table's selection checkbox. */
  selected?: boolean | undefined;
  onSelectedChange?: ((selected: boolean) => void) | undefined;
  loading?: boolean | undefined;
}

/** «Сільпо» → «С», «ФОП Іваненко» → «ФІ»: the first letters of the first two words. */
export function merchantInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => Array.from(w)[0]?.toUpperCase() ?? "")
    .join("");
}

function CategoryChip({ category }: { category: TransactionCategory | null | undefined }) {
  const { t } = useI18n();
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

/** The «тег» mark: its tooltip lists the tags (CMP-28 «Будова»); the tags are also in the row's accessible name. */
function TagsMark({ tags }: { tags: readonly string[] }) {
  const { t } = useI18n();
  const { triggerProps, tooltip } = useTooltip(t("transactionRow.tags", { tags: tags.join(", ") }));
  return (
    <>
      <span {...triggerProps} className="ws-tx-mark">
        <Icon name="tag" size={16} />
      </span>
      {tooltip}
    </>
  );
}

/**
 * CMP-28@PoC TransactionRow, a variant of ListRow (CMP-27): the row of a list of transactions and of the «До розбору»
 * queue. Initials of the merchant on a grey tile; the merchant with its marks (tags, note, «Очікує», «Можливий
 * дубль», «розділено», «переказ» — no others); date and category under it; the amount on the right. A row that needs
 * review has a 6 px left stripe, the «! Перевірити» badge and two actions. The whole row opens the record; the
 * actions are separate controls inside it. Spending shows a real minus, income no sign; colour never carries it.
 */
export function TransactionRow({
  merchant,
  date,
  category,
  amount,
  review = false,
  pending = false,
  possibleDuplicate = false,
  transfer = false,
  split,
  tags,
  note = false,
  onConfirm,
  onChangeCategory,
  onMerge,
  layout = "list",
  asset,
  withAsset = true,
  account,
  time,
  selected = false,
  onSelectedChange,
  loading = false,
  href,
  onOpen,
}: TransactionRowProps) {
  const { t, locale } = useI18n();
  const { hidden } = useHideAmounts();
  const merchantRef = useRef<HTMLSpanElement>(null);
  const cut = useIsCut([merchantRef], merchant);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  if (loading)
    return (
      <div className={`ws-tx-row ws-tx-row-${layout} ws-tx-row-loading`}>
        <Skeleton variant="row" lines={1} />
      </div>
    );

  const table = layout === "table";
  const when = formatDate(locale, date);
  const tagList = tags?.length ? tags : undefined;
  const splitLabel =
    typeof split === "number"
      ? t("transactionRow.splitMonths", { count: split })
      : split
        ? t("transactionRow.split")
        : "";
  // The marks beside the merchant, in the card's order; no others (CMP-28 «Будова»).
  const marks: { text: string; tone: BadgeTone }[] = [];
  if (pending) marks.push({ text: t("transactionRow.pending"), tone: "info" });
  if (possibleDuplicate) marks.push({ text: t("transactionRow.possibleDuplicate"), tone: "attention" });
  if (split) marks.push({ text: splitLabel, tone: "neutral" });
  if (transfer) marks.push({ text: t("transactionRow.transfer"), tone: "neutral" });

  const name = [
    merchant,
    when,
    table && time,
    category?.name ?? t("transactionRow.uncategorized"),
    table && withAsset && asset,
    table && account,
    spokenRowAmount(locale, t, hidden, amount),
    review && t("transactionRow.needsReview"),
    ...marks.map((m) => m.text),
    tagList && t("transactionRow.tags", { tags: tagList.join(", ") }),
    note && t("transactionRow.note"),
  ]
    .filter(Boolean)
    .join(", ");

  const confirm = () => {
    if (busy || !onConfirm) return;
    setBusy(true);
    // The row stays until the server confirmed: the consumer removes it after this promise settles. A failure is the
    // consumer's to show («✕ Помилка»); the row only ends its busy state and stays.
    void Promise.resolve()
      .then(onConfirm)
      .catch(() => undefined)
      .finally(() => {
        if (mounted.current) setBusy(false);
      });
  };

  const classes = [
    "ws-tx-row",
    `ws-tx-row-${layout}`,
    table && !withAsset && "ws-tx-row-noasset",
    review && "ws-tx-row-review",
    selected && "ws-list-row-selected",
  ]
    .filter(Boolean)
    .join(" ");

  const headline = (
    <span className="ws-row-text" aria-hidden="true">
      <span className="ws-row-headline">
        <span ref={merchantRef} className="ws-row-title">
          {merchant}
        </span>
        {tagList && <TagsMark tags={tagList} />}
        {note && (
          <span className="ws-tx-mark">
            <Icon name="note" size={16} />
          </span>
        )}
        {marks.map((m) => (
          <Badge key={m.text} label={m.text} tone={m.tone} />
        ))}
      </span>
      {!table && (
        <span className="ws-row-meta ws-tx-meta">
          <span>{when}</span>
          {review ? (
            <Badge label={t("transactionRow.review")} tone="attention" />
          ) : (
            <CategoryChip category={category} />
          )}
        </span>
      )}
    </span>
  );

  const open = (
    <RowOpenArea open={{ href, onOpen }} label={name} tip={merchant} tipEnabled={cut}>
      {headline}
    </RowOpenArea>
  );
  const tile = (
    <span className="ws-tx-logo" aria-hidden="true">
      {merchantInitials(merchant)}
    </span>
  );
  const check = onSelectedChange && (
    <RowCheckbox
      checked={selected}
      label={t("transactionRow.select", { name: merchant })}
      onChange={onSelectedChange}
    />
  );

  if (table)
    return (
      <div className={classes}>
        {check}
        <span className="ws-tx-who">
          {tile}
          {open}
        </span>
        <span className="ws-tx-cell">
          {review ? (
            <Badge label={t("transactionRow.review")} tone="attention" />
          ) : (
            <CategoryChip category={category} />
          )}
        </span>
        {withAsset && <span className="ws-tx-cell ws-tx-cell-text">{asset ?? "—"}</span>}
        <span className="ws-tx-cell ws-tx-cell-text">{account ?? "—"}</span>
        <span className="ws-tx-cell ws-tx-when">
          <span>{when}</span>
          {time && <span className="ws-muted">{time}</span>}
        </span>
        <RowAmount amount={amount} />
      </div>
    );

  return (
    <div className={classes}>
      {check}
      {tile}
      {open}
      {(review || possibleDuplicate) && (
        <span className="ws-tx-actions">
          {review && onConfirm && (
            <Button
              variant="secondary"
              size="sm"
              icon="check"
              label={t("transactionRow.confirm")}
              loading={busy}
              onClick={confirm}
            />
          )}
          {review && onChangeCategory && (
            <IconButton icon="edit" label={t("transactionRow.changeCategory")} onClick={onChangeCategory} />
          )}
          {possibleDuplicate && onMerge && (
            <Button variant="secondary" size="sm" label={t("transactionRow.merge")} onClick={onMerge} />
          )}
        </span>
      )}
      <RowAmount amount={amount} />
    </div>
  );
}

/** A column of the transactions table. */
export type TransactionColumn = "merchant" | "category" | "asset" | "account" | "when" | "amount";
/** The sort of the table: its column and direction. */
export interface TransactionSort {
  column: TransactionColumn;
  direction: "asc" | "desc";
}

const COLUMN_LABEL: Record<TransactionColumn, MessageKey> = {
  merchant: "transactionRow.col.merchant",
  category: "transactionRow.col.category",
  asset: "transactionRow.col.asset",
  account: "transactionRow.col.account",
  when: "transactionRow.col.when",
  amount: "transactionRow.col.amount",
};
const SORT_TITLE: Record<TransactionColumn, MessageKey> = {
  merchant: "transactionRow.sortBy.merchant",
  category: "transactionRow.sortBy.category",
  asset: "transactionRow.sortBy.asset",
  account: "transactionRow.sortBy.account",
  when: "transactionRow.sortBy.when",
  amount: "transactionRow.sortBy.amount",
};

/**
 * The header of the transactions table (CMP-28 «Адаптивність»): «Контрагент», «Категорія», «Актив», «Рахунок»,
 * «Дата і час», «Сума» — the date is never first; `withAsset={false}` leaves «Актив» out (FIN-03@PoC FR 13).
 * Without `onSort` it is decorative: every row names its own cells. With `onSort` (DAT-01@PoC FR 3) each column of
 * `sortable` is a button: a press sorts by it, the next press turns the direction; the active column is highlighted
 * with the arrow of its direction (also said in words), the other sortable ones have the grey double arrow.
 */
export function TransactionTableHead({
  selectable = false,
  selectPage,
  selectPageRef,
  withAsset = true,
  sort,
  sortable = [],
  onSort,
}: {
  selectable?: boolean;
  /**
   * DAT-03@PoC FR 1: «Вибрати сторінку» — the header checkbox of the selection mode (`label` is its name). Replaces
   * the empty `selectable` cell.
   */
  selectPage?: { checked: boolean; label: string; onChange: (checked: boolean) => void } | undefined;
  /** The header checkbox itself, for the focus after «Зняти вибір». */
  selectPageRef?: Ref<HTMLInputElement> | undefined;
  withAsset?: boolean;
  sort?: TransactionSort | undefined;
  sortable?: readonly TransactionColumn[];
  onSort?: ((column: TransactionColumn) => void) | undefined;
}) {
  const { t } = useI18n();
  const columns: TransactionColumn[] = ["merchant", "category", "asset", "account", "when", "amount"];
  const shown = columns.filter((c) => withAsset || c !== "asset");
  const head = (column: TransactionColumn) => {
    const label = t(COLUMN_LABEL[column]);
    if (!onSort || !sortable.includes(column))
      return <span aria-hidden={onSort ? true : undefined}>{label}</span>;
    const active = sort?.column === column ? sort.direction : undefined;
    return (
      <button
        type="button"
        className="ws-tx-sort"
        data-sort={active ?? "none"}
        title={t(SORT_TITLE[column])}
        onClick={() => onSort(column)}
      >
        <span>{label}</span>
        <Icon
          name={active === "asc" ? "chevron-up" : active === "desc" ? "chevron-down" : "sort"}
          size={16}
          inButton
        />
        {active && (
          <span className="ws-visually-hidden">
            {`, ${t(active === "asc" ? "transactionRow.sorted.asc" : "transactionRow.sorted.desc")}`}
          </span>
        )}
      </button>
    );
  };
  return (
    <div
      className={`ws-tx-row ws-tx-row-table ws-tx-head ws-text-label ws-muted${withAsset ? "" : " ws-tx-row-noasset"}${
        onSort ? " ws-tx-head-sortable" : ""
      }`}
      aria-hidden={onSort ? undefined : true}
    >
      {selectPage ? (
        <RowCheckbox
          ref={selectPageRef}
          checked={selectPage.checked}
          label={selectPage.label}
          onChange={selectPage.onChange}
        />
      ) : (
        selectable && <span className="ws-row-check-spacer" />
      )}
      {shown.map((column) => (
        <span key={column} className={column === "amount" ? "ws-tx-head-amount" : undefined}>
          {head(column)}
        </span>
      ))}
    </div>
  );
}

/**
 * The polite live region of a queue (CMP-28 AC4): after the server confirmed a row and the consumer removed it, it
 * says «Підтверджено. Лишилось 11». Keep it mounted outside the rows; `remaining` null says nothing.
 */
export function ReviewAnnouncement({ remaining }: { remaining: number | null }) {
  const { t } = useI18n();
  return (
    <span role="status" className="ws-visually-hidden">
      {remaining === null ? "" : t("transactionRow.confirmed", { count: remaining })}
    </span>
  );
}
