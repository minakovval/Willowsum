import { formatDelta, useI18n, type DeltaInput } from "@willowsum/i18n";
import { HIDDEN_AMOUNT, useHideAmounts } from "../privacy/HideAmounts.tsx";

const TONE = { up: "ws-gain", down: "ws-loss", none: "ws-muted" } as const;

/**
 * DS-04 items 4, 14, 16: a change with an arrow and a colour — «▲ 2,4 %» in `gain`, «▼ 2 п. п. м/м» in
 * `loss`, «– 0,0 %» in `ink-muted`; no «+» or «−», the arrow shows the direction. Screen readers hear
 * the accessible name with «зросло», «знизилось» or «без змін» and the amount spoken in full, so the
 * colour is never the only sign. A line may break only after «·» and before the period. While amounts
 * are hidden (DS-18 item 4) the amount part is left out and percentages stay.
 */
export function Delta(props: DeltaInput) {
  const { t, locale } = useI18n();
  const { hidden } = useHideAmounts();
  const { amount, ...rest } = props;
  const shown: DeltaInput = hidden || !amount ? rest : { ...rest, amount };
  if (hidden && shown.percent === undefined && shown.points === undefined)
    return (
      <span className="ws-delta ws-muted">
        <span aria-hidden="true">{HIDDEN_AMOUNT}</span>
        <span className="ws-visually-hidden">{t("amount.hidden")}</span>
      </span>
    );
  const { text, direction, label } = formatDelta(locale, shown);
  return (
    <span className={`ws-delta ws-tabular ${TONE[direction]}`} data-direction={direction}>
      <span aria-hidden="true">{text}</span>
      <span className="ws-visually-hidden">{label}</span>
    </span>
  );
}
