import { useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { formatDate, formatLocaleOf, formatNumber, useI18n, type Locale } from "@willowsum/i18n";
import {
  chooseStep,
  dayNumber,
  niceScale,
  percentChange,
  stepEnd,
  stepStart,
  toNumber,
  type TimeStep,
} from "./math.ts";
import { formatCompactNumber } from "../amount/compact.ts";
import {
  ChartShell,
  InvalidChart,
  MarkerShapeSvg,
  allDecimal,
  Swatch,
  TipTable,
  money,
  placeTip,
  toneVar,
  useChartWidth,
  type ChartStateProps,
  type ChartTone,
  type MarkerShape,
  type TipRow,
} from "./shared.tsx";

export interface LinePoint {
  /** `YYYY-MM-DD`. */
  date: string;
  /** A decimal amount. */
  value: string;
}

export interface LineSeries {
  id: string;
  name: string;
  points: readonly LinePoint[];
  /** `step` (default): the value holds between events and jumps on the date of the next one; `linear`: a straight segment (a price). */
  shape?: "step" | "linear";
  /** Overrides the colour of the style of 1–3 series or the highlighted line of 4 and more. */
  tone?: ChartTone;
  goodWhen?: "up" | "down";
}

/** A mark on the time axis («Взято кредит»); the details are in the tooltip. */
export interface ChartEvent {
  id: string;
  date: string;
  label: string;
  detail?: string;
}

export interface LineChartProps extends ChartStateProps {
  label: string;
  series: readonly LineSeries[];
  currency: string;
  height?: number;
  width?: number;
  /** The area under the first series in `brand-2` at 14 %. */
  area?: boolean;
  /** A goal: a dashed reference line with its label; used for goals only. */
  target?: { value: string; label: string };
  events?: readonly ChartEvent[];
  /** The highlighted line for 4 and more series (the first by default). */
  selectedId?: string;
  onSelect?: (id: string) => void;
}

interface Style {
  tone: ChartTone;
  width: number;
  dash?: readonly [number, number];
  marker: MarkerShape;
}

/** CMP-42: three styles for 1–3 series — solid with a circle, dashed 7 / 5 with a square, dotted 1 / 5 with a diamond. */
const STYLES: readonly Style[] = [
  { tone: "brand-2", width: 2.4, marker: "circle" },
  { tone: "ink-muted", width: 2.4, dash: [7, 5], marker: "square" },
  { tone: "brand", width: 2.4, dash: [1, 5], marker: "diamond" },
];
const PAD = { top: 16, right: 64, bottom: 28, left: 12 } as const;
const INSET = 12;
const WIDE = 520;
const LEGEND_WIDTH = 220;
const DOTS_UP_TO = 60;

interface Bucket {
  end: string;
  x: number;
}

function stepTitle(locale: Locale, step: TimeStep, end: string, t: (k: never, p?: never) => string): string {
  const fmt = (options: Intl.DateTimeFormatOptions, date: string) =>
    new Intl.DateTimeFormat(formatLocaleOf(locale), { ...options, timeZone: "UTC" })
      .format(new Date(`${date}T00:00:00Z`))
      .replace(/\s*р\.$/, "");
  const cap = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
  const tr = t as unknown as (k: string, p?: Record<string, string>) => string;
  switch (step) {
    case "event":
      return formatDate(locale, end);
    case "day":
      return fmt({ day: "numeric", month: "long", year: "numeric" }, end);
    case "week": {
      const start = stepStart(end, "week");
      return tr("chart.step.week", {
        from: fmt(
          { day: "numeric", month: start.slice(5, 7) === end.slice(5, 7) ? undefined : "long" },
          start,
        ),
        to: fmt({ day: "numeric", month: "long", year: "numeric" }, end),
      });
    }
    case "month":
      return cap(fmt({ month: "long", year: "numeric" }, end));
    case "quarter":
      return tr("chart.step.quarter", {
        quarter: String(Math.floor((Number(end.slice(5, 7)) - 1) / 3) + 1),
        year: end.slice(0, 4),
      });
    case "year":
      return end.slice(0, 4);
  }
}

/** «16 серпня» (uk), «16 August» (en): the date of the end of a step in the tooltip head. */
function dayMonth(locale: Locale, date: string): string {
  return new Intl.DateTimeFormat(formatLocaleOf(locale), {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

function axisLabel(locale: Locale, step: TimeStep, end: string): string {
  const fmt = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(formatLocaleOf(locale), { ...options, timeZone: "UTC" }).format(
      new Date(`${end}T00:00:00Z`),
    );
  if (step === "year") return end.slice(0, 4);
  if (step === "quarter" || step === "month")
    return fmt({ month: "short", ...(end.slice(5, 7) === "12" ? { year: "numeric" } : {}) });
  return fmt({ day: "numeric", month: "short" });
}

/**
 * CMP-42@PoC: lines of one or more measures in time on one value axis (CHT-00, DS-15, DS-16). The time step is chosen
 * on its own — the finest of event, day, week, month, quarter, year with at most about 120 points — and each series
 * keeps its last value of a step; lines are steps unless a series says `linear`; the scale is adaptive, not tied to
 * zero (10 % of the range on each side, round ticks) and labelled on the right. 1–3 series differ by line style and
 * marker, 4 and more are grey with one highlighted from a legend of radio buttons. Hover or focus on a step shows a
 * dotted line, a marker on every series and a table «на <дата> · Δ · %»; arrows move the step and Esc closes it.
 * One point is a dot and a value without a line. No animation.
 */
export function LineChart(props: LineChartProps) {
  const values = [
    ...props.series.flatMap((s) => s.points.map((p) => p.value)),
    ...(props.target ? [props.target.value] : []),
  ];
  if (!allDecimal(values)) return <InvalidChart height={props.height ?? 300} />;
  return <LineChartView {...props} />;
}

function LineChartView({
  label,
  series,
  currency,
  height = 300,
  width: fallbackWidth,
  area = false,
  target,
  events = [],
  selectedId,
  onSelect,
  ...stateProps
}: LineChartProps) {
  const { t, locale } = useI18n();
  const tipId = useId();
  const box = useRef<HTMLDivElement>(null);
  const measured = useChartWidth(box, fallbackWidth ?? 640);
  const [pick, setPick] = useState<string | undefined>(undefined);
  const [active, setActive] = useState<number | null>(null);
  const [eventTip, setEventTip] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const many = series.length > 3;
  const highlighted = selectedId ?? pick ?? series[0]?.id;
  const wide = measured > WIDE;
  const plotWidth = wide ? measured - LEGEND_WIDTH - 16 : measured;
  const plotW = Math.max(0, plotWidth - PAD.left - PAD.right);
  const top = PAD.top;
  const bottom = height - PAD.bottom;

  const model = useMemo(() => {
    const dates = series.flatMap((s) => s.points.map((p) => p.date));
    const step = chooseStep(dates);
    const ends = [...new Set(dates.map((d) => stepEnd(d, step)))].sort();
    const first = ends[0] ? dayNumber(ends[0]) : 0;
    const last = ends.length ? dayNumber(ends[ends.length - 1] ?? "") : 0;
    const span = last - first;
    const xOf = (end: string) =>
      PAD.left + (span === 0 ? plotW / 2 : INSET + ((dayNumber(end) - first) / span) * (plotW - 2 * INSET));
    const buckets: Bucket[] = ends.map((end) => ({ end, x: xOf(end) }));
    // The last value of each series in each step; before the first event of a series there is none.
    const values = series.map((s) => {
      const sorted = [...s.points].sort((a, b) => (a.date < b.date ? -1 : 1));
      const own = new Map<string, string>();
      for (const p of sorted) own.set(stepEnd(p.date, step), p.value);
      let carried: string | null = null;
      return ends.map((end) => {
        if (own.has(end)) carried = own.get(end) ?? null;
        return carried;
      });
    });
    const all = [
      ...values.flatMap((v) => v.filter((x): x is string => x !== null).map(toNumber)),
      ...(target ? [toNumber(target.value)] : []),
    ];
    return { step, buckets, values, scale: niceScale(all, false), xOf, firstDay: first, lastDay: last };
  }, [series, target, plotW]);

  const { step, buckets, values, scale, xOf } = model;
  const y = (v: number) => bottom - ((v - scale.min) / (scale.max - scale.min)) * (bottom - top);
  const styleOf = (s: LineSeries, i: number): Style => {
    if (many) {
      const on = s.id === highlighted;
      return on
        ? { tone: s.tone ?? "brand-2", width: 3, marker: "circle" }
        : { tone: "border-control", width: 1.5, marker: "circle" };
    }
    const base = STYLES[i] ?? STYLES[0]!;
    return s.tone ? { ...base, tone: s.tone } : base;
  };

  const pathOf = (s: LineSeries, vals: (string | null)[]): string => {
    const pts = vals.map((v, k) => (v === null ? null : { x: buckets[k]?.x ?? 0, y: y(toNumber(v)) }));
    let d = "";
    let pen = false;
    for (const p of pts) {
      if (!p) {
        pen = false;
        continue;
      }
      if (!pen) d += `M${p.x} ${p.y}`;
      else if ((s.shape ?? "step") === "step") d += `H${p.x}V${p.y}`;
      else d += `L${p.x} ${p.y}`;
      pen = true;
    }
    return d;
  };

  const rows = (k: number): TipRow[] =>
    series.map((s, i) => {
      const st = styleOf(s, i);
      return {
        key: s.id,
        kind: "line" as const,
        name: s.name,
        tone: st.tone,
        dash: st.dash,
        marker: st.marker,
        value: values[i]?.[k] ?? null,
        previous: k > 0 ? (values[i]?.[k - 1] ?? null) : null,
        goodWhen: s.goodWhen,
      };
    });

  const nearest = (clientX: number, rect: DOMRect): number => {
    if (!buckets.length) return 0;
    const x = clientX - rect.left;
    let best = 0;
    buckets.forEach((b, k) => {
      if (Math.abs(b.x - x) < Math.abs((buckets[best]?.x ?? 0) - x)) best = k;
    });
    return best;
  };
  const move = (event: PointerEvent<SVGRectElement>) => {
    const next = nearest(
      event.clientX,
      event.currentTarget.ownerSVGElement?.getBoundingClientRect() ??
        event.currentTarget.getBoundingClientRect(),
    );
    if (next !== active) setDismissed(false);
    setActive(next);
    setEventTip(null);
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      setDismissed(true);
      setEventTip(null);
    } else if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      setDismissed(false);
      setActive((a) => {
        const next =
          (a ?? (event.key === "ArrowRight" ? -1 : buckets.length)) + (event.key === "ArrowRight" ? 1 : -1);
        return Math.max(0, Math.min(buckets.length - 1, next));
      });
    }
  };

  const tickLabel = (v: number): string => {
    const text = String(Math.round(v * 100) / 100);
    return formatCompactNumber({ value: text, locale, axis: true }) ?? formatNumber(locale, text);
  };
  const periodWord =
    step === "event"
      ? t("chart.tooltip.deltaEvent")
      : t("chart.tooltip.delta", { period: t(`delta.period.${step}` as "delta.period.day") });
  const open = active !== null && !dismissed && buckets[active] !== undefined;
  const activeBucket = active !== null ? buckets[active] : undefined;
  const lastValues = series.map((_s, i) => {
    const arr = values[i] ?? [];
    for (let k = arr.length - 1; k >= 0; k--) if (arr[k] != null) return arr[k] ?? null;
    return null;
  });
  const hasDots = buckets.length <= DOTS_UP_TO;
  const zeroVisible = scale.min < 0 && scale.max > 0;
  const tickEvery = Math.max(1, Math.ceil(buckets.length / Math.max(1, Math.floor(plotW / 70))));

  const legendItems = series.map((s, i) => ({ s, st: styleOf(s, i), i }));
  const legend = many ? (
    <div
      role="radiogroup"
      aria-label={t("chart.legend.group")}
      className="ws-chart-legend ws-chart-legend--list"
    >
      {legendItems.map(({ s, st, i }) => (
        <button
          key={s.id}
          type="button"
          role="radio"
          aria-checked={s.id === highlighted}
          className="ws-chart-legend-button"
          onClick={() => {
            setPick(s.id);
            onSelect?.(s.id);
          }}
        >
          <Swatch kind="line" tone={st.tone} marker={st.marker} />
          <span title={s.name}>{s.name}</span>
          {lastValues[i] != null ? (
            <b className="ws-tabular">{money(locale, lastValues[i] ?? "0", currency)}</b>
          ) : null}
        </button>
      ))}
    </div>
  ) : (
    <ul className="ws-chart-legend">
      {legendItems.map(({ s, st, i }) => (
        <li key={s.id} className="ws-chart-legend-item">
          <Swatch kind="line" tone={st.tone} dash={st.dash} marker={st.marker} />
          <span className="ws-muted" title={s.name}>
            {s.name}
          </span>
          {lastValues[i] != null ? (
            <b className="ws-tabular">{money(locale, lastValues[i] ?? "0", currency)}</b>
          ) : null}
        </li>
      ))}
    </ul>
  );

  const empty = buckets.length === 0;
  const shownEvent = events.find((e) => e.id === eventTip);

  return (
    <div className={`ws-chart${wide ? " ws-chart--wide" : ""}`} ref={box} data-chart="line" onKeyDown={onKey}>
      <ChartShell height={height} empty={empty} {...stateProps}>
        <div className="ws-chart-layout">
          <div className="ws-chart-plot" style={{ height, width: plotWidth }}>
            <svg
              width={plotWidth}
              height={height}
              role="group"
              aria-label={label}
              aria-describedby={open ? tipId : undefined}
              tabIndex={0}
              className="ws-chart-svg"
              onFocus={(e) => {
                if (e.target === e.currentTarget) setActive((a) => a ?? buckets.length - 1);
              }}
              onBlur={(e) => {
                if (e.target === e.currentTarget) setActive(null);
              }}
            >
              {scale.ticks.map((tick) => (
                <g key={tick}>
                  <line
                    x1={PAD.left}
                    x2={PAD.left + plotW}
                    y1={y(tick)}
                    y2={y(tick)}
                    className="ws-chart-grid"
                  />
                  <text x={PAD.left + plotW + 8} y={y(tick) + 4} className="ws-chart-axis ws-tabular">
                    {tickLabel(tick)}
                  </text>
                </g>
              ))}
              {zeroVisible ? (
                <line x1={PAD.left} x2={PAD.left + plotW} y1={y(0)} y2={y(0)} className="ws-chart-zero" />
              ) : null}
              {buckets.map((b, k) =>
                k % tickEvery === 0 ? (
                  <text key={b.end} x={b.x} y={height - 8} textAnchor="middle" className="ws-chart-axis">
                    {axisLabel(locale, step, b.end)}
                  </text>
                ) : null,
              )}
              {area && series[0] && values[0] ? (
                <path
                  d={`${pathOf(series[0], values[0])}V${bottom}H${
                    buckets[
                      Math.max(
                        0,
                        (values[0] ?? []).findIndex((v) => v !== null),
                      )
                    ]?.x ?? 0
                  }Z`}
                  fill={toneVar("brand-2")}
                  fillOpacity="var(--ws-chart-area-opacity)"
                  stroke="none"
                />
              ) : null}
              {target ? (
                <g>
                  <line
                    x1={PAD.left}
                    x2={PAD.left + plotW}
                    y1={y(toNumber(target.value))}
                    y2={y(toNumber(target.value))}
                    stroke="var(--ws-chart-reference)"
                    strokeWidth={2}
                    strokeDasharray="4 4"
                  />
                  <text
                    x={PAD.left + plotW}
                    y={y(toNumber(target.value)) - 6}
                    textAnchor="end"
                    className="ws-chart-target"
                  >
                    {target.label}
                  </text>
                </g>
              ) : null}
              {legendItems
                .slice()
                .sort((a, b) => Number(a.s.id === highlighted) - Number(b.s.id === highlighted))
                .map(({ s, st, i }) => {
                  const vals = values[i] ?? [];
                  const defined = vals.filter((v) => v !== null).length;
                  const lastK = vals.map((v) => v !== null).lastIndexOf(true);
                  return (
                    <g key={s.id} data-series={s.id}>
                      {defined > 1 ? (
                        <path
                          d={pathOf(s, vals)}
                          fill="none"
                          stroke={toneVar(st.tone)}
                          strokeWidth={st.width}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeDasharray={st.dash ? st.dash.join(" ") : undefined}
                        />
                      ) : null}
                      {hasDots
                        ? vals.map((v, k) =>
                            v !== null && k !== lastK ? (
                              <circle
                                key={k}
                                cx={buckets[k]?.x}
                                cy={y(toNumber(v))}
                                r={2.5}
                                fill={toneVar(st.tone)}
                              />
                            ) : null,
                          )
                        : null}
                      {lastK >= 0 && (!many || s.id === highlighted) ? (
                        <MarkerShapeSvg
                          shape={st.marker}
                          x={buckets[lastK]?.x ?? 0}
                          y={y(toNumber(vals[lastK] ?? "0"))}
                          size={10}
                          color={toneVar(st.tone)}
                          outline="var(--ws-surface-200)"
                          outlineWidth={2}
                        />
                      ) : lastK >= 0 ? (
                        <circle
                          cx={buckets[lastK]?.x}
                          cy={y(toNumber(vals[lastK] ?? "0"))}
                          r={2.5}
                          fill={toneVar(st.tone)}
                        />
                      ) : null}
                    </g>
                  );
                })}
              <rect
                x={PAD.left}
                y={top}
                width={plotW}
                height={bottom - top}
                fill="transparent"
                onPointerMove={move}
                onPointerLeave={() => setActive(null)}
              />
              {open && activeBucket ? (
                <g aria-hidden="true">
                  <line
                    x1={activeBucket.x}
                    x2={activeBucket.x}
                    y1={top}
                    y2={bottom}
                    className="ws-chart-cursor"
                  />
                  {legendItems.map(({ s, st, i }) => {
                    const v = values[i]?.[active ?? 0];
                    return v != null ? (
                      <MarkerShapeSvg
                        key={s.id}
                        shape={st.marker}
                        x={activeBucket.x}
                        y={y(toNumber(v))}
                        size={8}
                        color={toneVar(st.tone)}
                        outline="var(--ws-surface-200)"
                      />
                    ) : null;
                  })}
                </g>
              ) : null}
              {events.map((e, k) => {
                const day = dayNumber(e.date);
                if (day < model.firstDay || day > model.lastDay) return null;
                const x = xOf(stepEnd(e.date, step));
                const name = e.detail
                  ? `${e.label}, ${formatDate(locale, e.date)}, ${e.detail}`
                  : `${e.label}, ${formatDate(locale, e.date)}`;
                return (
                  <g
                    key={e.id}
                    role="img"
                    tabIndex={0}
                    aria-label={name}
                    className="ws-chart-event"
                    onFocus={() => {
                      setEventTip(e.id);
                      setActive(null);
                    }}
                    onBlur={() => setEventTip(null)}
                    onPointerEnter={() => {
                      setEventTip(e.id);
                      setActive(null);
                    }}
                    onPointerLeave={() => setEventTip(null)}
                  >
                    <line
                      x1={x}
                      x2={x}
                      y1={bottom}
                      y2={bottom + 6}
                      stroke="var(--ws-ink-muted)"
                      strokeWidth={1}
                    />
                    <path
                      d={`M${x} ${bottom - 5}L${x + 5} ${bottom}L${x} ${bottom + 5}L${x - 5} ${bottom}Z`}
                      fill="var(--ws-ink-muted)"
                      stroke="var(--ws-surface-200)"
                      strokeWidth={1.5}
                    />
                    <text
                      x={x}
                      y={top + 10 + (k % 2) * 14}
                      textAnchor="middle"
                      className="ws-chart-event-label"
                    >
                      {e.label}
                    </text>
                  </g>
                );
              })}
            </svg>
            {open && activeBucket && active !== null
              ? (() => {
                  const place = placeTip(
                    activeBucket.x,
                    plotWidth,
                    330,
                    top,
                    height,
                    56 + 22 * series.length,
                  );
                  const end = activeBucket.end;
                  return (
                    <TipTable
                      id={tipId}
                      title={stepTitle(locale, step, end, t as never)}
                      rows={rows(active)}
                      currency={currency}
                      withChange
                      columns={{
                        value: t("chart.tooltip.on", { date: dayMonth(locale, end) }),
                        change: periodWord,
                        percent: t("chart.tooltip.percent"),
                      }}
                      percentOf={(row) => {
                        if (row.value === null || row.previous === null) return null;
                        const p = percentChange(row.value, row.previous);
                        return p === null ? null : formatNumber(locale, p.replace("-", ""));
                      }}
                      style={{ left: place.left, top: place.top }}
                    />
                  );
                })()
              : null}
            {shownEvent ? (
              <div
                role="tooltip"
                id={tipId}
                className="ws-chart-tip"
                style={{
                  left: Math.min(
                    Math.max(0, xOf(stepEnd(shownEvent.date, step)) - 120),
                    Math.max(0, plotWidth - 260),
                  ),
                  top: bottom - 80,
                }}
              >
                <div className="ws-chart-tip-title">{shownEvent.label}</div>
                <div className="ws-muted">{formatDate(locale, shownEvent.date)}</div>
                {shownEvent.detail ? <div>{shownEvent.detail}</div> : null}
              </div>
            ) : null}
          </div>
          {legend}
        </div>
      </ChartShell>
    </div>
  );
}
