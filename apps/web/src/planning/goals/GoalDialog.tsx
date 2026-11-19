import { useEffect, useRef, useState } from "react";
import { newIdempotencyKey } from "@willowsum/api-contract";
import { formatMoney, formatNumber, useI18n, type MessageKey } from "@willowsum/i18n";
import {
  AmountField,
  DateField,
  Field,
  FormDialog,
  Select,
  type FormDialogField,
  type FormDialogState,
} from "@willowsum/ui";
import { outcome, useAuthApi } from "../../auth/api.ts";
import type { Goal } from "./model.ts";
import {
  createBody,
  cushionTarget,
  freeOn,
  initialValues,
  isPositive,
  loadCushionAverage,
  loadFormContext,
  MAIN,
  minus,
  monthsOf,
  monthsValid,
  MONTHS_MAX,
  NAME_MAX,
  patchBody,
  PART_KINDS,
  progressOf,
  TEMPLATES,
  valuesOf,
  WHERE,
  type CushionAverage,
  type FormContext,
  type GoalValues,
} from "./newGoal.ts";

type Failure = { key: MessageKey; params?: Record<string, string> };

/**
 * S-138 «Нова ціль» and «Змінити ціль» (BUD-05@PoC FR 2, FR 10, AC 1, 3, 4, 9–14; canvas PocPlanGoalNew*,
 * PocPlanGoalNewForm*, PocPlanGoalNewCushion*, PocPlanGoalNewEnvelope, PocPlanGoalNewWhere) on the CMP-21 form dialog:
 * two steps «1 Основне · 2 Де лежать гроші», the main action active from step 1 once the name and the target are valid
 * (a goal made so has one part «Без рахунку — лише позначки»), the reason line and the inactive buttons are the
 * dialog's own. Exactly one part, so there is no «+ Додати рахунок» (AC 9). The goal belongs to the space; there is no
 * «особиста». The amounts go to the API as the decimal strings of the fields. When `goal` is given the dialog changes
 * it (every step counts as passed, «Зберегти»).
 */
export function GoalDialog({
  goal,
  goals,
  today,
  template,
  fallbackCurrency,
  onClose,
  onSaved,
}: {
  /** «Змінити ціль»: the goal to change; left out — a new goal. */
  goal?: Goal | undefined;
  /** The space's goals: the free balance of an account for a new envelope. */
  goals: readonly Goal[];
  today: string;
  /** The template a new goal starts with (a tile of the empty state). */
  template?: Goal["template"] | undefined;
  fallbackCurrency: string;
  onClose: () => void;
  onSaved: (goalId: string) => void;
}) {
  const api = useAuthApi();
  const [context, setContext] = useState<FormContext | null>(null);
  // Mounted when the dialog is opened (the consumer renders it only then), so a fresh read each time.
  useEffect(() => {
    let live = true;
    void loadFormContext(api, goal?.target.currency ?? null, fallbackCurrency).then((c) => {
      if (live) setContext(c);
    });
    return () => {
      live = false;
    };
  }, [api, goal?.target.currency, fallbackCurrency]);
  if (!context) return null;
  return (
    <GoalForm
      goal={goal}
      goals={goals}
      today={today}
      template={template}
      context={context}
      onClose={onClose}
      onSaved={onSaved}
    />
  );
}

function GoalForm({
  goal,
  goals,
  today,
  template,
  context,
  onClose,
  onSaved,
}: {
  goal?: Goal | undefined;
  goals: readonly Goal[];
  today: string;
  template?: Goal["template"] | undefined;
  context: FormContext;
  onClose: () => void;
  onSaved: (goalId: string) => void;
}) {
  const { t, locale } = useI18n();
  const api = useAuthApi();
  const { currency, accounts } = context;
  const [v, setV] = useState<GoalValues>(() => (goal ? valuesOf(goal) : initialValues(template)));
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const sent = useRef<{ body: string; key: string } | null>(null);
  const emergency = v.template === "emergency";
  // FR 10, AC 3: the average monthly expenses come from the API (a server sum), read once the template is chosen.
  const [cushion, setCushion] = useState<CushionAverage | "none" | null>(null);
  useEffect(() => {
    if (!emergency || cushion !== null) return;
    let live = true;
    void loadCushionAverage(api, currency).then((c) => {
      if (live) setCushion(c);
    });
    return () => {
      live = false;
    };
  }, [api, currency, emergency, cushion]);
  const set = <K extends keyof GoalValues>(k: K, value: GoalValues[K]) => {
    setFailure(null);
    setV((old) => ({ ...old, [k]: value }));
  };
  const money = (amount: string) => formatMoney(locale, amount, currency);
  const shownPercent = (p: string | null) => (p === null ? "—" : formatNumber(locale, p));

  // A new «Подушка безпеки» with an average: the target is months × average, not typed (board PocPlanGoalNewCushion).
  const computed =
    emergency && !goal && cushion !== null && cushion !== "none" && cushion.average !== null ? cushion : null;
  const target = computed ? cushionTarget(computed, v.months) : v.target;
  const onAccount = v.kind !== "marks";
  const ownStart = v.kind !== "account";
  const account = accounts.find((a) => a.id === v.accountId);
  const dateText = v.date !== "" && v.date < today && v.date !== goal?.targetDate;

  const fields: FormDialogField[] = [
    { id: "template", label: t("planning.goals.new.template"), step: MAIN, required: true, empty: false },
    {
      id: "name",
      label: t("planning.goals.new.name"),
      step: MAIN,
      required: true,
      empty: v.name.trim() === "",
    },
    {
      id: "target",
      label: t("planning.goals.new.target"),
      step: MAIN,
      required: true,
      empty: target === null && !v.targetProblem,
      error:
        (!computed && v.targetProblem) || (target !== null && !isPositive(target))
          ? t("planning.goals.new.target.positive")
          : null,
    },
    ...(emergency
      ? [
          {
            id: "months",
            label: t("planning.goals.new.months"),
            step: MAIN,
            required: true,
            empty: v.months.trim() === "",
            error:
              v.months.trim() !== "" && !monthsValid(v.months) ? t("planning.goals.new.months.error") : null,
          },
        ]
      : []),
    {
      id: "date",
      label: t("planning.goals.new.date"),
      step: MAIN,
      empty: v.date === "",
      error: dateText ? t("planning.goals.new.date.past") : null,
    },
    { id: "kind", label: t("planning.goals.new.part"), step: WHERE, required: true, empty: false },
    ...(onAccount
      ? [
          {
            id: "account",
            label: t("planning.goals.new.account"),
            step: WHERE,
            required: true,
            empty: v.accountId === "",
          },
        ]
      : []),
    ...(ownStart
      ? [
          {
            id: "start",
            label: t("planning.goals.new.start"),
            step: WHERE,
            empty: v.start === null && !v.startProblem,
            error: v.startProblem
              ? t("planning.goals.new.start")
              : v.start?.trim().startsWith("-")
                ? t("planning.goals.new.start.negative")
                : null,
          },
        ]
      : []),
  ];

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    let result;
    if (goal) {
      result = await outcome(
        api.PATCH("/v1/goals/{goalId}", { params: { path: { goalId: goal.id } }, body: patchBody(v, goal) }),
      );
    } else {
      const body = createBody({ ...v, target }, currency);
      const text = JSON.stringify(body);
      // The same request keeps its key on a retry (ARC-07 FR 4); a changed request takes a new one.
      if (sent.current?.body !== text) sent.current = { body: text, key: newIdempotencyKey() };
      result = await outcome(
        api.POST("/v1/goals", { params: { header: { "Idempotency-Key": sent.current.key } }, body }),
      );
    }
    setBusy(false);
    if (result.ok) {
      onSaved(result.data.id);
      return;
    }
    if (
      result.kind === "problem" &&
      result.problem.code === "GOAL_ENVELOPES_OVER_BALANCE" &&
      result.problem.excess
    ) {
      setFailure({
        key: "planning.goals.new.error.over",
        params: { excess: formatMoney(locale, result.problem.excess.amount, result.problem.excess.currency) },
      });
      return;
    }
    if (result.kind === "problem" && result.problem.code === "GOAL_ACCOUNT_TAKEN") {
      setFailure({ key: "planning.goals.new.error.taken" });
      return;
    }
    setFailure({ key: "planning.goals.new.error.save" });
  };

  const free = !goal && v.kind === "envelope" && account ? freeOn(account, goals) : null;
  const startHint = (() => {
    if (v.kind === "account" && account)
      return t("planning.goals.new.accountProgress", {
        collected: money(account.balance.amount),
        percent: shownPercent(progressOf(account.balance.amount, target)),
      });
    if (v.kind === "marks" || account) {
      const start = v.start ?? "0";
      const percent = progressOf(start, target);
      return [
        free
          ? t("planning.goals.new.freeAfter", {
              free: formatMoney(locale, minus(free, start).amount, currency),
            })
          : "",
        percent !== null
          ? t("planning.goals.new.startProgress", { start: money(start), percent: shownPercent(percent) })
          : "",
      ]
        .filter(Boolean)
        .join(" · ");
    }
    return undefined;
  })();

  const averageLine = (c: CushionAverage | "none") =>
    c === "none" || c.average === null
      ? t("planning.goals.new.cushion.none")
      : t(c.approximate ? "planning.goals.new.cushion.approx" : "planning.goals.new.cushion.average", {
          average: formatMoney(locale, c.average.amount, c.average.currency),
          months: formatNumber(locale, String(c.months)),
        });

  // A render function, not a component: the input keeps its focus while the form re-renders.
  const cushionRow = (p: {
    months: string;
    average: CushionAverage;
    target: string | null;
    monthsError: string | undefined;
    onMonths: (x: string) => void;
    onLeave: () => void;
  }) => {
    const n = monthsOf(p.months);
    const step = (by: number) => p.onMonths(String(Math.min(MONTHS_MAX, Math.max(1, (n ?? 0) + by))));
    const hintId = "goal-cushion-hint";
    const average = p.average.average!;
    return (
      <div className="goal-cushion">
        <div className="goal-cushion-row">
          <div className="goal-cushion-months">
            <label className="ws-field-label" htmlFor="goal-cushion-months">
              {t("planning.goals.new.months")}
              <span className="ws-field-required" aria-hidden="true">
                {" "}
                *
              </span>
              <span className="ws-visually-hidden">{`, ${t("field.required")}`}</span>
            </label>
            <span className="goal-cushion-stepper" data-invalid={p.monthsError ? true : undefined}>
              <button
                type="button"
                aria-label={t("planning.goals.new.months.less")}
                disabled={n !== null && n <= 1}
                onClick={() => step(-1)}
              >
                −
              </button>
              <input
                id="goal-cushion-months"
                inputMode="numeric"
                maxLength={3}
                required
                aria-invalid={p.monthsError ? true : undefined}
                aria-describedby={hintId}
                value={p.months}
                onChange={(e) => p.onMonths(e.target.value)}
                onBlur={p.onLeave}
              />
              <button
                type="button"
                aria-label={t("planning.goals.new.months.more")}
                disabled={n !== null && n >= MONTHS_MAX}
                onClick={() => step(1)}
              >
                +
              </button>
            </span>
          </div>
          <div className="goal-cushion-target">
            <span className="ws-field-label" id="goal-cushion-target-label">
              {t("planning.goals.new.target")}
            </span>
            <output
              className="goal-cushion-sum"
              aria-labelledby="goal-cushion-target-label"
              aria-live="polite"
            >
              <b>{p.target === null ? "—" : money(p.target)}</b>
              <span className="ws-muted">
                {t("planning.goals.new.cushion.times", {
                  months: n === null ? "—" : formatNumber(locale, String(n)),
                  average: formatMoney(locale, average.amount, average.currency),
                })}
              </span>
            </output>
          </div>
        </div>
        {p.monthsError ? (
          <p className="ws-field-error" role="alert">
            {p.monthsError}
          </p>
        ) : null}
        <p className="ws-muted goal-cushion-hint" id={hintId}>
          {averageLine(p.average)}
        </p>
      </div>
    );
  };

  const step = (form: FormDialogState) => {
    if (form.step === MAIN)
      return (
        <>
          <Select
            label={t("planning.goals.new.template")}
            required
            value={v.template}
            hint={t(`planning.goals.new.template.${v.template}` as MessageKey)}
            onChange={(x) => set("template", x as GoalValues["template"])}
            options={TEMPLATES.map((x) => ({
              value: x,
              label: t(`planning.goals.template.${x}` as MessageKey),
            }))}
          />
          <Field
            label={t("planning.goals.new.name")}
            required
            value={v.name}
            maxLength={NAME_MAX}
            counter
            onChange={(x) => set("name", x)}
            onBlur={form.leave("name")}
            error={form.errorOf("name")}
          />
          {computed ? (
            cushionRow({
              months: v.months,
              average: computed,
              target,
              monthsError: form.errorOf("months"),
              onMonths: (x) => set("months", x),
              onLeave: form.leave("months"),
            })
          ) : (
            <>
              <AmountField
                label={t("planning.goals.new.target")}
                required
                currency={currency}
                value={v.target}
                onChange={(value, problem) =>
                  setV((old) => ({ ...old, target: value, targetProblem: problem !== null }))
                }
                onBlur={form.leave("target")}
                error={v.targetProblem ? undefined : form.errorOf("target")}
              />
              {emergency ? (
                <Field
                  label={t("planning.goals.new.months")}
                  required
                  value={v.months}
                  inputMode="numeric"
                  maxLength={3}
                  hint={cushion === null ? undefined : averageLine(cushion)}
                  onChange={(x) => set("months", x)}
                  onBlur={form.leave("months")}
                  error={form.errorOf("months")}
                />
              ) : null}
            </>
          )}
          <DateField
            label={t("planning.goals.new.date")}
            value={v.date}
            today={today}
            hint={t("planning.goals.new.date.hint")}
            onChange={(d) => set("date", d)}
            error={form.errorOf("date")}
          />
        </>
      );
    return (
      <>
        <Select
          label={t("planning.goals.new.part")}
          required
          value={v.kind}
          hint={t(`planning.goals.new.part.${v.kind}` as MessageKey)}
          onChange={(k) =>
            setV((old) => ({
              ...old,
              kind: k as GoalValues["kind"],
              accountId: k === "marks" ? "" : old.accountId,
              start: k === "account" ? null : old.start,
              startProblem: k === "account" ? false : old.startProblem,
            }))
          }
          options={PART_KINDS.map((k) => ({ value: k, label: t(`planning.goals.part.${k}` as MessageKey) }))}
        />
        {onAccount ? (
          <Select
            label={t("planning.goals.new.account")}
            required
            value={v.accountId}
            hint={accounts.length === 0 ? t("planning.goals.new.account.none", { currency }) : undefined}
            onChange={(id) => set("accountId", id)}
            options={accounts.map((a) => ({
              value: a.id,
              label: `${a.name}${a.mask ? ` ${a.mask}` : ""} · ${money(a.balance.amount)}`,
            }))}
            error={form.errorOf("account")}
          />
        ) : null}
        {ownStart ? (
          <AmountField
            label={t("planning.goals.new.start")}
            currency={currency}
            value={v.start}
            hint={startHint}
            onChange={(value, problem) =>
              setV((old) => ({ ...old, start: value, startProblem: problem !== null }))
            }
            onBlur={form.leave("start")}
            error={v.startProblem ? undefined : form.errorOf("start")}
          />
        ) : startHint ? (
          <p className="ws-muted goal-form-note">{startHint}</p>
        ) : null}
      </>
    );
  };

  return (
    <FormDialog
      open
      onClose={onClose}
      title={t(goal ? "planning.goals.edit.title" : "planning.goals.new.title")}
      closeLabel={t("planning.goals.dialog.close")}
      steps={[{ label: t("planning.goals.new.step.main") }, { label: t("planning.goals.new.step.where") }]}
      fields={fields}
      editing={goal !== undefined}
      submitLabel={t(goal ? "planning.goals.edit.submit" : "planning.goals.new.submit")}
      busyLabel={t(goal ? "planning.goals.edit.busy" : "planning.goals.new.busy")}
      busy={busy}
      error={failure ? t(failure.key, failure.params) : undefined}
      onSubmit={() => void submit()}
    >
      {step}
    </FormDialog>
  );
}
