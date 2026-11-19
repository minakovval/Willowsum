/**
 * CHT-00@PoC FR 1, DS-16 and DS-15: the shared arithmetic of the chart components. Amounts arrive as decimal
 * strings (CHT-00 «Бізнес-правила»); differences and percentages are computed on scaled integers (BigInt), never
 * on floating-point numbers. Only the pixel geometry uses `Number`, and it is rounded away before display.
 */
const DECIMAL = /^-?\d+(\.\d+)?$/;

export const isDecimal = (value: unknown): value is string =>
  typeof value === "string" && DECIMAL.test(value);

interface Scaled {
  n: bigint;
  scale: number;
}

function scaled(value: string): Scaled {
  if (!isDecimal(value)) throw new RangeError("Not a plain decimal string");
  const negative = value.startsWith("-");
  const [int = "0", frac = ""] = value.replace("-", "").split(".");
  const n = BigInt(int + frac);
  return { n: negative ? -n : n, scale: frac.length };
}

function align(a: string, b: string): { a: bigint; b: bigint; scale: number } {
  const x = scaled(a);
  const y = scaled(b);
  const scale = Math.max(x.scale, y.scale);
  return {
    a: x.n * 10n ** BigInt(scale - x.scale),
    b: y.n * 10n ** BigInt(scale - y.scale),
    scale,
  };
}

function unscale(n: bigint, scale: number): string {
  const negative = n < 0n;
  const digits = (negative ? -n : n).toString().padStart(scale + 1, "0");
  const int = digits.slice(0, digits.length - scale);
  const frac = digits.slice(digits.length - scale);
  const body = frac ? `${int}.${frac}` : int;
  return negative && n !== 0n ? `-${body}` : body;
}

export function addDecimal(a: string, b: string): string {
  const p = align(a, b);
  return unscale(p.a + p.b, p.scale);
}

export function subDecimal(a: string, b: string): string {
  const p = align(a, b);
  return unscale(p.a - p.b, p.scale);
}

export function compareDecimal(a: string, b: string): -1 | 0 | 1 {
  const p = align(a, b);
  return p.a === p.b ? 0 : p.a < p.b ? -1 : 1;
}

export const signOf = (value: string): -1 | 0 | 1 => compareDecimal(value, "0");

/** `(current − base) / |base|` in percent with one decimal, half away from zero; null when the base is zero. */
export function percentChange(current: string, base: string): string | null {
  const p = align(current, base);
  if (p.b === 0n) return null;
  const abs = p.b < 0n ? -p.b : p.b;
  const num = (p.a - p.b) * 1000n;
  const half = abs / 2n;
  const q = (num < 0n ? num - half : num + half) / abs;
  return unscale(q, 1);
}

/** For the pixel geometry only. */
export const toNumber = (value: string): number => Number(value);

export interface Scale {
  min: number;
  max: number;
  ticks: number[];
}

/** The smallest round step (1, 2, 2.5 or 5 times a power of ten) that covers `lo` … `hi` in at most `target` intervals. */
function niceStep(lo: number, hi: number, target: number): number {
  const span = hi - lo;
  const base = Math.floor(Math.log10(span / target));
  for (let k = base; k <= base + 2; k++)
    for (const unit of [1, 2, 2.5, 5]) {
      const step = unit * 10 ** k;
      if (Math.ceil(hi / step - 1e-9) - Math.floor(lo / step + 1e-9) <= target) return step;
    }
  return 10 ** (base + 3);
}

/**
 * DS-16 item 16, CMP-42: the value scale. `fromZero` (bars) always contains zero; otherwise it runs from the data
 * minimum to the maximum with 10 % of the span on each side, rounded to round steps, and is not tied to zero.
 */
export function niceScale(values: readonly number[], fromZero: boolean, target = 6): Scale {
  let lo = values.length ? Math.min(...values) : 0;
  let hi = values.length ? Math.max(...values) : 1;
  if (fromZero) {
    lo = Math.min(lo, 0);
    hi = Math.max(hi, 0);
  } else {
    const span = hi - lo || Math.abs(hi) * 0.2 || 1;
    lo -= span * 0.1;
    hi += span * 0.1;
  }
  if (hi === lo) hi = lo + 1;
  const step = niceStep(lo, hi, target);
  const min = Math.floor(lo / step + 1e-9) * step;
  const max = Math.ceil(hi / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let v = min; v <= max + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return { min: ticks[0] ?? min, max: ticks[ticks.length - 1] ?? max, ticks };
}

export type TimeStep = "event" | "day" | "week" | "month" | "quarter" | "year";
export const TIME_STEPS: readonly TimeStep[] = ["event", "day", "week", "month", "quarter", "year"];
/** CMP-42, CHT-01 FR 1: no more than about 120 points. */
export const MAX_POINTS = 120;

const DAY = 86_400_000;
const parse = (date: string): Date => {
  const [y = 0, m = 1, d = 1] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const iso = (at: Date): string => at.toISOString().slice(0, 10);
export const dayNumber = (date: string): number => Math.round(parse(date).getTime() / DAY);

/** The last day of the step that holds `date` (weeks run Monday to Sunday). */
export function stepEnd(date: string, step: TimeStep): string {
  const at = parse(date);
  switch (step) {
    case "event":
    case "day":
      return date;
    case "week":
      return iso(new Date(at.getTime() + ((7 - (at.getUTCDay() || 7)) % 7) * DAY));
    case "month":
      return iso(new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 0)));
    case "quarter":
      return iso(new Date(Date.UTC(at.getUTCFullYear(), Math.floor(at.getUTCMonth() / 3) * 3 + 3, 0)));
    case "year":
      return `${at.getUTCFullYear()}-12-31`;
  }
}

/** The first day of the step that ends on `end`. */
export function stepStart(end: string, step: TimeStep): string {
  const at = parse(end);
  switch (step) {
    case "event":
    case "day":
      return end;
    case "week":
      return iso(new Date(at.getTime() - 6 * DAY));
    case "month":
      return iso(new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1)));
    case "quarter":
      return iso(new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() - 2, 1)));
    case "year":
      return `${at.getUTCFullYear()}-01-01`;
  }
}

/** The finest step, in the order event, day, week, month, quarter, year, with at most `MAX_POINTS` points. */
export function chooseStep(dates: readonly string[]): TimeStep {
  const distinct = (step: TimeStep) => new Set(dates.map((d) => stepEnd(d, step))).size;
  return TIME_STEPS.find((step) => distinct(step) <= MAX_POINTS) ?? "year";
}
