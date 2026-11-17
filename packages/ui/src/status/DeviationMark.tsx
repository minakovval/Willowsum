import { useI18n } from "@willowsum/i18n";
import { deviation } from "./rules.ts";
import { StatusMark } from "./StatusMark.tsx";

export interface DeviationMarkProps {
  /** The value and the base it is compared with (plan, average, previous period), in the same unit. */
  value: number;
  base: number;
  /** Spending and debt: less is better; income: more is better. */
  kind: "expense" | "income";
  /** The change as the caller formats it («50,20 €»). */
  amount: string;
  /** The change spoken in full (DS-04: «50 євро 20 центів»). */
  spokenAmount?: string;
  className?: string;
}

/**
 * DS-23@PoC family Б: «▲ 50,20 €» / «▼ …» in `gain` / `loss` (saturated above 10 %, `gain-soft` / `loss-soft` up
 * to 10 % inclusive of the rounded percent) or «— …» in `brand` when the change is below 1 % and 1 currency unit.
 * The colour says «краще» or «гірше», the arrow says the direction; the state word is in the accessible name.
 */
export function DeviationMark({ value, base, kind, amount, spokenAmount, className }: DeviationMarkProps) {
  const { t } = useI18n();
  const d = deviation(value, base, kind);
  const word = t(`status.b.${d.state}`);
  const direction =
    d.arrow === "▲" ? t("status.deviation.up") : d.arrow === "▼" ? t("status.deviation.down") : "";
  const spoken = [word, direction, spokenAmount ?? amount].filter(Boolean).join(", ");
  return (
    <span
      className={["ws-deviation ws-tabular", className].filter(Boolean).join(" ")}
      data-state={d.state}
      title={word}
    >
      <StatusMark id={`b.${d.state}`} arrow={d.arrow ?? undefined} spokenText={spoken} markerOnly />
      {d.state === "unchanged" ? null : (
        <span className="ws-deviation-amount" aria-hidden="true" data-ink={ink(d.state)}>
          {amount}
        </span>
      )}
    </span>
  );
}

const ink = (state: string) =>
  state === "better"
    ? "gain"
    : state === "slightlyBetter"
      ? "gain-soft"
      : state === "worse"
        ? "loss"
        : "loss-soft";
