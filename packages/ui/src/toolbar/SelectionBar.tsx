import { formatMoney, useI18n } from "@willowsum/i18n";
import { Icon } from "../icons/Icon.tsx";
import { IconButton } from "../icons/IconButton.tsx";
import { MenuButton, type MenuItem } from "../shell/MenuButton.tsx";
import { Tooltip } from "../tooltip/Tooltip.tsx";
import { ListToolbar } from "./ListToolbar.tsx";

/** «· Сума ±X €» of the selection: the exact sum in the reporting currency, or `null` while there is none. */
export interface SelectionSum {
  readonly amount: { readonly value: string; readonly currency: string } | null;
  /** A record was converted at the nearest available rate: the sum is marked «приблизно». */
  readonly approximate?: boolean | undefined;
  /** The hint of the sum: «2 транзакції конвертовано», «1 транзакція за найближчим курсом». */
  readonly hint?: string | undefined;
  /** The sum is being recounted: the previous value is muted, «Оновлюється…». */
  readonly updating?: boolean | undefined;
}

export interface SelectionBarProps {
  /** How many records are selected (with «усі за фільтром» — the filter's count without the unticked ones). */
  count: number;
  sum?: SelectionSum | undefined;
  /** The number of records by the filter, when the whole page is ticked and there are more: «Вибрати всі M за фільтром». */
  filterCount?: number | undefined;
  /** «Усі за фільтром» is selected. */
  allSelected?: boolean | undefined;
  /** How many rows were unticked after «усі за фільтром»: the text becomes «Вибрано M − K за фільтром». */
  excluded?: number | undefined;
  /** The list's bulk actions; a dangerous one goes last (`danger`). */
  actions: readonly MenuItem[];
  /** A bulk action runs in the background: «Дії з вибраними» is inactive with the reason as its hint. */
  busy?: boolean | undefined;
  onSelectAll?: (() => void) | undefined;
  onSelectPage?: (() => void) | undefined;
  /** «×» «Зняти вибір»: the consumer clears the selection and returns focus to the header checkbox. */
  onClear: () => void;
}

/**
 * CMP-73@PoC SelectionBar — the panel of the selection mode of a list: «Вибрано N · Сума ±X €», «Вибрати всі M за
 * фільтром» / «Вибрати лише сторінку», one «Дії з вибраними ˅» with the list's actions, and «×». Shown only while
 * something is selected (the consumer renders it then; nothing is reserved). A named toolbar: ← → move between its
 * controls; every change of the selection is announced politely («Вибрано 3 · Сума −52,30 €»).
 */
export function SelectionBar({
  count,
  sum,
  filterCount,
  allSelected = false,
  excluded = 0,
  actions,
  busy = false,
  onSelectAll,
  onSelectPage,
  onClear,
}: SelectionBarProps) {
  const { t, locale } = useI18n();
  const counted = allSelected
    ? excluded > 0
      ? t("selection.byFilter", { count })
      : t("selection.allByFilter", { count })
    : t("selection.count", { count });
  const money = sum?.amount
    ? formatMoney(locale, sum.amount.value, sum.amount.currency, { signed: true })
    : null;
  const sumText =
    money === null ? null : t(sum?.approximate ? "selection.sumApprox" : "selection.sum", { amount: money });
  const announce = sumText === null ? counted : `${counted} · ${sumText}`;

  const sumNode =
    sumText === null ? null : (
      <span className={sum?.updating ? "ws-selection-sum ws-selection-sum-updating" : "ws-selection-sum"}>
        {"· "}
        {sum?.hint ? (
          <Tooltip text={sum.hint}>
            <span className="ws-tabular" tabIndex={0} data-toolbar-item="">
              {sumText}
            </span>
          </Tooltip>
        ) : (
          <span className="ws-tabular">{sumText}</span>
        )}
        {sum?.updating ? <span className="ws-selection-updating">{t("selection.updating")}</span> : null}
      </span>
    );

  const actionsLabel = (
    <>
      <span>{t("selection.actions")}</span>
      <Icon name="chevron-down" size={16} inButton />
    </>
  );

  return (
    <ListToolbar
      label={t("selection.label")}
      className="ws-selection-bar ws-surface-brand"
      status={announce}
      end={
        <>
          {busy ? (
            <Tooltip text={t("selection.busy")}>
              <button type="button" className="ws-selection-actions" aria-disabled="true">
                {actionsLabel}
              </button>
            </Tooltip>
          ) : (
            <MenuButton
              menuLabel={t("selection.actions")}
              items={actions}
              placement="down"
              align="end"
              className="ws-selection-actions"
            >
              {actionsLabel}
            </MenuButton>
          )}
          <IconButton
            icon="close"
            label={t("selection.clear")}
            className="ws-selection-clear"
            onClick={onClear}
          />
        </>
      }
    >
      <span className="ws-selection-count">{counted}</span>
      {sumNode}
      {allSelected && onSelectPage ? (
        <button type="button" className="ws-selection-link" onClick={onSelectPage}>
          {t("selection.selectPage")}
        </button>
      ) : !allSelected && filterCount !== undefined && filterCount > count && onSelectAll ? (
        <button type="button" className="ws-selection-link" onClick={onSelectAll}>
          {t("selection.selectAll", { count: filterCount })}
        </button>
      ) : null}
    </ListToolbar>
  );
}
