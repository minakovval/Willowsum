import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useI18n } from "@willowsum/i18n";
import { formatNumber } from "@willowsum/i18n";
import { formatCompactNumber } from "../amount/compact.ts";
import { addDecimal, compareDecimal, niceScale, signOf, toNumber, type Scale } from "./math.ts";
import {
  ChartShell,
  InvalidChart,
  MarkerShapeSvg,
  allDecimal,
  Swatch,
  TipTable,
  money,
  placeTip,
  shortMoney,
  toneVar,
  useChartWidth,
  type ChartStateProps,
  type ChartTone,
  type MarkerShape,
  type TipRow,
} from "./shared.tsx";

export interface BarCategory {
  id: string;
  /** The label under the column («жовт.»); one line, cut with «…» when it does not fit. */
  label: string;
  /** The full name for the legend, the tooltip and the screen reader («жовтень 2026»). */
  full?: string;
}

export interface BarSeries {
  id: string;
  name: string;
  /** A decimal amount per category; null — no value (nothing is drawn). */
  values: readonly (string | null)[];
  /** A colour token; by default the order of CMP-47: brand, brand-2, ink-muted, border-control. */
  tone?: ChartTone;
  /** Stripes (3 px at 45°) instead of a fill; the fifth series «Інші · N» and a part such as «з цілей». */
  hatched?: boolean;
  goodWhen?: "up" | "down";
}

/** A line drawn over the bars on the same scale (a plan, an income). */
export interface ChartLine {
  id: string;
  name: string;
  values: readonly (string | null)[];
  tone?: ChartTone;
  /** Dash and gap in px: plan 4 / 4, budget 12 / 4, solid when absent. */
  dash?: readonly [number, number];
  marker?: MarkerShape;
  /** A horizontal level over each column, as the plan is; otherwise a polyline through the column centres. */
  step?: boolean;
  goodWhen?: "up" | "down";
}

export interface BarChartProps extends ChartStateProps {
  /** The accessible name of the chart. */
  label: string;
  categories: readonly BarCategory[];
  series: readonly BarSeries[];
  lines?: readonly ChartLine[];
  /** `stacked`: segments of one column 2 px apart; `percent`: every column is 100 %. Default: `stacked` for several series, else a single bar. */
  mode?: "single" | "stacked" | "percent";
  /** ISO currency code of all values. */
  currency: string;
  /** The height of the plot in px; the width is the container's. */
  height?: number;
  /** The width to use where it cannot be measured (tests). */
  width?: number;
  /** Value labels above the columns: default for single and stacked charts of 6 columns or fewer. */
  showValues?: boolean;
  /** The legend of series and lines with the value of the last category. */
  legend?: boolean;
  /** Makes the columns buttons («натисніть на стовпчик»): called with the category index. */
  onBarClick?: (index: number) => void;
  /** The tooltip title suffix, e.g. «Δ м/м»: the change in the table is against the previous column. */
  changeLabel?: string;
}

const DEFAULT_TONES: readonly ChartTone[] = ["brand", "brand-2", "ink-muted", "border-control", "ink-muted"];
const MAX_SERIES = 5;
const AXIS_WIDTH = 56;
const PAD = { top: 22, right: AXIS_WIDTH, bottom: 24, left: 8 } as const;
const MAX_BAR = 44;
const GAP = 2;
const RADIUS = 4;
const MIN_BAR = 2;
const CHAR_WIDTH = 6.5;

/** CMP-47 AC1: more than 5 series — the 4 largest and «Інші · N» (the sum), hatched and last. */
function collapse(series: readonly BarSeries[], other: (n: number) => string): BarSeries[] {
  if (series.length <= MAX_SERIES) return [...series];
  const total = (s: BarSeries) => s.values.reduce<string>((sum, v) => addDecimal(sum, v ?? "0"), "0");
  const ranked = [...series].sort((a, b) => compareDecimal(total(b), total(a)));
  const keep = new Set(ranked.slice(0, MAX_SERIES - 1).map((s) => s.id));
  const rest = series.filter((s) => !keep.has(s.id));
  const count = rest[0]?.values.length ?? 0;
  const values = Array.from({ length: count }, (_, i) => {
    const parts = rest.map((s) => s.values[i] ?? null).filter((v): v is string => v !== null);
    return parts.length ? parts.reduce((sum, v) => addDecimal(sum, v), "0") : null;
  });
  return [
    ...series.filter((s) => keep.has(s.id)),
    { id: "other", name: other(rest.length), values, hatched: true },
  ];
}

function barPath(x: number, y: number, w: number, h: number, round: "top" | "bottom" | "none"): string {
  const r = round === "none" ? 0 : Math.min(RADIUS, w / 2, h);
  if (round === "top")
    return `M${x} ${y + h}V${y + r}Q${x} ${y} ${x + r} ${y}H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${y + h}Z`;
  if (round === "bottom")
    return `M${x} ${y}V${y + h - r}Q${x} ${y + h} ${x + r} ${y + h}H${x + w - r}Q${x + w} ${y + h} ${x + w} ${y + h - r}V${y}Z`;
  return `M${x} ${y}H${x + w}V${y + h}H${x}Z`;
}

interface Segment {
  series: BarSeries;
  tone: ChartTone;
  index: number;
  category: number;
  value: string;
  x: number;
  y: number;
  w: number;
  h: number;
  round: "top" | "bottom" | "none";
}

/**
 * CMP-47@PoC: the vertical bar chart (one series, stacked or 100 %) with optional lines over it on the same scale,
 * CHT-00 FR 4 and DS-16. The scale always starts at zero and is labelled on the right; negative columns go below the
 * zero line with the label under the column; the ends on the data side are rounded 4 px; stacked segments are 2 px
 * apart. Series differ by fill, hatching and legend, not by colour alone. Columns are reachable by Tab, named
 * «series, category, value»; the tooltip opens on hover and on focus, closes with Esc, and only repeats what is
 * on the chart or in the legend. No appearance animation (CHT-00 «Бізнес-правила»).
 */
export function BarChart(props: BarChartProps) {
  const values = [...props.series.flatMap((s) => s.values), ...(props.lines ?? []).flatMap((l) => l.values)];
  if (!allDecimal(values)) return <InvalidChart height={props.height ?? 300} />;
  return <BarChartView {...props} />;
}

function BarChartView({
  label,
  categories,
  series: given,
  lines = [],
  mode,
  currency,
  height = 300,
  width: fallbackWidth,
  showValues,
  legend = true,
  onBarClick,
  changeLabel,
  ...stateProps
}: BarChartProps) {
  const { t, locale } = useI18n();
  const tipId = useId();
  const patternId = useId();
  const box = useRef<HTMLDivElement>(null);
  const measured = useChartWidth(box, fallbackWidth ?? 640);
  const width = measured;
  const [active, setActive] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const series = useMemo(() => collapse(given, (n) => t("chart.other", { count: String(n) })), [given, t]);
  const kind = mode ?? (series.length > 1 ? "stacked" : "single");
  const toneOf = (s: BarSeries, i: number): ChartTone => s.tone ?? DEFAULT_TONES[i] ?? "ink-muted";
  const n = categories.length;
  const plotW = Math.max(0, width - PAD.left - PAD.right);
  const band = n ? plotW / n : 0;
  const barW = Math.min(MAX_BAR, band * 0.6);
  const top = PAD.top;
  const bottom = height - PAD.bottom;

  const model = useMemo(() => {
    // Per column: the positive and the negative stack in numbers (geometry only).
    const stacks = categories.map((_, c) => {
      let pos = 0;
      let neg = 0;
      for (const s of kind === "single" ? series.slice(0, 1) : series) {
        const v = s.values[c];
        if (v === null || v === undefined) continue;
        if (toNumber(v) >= 0) pos += toNumber(v);
        else neg += toNumber(v);
      }
      return { pos, neg };
    });
    let scale: Scale;
    if (kind === "percent") scale = { min: 0, max: 100, ticks: [0, 25, 50, 75, 100] };
    else {
      const all = [
        ...stacks.flatMap((s) => [s.pos, s.neg]),
        ...lines.flatMap((l) => l.values.filter((v): v is string => v !== null).map(toNumber)),
      ];
      scale = niceScale(all, true);
    }
    return { stacks, scale };
  }, [categories, series, lines, kind]);

  const { scale, stacks } = model;
  const y = (v: number) => bottom - ((v - scale.min) / (scale.max - scale.min)) * (bottom - top);
  const zeroY = y(0);
  const hasNegative = stacks.some((s) => s.neg < 0);

  const segments = useMemo(() => {
    const out: Segment[] = [];
    categories.forEach((_, c) => {
      const x = PAD.left + band * c + (band - barW) / 2;
      const totals = stacks[c] ?? { pos: 0, neg: 0 };
      const posTotal = kind === "percent" ? totals.pos + Math.abs(totals.neg) : 1;
      let up = 0;
      let down = 0;
      const used = (kind === "single" ? series.slice(0, 1) : series)
        .map((s, index) => ({ s, index, v: s.values[c] ?? null }))
        .filter((e): e is { s: BarSeries; index: number; v: string } => e.v !== null && signOf(e.v) !== 0);
      const lastPos = [...used].reverse().find((e) => signOf(e.v) > 0);
      const lastNeg = [...used].reverse().find((e) => signOf(e.v) < 0);
      for (const { s, index, v } of used) {
        const raw = kind === "percent" ? (toNumber(v) / (posTotal || 1)) * 100 : toNumber(v);
        const positive = raw >= 0;
        const from = positive ? up : down;
        const to = from + raw;
        if (positive) up = to;
        else down = to;
        const y1 = y(Math.max(from, to));
        const y2 = y(Math.min(from, to));
        let h = Math.max(MIN_BAR, y2 - y1);
        let yy = y1;
        // Segments of one stack are 2 px apart: the later one gives up 2 px at the joint.
        const joint = from !== 0 && kind !== "single";
        if (joint && h > GAP + MIN_BAR) {
          if (positive) h -= GAP;
          else {
            yy += GAP;
            h -= GAP;
          }
        }
        const outer = positive ? lastPos?.s.id === s.id : lastNeg?.s.id === s.id;
        out.push({
          series: s,
          tone: toneOf(s, index),
          index,
          category: c,
          value: v,
          x,
          y: yy,
          w: barW,
          h,
          round: outer ? (positive ? "top" : "bottom") : "none",
        });
      }
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categories, series, kind, band, barW, scale.min, scale.max, height]);

  const columnNames = (c: number) => categories[c]?.full ?? categories[c]?.label ?? "";
  const maxChars = Math.max(1, Math.floor(band / CHAR_WIDTH));
  const cut = (text: string) =>
    text.length > maxChars ? `${text.slice(0, Math.max(1, maxChars - 1))}…` : text;
  const valuesShown = showValues ?? (kind !== "percent" && n <= 6);

  const tipRows = (c: number): TipRow[] => [
    ...series.map((s, i) => ({
      key: s.id,
      kind: "bar" as const,
      name: s.name,
      tone: toneOf(s, i),
      hatched: s.hatched ?? false,
      value: s.values[c] ?? null,
      previous: c > 0 ? (s.values[c - 1] ?? null) : null,
      goodWhen: s.goodWhen,
    })),
    ...lines.map((l) => ({
      key: l.id,
      kind: "line" as const,
      name: l.name,
      tone: l.tone ?? "ink-muted",
      dash: l.dash,
      marker: l.marker,
      value: l.values[c] ?? null,
      previous: c > 0 ? (l.values[c - 1] ?? null) : null,
      goodWhen: l.goodWhen,
    })),
  ];
  const tableTip = series.length > 1 || lines.length > 0;
  const needsTip = (c: number): boolean =>
    tableTip ||
    !valuesShown ||
    (categories[c]?.label ?? "").length > maxChars ||
    series.some((s) => {
      const v = s.values[c];
      return v !== null && v !== undefined && shortMoney(locale, v, currency).abbreviated;
    });

  const open = active !== null && !dismissed && needsTip(active);
  const clickable = onBarClick !== undefined;
  const select = (c: number) => {
    if (c !== active) setDismissed(false);
    setActive(c);
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape" && open) {
      event.stopPropagation();
      setDismissed(true);
    }
  };

  const tickLabel = (v: number): string => {
    if (kind === "percent") return `${formatNumber(locale, String(v))} %`;
    const text = String(Math.round(v * 100) / 100);
    return formatCompactNumber({ value: text, locale, axis: true }) ?? formatNumber(locale, text);
  };

  /** The legend names the last period with a value that is not zero (the last one when all are zero or empty). */
  const legendIndexOf = (values: readonly (string | null)[]): number => {
    for (let c = n - 1; c >= 0; c--) {
      const v = values[c];
      if (v != null && signOf(v) !== 0) return c;
    }
    for (let c = n - 1; c >= 0; c--) if (values[c] != null) return c;
    return n - 1;
  };

  const anchor = active !== null ? { x: PAD.left + band * active + band / 2, y: top } : null;
  const tip =
    open && active !== null && anchor
      ? (() => {
          const place = placeTip(
            anchor.x,
            width,
            330,
            anchor.y,
            height,
            40 + 22 * (series.length + lines.length),
          );
          const title = changeLabel ? `${columnNames(active)} · ${changeLabel}` : columnNames(active);
          return (
            <TipTable
              id={tipId}
              title={title}
              rows={tableTip ? tipRows(active) : tipRows(active).slice(0, 1)}
              currency={currency}
              withChange={tableTip && active > 0}
              style={{ left: place.left, top: place.top }}
            />
          );
        })()
      : null;

  const empty = n === 0 || series.every((s) => s.values.every((v) => v === null));

  return (
    <div className="ws-chart" ref={box} data-chart="bar" onKeyDown={onKey}>
      <ChartShell height={height} empty={empty} {...stateProps}>
        {legend ? (
          <ul className="ws-chart-legend">
            {series.map((s, i) => (
              <LegendItem
                key={s.id}
                swatch={<Swatch kind="bar" tone={toneOf(s, i)} hatched={s.hatched ?? false} />}
                name={s.name}
                category={
                  categories[legendIndexOf(s.values)]?.full ?? categories[legendIndexOf(s.values)]?.label
                }
                value={s.values[legendIndexOf(s.values)] ?? null}
                currency={currency}
              />
            ))}
            {lines.map((l) => (
              <LegendItem
                key={l.id}
                swatch={
                  <Swatch
                    kind="line"
                    tone={l.tone ?? "ink-muted"}
                    dash={l.dash}
                    marker={l.marker ?? "circle"}
                  />
                }
                name={l.name}
                category={
                  categories[legendIndexOf(l.values)]?.full ?? categories[legendIndexOf(l.values)]?.label
                }
                value={l.values[legendIndexOf(l.values)] ?? null}
                currency={currency}
              />
            ))}
          </ul>
        ) : null}
        <div className="ws-chart-plot" style={{ height }}>
          <svg width={width} height={height} role="group" aria-label={label} className="ws-chart-svg">
            <defs>
              {series.map((s, i) =>
                s.hatched ? (
                  <pattern
                    key={s.id}
                    id={`${patternId}-${s.id}`}
                    width="6"
                    height="6"
                    patternUnits="userSpaceOnUse"
                    patternTransform="rotate(45)"
                  >
                    <rect width="6" height="6" fill="var(--ws-surface-200)" />
                    <rect width="3" height="6" fill={toneVar(toneOf(s, i))} />
                  </pattern>
                ) : null,
              )}
            </defs>
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
            {hasNegative ? (
              <line x1={PAD.left} x2={PAD.left + plotW} y1={zeroY} y2={zeroY} className="ws-chart-zero" />
            ) : null}
            {categories.map((c, i) => (
              <g key={c.id}>
                <rect
                  x={PAD.left + band * i}
                  y={top}
                  width={band}
                  height={bottom - top}
                  fill="transparent"
                  className={clickable ? "ws-chart-hit ws-chart-hit--click" : "ws-chart-hit"}
                  onPointerEnter={() => select(i)}
                  onPointerLeave={() => setActive((a) => (a === i ? null : a))}
                  onClick={clickable ? () => onBarClick(i) : undefined}
                />
                <text
                  x={PAD.left + band * i + band / 2}
                  y={height - 6}
                  textAnchor="middle"
                  className="ws-chart-axis"
                >
                  {cut(c.label)}
                </text>
              </g>
            ))}
            {segments.map((s) => {
              const name = t("chart.series.aria", {
                series: s.series.name,
                category: columnNames(s.category),
                value: money(locale, s.value, currency),
              });
              const common = {
                tabIndex: 0,
                "aria-label": name,
                "aria-describedby": open && active === s.category ? tipId : undefined,
                className: "ws-chart-bar",
                onFocus: () => select(s.category),
                onBlur: () => setActive((a) => (a === s.category ? null : a)),
              };
              const fill = s.series.hatched ? `url(#${patternId}-${s.series.id})` : toneVar(s.tone);
              const path = (
                <path
                  d={barPath(s.x, s.y, s.w, s.h, s.round)}
                  fill={fill}
                  stroke={s.series.hatched ? toneVar(s.tone) : undefined}
                  strokeWidth={s.series.hatched ? 1 : undefined}
                />
              );
              return clickable ? (
                <g
                  key={`${s.series.id}-${s.category}`}
                  role="button"
                  {...common}
                  onClick={() => onBarClick(s.category)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onBarClick(s.category);
                    }
                  }}
                >
                  {path}
                </g>
              ) : (
                <g key={`${s.series.id}-${s.category}`} role="img" {...common}>
                  {path}
                </g>
              );
            })}
            {valuesShown
              ? categories.map((c, i) => {
                  const totals = stacks[i] ?? { pos: 0, neg: 0 };
                  const sum = (kind === "single" ? series.slice(0, 1) : series).reduce<string | null>(
                    (acc, s) => (s.values[i] == null ? acc : addDecimal(acc ?? "0", s.values[i] ?? "0")),
                    null,
                  );
                  if (sum === null || kind === "percent") return null;
                  const negative = signOf(sum) < 0;
                  const at = negative ? y(totals.neg) + 14 : y(totals.pos) - 5;
                  return (
                    <text
                      key={c.id}
                      x={PAD.left + band * i + band / 2}
                      y={at}
                      textAnchor="middle"
                      className="ws-chart-value ws-tabular"
                    >
                      {shortMoney(locale, sum, currency).text}
                    </text>
                  );
                })
              : null}
            {lines.map((l) => (
              <LineOverlay key={l.id} line={l} band={band} left={PAD.left} y={y} />
            ))}
            {open && active !== null ? (
              <line
                x1={PAD.left + band * active + band / 2}
                x2={PAD.left + band * active + band / 2}
                y1={top}
                y2={bottom}
                className="ws-chart-cursor"
              />
            ) : null}
          </svg>
          {tip}
        </div>
      </ChartShell>
    </div>
  );
}

function LegendItem({
  swatch,
  name,
  category,
  value,
  currency,
}: {
  swatch: React.ReactNode;
  name: string;
  category: string | undefined;
  value: string | null;
  currency: string;
}) {
  const { locale } = useI18n();
  const text = category ? `${name} · ${category}` : name;
  return (
    <li className="ws-chart-legend-item">
      {swatch}
      <span className="ws-muted" title={text}>
        {text}
      </span>
      {value !== null ? <b className="ws-tabular">{money(locale, value, currency)}</b> : null}
    </li>
  );
}

/** A line over the columns: a polyline through the column centres, or a level per column (a step). */
function LineOverlay({
  line,
  band,
  left,
  y,
}: {
  line: ChartLine;
  band: number;
  left: number;
  y: (v: number) => number;
}) {
  const tone = toneVar(line.tone ?? "ink-muted");
  const points = line.values.map((v, i) =>
    v === null ? null : { x: left + band * i + band / 2, y: y(toNumber(v)), i },
  );
  let d = "";
  if (line.step) {
    let pen = false;
    points.forEach((p, i) => {
      if (!p) {
        pen = false;
        return;
      }
      const x0 = left + band * i;
      d += pen ? `V${p.y}H${x0 + band}` : `M${x0} ${p.y}H${x0 + band}`;
      pen = true;
    });
  } else {
    let pen = false;
    for (const p of points) {
      if (!p) {
        pen = false;
        continue;
      }
      d += `${pen ? "L" : "M"}${p.x} ${p.y}`;
      pen = true;
    }
  }
  return (
    <g className="ws-chart-line" aria-hidden="true">
      <path
        d={d}
        fill="none"
        stroke={tone}
        strokeWidth={2}
        strokeDasharray={line.dash ? line.dash.join(" ") : undefined}
      />
      {points.map((p) =>
        p ? (
          <MarkerShapeSvg
            key={p.i}
            shape={line.marker ?? "circle"}
            x={p.x}
            y={p.y}
            size={7}
            color={tone}
            outline="var(--ws-surface-200)"
          />
        ) : null,
      )}
    </g>
  );
}
