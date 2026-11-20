import "./spendable.css";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Decimal } from "@willowsum/domain-kernel";
import { formatDate, formatMoney, useI18n, type MessageKey } from "@willowsum/i18n";
import { Button, Icon, IconButton, Popover, Skeleton, StatusMark } from "@willowsum/ui";
import { useAuthApi } from "../../auth/api.ts";
import { failureOf } from "../../auth/failure.ts";
import { useLoad } from "../../recurring/data.ts";
import { hrefFor } from "../../routing/useHashPath.ts";
import { childPath, GOALS, RECURRING, TRANSACTIONS } from "../../routing/routes.ts";
import { PlanRegion } from "../PlanGrid.tsx";
import {
  loadSourceNames,
  loadSpendable,
  shadeOf,
  SOURCE_KEYS,
  type Figures,
  type Money,
  type SourceNames,
  type SpendableData,
} from "./model.ts";

const FORMS = ["one", "few", "many", "other"] as const;
const plural = (locale: string, count: number): (typeof FORMS)[number] => {
  const rule = new Intl.PluralRules(locale === "uk" ? "uk-UA" : "en").select(count);
  return (FORMS as readonly string[]).includes(rule) ? (rule as (typeof FORMS)[number]) : "other";
};

const MINI: Readonly<Record<Figures["mini"][number]["row"], MessageKey>> = {
  income: "planning.spend.row.income",
  spent: "planning.spend.row.spent",
  regular: "planning.spend.row.regular",
  goals: "planning.spend.row.goals",
  mandatory: "planning.spend.row.mandatory",
};
const SOURCE_LABELS: Readonly<Record<(typeof SOURCE_KEYS)[number], MessageKey>> = {
  obligations: "planning.spend.source.obligations",
  incomes: "planning.spend.source.incomes",
  goals: "planning.spend.source.goals",
  plannedExpenses: "planning.spend.source.plannedExpenses",
};

/** Scrolls to a card of the page and moves the focus there (a source of the sum that has no page of its own). */
function goTo(region: string) {
  const el = document.querySelector<HTMLElement>(`[data-plan-region='${region}']`);
  if (!el) return;
  el.scrollIntoView?.({ block: "start" });
  el.querySelector<HTMLElement>("h2")?.setAttribute("tabindex", "-1");
  el.querySelector<HTMLElement>("h2")?.focus();
}

/**
 * BUD-03@PoC b) (row 126) FR 1, FR 4, FR 8, FR 10, FR 15, S-121: the card «Можна витратити» — the sum to the end of
 * the period, the daily limit, the five rows of the mini breakdown, «Перевитрата N €» in the state «перевищено»
 * (DS-23) with its two actions, and the full breakdown that the «›» of the heading opens. Every figure is the API's:
 * the web only formats. The card fills the region `spendable` of the grid; a space without the function (the API
 * answers 404) keeps the region as an empty slot. Only the current month has it (FR 4).
 */
export function SpendableCard({ period }: { period: string }) {
  const { t } = useI18n();
  const load = useCallback(
    (api: Parameters<typeof loadSpendable>[0]) => loadSpendable(api, period),
    [period],
  );
  const { result, reload } = useLoad(load);
  if (result.state === "ready" && result.data === null) return <PlanRegion name="spendable" span={4} />;
  return (
    <PlanRegion name="spendable" span={4} card>
      {result.state === "loading" ? (
        <section className="bud-card bud-spend" aria-label={t("planning.spend.title")}>
          <Skeleton variant="text" lines={4} />
        </section>
      ) : result.state === "error" ? (
        <section className="bud-card bud-spend" role="alert" aria-labelledby="bud-spend-error">
          <h2 id="bud-spend-error" className="ws-text-heading-3 bud-card-title">
            <Icon name="close" size={16} /> {t("planning.spend.error.title")}
          </h2>
          <p className="ws-muted">{t(failureOf(result.failure).key)}</p>
          <Retry onRetry={reload} code={failureOf(result.failure).code} />
        </section>
      ) : (
        <Ready data={result.data!} onRetry={reload} />
      )}
    </PlanRegion>
  );
}

function Retry({ onRetry, code }: { onRetry: () => void; code: string | undefined }) {
  const { t } = useI18n();
  return (
    <>
      <p>
        <button type="button" className="ws-button" onClick={onRetry}>
          {t("planning.budget.error.retry")}
        </button>
      </p>
      {code ? <p className="ws-muted">{t("planning.budget.error.code", { code })}</p> : null}
    </>
  );
}

function Ready({ data, onRetry }: { data: SpendableData; onRetry: () => void }) {
  const { t, locale } = useI18n();
  const { spendable, planOn } = data;
  const { figures, approximate } = spendable;
  const titleId = useId();
  const host = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const money = (m: Money) => formatMoney(locale, m.amount, m.currency);
  const monthOf = t(`planning.budget.monthOf.${spendable.period.slice(5, 7)}` as MessageKey);
  const anyApprox =
    approximate.nearestRateCount > 0 ||
    approximate.obligations ||
    approximate.incomes ||
    approximate.goals ||
    approximate.plannedExpenses;

  const head = (
    <div className="bud-spend-head">
      <div>
        <h2 id={titleId} className="ws-text-heading-3 bud-card-title">
          {t("planning.spend.title")}
        </h2>
        <p className="ws-muted bud-sub">{t("planning.spend.until", { month: monthOf })}</p>
      </div>
      {figures ? (
        <span className="ws-popover-host" ref={host}>
          <IconButton
            icon="chevron-right"
            label={t("planning.spend.breakdown.open")}
            expanded={open}
            onClick={() => setOpen((o) => !o)}
          />
          <Popover
            align="start"
            open={open}
            onClose={() => setOpen(false)}
            label={t("planning.spend.breakdown.title")}
            anchor={host}
          >
            <Breakdown data={data} figures={figures} onClose={() => setOpen(false)} />
          </Popover>
        </span>
      ) : null}
    </div>
  );

  // EC4: a source has no figure (no rate): no sum, never a partial one shown as complete.
  if (!figures) {
    const missing = SOURCE_KEYS.filter((k) => spendable.unavailable.includes(k)).map((k) =>
      t(SOURCE_LABELS[k]),
    );
    return (
      <section className="bud-card bud-spend" aria-labelledby={titleId} data-state="unavailable">
        {head}
        <p role="alert" className="bud-spend-fail">
          <Icon name="close" size={16} /> {t("planning.spend.error.title")}
        </p>
        {approximate.unavailableCount > 0 ? (
          <p className="ws-muted">
            {t("planning.budget.rate.unavailable", { count: approximate.unavailableCount })}
          </p>
        ) : null}
        {missing.length > 0 ? (
          <p className="ws-muted">{t("planning.spend.unavailable", { sources: missing.join(", ") })}</p>
        ) : null}
        <p>
          <button type="button" className="ws-button" onClick={onRetry}>
            {t("planning.budget.error.retry")}
          </button>
        </p>
      </section>
    );
  }

  const over = figures.overspend;
  const level = over ? shadeOf(over) : null;
  const days = t(`planning.spend.days.${plural(locale, spendable.daysLeft)}` as MessageKey, {
    count: spendable.daysLeft,
  });
  return (
    <section
      className="bud-card bud-spend"
      aria-labelledby={titleId}
      data-state={over ? "over" : "ok"}
      data-over-level={level ?? undefined}
    >
      {head}
      <p className="bud-spend-amount">
        <bdi className="ws-text-amount-l" data-testid="spendable-amount">
          {money(figures.amount)}
        </bdi>
        {anyApprox ? <StatusMark id="g.approximate" /> : null}
      </p>
      <p className="bud-spend-daily">
        <strong>{t("planning.spend.daily", { amount: money(figures.daily) })}</strong>{" "}
        <span className="ws-muted">{days}</span>
      </p>
      {over && level ? (
        <div className="bud-spend-over" data-level={level}>
          <p className="bud-spend-over-line">
            <StatusMark id="a.over" />
            <strong>{t("planning.spend.over", { amount: money(over.amount) })}</strong>
          </p>
          <span
            className="bud-spend-over-bar"
            aria-hidden="true"
            style={{ backgroundColor: `var(--ws-over-${level})` }}
          />
          <div className="bud-spend-actions">
            <Button
              variant="secondary"
              size="sm"
              label={t("planning.spend.over.categories")}
              onClick={() => goTo("categories")}
            />
            <Button
              variant="secondary"
              size="sm"
              label={t("planning.spend.over.goal")}
              href={hrefFor(planOn ? childPath("budgetPlan") : GOALS.path)}
            />
          </div>
        </div>
      ) : null}
      <dl className="bud-figures bud-spend-mini">
        {figures.mini.map((r) => (
          <div key={r.row} data-row={r.row}>
            <dt>
              {t(MINI[r.row])}
              {r.row === "income" && figures.income.pending ? (
                <>
                  {" "}
                  <StatusMark id="g.expected" />
                </>
              ) : null}
            </dt>
            <dd>{r.row === "income" ? money(r.amount) : deducted(r.amount, money)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** A figure the sum is lowered by: «−2 365,52 €»; a zero stays «0,00 €». The amount is the API's, never recomputed. */
function deducted(m: Money, money: (m: Money) => string): string {
  return new Decimal(m.amount).isZero() ? money(m) : `−${money(m)}`;
}

/** FR 8, AC2: the breakdown — each source with its sum, the list behind it and a way to the source. */
function Breakdown({
  data,
  figures,
  onClose,
}: {
  data: SpendableData;
  figures: Figures;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const api = useAuthApi();
  const [names, setNames] = useState<SourceNames | null>(null);
  useEffect(() => {
    let live = true;
    void loadSourceNames(api).then(
      (n) => live && setNames(n),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [api]);
  const money = (m: Money) => formatMoney(locale, m.amount, m.currency);
  const month = t(`planning.budget.month.${data.spendable.period.slice(5, 7)}` as MessageKey);
  const nameOf = (map: ReadonlyMap<string, string> | undefined, id: string | null, fallback: MessageKey) =>
    (id !== null ? map?.get(id) : undefined) || t(fallback);
  const approx = (on: boolean) => (on ? <StatusMark id="g.approximate" /> : null);
  const a = data.spendable.approximate;
  const income = figures.income;

  return (
    <div className="bud-spend-break">
      <div className="bud-spend-break-head">
        <h3 className="ws-text-heading-3 bud-card-title">{t("planning.spend.breakdown.title")}</h3>
        <IconButton icon="close" label={t("planning.spend.breakdown.close")} onClick={onClose} />
      </div>
      <Source
        label={t("planning.spend.row.expectedIncome")}
        amount={money(income.value)}
        note={
          <>
            {t("planning.spend.income.note", { plan: money(income.plan), actual: money(income.actual) })}{" "}
            {income.pending ? <StatusMark id="g.expected" /> : null} {approx(a.incomes)}
          </>
        }
        go={{
          label: t("planning.spend.go", { source: t("planning.budget.income.title") }),
          onClick: () => goTo("income"),
        }}
      />
      <Source
        label={t("planning.spend.row.spent")}
        amount={deducted(figures.spent.total, money)}
        note={
          <>
            {t("planning.spend.spent.note")} {approx(a.nearestRateCount > 0)}
          </>
        }
        go={{
          label: t("planning.spend.go", { source: t("planning.spend.row.spent") }),
          href: hrefFor(TRANSACTIONS.path),
        }}
      />
      <Source
        label={t("planning.spend.row.regular")}
        amount={deducted(figures.regularPayments.total, money)}
        note={
          <>
            {t("planning.spend.regular.note")} {approx(a.obligations)}
          </>
        }
        go={{
          label: t("planning.spend.go", { source: t("planning.spend.row.regular") }),
          href: hrefFor(RECURRING.path),
        }}
        items={figures.regularPayments.items.map((i, n) =>
          i.kind === "recurring"
            ? {
                key: `${i.paymentId ?? "p"}-${n}`,
                label: `${i.dueOn ? `${formatDate(locale, i.dueOn)} · ` : ""}${nameOf(names?.payments, i.paymentId, "planning.spend.item.payment")}`,
                status:
                  i.overdueDays !== null ? (
                    <StatusMark id="d.overdue" params={{ days: i.overdueDays }} />
                  ) : null,
                amount: money(i.amount),
              }
            : {
                key: `loan-${i.accountId}`,
                label: nameOf(names?.accounts, i.accountId, "planning.spend.item.loan"),
                status: null,
                amount: money(i.amount),
              },
        )}
      />
      <Source
        label={t("planning.spend.mandatory", { amount: money(figures.mandatory.total) })}
        amount={null}
        note={null}
        go={{
          label: t("planning.spend.go", { source: t("planning.budget.categories.title") }),
          onClick: () => goTo("categories"),
        }}
        items={figures.mandatory.categories.map((c) => ({
          key: c.categoryId,
          label: nameOf(names?.categories, c.categoryId, "planning.budget.uncategorized"),
          status: null,
          amount: money(c.amount),
        }))}
      />
      <Source
        label={t("planning.spend.goals.title")}
        amount={deducted(figures.goals.total, money)}
        note={
          <>
            {t("planning.spend.goals.note", {
              month: month.toLocaleLowerCase(locale === "uk" ? "uk-UA" : "en"),
            })}{" "}
            {approx(a.goals)}
          </>
        }
        go={{
          label: t("planning.spend.go", { source: t("planning.spend.goals.title") }),
          href: hrefFor(GOALS.path),
        }}
        items={figures.goals.items.map((g) => ({
          key: g.goalId,
          label: nameOf(names?.goals, g.goalId, "planning.spend.item.goal"),
          status: null,
          amount: money(g.amount),
        }))}
      />
      <Source
        label={t("planning.spend.row.planned")}
        amount={deducted(figures.plannedExpenses.total, money)}
        note={
          <>
            {t("planning.spend.planned.note")} {approx(a.plannedExpenses)}
          </>
        }
        go={{
          label: t("planning.spend.go", { source: t("planning.spend.row.planned") }),
          href: hrefFor(childPath("debtsPlan")),
        }}
        items={figures.plannedExpenses.items.map((e) => ({
          key: e.accountId,
          label: nameOf(names?.debts, e.accountId, "planning.spend.item.debt"),
          status: null,
          amount: money(e.amount),
        }))}
      />
      <p className="bud-spend-total">
        <span>{t("planning.spend.title")}</span>
        <strong>{money(figures.amount)}</strong>
      </p>
    </div>
  );
}

interface Item {
  readonly key: string;
  readonly label: string;
  readonly status: ReactNode;
  readonly amount: string;
}

function Source({
  label,
  amount,
  note,
  go,
  items = [],
}: {
  label: string;
  amount: string | null;
  note: ReactNode;
  go: { label: string; href?: string; onClick?: () => void };
  items?: readonly Item[];
}) {
  return (
    <section className="bud-spend-source">
      <div className="bud-spend-source-head">
        <div>
          <p className="bud-spend-source-label">{label}</p>
          {note ? <p className="ws-muted bud-sub">{note}</p> : null}
        </div>
        {amount !== null ? <strong className="bud-spend-source-amount">{amount}</strong> : null}
        {go.href !== undefined ? (
          <a className="ws-icon-button" href={go.href} aria-label={go.label} title={go.label}>
            <Icon name="chevron-right" size={20} />
          </a>
        ) : (
          <IconButton icon="chevron-right" label={go.label} onClick={go.onClick} />
        )}
      </div>
      {items.length > 0 ? (
        <ul className="bud-spend-items">
          {items.map((i) => (
            <li key={i.key}>
              <span className="bud-spend-item-name">{i.label}</span>
              {i.status}
              <span className="bud-spend-item-amount">{i.amount}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
