import { useI18n, type DeltaInput } from "@willowsum/i18n";
import { useRef, type ReactNode } from "react";
import { Delta } from "../amount/Delta.tsx";
import { Badge, type BadgeTone } from "../badge/Badge.tsx";
import { useHideAmounts } from "../privacy/HideAmounts.tsx";
import { Skeleton } from "../skeleton/Skeleton.tsx";
import {
  RowAmount,
  RowCheckbox,
  RowOpenArea,
  spokenDelta,
  spokenRowAmount,
  useIsCut,
  type RowMoney,
  type RowOpen,
} from "./rowParts.tsx";

export interface ListRowProps extends RowOpen {
  /** The record's name: one line, cut with an ellipsis. */
  title: string;
  /** One line of detail under the name («monobank · EUR · оновлено 12 хв тому»). */
  meta?: string | undefined;
  /** The amount; a debt carries its own minus in `value` («-180000.00»). Colour never carries the sign. */
  amount?: RowMoney | undefined;
  /** At most one change under the amount (CMP-08). */
  delta?: DeltaInput | undefined;
  /** The status next to the name; `label` is already translated. */
  badge?: { label: string; tone: BadgeTone } | undefined;
  /** An optional start element: a 24 px icon, a 48 px thumbnail or an avatar. Decorative. */
  leading?: ReactNode;
  /** The record is archived: the name in `ink-muted` and a «Архів» badge in the `neutral` tone. */
  archived?: boolean | undefined;
  /** Bulk-action mode: with `onSelectedChange` the row starts with a checkbox; `selected` fills it and the row. */
  selected?: boolean | undefined;
  onSelectedChange?: ((selected: boolean) => void) | undefined;
  /** The skeleton in the shape of a row (CMP-22) instead of the content. */
  loading?: boolean | undefined;
  className?: string | undefined;
}

/**
 * CMP-27@PoC ListRow: one record in a list — name, one line of detail, a status badge and the amount with an
 * optional change under it. The whole row is one link or button that opens the record (Tab, Enter); its accessible
 * name is one sentence: name, detail, status, amount, change. At least 56 px high. Money goes through the shared
 * helpers (`formatMoney`, `speakMoney`) on decimal strings.
 */
export function ListRow({
  title,
  meta,
  amount,
  delta,
  badge,
  leading,
  archived = false,
  selected = false,
  onSelectedChange,
  loading = false,
  href,
  onOpen,
  className,
}: ListRowProps) {
  const { t, locale } = useI18n();
  const { hidden } = useHideAmounts();
  const titleRef = useRef<HTMLSpanElement>(null);
  const metaRef = useRef<HTMLSpanElement>(null);
  const cut = useIsCut([titleRef, metaRef], `${title}|${meta ?? ""}`);

  if (loading)
    return (
      <div className={["ws-list-row", "ws-list-row-loading", className].filter(Boolean).join(" ")}>
        <Skeleton variant="row" lines={1} leading="circle" />
      </div>
    );

  const status = archived ? { label: t("listRow.archived"), tone: "neutral" as const } : badge;
  const name = [
    title,
    meta,
    status?.label,
    amount && spokenRowAmount(locale, t, hidden, amount),
    delta && spokenDelta(locale, t, hidden, delta),
  ]
    .filter(Boolean)
    .join(", ");
  const classes = [
    "ws-list-row",
    archived && "ws-list-row-archived",
    selected && "ws-list-row-selected",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes}>
      {onSelectedChange && (
        <RowCheckbox
          checked={selected}
          label={t("listRow.select", { name: title })}
          onChange={onSelectedChange}
        />
      )}
      {leading && (
        <span className="ws-row-leading" aria-hidden="true">
          {leading}
        </span>
      )}
      <RowOpenArea
        open={{ href, onOpen }}
        label={name}
        tip={[cut && title, cut && meta].filter(Boolean).join(" · ") || title}
        tipEnabled={cut}
      >
        <span className="ws-row-text" aria-hidden="true">
          <span className="ws-row-headline">
            <span ref={titleRef} className="ws-row-title">
              {title}
            </span>
            {status && <Badge label={status.label} tone={status.tone} />}
          </span>
          {meta && (
            <span ref={metaRef} className="ws-row-meta">
              {meta}
            </span>
          )}
        </span>
      </RowOpenArea>
      {amount && (
        <RowAmount amount={amount}>
          {delta && (
            <span className="ws-row-delta">
              <Delta {...delta} />
            </span>
          )}
        </RowAmount>
      )}
    </div>
  );
}
