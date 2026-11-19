import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import {
  currencySymbolOf,
  formatDelta,
  formatMoney,
  useI18n,
  type Locale,
  type MessageKey,
  type Translate,
} from "@willowsum/i18n";
import {
  EmptyState,
  ErrorState,
  formatPeriodRange,
  Icon,
  PeriodPicker,
  Segmented,
  Select,
  StatusMark,
  Table,
  type TableColumn,
  type TableRow,
} from "@willowsum/ui";
import { failureOf } from "../../auth/failure.ts";
import { AppLayout } from "../../pages/AppLayout.tsx";
import { kyivToday, useLoad, type Load } from "../../recurring/data.ts";
import { BUDGET, childPath, IMPORT_WIZARD_PATH } from "../../routing/routes.ts";
import { hrefFor } from "../../routing/useHashPath.ts";
import { useDocumentTitle } from "../../useDocumentTitle.ts";
import { monthOf } from "../budget/model.ts";
import "./compare.css";
import {
  allowedBases,
  anchorTo,
  defaultBase,
  hasEarlier,
  hashOf,
  isLatest,
  loadCompare,
  loadYear,
  periodsOf,
  shiftPeriod,
  stateFromHash,
  TYPES,
  yearOf,
  type BaseId,
  type Change,
  type CompareData,
  type PeriodType,
  type Row,
  type State,
  type View,
  type YearData,
} from "./model.ts";
import { YearTable } from "./YearTable.tsx";

const K = (key: string) => `planning.compare.${key}` as MessageKey;
const subscribe = (onChange: () => void) => {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
};
const readHash = () => window.location.hash;
const STORE = "ws.budget.compare";

type Shown =
  { kind: "compare"; key: string; data: CompareData } | { kind: "year"; key: string; data: YearData };

const keyOf = (s: State) =>
  s.view === "year" ? `year:${yearOf(s)}` : `${s.type}:${s.period}:${s.base}:${s.full}`;
const ROMAN = ["I", "II", "III", "IV"] as const;

/** CMP-72: the names of the periods («Жовтень 2026», «III квартал 2026», «Січень — жовтень 2026», «2026»). */
export function periodName(
  t: Translate,
  locale: Locale,
  type: PeriodType,
  period: string,
  today: string,
): string {
  const year = period.slice(0, 4);
  if (type === "month") return `${t(`planning.budget.month.${period.slice(5)}` as MessageKey)} ${year}`;
  if (type === "quarter") {
    const n = Number(period.slice(6));
    return t(K("period.quarter"), { quarter: locale === "uk" ? (ROMAN[n - 1] ?? "") : String(n), year });
  }
  if (type === "ytd") {
    const name = t(`planning.budget.month.${monthOf(today).slice(5)}` as MessageKey);
    // «Січень — жовтень 2026»: the second month is lower case in Ukrainian.
    const month = locale === "uk" ? name.toLocaleLowerCase("uk-UA") : name;
    return t(K("period.ytd"), { month, year });
  }
  return year;
}

/** BUD-06@PoC b), S-132 and S-290: «Порівняння» of the budget page, without the page shell (the shell wraps it in `ComparePage`). */
export function CompareScreen({ today = kyivToday() }: { today?: string }) {
  const { t, locale } = useI18n();
  const hash = useSyncExternalStore(subscribe, readHash, () => "");
  const s = stateOf(hash, today);
  const [firstMonth, setFirstMonth] = useState<string | null>(null);

  const load = useCallback(
    async (api: Parameters<typeof loadCompare>[0]): Promise<Load<Shown>> => {
      if (s.view === "year") {
        const r = await loadYear(api, yearOf(s));
        return r.state === "ready"
          ? { state: "ready", data: { kind: "year", key: keyOf(s), data: r.data } }
          : r;
      }
      const r = await loadCompare(api, s);
      return r.state === "ready"
        ? { state: "ready", data: { kind: "compare", key: keyOf(s), data: r.data } }
        : r;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [s.type, s.period, s.base, s.full, s.view],
  );
  const { result, reload } = useLoad(load);
  const shown = result.state === "ready" && result.data.key === keyOf(s) ? result.data : null;
  const settled = shown !== null;
  const compare = shown?.kind === "compare" ? shown.data.compare : null;

  // The history's first month is the same for every period: the finished months counted back from today.
  const first = compare ? shiftPeriod("month", monthOf(today), -compare.finishedPeriods) : null;
  if (first !== null && first !== firstMonth) setFirstMonth(first);
  useEffect(() => {
    try {
      window.localStorage.setItem(STORE, JSON.stringify({ type: s.type, period: s.period }));
    } catch {
      /* the choice is a per-viewer convenience: the page works without it */
    }
  }, [s.type, s.period]);

  const go = (next: State) => {
    window.location.hash = hashOf(childPath("budgetCompare"), next);
  };
  const name = (type: PeriodType, period: string) => periodName(t, locale, type, period, today);
  const label = name(s.type, s.period);
  const currency = compare?.currency ?? "EUR";
  const lastYear = shiftPeriod(s.type, s.period, s.type === "quarter" ? -4 : s.type === "month" ? -12 : -1);

  const typeChoices = TYPES.map((id) => ({ id, label: t(K(`type.${id}`)) }));
  const periodChoices = periodsOf(s.type, firstMonth, today).map((id) => ({ id, label: name(s.type, id) }));

  return (
    <div className="cmp-screen">
      <div className="app-page-head cmp-head">
        <div>
          <h1>{t(K("title"))}</h1>
          <p className="ws-muted">{t(K("subtitle"), { currency })}</p>
        </div>
      </div>
      <div className="cmp-toolbar">
        <PeriodPicker
          typeLabel={t(K("picker.type"))}
          typeName={(type) => t(K("picker.typeName"), { type })}
          types={typeChoices}
          type={s.type}
          onTypeChange={(type) => {
            const to = type as PeriodType;
            go({ ...s, type: to, period: anchorTo(to, s.type, s.period, today), base: null, full: false });
          }}
          periods={periodChoices}
          period={s.period}
          periodLabel={label}
          periodListLabel={t(K("picker.list"))}
          prevLabel={t(K("picker.prev"))}
          nextLabel={t(K("picker.next"))}
          prevDisabled={!hasEarlier(s.type, s.period, firstMonth, today)}
          prevHint={t(K("picker.noEarlier"))}
          nextDisabled={isLatest(s.type, s.period, today)}
          onPrev={() => go({ ...s, period: shiftPeriod(s.type, s.period, -1) })}
          onNext={() => go({ ...s, period: shiftPeriod(s.type, s.period, 1) })}
          onPeriodChange={(period) => go({ ...s, period })}
          announce={(p) => t(K("picker.shown"), { period: p })}
        />
        {s.view === "compare" ? (
          <BaseControl
            s={s}
            compare={compare}
            lastYear={name(s.type, lastYear)}
            onBase={(base) => go({ ...s, base })}
            onFull={(full) => go({ ...s, full })}
          />
        ) : null}
        <Segmented
          legend={t(K("view.group"))}
          value={s.view}
          options={[
            { value: "compare", label: t(K("view.compare")) },
            { value: "year", label: t(K("view.year")) },
          ]}
          onChange={(view) => go({ ...s, view: view as View })}
        />
      </div>
      <Body
        s={s}
        shown={shown}
        result={result}
        settled={settled}
        reload={reload}
        label={label}
        locale={locale}
      />
    </div>
  );
}

/** The state of the hash, or — when the address has no choice — the last one of this viewer. */
function stateOf(hash: string, today: string): State {
  if (hash.includes("?")) return stateFromHash(hash, today);
  try {
    const saved = JSON.parse(window.localStorage.getItem(STORE) ?? "null") as {
      type?: string;
      period?: string;
    } | null;
    if (saved?.type && saved.period)
      return stateFromHash(`#?type=${saved.type}&period=${saved.period}`, today);
  } catch {
    /* no stored choice */
  }
  return stateFromHash(hash, today);
}

function BaseControl({
  s,
  compare,
  lastYear,
  onBase,
  onFull,
}: {
  s: State;
  compare: CompareData["compare"] | null;
  lastYear: string;
  onBase: (base: BaseId | null) => void;
  onFull: (full: boolean) => void;
}) {
  const { t, locale } = useI18n();
  const chosen = compare?.base.base ?? s.base ?? defaultBase(s.type);
  const text = (b: BaseId): string =>
    b === "previous"
      ? t(K("base.previous"))
      : b === "last-year"
        ? t(K(s.type === "year" ? "base.lastYearOfYear" : "base.lastYear"))
        : t(K("base.avg"), { n: b.slice(3) });
  const options = allowedBases(s.type).map((b) => {
    const info = compare?.bases.find((x) => x.base === b);
    const off = info !== undefined && !info.available;
    const why =
      info?.reason === "no_finished_periods"
        ? t(K("base.noFinished"), { base: text(b) })
        : t(K("base.noData"), {
            base: text(b),
            period: s.type === "month" && locale === "uk" ? lastYear.toLocaleLowerCase("uk-UA") : lastYear,
          });
    return { value: b, label: off ? why : text(b), disabled: off };
  });
  const full =
    compare !== null &&
    (chosen === "previous" || chosen === "last-year") &&
    (compare.inProgress || s.type === "ytd");
  const importNeeded =
    compare?.bases.some((x) => x.base === "last-year" && x.reason === "no_history") ?? false;
  return (
    <>
      <div className="cmp-base">
        <Select
          label={t(K("base.label"))}
          value={chosen}
          options={options}
          onChange={(v) => onBase(v as BaseId)}
        />
      </div>
      {full ? (
        <label className="ws-switch cmp-full">
          <input type="checkbox" role="switch" checked={s.full} onChange={(e) => onFull(e.target.checked)} />
          <span className="ws-switch-track" aria-hidden="true" />
          <span>{t(K("full.label"))}</span>
        </label>
      ) : null}
      {importNeeded ? (
        <a className="ws-link cmp-import" href={hrefFor(IMPORT_WIZARD_PATH)}>
          {t(K("base.import"))}
        </a>
      ) : null}
    </>
  );
}

function Body({
  s,
  shown,
  result,
  settled,
  reload,
  label,
  locale,
}: {
  s: State;
  shown: Shown | null;
  result: Load<Shown>;
  settled: boolean;
  reload: () => void;
  label: string;
  locale: Locale;
}) {
  const { t } = useI18n();
  if (result.state === "error") {
    const key = failureOf(result.failure).key;
    const unavailable = key === "auth.error.unavailable";
    return (
      <ErrorState
        text={t(unavailable ? K("error.unavailable") : K("error.text"))}
        code={failureOf(result.failure).code}
        onRetry={reload}
      />
    );
  }
  if (!settled || shown === null)
    return <Table caption={t(K("title"))} columns={[]} rows={[]} state="loading" />;
  if (shown.kind === "year") return <YearTable data={shown.data} />;
  const { compare, names } = shown.data;
  if (compare.finishedPeriods === 0)
    return (
      <EmptyState
        title={t(K("empty.title"))}
        text={t(K("empty.text"))}
        primary={{ label: t(K("base.import")), href: hrefFor(IMPORT_WIZARD_PATH) }}
      />
    );
  return <Tables s={s} compare={compare} names={names} label={label} locale={locale} />;
}

function Tables({
  s,
  compare,
  names,
  label,
  locale,
}: {
  s: State;
  compare: CompareData["compare"];
  names: ReadonlyMap<string, string>;
  label: string;
  locale: Locale;
}) {
  const { t } = useI18n();
  const base = compare.base;
  const kind: "previous" | "lastYear" | "avg" =
    base.base === "previous" ? "previous" : base.base === "last-year" ? "lastYear" : "avg";
  const requested = base.base.startsWith("avg") ? Number(base.base.slice(3)) : 0;
  const money = (m: { amount: string; currency: string }) => formatMoney(locale, m.amount, m.currency);
  const dash = t(K("dash"));

  const columns: TableColumn[] = [
    { key: "category", label: t(K("col.category")), width: "22%" },
    { key: "current", label: label, type: "amount", width: "13%" },
    { key: "plan", label: t(K("col.plan")), type: "amount", width: "13%" },
    { key: "planDiff", label: t(K("col.planDiff")), type: "amount", width: "19%" },
    {
      key: "base",
      label: t(K(kind === "avg" ? "col.avg" : kind === "previous" ? "col.previous" : "col.lastYear"), {
        n: String(requested),
      }),
      type: "amount",
    },
    {
      key: "baseDiff",
      label: t(
        K(kind === "avg" ? "col.avgDiff" : kind === "previous" ? "col.previousDiff" : "col.lastYearDiff"),
      ),
      type: "amount",
    },
  ];
  const baseNote =
    base.base.startsWith("avg") && base.months !== null && base.months < requested
      ? t(K("base.months"), { n: String(base.months) })
      : null;

  const rowOf = (id: string, name: string, r: Row, outside: boolean, strong: boolean): TableRow => ({
    id,
    label: name,
    cells: {
      category: strong ? <strong>{name}</strong> : name,
      current: money(r.current),
      plan: r.plan ? (
        money(r.plan)
      ) : (
        <span>
          {dash}
          {outside ? <span className="cmp-sub ws-muted">{t(K("plan.none"))}</span> : null}
        </span>
      ),
      planDiff: <ChangeCell change={r.planDifference} />,
      base: r.base ? money(r.base) : dash,
      baseDiff: <ChangeCell change={r.difference} />,
    },
  });
  const nameOf = (id: string | null) =>
    id === null ? t("planning.budget.uncategorized") : (names.get(id) ?? "");
  const incomeRows = compare.income.categories.map((r, i) =>
    rowOf(`i${i}`, nameOf(r.categoryId), r, false, false),
  );
  if (compare.income.categories.length > 1)
    incomeRows.push(rowOf("it", t(K("income.total")), compare.income.overall, false, true));
  const expenseRows = compare.expenses.categories.map((r, i) =>
    rowOf(`e${i}`, nameOf(r.categoryId), r, r.plan === null, false),
  );
  expenseRows.push(rowOf("et", t(K("expenses.total")), compare.expenses.overall, false, true));

  const range = (w: { from: string; to: string }) => formatPeriodRange(locale, w.from, w.to);
  const cut = compare.inProgress || s.type === "ytd";
  const vsKey = kind === "avg" ? "avg" : kind === "previous" ? "previous" : "lastYear";
  const monthOfPeriod = s.type === "month" && compare.finished ? s.period : null;

  return (
    <div className="cmp-body">
      {cut && base.window ? (
        <p className="cmp-note ws-muted">
          {t(K(base.full ? "window.full" : "window.cut"), {
            current: range(compare.window),
            base: range(base.window),
          })}
        </p>
      ) : null}
      {baseNote ? <p className="cmp-note ws-muted">{baseNote}</p> : null}
      <Notes compare={compare} />
      {!base.available ? (
        <p className="cmp-note" role="status">
          {t(K("base.unavailable"))}
        </p>
      ) : null}
      {compare.largest.length > 0 && base.available ? (
        <section className="ws-card cmp-largest" aria-labelledby="cmp-largest-title">
          <div className="cmp-largest-head">
            <h2 id="cmp-largest-title" className="ws-text-heading-3">
              {t(K("largest.title"))}
            </h2>
            {monthOfPeriod ? (
              <a
                className="ws-icon-button"
                href={hrefFor(`${BUDGET.path}?period=${monthOfPeriod}`)}
                aria-label={t(K("largest.open"), { month: label })}
                title={t(K("largest.open"), { month: label })}
              >
                <Icon name="chevron-right" size={16} />
              </a>
            ) : null}
          </div>
          <p className="ws-muted">{t(K(`largest.sub.${vsKey}`), { period: label })}</p>
          <ol className="cmp-largest-list">
            {compare.largest.map((l, i) => {
              const diff = l.transactions.base === null ? 0 : l.transactions.current - l.transactions.base;
              const f = formatDelta(locale, {
                amount: { value: l.difference.amount, currency: l.difference.currency, digits: 2 },
              });
              return (
                <li key={i}>
                  {t(K("largest.item"), {
                    category: nameOf(l.categoryId),
                    change: f.text,
                    vs: t(K(`vs.${vsKey}`)),
                    tx: diff === 0 ? "" : txClause(t, locale, diff),
                  })}
                </li>
              );
            })}
          </ol>
        </section>
      ) : null}
      <h2 className="ws-text-heading-3">{t(K("income.title"))}</h2>
      <Table caption={t(K("income.title"))} columns={columns} rows={incomeRows} />
      <h2 className="ws-text-heading-3">{t(K("expenses.title"))}</h2>
      <Table caption={t(K("expenses.title"))} columns={columns} rows={expenseRows} />
    </div>
  );
}

/** «, на 6 транзакцій більше»: a count of transactions, not money. */
function txClause(t: Translate, locale: Locale, diff: number): string {
  const rule = new Intl.PluralRules(locale === "uk" ? "uk-UA" : "en").select(Math.abs(diff));
  const form = rule === "one" || rule === "few" || rule === "many" ? rule : "other";
  return t(K(`tx.${diff > 0 ? "more" : "less"}.${form}`), { count: Math.abs(diff) });
}

/** BUD-06 «Суми»: the nearest-rate and the no-rate counts of the window, shown with their numbers. */
function Notes({ compare }: { compare: CompareData["compare"] }) {
  const { t, locale } = useI18n();
  const { nearestRateCount, unavailableCount } = compare.approximate;
  const rule = new Intl.PluralRules(locale === "uk" ? "uk-UA" : "en").select(nearestRateCount);
  const form = rule === "one" || rule === "few" || rule === "many" ? rule : "other";
  return (
    <>
      {nearestRateCount > 0 ? (
        <p className="cmp-note">
          <StatusMark id="g.approximate" />{" "}
          {t(`planning.budget.approx.${form}` as "planning.budget.approx.one", { count: nearestRateCount })}
        </p>
      ) : null}
      {unavailableCount > 0 ? (
        <p className="cmp-note">{t("planning.budget.rate.unavailable", { count: unavailableCount })}</p>
      ) : null}
    </>
  );
}

/**
 * A change with an arrow (DS-04), coloured by the API's `tone` (better or worse, not the direction); the arrow and the
 * spoken name keep the meaning without the colour (NFR-08). «без змін» is a blue «—».
 */
export function ChangeCell({ change, short = false }: { change: Change | null; short?: boolean }) {
  const { t, locale } = useI18n();
  if (change === null) return <span>{t(K("dash"))}</span>;
  if (change.tone === "none")
    return (
      <span className="cmp-tone cmp-tone--none">
        <span aria-hidden="true">—</span>
        <span className="ws-visually-hidden">{t(K("unchanged"))}</span>
      </span>
    );
  const f = formatDelta(locale, {
    amount: { value: change.amount.amount, currency: change.amount.currency, digits: 2 },
    // The percentage carries the sign of the arrow: DS-04 leaves out a part that moves the other way.
    ...(change.percent !== null && !short
      ? { percent: change.direction === "down" ? `-${change.percent}` : change.percent }
      : {}),
  });
  // `short` is the year table: the note says «суми в EUR», so the cell keeps the number and the arrow, not the symbol.
  const text = short ? f.text.replace(currencySymbolOf(locale, change.amount.currency), "").trim() : f.text;
  return (
    <span className={`cmp-tone cmp-tone--${change.tone}`}>
      <span aria-hidden="true">{text}</span>
      <span className="ws-visually-hidden">{f.label}</span>
    </span>
  );
}

/** The page: the shell around the screen. */
export function ComparePage() {
  const { t } = useI18n();
  useDocumentTitle(t(K("title")));
  return (
    <AppLayout sectionId={BUDGET.sectionId} pageId={BUDGET.id}>
      <CompareScreen />
    </AppLayout>
  );
}
