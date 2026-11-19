import { useEffect, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { formatCompactAmount } from "../amount/compact.ts";
import { currencySymbolOf, formatMoney, useI18n, type Locale } from "@willowsum/i18n";
import type { ColorTokenName } from "../tokens/color.ts";
import { EmptyState } from "../states/EmptyState.tsx";
import { ErrorState } from "../states/ErrorState.tsx";
import { Skeleton } from "../skeleton/Skeleton.tsx";
import { compareDecimal, isDecimal, signOf, subDecimal } from "./math.ts";

/** A colour token of the design system; the chart components set no colours of their own (CHT-00 FR 2). */
export type ChartTone = ColorTokenName;
export type MarkerShape = "circle" | "square" | "diamond";
export const toneVar = (tone: ChartTone): string => `var(--ws-${tone})`;

export interface ChartErrorProps {
  /** What failed, instead of the default «Не вдалося побудувати графік». */
  text?: string;
  /** The request id for support («Код: …»). */
  code?: string;
  onRetry: () => void;
}

/** The states every chart of the module has (CHT-00 FR 6, DAT-05): loading, empty and error. */
export interface ChartStateProps {
  /** The skeleton of the chart's own height while the data loads. */
  loading?: boolean;
  /** The error state with «Спробувати ще раз» instead of the chart. */
  error?: ChartErrorProps;
  /** The empty state's title and text, instead of «Ще немає історії». */
  emptyTitle?: string;
  emptyText?: string;
}

/** CHT-00 FR 7: the chart fills the width its container gives; measured, with `fallback` where nothing can be measured. */
export function useChartWidth(ref: RefObject<HTMLElement | null>, fallback = 640): number {
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const w = Math.floor(el.getBoundingClientRect().width);
      if (w > 0) setWidth(w);
    };
    read();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

/** Loading, error or empty instead of `children`; `children` only when the chart can be drawn. */
export function ChartShell({
  height,
  loading,
  error,
  empty,
  emptyTitle,
  emptyText,
  children,
}: ChartStateProps & { height: number; empty: boolean; children: ReactNode }) {
  const { t } = useI18n();
  if (loading) return <Skeleton variant="block" height={height} />;
  if (error)
    return (
      <div className="ws-chart-state" style={{ minHeight: height }}>
        <ErrorState
          placement="block"
          text={error.text ?? t("chart.error.text")}
          code={error.code}
          onRetry={error.onRetry}
        />
      </div>
    );
  if (empty)
    return (
      <div className="ws-chart-state" style={{ minHeight: height }}>
        <EmptyState
          placement="block"
          title={emptyTitle ?? t("chart.empty.title")}
          text={emptyText ?? t("chart.empty.text")}
        />
      </div>
    );
  return <>{children}</>;
}

/** The full value, «3 144,46 €». */
export const money = (locale: Locale, value: string, currency: string): string =>
  formatMoney(locale, value, currency);

/** DS-15, DS-16 FR 2: the abbreviated form from 1 000 (with the full one in the tooltip), the full form below. */
export function shortMoney(
  locale: Locale,
  value: string,
  currency: string,
): { text: string; abbreviated: boolean } {
  const symbol = currencySymbolOf(locale, currency);
  const compact = formatCompactAmount({ value, currency: symbol, locale });
  return compact === null
    ? { text: money(locale, value, currency), abbreviated: false }
    : { text: compact, abbreviated: true };
}

/** A legend or tooltip key: the shape of the series, so the colour is never the only sign (NFR-08 FR 4). */
export function Swatch({
  kind,
  tone,
  hatched = false,
  dash,
  marker = "circle",
}: {
  kind: "bar" | "line";
  tone: ChartTone;
  hatched?: boolean;
  dash?: readonly [number, number] | undefined;
  marker?: MarkerShape;
}) {
  const color = toneVar(tone);
  if (kind === "bar")
    return (
      <span
        className={`ws-chart-swatch${hatched ? " ws-chart-swatch--hatched" : ""}`}
        style={{ ["--ws-chart-tone" as string]: color }}
        aria-hidden="true"
      />
    );
  return (
    <svg width="22" height="12" aria-hidden="true" className="ws-chart-swatch-line">
      <line
        x1="0"
        y1="6"
        x2="22"
        y2="6"
        stroke={color}
        strokeWidth="2"
        strokeDasharray={dash ? dash.join(" ") : undefined}
      />
      <MarkerShapeSvg shape={marker} x={11} y={6} size={6} color={color} outline="var(--ws-surface-200)" />
    </svg>
  );
}

/** The marker of a series (circle, square with a 2 px radius, diamond), with an outline in the surface colour. */
export function MarkerShapeSvg({
  shape,
  x,
  y,
  size,
  color,
  outline,
  outlineWidth = 1.5,
}: {
  shape: MarkerShape;
  x: number;
  y: number;
  size: number;
  color: string;
  outline: string;
  outlineWidth?: number;
}) {
  const h = size / 2;
  const common = { fill: color, stroke: outline, strokeWidth: outlineWidth } as const;
  if (shape === "circle") return <circle cx={x} cy={y} r={h} {...common} />;
  if (shape === "square") return <rect x={x - h} y={y - h} width={size} height={size} rx={2} {...common} />;
  return <path d={`M${x} ${y - h - 1}L${x + h + 1} ${y}L${x} ${y + h + 1}L${x - h - 1} ${y}Z`} {...common} />;
}

export interface TipRow {
  key: string;
  kind: "bar" | "line";
  name: string;
  tone: ChartTone;
  hatched?: boolean;
  dash?: readonly [number, number] | undefined;
  marker?: MarkerShape | undefined;
  value: string | null;
  /** The value of the previous step, for the change. */
  previous: string | null;
  /** Which direction of the change is good: «down» for spending, «up» for income; none — neutral. */
  goodWhen?: "up" | "down" | undefined;
}

/** DS-14/DS-16 item 14: the change as an arrow and an amount without a sign; better or worse as a word and a colour. */
function ChangeCell({ row, currency }: { row: TipRow; currency: string }) {
  const { t, locale } = useI18n();
  if (row.value === null || row.previous === null) return <span className="ws-muted">{t("chart.dash")}</span>;
  const diff = subDecimal(row.value, row.previous);
  const sign = signOf(diff);
  if (sign === 0)
    return (
      <span className="ws-muted" title={t("chart.delta.same")}>
        <span aria-hidden="true">{t("chart.dash")}</span>
        <span className="ws-visually-hidden">{t("chart.delta.same")}</span>
      </span>
    );
  const abs = sign < 0 ? subDecimal("0", diff) : diff;
  const amount = money(locale, abs, currency);
  const up = sign > 0;
  const good = row.goodWhen === undefined ? undefined : (row.goodWhen === "up") === up;
  const tone = good === undefined ? "ws-muted" : good ? "ws-gain" : "ws-loss";
  const word = good === undefined ? "" : ` · ${t(good ? "chart.delta.better" : "chart.delta.worse")}`;
  return (
    <span
      className={tone}
      data-direction={up ? "up" : "down"}
      title={good === undefined ? undefined : t(good ? "chart.delta.better" : "chart.delta.worse")}
    >
      <span aria-hidden="true">{`${up ? "▲" : "▼"} ${amount}`}</span>
      <span className="ws-visually-hidden">{`${t(up ? "chart.delta.up" : "chart.delta.down", { value: amount })}${word}`}</span>
    </span>
  );
}

/** The tooltip table of a step: a title, and a row per series with the value and the change from the previous step. */
export function TipTable({
  id,
  title,
  rows,
  currency,
  withChange,
  style,
  percentOf,
  columns,
}: {
  id: string;
  title: string;
  rows: TipRow[];
  currency: string;
  withChange: boolean;
  style?: CSSProperties;
  percentOf?: ((row: TipRow) => string | null) | undefined;
  /** The heads of the columns: «на <дата>», «Δ м/м», «%» (CMP-42). */
  columns?: { value: string; change: string; percent: string } | undefined;
}) {
  const { t, locale } = useI18n();
  return (
    <div role="tooltip" id={id} className="ws-chart-tip" style={style}>
      <div className="ws-chart-tip-title">{title}</div>
      {columns ? (
        <div className="ws-chart-tip-row ws-chart-tip-head ws-muted">
          <span className="ws-chart-tip-name" />
          <span>{columns.value}</span>
          {withChange ? (
            <span className="ws-chart-tip-change">
              {columns.change}
              {percentOf ? ` · ${columns.percent}` : ""}
            </span>
          ) : null}
        </div>
      ) : null}
      {rows.map((row) => (
        <div className="ws-chart-tip-row" key={row.key}>
          <Swatch
            kind={row.kind}
            tone={row.tone}
            hatched={row.hatched ?? false}
            dash={row.dash}
            marker={row.marker ?? "circle"}
          />
          <span className="ws-chart-tip-name">{row.name}</span>
          <b className="ws-tabular">
            {row.value === null ? t("chart.dash") : money(locale, row.value, currency)}
          </b>
          {withChange ? (
            <span className="ws-chart-tip-change ws-tabular">
              <ChangeCell row={row} currency={currency} />
              {percentOf && percentOf(row) !== null ? (
                <span className="ws-muted">
                  {" "}
                  {percentOf(row)} {t("chart.tooltip.percent")}
                </span>
              ) : null}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export const maxDecimal = (values: readonly string[]): string =>
  values.reduce((best, v) => (compareDecimal(v, best) > 0 ? v : best), values[0] ?? "0");

/** The position of a tooltip inside the chart box: right of the anchor, left when it would run out of the box. */
export function placeTip(
  anchorX: number,
  boxWidth: number,
  tipWidth: number,
  anchorY: number,
  boxHeight: number,
  tipHeight: number,
): { left: number; top: number } {
  const gap = 12;
  const left = anchorX + gap + tipWidth <= boxWidth ? anchorX + gap : Math.max(0, anchorX - gap - tipWidth);
  const top = Math.max(0, Math.min(anchorY, boxHeight - tipHeight));
  return { left, top };
}

/** CHT-00 FR 1: a value that is not a plain decimal string cannot be drawn; the chart shows its error state instead of throwing. */
export const allDecimal = (values: readonly (string | null | undefined)[]): boolean =>
  values.every((v) => v === null || v === undefined || isDecimal(v));

export function InvalidChart({ height }: { height: number }) {
  const { t } = useI18n();
  const [marker = "", ...rest] = t("state.error.title").split(" ");
  return (
    <div className="ws-chart ws-chart-state" role="alert" data-chart="invalid" style={{ minHeight: height }}>
      <p>
        <span aria-hidden="true">{marker} </span>
        {rest.join(" ")} · {t("chart.error.text")}
      </p>
    </div>
  );
}
