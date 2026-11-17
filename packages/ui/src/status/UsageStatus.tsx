import { formatPercent, useI18n } from "@willowsum/i18n";
import type { CSSProperties } from "react";
import { almostPercent, overLevel, usageFill, usagePercent, usageState } from "./rules.ts";
import { StatusMark } from "./StatusMark.tsx";

export interface UsageStatusProps {
  /** Spent and the limit in the same unit; the limit is above zero. */
  spent: number;
  limit: number;
  /** A category with the attribute «обов'язкова»: a spent limit is «ліміт вичерпано» (grey), not «вичерпано». */
  mandatory?: boolean;
  /** The sum of the limits of the optional categories of the period; the overspend level is its share. */
  optionalLimits?: number;
  /** The overspend of an exceeded limit (spent − limit) is calculated; this shows it in the tooltip text. */
  overTip?: string;
  className?: string;
}

/**
 * DS-23@PoC family А «Шкала використання ліміту»: a 6 px pill bar on `surface-300` and under it the state's marker
 * and word (and «N %» for «майже вичерпано»), then the second smaller line «N % ліміту» (the remainder) or «N % понад ліміт» (the overspend), a whole
 * percent of the limit. The fill is the gradient `usage-0` … `usage-95` at the percent; an optional
 * category that is spent exactly is `over-1`; an overspend is a full bar and a tail past it, a shade `over-1` …
 * `over-8` by the share of the overspend in the optional limits. The gradient and the shades paint the bar only,
 * never the marker, the word or the sum. A mandatory category at its limit is grey (`ink-muted`).
 */
export function UsageStatus({
  spent,
  limit,
  mandatory = false,
  optionalLimits = 0,
  overTip,
  className,
}: UsageStatusProps) {
  const { t, locale } = useI18n();
  const state = usageState(spent, limit, mandatory);
  const percent = usagePercent(spent, limit);
  const level = state === "over" ? overLevel(spent - limit, optionalLimits) : undefined;
  // The second line: the remainder as a share of the limit, or the overspend as a share of the limit (whole percent).
  const wholePercent = formatPercent(locale, String(Math.round(Math.abs(100 - percent))));
  const fillWidth = `${Math.min(100, Math.max(0, percent))}%`;
  const fillColor =
    state === "over"
      ? `var(--ws-over-${level})`
      : state === "exhausted"
        ? "var(--ws-over-1)"
        : state === "limitReached"
          ? "var(--ws-ink-muted)"
          : usageFill(percent);
  const fill: CSSProperties = { inlineSize: fillWidth, backgroundColor: fillColor };
  const tail: CSSProperties | undefined = level
    ? { inlineSize: `calc(var(--ws-space-1) * ${level})`, backgroundColor: `var(--ws-over-${level})` }
    : undefined;
  const sub =
    state === "over"
      ? t("status.usage.overLimit", { percent: wholePercent })
      : t("status.usage.ofLimit", { percent: wholePercent });
  return (
    <div
      className={["ws-usage", className].filter(Boolean).join(" ")}
      data-state={state}
      data-level={level}
      title={state === "over" ? overTip : undefined}
    >
      <div
        className="ws-usage-track"
        aria-hidden="true"
        data-empty={state === "notStarted" ? "true" : undefined}
      >
        {state === "notStarted" ? null : <span className="ws-usage-fill" style={fill} />}
        {tail ? <span className="ws-usage-tail" style={tail} /> : null}
      </div>
      <StatusMark
        id={`a.${state}`}
        params={
          state === "almost"
            ? { percent: formatPercent(locale, String(almostPercent(spent, limit))) }
            : undefined
        }
      />
      <span className="ws-usage-sub">{sub}</span>
    </div>
  );
}
