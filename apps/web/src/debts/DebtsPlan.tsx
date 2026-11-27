import { useMemo, useState } from "react";
import { Decimal } from "@willowsum/domain-kernel";
import { useI18n } from "@willowsum/i18n";
import { AmountField, Button, Field, Icon, Select } from "@willowsum/ui";
import { accountSettingsPath } from "../routing/routes.ts";
import { hrefFor } from "../routing/useHashPath.ts";
import { useSavePlan, useScenario, type Calculation, type Debt, type Scenario } from "./api.ts";
import { formatAmount, formatMonth } from "./format.ts";
import { initialAssumptions, isCard, parseRate, planBody, scenarioBody, type Assumptions } from "./model.ts";
import { Disclaimer } from "./parts.tsx";
import { ScheduleChart } from "./ScheduleChart.tsx";

/**
 * S-144 «План погашення» (BUD-19@PoC FR 1, FR 2, FR 4, FR 5, FR 10; AC1, AC2, AC4, AC5, AC6, AC11): one debt at a time,
 * the assumptions of a scenario (the debt's own data stays), the result of the base and of the scenario, the chart
 * and «Зберегти план». Every figure comes from `POST /v1/debts/{id}/scenario`; the browser calculates nothing. A credit
 * card has no rate and no regular payment: it asks for «Гасити щомісяця: …», which «Зберегти план» keeps as the
 * card's plan setting (FLW-44@PoC FR 1, BUD-19@PoC FR 2, AC5; owner decision 2026-11-27).
 */
export function DebtsPlan({ debts, refresh }: { debts: readonly Debt[]; refresh: () => void }) {
  const { t } = useI18n();
  const [selected, setSelected] = useState(debts[0]!.accountId);
  const debt = debts.find((d) => d.accountId === selected) ?? debts[0]!;
  return (
    <>
      <div className="ws-card debts-pick">
        <Select
          label={t("debts.plan.pick")}
          value={debt.accountId}
          onChange={setSelected}
          options={debts.map((d) => ({ value: d.accountId, label: d.name }))}
        />
        {debt.plan ? (
          <span className="debts-badge debts-badge--muted">{t("debts.plan.savedBadge")}</span>
        ) : null}
        <a className="ws-button" href={hrefFor(accountSettingsPath(debt.accountId))}>
          {t("debts.plan.openSettings")}
        </a>
      </div>
      <ScenarioPanel key={debt.accountId} debt={debt} refresh={refresh} />
    </>
  );
}

function ScenarioPanel({ debt, refresh }: { debt: Debt; refresh: () => void }) {
  const { t, locale } = useI18n();
  const [a, setA] = useState<Assumptions>(() => initialAssumptions(debt, locale === "uk"));
  const [nextId, setNextId] = useState(a.oneOffs.length);
  const [how, setHow] = useState(false);
  const [saved, setSaved] = useState<"saved" | "error" | null>(null);
  const [saving, setSaving] = useState(false);
  const save = useSavePlan(debt.accountId);
  const body = useMemo(() => scenarioBody(debt, a), [debt, a]);
  const { calc, retry } = useScenario(debt.accountId, body);
  const set = (patch: Partial<Assumptions>) => {
    setSaved(null);
    // A field that reports the value it already has changes nothing (it also reports itself when it mounts).
    setA((cur) =>
      (Object.keys(patch) as (keyof Assumptions)[]).every((k) => Object.is(cur[k], patch[k]))
        ? cur
        : { ...cur, ...patch },
    );
  };
  const currency = debt.balance.currency;
  const result: Scenario | null = calc.kind === "ready" ? calc.data : calc.kind === "idle" ? null : calc.last;
  const busy = calc.kind === "loading";
  const hasExtra = a.extra !== null && new Decimal(a.extra).gt(0);
  const card = isCard(debt);
  // A card's own amount is its base: a new amount alone is no scenario beside it (the server's base takes it too).
  const changed = body !== null && Object.keys(body).some((k) => !(card && k === "monthlyPayment"));
  const canSave = calc.kind === "ready" && body !== null && calc.data.scenario.status === "paid";

  const onSave = async () => {
    if (body === null) return;
    setSaving(true);
    const ok = await save(planBody(body, a.addPlanned && hasExtra));
    setSaving(false);
    setSaved(ok ? "saved" : "error");
    if (ok) refresh();
  };

  return (
    <>
      <div className="debts-plan-grid">
        <div className="debts-plan-side">
          <section className="ws-card debts-scenario" aria-labelledby="debts-scenario-title">
            <header className="debts-scenario-head">
              <h2 id="debts-scenario-title" className="debts-card-title">
                {t("debts.plan.scenario")}
              </h2>
              <span className="ws-muted debts-small">{t("debts.plan.scenarioHint")}</span>
            </header>
            <div className="debts-fields">
              <AmountField
                label={t("debts.plan.field.balance")}
                value={a.balance}
                currency={currency}
                onChange={(balance) => set({ balance })}
              />
              {card ? (
                <AmountField
                  label={t("debts.plan.field.cardAmount")}
                  value={a.payment}
                  currency={currency}
                  hint={t("debts.card.amountHint")}
                  onChange={(payment) => set({ payment })}
                />
              ) : (
                <>
                  <Field
                    label={t("debts.plan.field.rate")}
                    value={a.rate}
                    inputMode="decimal"
                    onChange={(rate) => set({ rate })}
                    error={a.rate !== "" && parseRate(a.rate) === null ? t("debts.plan.rateError") : null}
                  />
                  <AmountField
                    label={t("debts.plan.field.payment")}
                    value={a.payment}
                    currency={currency}
                    onChange={(payment) => set({ payment })}
                  />
                </>
              )}
              <AmountField
                label={t("debts.plan.field.extra")}
                value={a.extra}
                currency={currency}
                onChange={(extra) => set({ extra })}
              />
            </div>
            {a.oneOffs.map((o) => (
              <div key={o.id} className="debts-oneoff">
                <Field
                  label={t("debts.plan.oneOff.month")}
                  type="date"
                  value={o.month}
                  onChange={(month) =>
                    set({ oneOffs: a.oneOffs.map((x) => (x.id === o.id ? { ...x, month } : x)) })
                  }
                />
                <AmountField
                  label={t("debts.plan.oneOff.amount")}
                  value={o.amount}
                  currency={currency}
                  onChange={(amount) =>
                    set({ oneOffs: a.oneOffs.map((x) => (x.id === o.id ? { ...x, amount } : x)) })
                  }
                />
                <button
                  type="button"
                  className="ws-icon-button"
                  aria-label={t("debts.plan.oneOff.remove")}
                  title={t("debts.plan.oneOff.remove")}
                  onClick={() => set({ oneOffs: a.oneOffs.filter((x) => x.id !== o.id) })}
                >
                  <Icon name="trash" size={20} />
                </button>
              </div>
            ))}
            {result && result.scenario.cappedOneOffs.length > 0 ? (
              <p className="ws-muted debts-small" role="note">
                {t("debts.plan.oneOff.capped")}
              </p>
            ) : null}
            <div className="debts-actions">
              <Button
                label={t("debts.plan.oneOff.add")}
                onClick={() => {
                  set({ oneOffs: [...a.oneOffs, { id: nextId, month: "", amount: null }] });
                  setNextId(nextId + 1);
                }}
              />
              <button
                type="button"
                className="debts-link"
                aria-expanded={how}
                aria-controls="debts-how"
                onClick={() => setHow(!how)}
              >
                {t("debts.plan.how")}
              </button>
            </div>
            {how ? (
              <p id="debts-how" className="ws-muted debts-small">
                {t("debts.plan.howText")}
              </p>
            ) : null}
            <label className="debts-check">
              <input
                type="checkbox"
                checked={a.addPlanned && hasExtra}
                disabled={!hasExtra}
                onChange={(e) => set({ addPlanned: e.target.checked })}
              />
              <span>
                <span className="debts-strong">{t("debts.plan.addPlanned")}</span>
                <span className="ws-muted debts-small">{t("debts.plan.addPlannedHint")}</span>
              </span>
            </label>
            <div className="debts-actions">
              {canSave ? (
                <Button
                  label={t("debts.plan.save")}
                  variant="primary"
                  loading={saving}
                  onClick={() => void onSave()}
                />
              ) : (
                <Button
                  label={t("debts.plan.save")}
                  variant="primary"
                  disabled
                  disabledReason={t("debts.plan.saveWhy")}
                />
              )}
              {saved === "saved" ? (
                <p role="status" className="debts-saved">
                  {t("debts.plan.saved")}
                </p>
              ) : null}
              {saved === "error" ? (
                <p role="alert" className="debts-saved debts-saved--error">
                  {t("debts.plan.saveError")}
                </p>
              ) : null}
            </div>
          </section>
        </div>

        <div className="debts-plan-main">
          {body === null ? (
            <p className="ws-card debts-prompt" role="note">
              <Icon name="info" size={20} />
              <span>{t(card ? "debts.card.amountHint" : "debts.result.prompt")}</span>
            </p>
          ) : (
            <section className="ws-card debts-result" aria-labelledby="debts-result-title" aria-busy={busy}>
              <h2 id="debts-result-title" className="debts-card-title">
                {t("debts.result.title")}
              </h2>
              {calc.kind === "error" ? (
                <div role="alert" className="debts-calc-error">
                  <p>{t("debts.result.error")}</p>
                  <button type="button" className="ws-button" onClick={retry}>
                    {t("debts.result.retry")}
                  </button>
                </div>
              ) : null}
              {result ? (
                <div className="debts-result-cols">
                  <Outcome title={t("debts.result.base")} calc={result.base} currency={currency} />
                  {changed ? (
                    <Outcome title={t("debts.result.scenario")} calc={result.scenario} currency={currency} />
                  ) : null}
                </div>
              ) : null}
              {result?.saving && changed ? (
                <p className="debts-saving">
                  {result.saving.months > 0
                    ? t("debts.result.saving", {
                        months: String(result.saving.months),
                        amount: formatAmount(locale, result.saving.interest.amount, currency),
                      })
                    : t("debts.result.savingSame", {
                        amount: formatAmount(locale, result.saving.interest.amount, currency),
                      })}
                </p>
              ) : null}
            </section>
          )}

          {body !== null && result ? (
            <ScheduleChart
              base={result.base.schedule}
              scenario={changed ? result.scenario.schedule : []}
              currency={currency}
              busy={busy}
            />
          ) : null}
        </div>
      </div>
      <Disclaimer />
    </>
  );
}

/** FR 3, AC1, AC4: the payoff month and the interest of one calculation, or why there is no date. */
function Outcome({ title, calc, currency }: { title: string; calc: Calculation; currency: string }) {
  const { t, locale } = useI18n();
  return (
    <div className="debts-outcome">
      <p className="ws-muted debts-small">{title}</p>
      {calc.status === "paid" && calc.months !== null ? (
        <>
          <p className="debts-big">{t("debts.result.payoff", { months: String(calc.months) })}</p>
          <p className="ws-muted">
            {t("debts.result.detail", {
              month: calc.payoffMonth ? formatMonth(locale, calc.payoffMonth, "long") : "—",
              interest: calc.totalInterest ? formatAmount(locale, calc.totalInterest.amount, currency) : "—",
            })}
          </p>
        </>
      ) : (
        <p className="debts-big debts-big--warning">
          {calc.status === "over-limit" ? t("debts.overLimit") : t("debts.notDecreasing")}
        </p>
      )}
    </div>
  );
}
