import { currencyInfo, Decimal as KernelDecimal, isCurrencyCode } from "@willowsum/domain-kernel";
import type { StatementEvent, StatementEvents } from "./events.ts";
import type { DeclaredFigures } from "./figures.ts";

/**
 * The statement checked against its own figures (IMP-05@PoC FR 1, EC1): each check is «перевірено» (`verified`),
 * «розбіжність» (`mismatch`) or «не перевірялося» (`not-checked`), with the declared value, the computed value and
 * the difference (declared − computed). Amounts are exact decimals formatted to the currency's scale (JPY 0, KWD 3,
 * crypto up to 18) and never rounded: a value with more decimals keeps them. Codes, never sentences: the client words
 * them. Pure and deterministic.
 */
export const CHECK_KINDS = [
  "opening-balance",
  "closing-balance",
  "balance-equation",
  "debit-total",
  "credit-total",
  "operations",
  "period",
  "balance-chain",
] as const;
export type CheckKind = (typeof CHECK_KINDS)[number];
export type CheckStatus = "verified" | "mismatch" | "not-checked";

export interface ControlCheck {
  readonly kind: CheckKind;
  readonly status: CheckStatus;
  readonly declared: string | null;
  readonly computed: string | null;
  readonly difference: string | null;
  /** `balance-chain`: the first row where the chain breaks, from 1, and how many links break. */
  readonly row?: number;
  readonly breaks?: number;
}

/** What the next statement of the account is compared with (FR 3): the dates and the balances at both ends. */
export interface StatementBounds {
  readonly start: string | null;
  readonly end: string | null;
  readonly opening: string | null;
  readonly closing: string | null;
  readonly currency: string | null;
}

export interface ControlResult {
  readonly currency: string | null;
  readonly checks: readonly ControlCheck[];
  readonly bounds: StatementBounds;
  /** Rows (from 1) whose sign the balance chain confirms (FR 5, the strongest basis). */
  readonly chainRows: ReadonlySet<number>;
  /** The statement's own totals (not only the chain) agree with the rows (FR 5, the second basis). */
  readonly totalsVerified: boolean;
}

/**
 * The checks add what the file prints, whatever its size: a cell of up to 64 characters (`VALUE_CELL_CHARS`) is below
 * 1e64 with at most 18 decimals, and 20 000 rows of them sum below 1e69 — 87 significant digits. The kernel's 60
 * (NUMERIC(38,18)) would round such a sum, and a file that does not add up would be «перевірено».
 */
const Decimal = KernelDecimal.clone({ precision: 120 });
type Decimal = InstanceType<typeof Decimal>;

const zero = new Decimal("0");
const scaleOf = (text: string): number => (text.includes(".") ? text.length - text.indexOf(".") - 1 : 0);

/** The currency's scale, or the widest printed one when the currency is not known. */
function formatter(currency: string | null, printed: readonly string[]): (d: Decimal) => string {
  const scale =
    currency !== null && isCurrencyCode(currency)
      ? currencyInfo(currency).minorUnits
      : Math.max(0, ...printed.map(scaleOf));
  return (d) => (d.isZero() ? zero : d).toFixed(Math.max(scale, d.decimalPlaces()));
}

function compare(
  kind: CheckKind,
  declared: Decimal | null,
  computed: Decimal | null,
  fmt: (d: Decimal) => string,
): ControlCheck {
  if (declared === null || computed === null)
    return {
      kind,
      status: "not-checked",
      declared: declared && fmt(declared),
      computed: computed && fmt(computed),
      difference: null,
    };
  const difference = declared.minus(computed);
  return {
    kind,
    status: difference.isZero() ? "verified" : "mismatch",
    declared: fmt(declared),
    computed: fmt(computed),
    difference: fmt(difference),
  };
}

const dec = (text: string | null): Decimal | null => (text === null ? null : new Decimal(text));

interface Link {
  readonly event: StatementEvent;
  readonly amount: Decimal;
  readonly balance: Decimal;
}

/**
 * The order of the chain through rows given oldest first (FR 1, AC «ланцюжок залишків у будь-якому порядку рядків»):
 * rows of one day may be printed in any order — a bank prints operations of the same moment as it likes (#698 owner
 * report). Within each run of rows of the same date the next row is the first one, in the printed order, whose balance
 * before it (balance − amount) is the balance reached so far; where none is, the rest of the run keeps its printed
 * order (the chain breaks there, as printed). The printed order is kept wherever its links hold.
 */
function chainOrder(links: readonly Link[]): Link[] {
  const ordered: Link[] = [];
  let i = 0;
  while (i < links.length) {
    const day = links[i]!.event.date;
    let j = i + 1;
    while (day !== null && j < links.length && links[j]!.event.date === day) j += 1;
    const rest = links.slice(i, j);
    i = j;
    const before = (l: Link) => l.balance.minus(l.amount);
    let reached = ordered.at(-1)?.balance ?? null;
    if (reached === null) {
      // The first day: it starts at the row no other row of the day leads to (else as printed).
      const start = rest.find((l) => !rest.some((o) => o !== l && o.balance.eq(before(l)))) ?? rest[0]!;
      rest.splice(rest.indexOf(start), 1);
      ordered.push(start);
      reached = start.balance;
    }
    while (rest.length > 0) {
      const at = rest.findIndex((l) => before(l).eq(reached!));
      if (at < 0) {
        ordered.push(...rest);
        break;
      }
      const [next] = rest.splice(at, 1);
      ordered.push(next!);
      reached = next!.balance;
    }
  }
  return ordered;
}

/**
 * The balance chain (FR 1): every row's balance is the previous one plus its amount. Statements print the newest row
 * first or last: the direction with fewer breaks is taken (ties by the dates); rows of one day follow the chain
 * (`chainOrder`). The opening and the closing balance follow from the chain's ends.
 */
function chainOf(links: readonly Link[], declaredOpening: Decimal | null) {
  const walk = (oldestFirst: readonly Link[]) => {
    const order = chainOrder(oldestFirst);
    const ok = order.map((l, k) => k === 0 || order[k - 1]!.balance.plus(l.amount).eq(l.balance));
    return { order, ok, breaks: ok.filter((x) => !x).length };
  };
  const forward = walk(links);
  const reverse = walk([...links].reverse());
  const first = links[0]?.event.date;
  const last = links[links.length - 1]?.event.date;
  const reversed =
    reverse.breaks < forward.breaks ||
    (reverse.breaks === forward.breaks && !!first && !!last && first > last);
  const { order, ok, breaks } = reversed ? reverse : forward;
  const oldest = order[0];
  const newest = order[order.length - 1];
  const opening = oldest ? oldest.balance.minus(oldest.amount) : null;
  const confirmed = new Set<number>();
  order.forEach((l, k) => {
    // The oldest row's link is to the opening balance: only a declared one confirms it.
    if (k === 0 ? declaredOpening !== null && opening !== null && declaredOpening.eq(opening) : ok[k])
      confirmed.add(l.event.row);
  });
  const broken = ok.findIndex((x) => !x);
  return {
    opening,
    closing: newest ? newest.balance : null,
    confirmed,
    breaks,
    broken:
      broken > 0
        ? { link: order[broken]!, expected: order[broken - 1]!.balance.plus(order[broken]!.amount) }
        : null,
  };
}

export function checkControls(figures: DeclaredFigures, statement: StatementEvents): ControlResult {
  const events = statement.events;
  const currencies = statement.currencies;
  const currency = figures.currency ?? (currencies.length === 1 ? currencies[0]! : null);
  // A batch in several currencies has no one sum: its sum checks are not made.
  const single = currencies.length <= 1 && (currencies.length === 0 || currencies[0] === currency);
  const ops = events.filter((e) => e.legs.length > 0);
  const printed = [
    ...ops.map((e) => e.legs[0]!.amount),
    ...ops.flatMap((e) => (e.balance === null ? [] : [e.balance])),
    ...[figures.opening, figures.closing, figures.debitTotal, figures.creditTotal].filter(
      (v): v is string => v !== null,
    ),
  ];
  const fmt = formatter(currency, printed);
  const amounts = ops.map((e) => new Decimal(e.legs[0]!.amount));
  const sum = amounts.reduce((a, b) => a.plus(b), zero);
  const debits = amounts.filter((a) => a.isNegative()).reduce((a, b) => a.plus(b.abs()), zero);
  const credits = amounts.filter((a) => a.isPositive() && !a.isZero()).reduce((a, b) => a.plus(b), zero);

  const declaredOpening = dec(figures.opening);
  const declaredClosing = dec(figures.closing);
  // The chain needs every operation's balance.
  const withBalance = ops.filter((e) => e.balance !== null);
  const chainable = single && ops.length > 0 && withBalance.length === ops.length;
  const chain = chainable
    ? chainOf(
        ops.map((e) => ({
          event: e,
          amount: new Decimal(e.legs[0]!.amount),
          balance: new Decimal(e.balance!),
        })),
        declaredOpening,
      )
    : null;

  const opening = declaredOpening ?? chain?.opening ?? null;
  const closing = declaredClosing ?? chain?.closing ?? null;
  const unreadable = events.some((e) => e.legs.length === 0);
  const rowsSum = single && !unreadable ? sum : null;
  const checks: ControlCheck[] = [
    compare("opening-balance", declaredOpening, chain?.opening ?? null, fmt),
    compare("closing-balance", declaredClosing, chain?.closing ?? null, fmt),
    compare(
      "balance-equation",
      closing,
      opening === null || rowsSum === null ? null : opening.plus(rowsSum),
      fmt,
    ),
    compare("debit-total", dec(figures.debitTotal), single && !unreadable ? debits : null, fmt),
    compare("credit-total", dec(figures.creditTotal), single && !unreadable ? credits : null, fmt),
  ];
  const operations = figures.operations;
  checks.push({
    kind: "operations",
    status: operations === null ? "not-checked" : operations === events.length ? "verified" : "mismatch",
    declared: operations === null ? null : String(operations),
    computed: String(events.length),
    difference: operations === null ? null : String(operations - events.length),
  });
  const dates = events.flatMap((e) => (e.date === null ? [] : [e.date])).sort();
  const span = dates.length > 0 ? { from: dates[0]!, to: dates[dates.length - 1]! } : null;
  const period = figures.period;
  checks.push({
    kind: "period",
    status:
      period === null || span === null
        ? "not-checked"
        : span.from >= period.from && span.to <= period.to
          ? "verified"
          : "mismatch",
    declared: period && `${period.from}/${period.to}`,
    computed: span && `${span.from}/${span.to}`,
    difference: null,
  });
  if (chain === null || ops.length < 2)
    checks.push({
      kind: "balance-chain",
      status: "not-checked",
      declared: null,
      computed: null,
      difference: null,
    });
  else if (chain.broken === null)
    checks.push({
      kind: "balance-chain",
      status: "verified",
      declared: null,
      computed: null,
      difference: null,
    });
  else {
    const { link, expected } = chain.broken;
    checks.push({
      ...compare("balance-chain", link.balance, expected, fmt),
      row: link.event.row,
      breaks: chain.breaks,
    });
  }
  const status = (kind: CheckKind) => checks.find((c) => c.kind === kind)!.status;
  // Rows that sum to zero satisfy the equation under either sign: it confirms none then.
  const equationFromStatement =
    status("balance-equation") === "verified" &&
    (declaredOpening !== null || declaredClosing !== null) &&
    !sum.isZero();
  return {
    currency,
    checks,
    bounds: {
      start: period?.from ?? span?.from ?? null,
      end: period?.to ?? span?.to ?? null,
      opening: opening && fmt(opening),
      closing: closing && fmt(closing),
      currency,
    },
    chainRows: chain?.confirmed ?? new Set(),
    totalsVerified:
      equationFromStatement ||
      (status("debit-total") === "verified" && status("credit-total") === "verified"),
  };
}

// ——— History (FR 3, AC2, EC2) ———

export type HistoryStatus = "continuous" | "gap" | "overlap" | "unknown";

export interface HistoryGap {
  readonly status: HistoryStatus;
  /** `gap`: the days no statement covers; `overlap`: the days both cover. Null — none (or not known). */
  readonly range: { readonly from: string; readonly to: string } | null;
  readonly previousClosing: string | null;
  readonly newOpening: string | null;
  /** New opening − previous closing, in `currency`; null — a balance is not known or the currencies differ. */
  readonly difference: string | null;
  readonly currency: string | null;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
/** The ISO date `days` after `date` (calendar arithmetic, no clock). */
function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * The new statement against the previous statement of the same account (FR 3): «безперервно» (the day after and the
 * same balance), «розрив» (days missing, or the next day with another balance), «перекриття» (the new one starts on or
 * before the previous end; duplicates go to the dedup rules, EC2), «невідомо» (no previous statement or no dates).
 */
export function historyGap(
  previous: Pick<StatementBounds, "end" | "closing" | "currency"> | null,
  next: Pick<StatementBounds, "start" | "opening" | "currency">,
): HistoryGap {
  const sameCurrency = previous !== null && previous.currency === next.currency;
  const fmt = formatter(next.currency, [previous?.closing ?? "", next.opening ?? ""]);
  const difference =
    sameCurrency && previous.closing !== null && next.opening !== null
      ? new Decimal(next.opening).minus(previous.closing)
      : null;
  const base = {
    previousClosing: previous?.closing ?? null,
    newOpening: next.opening,
    difference: difference && fmt(difference),
    currency: next.currency,
  };
  if (!previous?.end || !next.start || !ISO.test(previous.end) || !ISO.test(next.start))
    return { status: "unknown", range: null, ...base };
  if (next.start <= previous.end)
    return { status: "overlap", range: { from: next.start, to: previous.end }, ...base };
  const dayAfter = addDays(previous.end, 1);
  if (next.start > dayAfter)
    return { status: "gap", range: { from: dayAfter, to: addDays(next.start, -1) }, ...base };
  return { status: difference !== null && !difference.isZero() ? "gap" : "continuous", range: null, ...base };
}
