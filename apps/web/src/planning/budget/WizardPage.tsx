import { useCallback, useEffect, useRef, useState } from "react";
import { formatLocaleOf, formatMoney, useI18n, type MessageKey, type Translate } from "@willowsum/i18n";
import { AmountField, Button, FocusShell, Skeleton, Stepper, type StepState } from "@willowsum/ui";
import { useAuthApi } from "../../auth/api.ts";
import { failureOf } from "../../auth/failure.ts";
import { Icon } from "@willowsum/ui";
import { useLoad } from "../../recurring/data.ts";
import { BUDGET } from "../../routing/routes.ts";
import { useDocumentTitle } from "../../useDocumentTitle.ts";
import "./budget.css";
import { monthOf, shiftMonth } from "./model.ts";
import { createBody, createBudget, loadWizard, newKey, type Start, type WizardData } from "./wizard.ts";

type Method = "spending" | "zero";
type Ready = Extract<WizardData, { kind: "ready" }>;

/** The month in the running text: lower case in Ukrainian («листопад»), as the catalogue has it in English. */
const monthWord = (t: Translate, locale: string, period: string): string => {
  const name = t(`planning.budget.month.${period.slice(5, 7)}` as MessageKey);
  return locale === "uk" ? name.toLocaleLowerCase("uk") : name;
};

/**
 * BUD-02@PoC e) (wave 2, row 124): the wizard «Новий бюджет», S-122 «Спосіб» (PocPlanBudgetWiz1, Wiz1NoHist), S-123
 * «Період» (Wiz2) and S-124 «Ліміти» (Wiz3), in focus mode (UX-09). «Створити за моїми витратами» takes the limits and
 * the income plan the server suggests (`GET /v1/budget/wizard`: the 3-month average rounded to 10); «Почати з нуля» has
 * no amounts; in the middle of a month the user must choose one of three starts, none preselected. Every figure is the
 * API's; the entered amounts go to `POST /v1/budget` as decimal strings. «Розподіл» (S-287) and the bottom strip of the
 * limits step wait for the server part of row 31; until then the limits step ends with «Створити бюджет».
 */
export function BudgetWizardPage() {
  const { t } = useI18n();
  const title = t("planning.budget.wizard.title");
  useDocumentTitle(title);
  const load = useCallback((api: Parameters<typeof loadWizard>[0]) => loadWizard(api), []);
  const { result, reload } = useLoad(load);
  const close = () => {
    window.location.hash = BUDGET.path;
  };
  const data = result.state === "ready" ? result.data : null;
  const exists = data?.kind === "exists";
  useEffect(() => {
    if (exists) window.location.replace(`#${BUDGET.path}`);
  }, [exists]);
  return (
    <FocusShell title={title} closeLabel={t("shell.close")} onClose={close}>
      {result.state === "error" ? (
        <section className="ws-card bud-card" role="alert" aria-labelledby="bud-wiz-error">
          <h2 id="bud-wiz-error" className="ws-text-heading-3 bud-card-title">
            <Icon name="close" size={16} /> {t("planning.budget.error.title")}
          </h2>
          <p className="ws-muted">{t(failureOf(result.failure).key)}</p>
          <p>
            <button type="button" className="ws-button" onClick={reload}>
              {t("planning.budget.error.retry")}
            </button>
          </p>
          {failureOf(result.failure).code ? (
            <p className="ws-muted">
              {t("planning.budget.error.code", { code: failureOf(result.failure).code ?? "" })}
            </p>
          ) : null}
        </section>
      ) : data?.kind === "ready" ? (
        <Wizard data={data} onClose={close} />
      ) : (
        <Skeleton variant="row" lines={4} />
      )}
    </FocusShell>
  );
}

function Wizard({ data, onClose }: { data: Ready; onClose: () => void }) {
  const { t, locale } = useI18n();
  const api = useAuthApi();
  const { wizard, currency } = data;
  const spending = wizard.fromSpending;
  const [step, setStep] = useState(0);
  const [method, setMethod] = useState<Method>(spending.available ? "spending" : "zero");
  const [startId, setStartId] = useState<Start["start"] | null>(null);
  const [income, setIncome] = useState<string | null>(null);
  const [limits, setLimits] = useState<ReadonlyMap<string, string | null>>(new Map());
  // Fields whose text does not parse (AmountField reports a problem): the budget cannot be created while any is there.
  const [problems, setProblems] = useState<ReadonlySet<string>>(new Set());
  const [opened, setOpened] = useState<Method | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const key = useRef<{ body: string; key: string } | null>(null);

  const start = wizard.midPeriod
    ? (wizard.starts.find((s) => s.start === startId) ?? null)
    : (wizard.starts[0] ?? null);
  const money = (m: { amount: string; currency: string }) => formatMoney(locale, m.amount, m.currency);
  // The months of the history come from the server's «today», not from the device's clock.
  const today = wizard.today;
  const months = [shiftMonth(monthOf(today), -3), shiftMonth(monthOf(today), -1)] as const;
  const setProblem = (field: string, problem: boolean) =>
    setProblems((old) => {
      if (old.has(field) === problem) return old;
      const next = new Set(old);
      if (problem) next.add(field);
      else next.delete(field);
      return next;
    });

  // The limits step opens with the server's suggestion («за моїми витратами») or empty («з нуля»); going back
  // and forward keeps what was edited, and a changed method starts over.
  const openLimits = () => {
    if (opened === method) {
      setStep(2);
      return;
    }
    setOpened(method);
    setProblems(new Set());
    if (method === "spending") {
      setIncome(spending.incomePlan?.amount ?? null);
      setLimits(
        new Map(data.groups.flatMap((g) => g.categories).map((c) => [c.id, c.suggested?.amount ?? null])),
      );
    } else {
      setIncome(null);
      setLimits(new Map());
    }
    setStep(2);
  };

  const next = () => {
    if (step === 0) setStep(1);
    else if (step === 1) openLimits();
  };

  const submit = async () => {
    if (busy || start === null || problems.size > 0) return;
    setBusy(true);
    setFailed(false);
    const body = createBody({ start, currency, income, limits });
    const text = JSON.stringify(body);
    // The same request keeps its key on a retry (ARC-07 FR 4).
    if (key.current?.body !== text) key.current = { body: text, key: newKey() };
    const o = await createBudget(api, body, key.current.key);
    setBusy(false);
    if (o.ok || (o.kind === "problem" && o.problem.code === "BUDGET_EXISTS")) onClose();
    else setFailed(true);
  };

  const states = (i: number): StepState => (i === step ? "current" : i < step ? "done" : "unavailable");
  const steps = (["method", "period", "limits"] as const).map((id, i) => ({
    label: t(`planning.budget.wizard.step.${id}` as MessageKey),
    state: states(i),
  }));
  const periodBlocked = wizard.midPeriod && start === null;

  return (
    <div className="bud-wiz">
      <Stepper
        steps={steps}
        label={t("planning.budget.wizard.steps")}
        onSelect={(i) => (i < step ? setStep(i) : undefined)}
      />
      {step === 0 ? (
        <MethodStep method={method} onChange={setMethod} data={data} months={months} money={money} />
      ) : step === 1 ? (
        <PeriodStep wizard={wizard} startId={startId} onStart={setStartId} />
      ) : (
        <LimitsStep
          data={data}
          method={method}
          income={income}
          onIncome={(v, problem) => {
            setProblem("income", problem);
            if (!problem) setIncome(v);
          }}
          limits={limits}
          onLimit={(id, v, problem) => {
            setProblem(id, problem);
            if (!problem) setLimits((old) => new Map(old).set(id, v));
          }}
          months={months}
          money={money}
        />
      )}
      {failed ? (
        <p role="alert" className="bud-wiz-error">
          {t("planning.budget.wizard.error.create")}
        </p>
      ) : null}
      <div className="bud-wiz-actions">
        {step > 0 ? (
          <Button
            variant="secondary"
            onClick={() => setStep(step - 1)}
            label={t("planning.budget.wizard.back")}
          />
        ) : null}
        <span className="bud-wiz-grow" />
        <Button variant="secondary" onClick={onClose} label={t("planning.budget.wizard.cancel")} />
        {step < 2 ? (
          <Button
            variant="primary"
            onClick={next}
            {...(step === 1 && periodBlocked
              ? { disabled: true as const, disabledReason: t("planning.budget.wizard.period.choose") }
              : {})}
            label={t("planning.budget.wizard.next")}
          />
        ) : (
          <Button
            variant="primary"
            onClick={() => void submit()}
            loading={busy}
            {...(problems.size > 0
              ? {
                  disabled: true as const,
                  disabledReason: t("dialog.form.reason.fix", {
                    fields: [
                      ...(problems.has("income") ? [t("planning.budget.wizard.limits.income")] : []),
                      ...data.groups
                        .flatMap((g) => g.categories)
                        .filter((c) => problems.has(c.id))
                        .map((c) => c.name),
                    ].join(", "),
                  }),
                }
              : {})}
            label={t("planning.budget.wizard.create")}
          />
        )}
      </div>
    </div>
  );
}

/** «листопада» (the month in the genitive, after a day number). */
const genitive = (t: Translate, period: string): string =>
  t(`planning.budget.month.${period.slice(5, 7)}.gen` as MessageKey);

const rangeOf = (
  t: Translate,
  locale: string,
  [from, to]: readonly [string, string] | readonly string[],
  form: "nominative" | "genitive" = "nominative",
): string =>
  form === "genitive"
    ? `${genitive(t, from!)}–${genitive(t, to!)}`
    : `${monthWord(t, locale, from!)}–${monthWord(t, locale, to!)}`;

function MethodStep({
  method,
  onChange,
  data,
  months,
  money,
}: {
  method: Method;
  onChange: (m: Method) => void;
  data: Ready;
  months: readonly string[];
  money: (m: { amount: string; currency: string }) => string;
}) {
  const { t, locale } = useI18n();
  const plural = (base: string, count: number) => {
    const rule = new Intl.PluralRules(formatLocaleOf(locale)).select(count);
    return t(`${base}.${rule === "zero" || rule === "two" ? "other" : rule}` as MessageKey, { count });
  };
  const s = data.wizard.fromSpending;
  const unit = money({ amount: "10", currency: data.currency });
  return (
    <section aria-labelledby="bud-wiz-h">
      <h2 id="bud-wiz-h" className="ws-text-heading-2">
        {t("planning.budget.wizard.method.title")}
      </h2>
      <p className="ws-muted">{t("planning.budget.wizard.method.currency", { currency: data.currency })}</p>
      <div role="radiogroup" aria-labelledby="bud-wiz-h" className="bud-wiz-options">
        <label className="bud-wiz-option" data-checked={method === "spending"} data-disabled={!s.available}>
          <input
            type="radio"
            name="bud-method"
            checked={method === "spending"}
            disabled={!s.available}
            onChange={() => onChange("spending")}
          />
          <span>
            <strong>{t("planning.budget.wizard.method.spending")}</strong>
            <span className="ws-muted">
              {s.available
                ? t("planning.budget.wizard.method.spending.body", {
                    months: rangeOf(t, locale, months),
                    unit,
                    income: s.incomePlan ? money(s.incomePlan) : "",
                  })
                : t("planning.budget.wizard.method.spending.none", { unit })}
            </span>
            <span className="ws-muted">
              {s.available
                ? plural("planning.budget.wizard.method.history", s.historyMonths)
                : plural("planning.budget.wizard.method.needHistory", s.historyMonths)}
            </span>
          </span>
        </label>
        <label className="bud-wiz-option" data-checked={method === "zero"}>
          <input
            type="radio"
            name="bud-method"
            checked={method === "zero"}
            onChange={() => onChange("zero")}
          />
          <span>
            <strong>{t("planning.budget.wizard.method.zero")}</strong>
            <span className="ws-muted">{t("planning.budget.wizard.method.zero.body")}</span>
          </span>
        </label>
      </div>
    </section>
  );
}

function PeriodStep({
  wizard,
  startId,
  onStart,
}: {
  wizard: Ready["wizard"];
  startId: Start["start"] | null;
  onStart: (s: Start["start"]) => void;
}) {
  const { t, locale } = useI18n();
  // Every label is built from the server's `today` and starts (`from`, `to`), not from the device's clock.
  const at = (id: Start["start"]) => wizard.starts.find((x) => x.start === id);
  const current = monthOf(at("period-start")?.from ?? wizard.today);
  const nextPeriod = at("next-period");
  const proportional = at("proportional");
  const left = proportional?.days ?? 0;
  const rule = new Intl.PluralRules(formatLocaleOf(locale)).select(left);
  const params = {
    day: String(Number(wizard.today.slice(8, 10))),
    month: genitive(t, current),
    left: String(proportional?.days ?? ""),
    all: String(proportional?.daysInPeriod ?? ""),
  };
  const labels: Record<Start["start"], { title: string; body: string }> = {
    "period-start": {
      title: t("planning.budget.wizard.start.period", { month: genitive(t, current) }),
      body: t("planning.budget.wizard.start.period.body", {
        month: monthWord(t, locale, current),
        gen: genitive(t, current),
      }),
    },
    "next-period": {
      title: t("planning.budget.wizard.start.next", {
        next: `${Number((nextPeriod?.from ?? "").slice(8, 10))} ${genitive(t, monthOf(nextPeriod?.from ?? wizard.today))}`,
      }),
      body: t("planning.budget.wizard.start.next.body", {
        month: t(`planning.budget.month.${current.slice(5, 7)}` as MessageKey),
      }),
    },
    proportional: {
      title: t("planning.budget.wizard.start.proportional", {
        from: String(Number((proportional?.from ?? "").slice(8, 10))),
        to: String(Number((proportional?.to ?? "").slice(8, 10))),
        month: params.month,
        left: params.left,
        all: params.all,
      }),
      body: t("planning.budget.wizard.start.proportional.body", { left: params.left, all: params.all }),
    },
  };
  return (
    <section aria-labelledby="bud-wiz-h">
      <h2 id="bud-wiz-h" className="ws-text-heading-2">
        {t("planning.budget.wizard.period.title")}
      </h2>
      <p className="ws-muted">{t("planning.budget.wizard.period.calendar")}</p>
      {wizard.midPeriod ? (
        <>
          <p>
            {t(
              `planning.budget.wizard.period.mid.${rule === "zero" || rule === "two" ? "other" : rule}` as MessageKey,
              {
                day: params.day,
                month: params.month,
                left: params.left,
                all: params.all,
              },
            )}
          </p>
          <div
            role="radiogroup"
            aria-label={t("planning.budget.wizard.period.mid.label")}
            className="bud-wiz-options"
          >
            {wizard.starts.map((s) => (
              <label key={s.start} className="bud-wiz-option" data-checked={startId === s.start}>
                <input
                  type="radio"
                  name="bud-start"
                  checked={startId === s.start}
                  onChange={() => onStart(s.start)}
                />
                <span>
                  <strong>{labels[s.start].title}</strong>
                  <span className="ws-muted">{labels[s.start].body}</span>
                </span>
              </label>
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}

function LimitsStep({
  data,
  method,
  income,
  onIncome,
  limits,
  onLimit,
  months,
  money,
}: {
  data: Ready;
  method: Method;
  income: string | null;
  onIncome: (v: string | null, problem: boolean) => void;
  limits: ReadonlyMap<string, string | null>;
  onLimit: (id: string, v: string | null, problem: boolean) => void;
  months: readonly string[];
  money: (m: { amount: string; currency: string }) => string;
}) {
  const { t, locale } = useI18n();
  const spending = method === "spending";
  const range = rangeOf(t, locale, months);
  const rangeGen = rangeOf(t, locale, months, "genitive");
  return (
    <section aria-labelledby="bud-wiz-h">
      <h2 id="bud-wiz-h" className="ws-text-heading-2">
        {t("planning.budget.wizard.limits.title")}
      </h2>
      <p className="ws-muted">
        {spending
          ? t("planning.budget.wizard.limits.spending", {
              months: rangeGen,
              unit: money({ amount: "10", currency: data.currency }),
            })
          : t("planning.budget.wizard.limits.zero")}
      </p>
      <div className="bud-wiz-income">
        <AmountField
          label={t("planning.budget.wizard.limits.income")}
          currency={data.currency}
          value={income}
          onChange={(v, problem) => onIncome(v, problem !== null)}
          hint={spending ? t("planning.budget.wizard.limits.income.hint", { months: range }) : undefined}
        />
        {spending && data.wizard.fromSpending.incomeIrregular ? (
          <p className="ws-muted">{t("planning.budget.wizard.limits.income.irregular")}</p>
        ) : null}
      </div>
      <table className="bud-wiz-table">
        <thead>
          <tr>
            <th scope="col">{t("planning.budget.wizard.limits.col.category")}</th>
            {spending ? <th scope="col">{t("planning.budget.wizard.limits.col.average")}</th> : null}
            <th scope="col">{t("planning.budget.wizard.limits.col.limit")}</th>
          </tr>
        </thead>
        {data.groups.map((g) => (
          <tbody key={g.id}>
            <tr className="bud-group-row">
              <th scope="rowgroup" colSpan={spending ? 3 : 2}>
                {g.name}
              </th>
            </tr>
            {g.categories.map((c) => (
              <tr key={c.id}>
                <th scope="row">{c.name}</th>
                {spending ? <td className="bud-num">{c.average ? money(c.average) : "—"}</td> : null}
                <td>
                  <AmountField
                    label={t("planning.budget.wizard.limits.of", { category: c.name })}
                    labelHidden
                    currency={data.currency}
                    value={limits.get(c.id) ?? null}
                    onChange={(v, problem) => onLimit(c.id, v, problem !== null)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
      <p className="ws-muted">{t("planning.budget.wizard.limits.outside")}</p>
    </section>
  );
}
