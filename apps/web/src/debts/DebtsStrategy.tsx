import { useId, useState } from "react";
import { Money } from "@willowsum/domain-kernel";
import { formatPercent, useI18n, type MessageKey } from "@willowsum/i18n";
import { AmountField, Field, Select } from "@willowsum/ui";
import { useStrategies, type Debt, type Strategies } from "./api.ts";
import { formatAmount, formatMonth, money } from "./format.ts";
import {
  initialEntries,
  isCard,
  minimumTotal,
  needsEntry,
  parseRate,
  strategyCurrencies,
  strategyDebts,
  type Entries,
} from "./model.ts";
import { DebtName, Disclaimer } from "./parts.tsx";

type Kind = "avalanche" | "snowball";
const KINDS: readonly { id: Kind; label: MessageKey; hint: MessageKey }[] = [
  { id: "avalanche", label: "debts.strategy.avalanche", hint: "debts.strategy.avalancheHint" },
  { id: "snowball", label: "debts.strategy.snowball", hint: "debts.strategy.snowballHint" },
];

/**
 * S-145 «Стратегія» (BUD-19@PoC FR 6, AC3, AC5): the debts with their minimum payments, «Усього на борги / міс.»
 * and the switch «Avalanche» / «Snowball». Both strategies are calculated together by the server
 * (`POST /v1/debts/strategy`); the difference is shown neutrally, with no «recommended» mark and no advice.
 * The minimum payments are fixed: a debt's own payment, or for a debt that has none (a credit card: FIN-01 gives it no
 * payment; owner 2026-11-16, «3 а») the minimum payment and the rate entered here, sent as `debts[]`. A credit card
 * takes part with its «Зменшувати на … / міс.» as a fixed payment and no rate (FLW-44@PoC FR 4, owner decision
 * 2026-11-27): from its saved plan, or entered here; without it, the card takes no part.
 */
export function DebtsStrategy({ debts }: { debts: readonly Debt[] }) {
  const { t, locale } = useI18n();
  const [entries, setEntries] = useState<Entries>(() => initialEntries(debts, locale === "uk"));
  const currencies = strategyCurrencies(debts, entries);
  const [picked, setPicked] = useState<string | null>(null);
  const currency =
    picked && currencies.includes(picked) ? picked : (currencies[0] ?? debts[0]!.balance.currency);
  const minimum = minimumTotal(debts, currency, entries);
  const needs = debts.filter(needsEntry);
  const [typed, setTyped] = useState<string | null>(null);
  const [kind, setKind] = useState<Kind>("avalanche");
  const group = useId();
  const total = typed !== null ? Money.of(typed, currency) : minimum;
  const tooLow = total.compare(minimum) < 0;
  const asked = currencies.length > 0 && !total.isZero() && !tooLow;
  const { calc, retry } = useStrategies(
    asked
      ? {
          total: { amount: total.toDecimalString(), currency },
          ...(strategyDebts(debts, entries, currency).length > 0
            ? { debts: strategyDebts(debts, entries, currency) }
            : {}),
        }
      : null,
  );
  const result: Strategies | null =
    calc.kind === "ready" ? calc.data : calc.kind === "idle" ? null : calc.last;
  const money = (m: Money) => formatAmount(locale, m.toDecimalString(), currency);

  return (
    <>
      <section className="ws-card debts-scenario debts-strategy-head" aria-label={t("debts.strategy.total")}>
        <div className="debts-fields debts-fields--strategy">
          <AmountField
            label={t("debts.strategy.total")}
            value={total.toDecimalString()}
            currency={currency}
            onChange={(v) => setTyped(v)}
            error={tooLow ? t("debts.strategy.totalLow", { min: money(minimum) }) : null}
            hint={
              tooLow
                ? undefined
                : t("debts.strategy.totalHint", { min: money(minimum), rest: money(total.minus(minimum)) })
            }
          />
          {currencies.length > 1 ? (
            <Select
              label={t("debts.strategy.currency")}
              value={currency}
              onChange={(c) => {
                setPicked(c);
                setTyped(null);
              }}
              options={currencies.map((c) => ({ value: c, label: c }))}
            />
          ) : null}
        </div>
        <fieldset className="ws-segmented">
          <legend className="ws-segmented-legend">{t("debts.strategy.switch")}</legend>
          <div className="ws-segmented-options">
            {KINDS.map((k) => (
              <label key={k.id} className="ws-segmented-option">
                <input
                  type="radio"
                  name={group}
                  value={k.id}
                  checked={kind === k.id}
                  onChange={() => setKind(k.id)}
                />
                <span>{t(k.label)}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </section>

      {needs.length > 0 ? (
        <section className="ws-card debts-scenario" aria-label={t("debts.strategy.enter")}>
          <p className="ws-muted debts-small">{t("debts.strategy.enter")}</p>
          {needs.map((d) => {
            const e = entries[d.accountId] ?? { min: null, rate: "" };
            const set = (patch: Partial<typeof e>) =>
              setEntries((cur) => {
                const was = cur[d.accountId] ?? e;
                const next = { ...was, ...patch };
                return next.min === was.min && next.rate === was.rate ? cur : { ...cur, [d.accountId]: next };
              });
            return (
              <div key={d.accountId} className="debts-fields">
                <span className="debts-strong">{d.name}</span>
                {isCard(d) ? (
                  <AmountField
                    label={t("debts.strategy.cardAmountOf", { name: d.name })}
                    value={e.min}
                    currency={d.balance.currency}
                    hint={t("debts.card.amountHint")}
                    onChange={(min) => set({ min })}
                  />
                ) : null}
                {!isCard(d) && d.annualRate === null ? (
                  <Field
                    label={t("debts.strategy.rateOf", { name: d.name })}
                    value={e.rate}
                    inputMode="decimal"
                    onChange={(rate) => set({ rate })}
                    error={e.rate !== "" && parseRate(e.rate) === null ? t("debts.plan.rateError") : null}
                  />
                ) : null}
                {!isCard(d) && d.monthlyPayment === null ? (
                  <AmountField
                    label={t("debts.strategy.minOf", { name: d.name })}
                    value={e.min}
                    currency={d.balance.currency}
                    onChange={(min) => set({ min })}
                  />
                ) : null}
              </div>
            );
          })}
        </section>
      ) : null}

      {calc.kind === "error" ? (
        <div role="alert" className="ws-card debts-calc-error">
          <p>{t("debts.strategy.error")}</p>
          <button type="button" className="ws-button" onClick={retry}>
            {t("debts.result.retry")}
          </button>
        </div>
      ) : null}
      {currencies.length === 0 ? <p className="ws-card ws-muted">{t("debts.strategy.none")}</p> : null}
      {result ? (
        <Compared result={result} kind={kind} currency={currency} busy={calc.kind === "loading"} />
      ) : null}
      {result ? <Order debts={debts} result={result} kind={kind} /> : null}
      <Disclaimer />
    </>
  );
}

function Compared({
  result,
  kind,
  currency,
  busy,
}: {
  result: Strategies;
  kind: Kind;
  currency: string;
  busy: boolean;
}) {
  const { t, locale } = useI18n();
  const a = result.avalanche;
  const s = result.snowball;
  let diff: string | null = null;
  if (a.totalInterest && s.totalInterest) {
    const gap = Money.of(a.totalInterest.amount, currency).minus(Money.of(s.totalInterest.amount, currency));
    const amount = formatAmount(locale, (gap.isNegative() ? gap.negated() : gap).toDecimalString(), currency);
    diff =
      a.months === s.months
        ? t("debts.strategy.diffSame", { months: String(a.months), amount })
        : t("debts.strategy.diffMonths", { avalanche: String(a.months), snowball: String(s.months), amount });
  }
  return (
    <section aria-busy={busy} className="debts-strategies">
      <div className="debts-result-cols">
        {KINDS.map((k) => {
          const r = result[k.id];
          return (
            <div
              key={k.id}
              className={`ws-card debts-outcome${kind === k.id ? " debts-outcome--chosen" : ""}`}
            >
              <p className="debts-strong">
                {t(k.label)} <span className="ws-muted debts-small">{t(k.hint)}</span>
                {kind === k.id ? (
                  <span className="debts-badge debts-badge--muted">{t("debts.strategy.chosen")}</span>
                ) : null}
              </p>
              {r.status === "paid" && r.months !== null ? (
                <>
                  <p className="debts-big">{t("debts.strategy.allPaid", { months: String(r.months) })}</p>
                  <p className="ws-muted">
                    {t("debts.strategy.detail", {
                      month: r.payoffMonth ? formatMonth(locale, r.payoffMonth, "long") : "—",
                      interest: r.totalInterest
                        ? formatAmount(locale, r.totalInterest.amount, currency)
                        : "—",
                    })}
                  </p>
                </>
              ) : (
                <p className="debts-big debts-big--warning">
                  {r.status === "over-limit" ? t("debts.overLimit") : t("debts.notDecreasing")}
                </p>
              )}
            </div>
          );
        })}
      </div>
      {diff ? <p className="debts-saving">{diff}</p> : null}
    </section>
  );
}

/**
 * FR 6, AC3, AC5: the payoff order of the chosen strategy — each debt with its terms and the month the server says it
 * is paid — and, after them, the debts left out of the calculation with the reason (no rate or payment, another
 * currency, already paid).
 */
function Order({ debts, result, kind }: { debts: readonly Debt[]; result: Strategies; kind: Kind }) {
  const { t, locale } = useI18n();
  const byId = new Map(debts.map((d) => [d.accountId, d]));
  const rows = [...result[kind].debts].sort((x, y) => x.months - y.months);
  return (
    <section className="ws-card debts-table ws-table-wrap" aria-labelledby="debts-order-title">
      <h2 id="debts-order-title" className="debts-card-title">
        {t("debts.strategy.order")} · {t(KINDS.find((k) => k.id === kind)!.label)}
      </h2>
      <p className="ws-muted debts-small">{t("debts.strategy.orderHint")}</p>
      <table className="ws-table">
        <thead>
          <tr>
            <th scope="col">{t("debts.strategy.col.order")}</th>
            <th scope="col">{t("debts.col.debt")}</th>
            <th scope="col" className="debts-num">
              {t("debts.col.balance")}
            </th>
            <th scope="col" className="debts-num">
              {t("debts.col.rate")}
            </th>
            <th scope="col" className="debts-num">
              {t("debts.strategy.col.min")}
            </th>
            <th scope="col">{t("debts.col.payoff")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const d = byId.get(r.accountId);
            if (!d) return null;
            return (
              <tr key={r.accountId}>
                <td data-label={t("debts.strategy.col.order")}>{i + 1}</td>
                <td data-label={t("debts.col.debt")}>
                  <DebtName debt={d} />
                </td>
                <td data-label={t("debts.col.balance")} className="debts-num debts-strong">
                  {money(locale, d.balance)}
                </td>
                <td data-label={t("debts.col.rate")} className="debts-num">
                  {d.annualRate === null ? "—" : formatPercent(locale, d.annualRate, { digits: 1 })}
                </td>
                <td data-label={t("debts.strategy.col.min")} className="debts-num">
                  {(isCard(d) ? d.cardMonthlyAmount : d.monthlyPayment) === null
                    ? "—"
                    : money(locale, (isCard(d) ? d.cardMonthlyAmount : d.monthlyPayment)!)}
                </td>
                <td data-label={t("debts.col.payoff")}>
                  <span className="debts-stack">
                    <span>{formatMonth(locale, r.payoffMonth)}</span>
                    <span className="ws-muted debts-small">
                      {t("debts.payoffIn", { months: String(r.months) })}
                    </span>
                  </span>
                </td>
              </tr>
            );
          })}
          {result.excluded.map((x) => {
            const d = byId.get(x.accountId);
            if (!d) return null;
            return (
              <tr key={x.accountId}>
                <td data-label={t("debts.strategy.col.order")}>—</td>
                <td data-label={t("debts.col.debt")}>
                  <DebtName debt={d} />
                </td>
                <td data-label={t("debts.col.balance")} className="debts-num debts-strong">
                  {money(locale, d.balance)}
                </td>
                <td colSpan={3} className="ws-muted">
                  {t("debts.strategy.excluded")} · {t(`debts.strategy.reason.${x.reason}`)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
