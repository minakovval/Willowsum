import {
  formatDelta,
  formatMoney,
  keepNumbersTogether,
  speakMoney,
  useI18n,
  type DeltaInput,
  type Locale,
  type Translate,
} from "@willowsum/i18n";
import { useLayoutEffect, useState, type ReactNode, type Ref, type RefObject } from "react";
import { useHideAmounts } from "../privacy/HideAmounts.tsx";
import { FitAmount } from "../amount/FitAmount.tsx";
import { formatCompactAmount } from "../amount/compact.ts";
import { useTooltip } from "../tooltip/Tooltip.tsx";

/** An amount as the rows take it: a decimal string with its own sign («-180000.00») and an ISO 4217 code. */
export interface RowMoney {
  value: string;
  currency: string;
}

/** What opening the row does: a link to the record, or a handler (a button). */
export interface RowOpen {
  href?: string | undefined;
  onOpen?: (() => void) | undefined;
}

/**
 * The amount for the screen reader, DS-04 item 10 («мінус 180 000 євро»); «Сума прихована» while amounts are
 * hidden (DS-18): the real value is never in the name then.
 */
export function spokenRowAmount(locale: Locale, t: Translate, hidden: boolean, amount: RowMoney): string {
  return hidden ? t("amount.hidden") : speakMoney(locale, amount.value, amount.currency);
}

/**
 * The change for the screen reader («знизилось на 0,8 %»). While amounts are hidden its money part is left out
 * (DS-18 item 4), as `Delta` does; a change that is only money is then «Сума прихована».
 */
export function spokenDelta(locale: Locale, t: Translate, hidden: boolean, delta: DeltaInput): string {
  if (!hidden) return formatDelta(locale, delta).label;
  const rest: DeltaInput = { ...delta };
  delete rest.amount;
  return rest.percent === undefined && rest.points === undefined
    ? t("amount.hidden")
    : formatDelta(locale, rest).label;
}

/**
 * The money part of a row (CMP-27, CMP-28): formatted by the shared helpers (no number arithmetic), at most 45 %
 * of the row, abbreviated by `FitAmount` when it does not fit. It sits above the row's open area, so a hidden
 * amount can still be revealed (DS-18) while the rest of the area opens the record.
 */
export function RowAmount({ amount, children }: { amount: RowMoney; children?: ReactNode }) {
  const { locale } = useI18n();
  const { hidden } = useHideAmounts();
  const full = formatMoney(locale, amount.value, amount.currency);
  const compact = formatCompactAmount({ value: amount.value, currency: amount.currency, locale });
  return (
    <span className="ws-row-money">
      <span className="ws-row-money-main">
        {/* The box the fit is measured against must not shrink with the shrunk amount (it would never grow back), so an
            invisible copy of the full value keeps its width; while amounts are hidden the value is not in the DOM. */}
        {!hidden && (
          <span className="ws-row-money-sizer ws-text-amount-s ws-tabular" aria-hidden="true">
            {keepNumbersTogether(full)}
          </span>
        )}
        <FitAmount value={full} compact={compact} size="amount-s" />
      </span>
      {children}
    </span>
  );
}

/** True while one of the elements' text is cut off with an ellipsis (re-measured when they are resized). */
export function useIsCut(refs: readonly RefObject<HTMLElement | null>[], key: string): boolean {
  const [cut, setCut] = useState(false);
  useLayoutEffect(() => {
    const nodes = refs.map((r) => r.current).filter((n): n is HTMLElement => n !== null);
    const measure = () => setCut(nodes.some((n) => n.scrollWidth > n.clientWidth + 0.5));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    nodes.forEach((n) => ro.observe(n));
    return () => ro.disconnect();
    // The refs are stable objects; the key says when the text changed.
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return cut;
}

/**
 * The whole-row link or button (CMP-27 «Клавіатура і екранний читач»). Its `::after` covers the row, so a click
 * anywhere opens the record; the actions and the checkbox sit above it. The accessible name is `label`: one
 * sentence with everything the row shows. The CMP-25 tooltip carries the full text, only while a line is cut.
 */
export function RowOpenArea({
  open,
  label,
  tip,
  tipEnabled,
  children,
}: {
  open: RowOpen;
  label: string;
  tip: string;
  tipEnabled: boolean;
  children: ReactNode;
}) {
  const { triggerProps, tooltip } = useTooltip(tip, tipEnabled);
  const shared = { ...triggerProps, className: "ws-row-open", "aria-label": label };
  return (
    <>
      {open.href ? (
        <a {...shared} href={open.href} onClick={open.onOpen ? () => open.onOpen?.() : undefined}>
          {children}
        </a>
      ) : (
        <button {...shared} type="button" onClick={() => open.onOpen?.()}>
          {children}
        </button>
      )}
      {tooltip}
    </>
  );
}

/** The selection checkbox of the bulk-action mode (CMP-27 «Вибраний»); its name says which record. */
export function RowCheckbox({
  checked,
  label,
  onChange,
  ref,
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
  ref?: Ref<HTMLInputElement> | undefined;
}) {
  return (
    <input
      ref={ref}
      type="checkbox"
      className="ws-row-check"
      checked={checked}
      aria-label={label}
      onChange={(e) => onChange(e.target.checked)}
    />
  );
}
