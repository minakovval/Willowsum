import { useCallback, useEffect, useRef, useState } from "react";
import { formatLocaleOf, formatMoney, useI18n, type MessageKey, type Translate } from "@willowsum/i18n";
import { Decimal } from "@willowsum/domain-kernel";
import {
  AmountField,
  Button,
  FocusShell,
  IconButton,
  Select,
  Skeleton,
  Stepper,
  type StepState,
} from "@willowsum/ui";
import { outcome, useAuthApi } from "../../auth/api.ts";
import { failureOf } from "../../auth/failure.ts";
import { Icon, StatusMark } from "@willowsum/ui";
import { useLoad } from "../../recurring/data.ts";
import { BUDGET } from "../../routing/routes.ts";
import { useDocumentTitle } from "../../useDocumentTitle.ts";
import "./budget.css";
import { budgetFailureKey, monthOf, shiftMonth } from "./model.ts";
import {
  DistributionStep,
  LimitsStrip,
  PLAN,
  SRC,
  SpendableLine,
  useAllocation,
  useDistribution,
} from "./Distribution.tsx";
import { allocationRows } from "./distribution.ts";
import {
  createBody,
  createBudget,
  groupsOf,
  incomeCategories,
  loadWizard,
  newKey,
  type IncomeRow,
  type Start,
  type Tree,
  type WizardData,
  type WizardGroup,
} from "./wizard.ts";
import { AddCategoryMenu, IncomeRowMenu, RowMenu, useCategoryActions } from "./CategoryActions.tsx";
import { UnbudgetedMark } from "./UnbudgetedMark.tsx";

type Method = "spending" | "zero";
/** The key of a problem field of a «План доходу» row (the rows of the limits are keyed by the category). */
const INCOME = "inc:";
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
 * API's; the entered amounts go to `POST /v1/budget` as decimal strings. S-287 «Розподіл» and the bottom strip of the
 * limits step (AC6) show the server's calculation `POST /v1/budget/allocation` (BUD-02@PoC FR 3, FR 15, AC6, AC7; wave 2,
 * row 31): the screen computes no difference, rest or status. «Створити бюджет» is on «Розподіл».
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
          <p className="ws-muted">{t(budgetFailureKey(result.failure))}</p>
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
  // The category tree is read again after a rename, a delete, a hide, a merge or a new category (FR 22, FR 23).
  const [tree, setTree] = useState<Tree>(data.tree);
  const groups = groupsOf(tree, wizard);
  const incomeOptions = incomeCategories(tree);
  const spending = wizard.fromSpending;
  const [step, setStep] = useState(0);
  const [method, setMethod] = useState<Method>(spending.available ? "spending" : "zero");
  const [startId, setStartId] = useState<Start["start"] | null>(null);
  const [incomes, setIncomes] = useState<readonly IncomeRow[]>([]);
  const [limits, setLimits] = useState<ReadonlyMap<string, string | null>>(new Map());
  // FR 25: the categories taken out of the budget with «Прибрати з бюджету» (they show «поза бюджетом» until a limit is set again).
  const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set());
  // Fields whose text does not parse (AmountField reports a problem): the budget cannot be created while any is there.
  const [problems, setProblems] = useState<ReadonlySet<string>>(new Set());
  const [opened, setOpened] = useState<Method | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  // The amounts chosen on «Розподіл», by row key (`plan:` rows of a surplus, `src:` rows of a deficit).
  const [chosen, setChosen] = useState<ReadonlyMap<string, string | null>>(new Map());
  const key = useRef<{ body: string; key: string } | null>(null);

  const start = wizard.midPeriod
    ? (wizard.starts.find((s) => s.start === startId) ?? null)
    : (wizard.starts[0] ?? null);
  const money = (m: { amount: string; currency: string }) => formatMoney(locale, m.amount, m.currency);
  // A category that is gone (deleted, hidden or merged away) leaves no limit and no income row in the request.
  const present = new Set([
    ...groups.flatMap((g) => g.categories.map((c) => c.id)),
    ...incomeOptions.map((c) => c.id),
  ]);
  const liveLimits = new Map([...limits].filter(([id]) => present.has(id)));
  const liveIncomes = incomes.filter((r) => present.has(r.id));
  const args =
    step >= 2 && start !== null ? { start, currency, incomes: liveIncomes, limits: liveLimits } : null;
  const prefix = (kind: string | undefined) => (kind === "surplus" ? PLAN : kind === "deficit" ? SRC : null);
  const [kind, setKind] = useState<string | undefined>(undefined);
  // The typed rows of «Розподіл» go to the calculation and to the create request only while that step is open and only
  // for the kind of difference the server reports now; the limits step is calculated without them (FR 3).
  const rows = step === 3 ? allocationRows(chosen, kind, currency) : [];
  const alloc = useAllocation(args, rows);
  const allocKind = alloc.allocation?.balance?.kind;
  // Rows of the other kind are gone: their amounts do not count and their unparsed texts no longer block.
  const dropRows = (keep: string | null) =>
    setProblems(
      (old) =>
        new Set(
          [...old].filter(
            (p) => !(p.startsWith(PLAN) || p.startsWith(SRC)) || (keep !== null && p.startsWith(keep)),
          ),
        ),
    );
  if (kind !== allocKind) {
    setKind(allocKind);
    dropRows(prefix(allocKind));
  }
  const distribution = useDistribution(currency, step === 3);
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

  const refreshTree = async () => {
    const o = await outcome(api.GET("/v1/categories"));
    if (!o.ok) return;
    setTree(o.data);
    // A category that is gone (deleted, hidden or merged away) takes its row, its limit and its unparsed text with it.
    const ids = new Set(o.data.groups.flatMap((g) => g.categories.filter((c) => !c.hidden).map((c) => c.id)));
    setIncomes((old) => old.filter((r) => ids.has(r.id)));
    setLimits((old) => new Map([...old].filter(([id]) => ids.has(id))));
    setProblems(
      (old) =>
        new Set(
          [...old].filter((p) => p.startsWith(PLAN) || p.startsWith(SRC) || ids.has(p.replace(INCOME, ""))),
        ),
    );
  };

  // The limits step opens with the server's suggestion («за моїми витратами») or empty («з нуля»); going back
  // and forward keeps what was edited, and a changed method starts over.
  const openLimits = () => {
    if (opened === method) {
      // The fields mount again with the stored amounts (an invalid text is not stored), so an old problem is gone.
      setProblems(new Set());
      setStep(2);
      return;
    }
    setOpened(method);
    setProblems(new Set());
    setRemoved(new Set());
    if (method === "spending") {
      // FR 3, FR 21: the list holds the income categories that had income, each with the server's plan.
      setIncomes(spending.incomes.map((i) => ({ id: i.categoryId, amount: i.plan.amount })));
      setLimits(new Map(groups.flatMap((g) => g.categories).map((c) => [c.id, c.suggested?.amount ?? null])));
    } else {
      setIncomes([]);
      setLimits(new Map());
    }
    setStep(2);
  };

  const next = () => {
    if (step === 0) setStep(1);
    else if (step === 1) openLimits();
    else if (step === 2) {
      dropRows(null);
      setStep(3);
    }
  };

  const submit = async () => {
    if (busy || start === null || problems.size > 0) return;
    setBusy(true);
    setFailed(false);
    const body = createBody({ start, currency, incomes: liveIncomes, limits: liveLimits, rows });
    const text = JSON.stringify(body);
    // The same request keeps its key on a retry (ARC-07 FR 4).
    if (key.current?.body !== text) key.current = { body: text, key: newKey() };
    const o = await createBudget(api, body, key.current.key);
    setBusy(false);
    if (o.ok || (o.kind === "problem" && o.problem.code === "BUDGET_EXISTS")) onClose();
    else setFailed(true);
  };

  const states = (i: number): StepState => (i === step ? "current" : i < step ? "done" : "unavailable");
  const steps = (["method", "period", "limits", "distribute"] as const).map((id, i) => ({
    label: t(`planning.budget.wizard.step.${id}` as MessageKey),
    state: states(i),
  }));
  const periodBlocked = wizard.midPeriod && start === null;
  const fixReason = t("dialog.form.reason.fix", {
    fields: [
      ...incomeOptions
        .filter((c) => problems.has(`${INCOME}${c.id}`))
        .map((c) => t("planning.budget.wizard.income.of", { category: c.name })),
      ...groups
        .flatMap((g) => g.categories)
        .filter((c) => problems.has(c.id))
        .map((c) => c.name),
      ...([...problems].some((p) => p.startsWith(PLAN) || p.startsWith(SRC))
        ? [t("planning.budget.wizard.step.distribute")]
        : []),
    ].join(", "),
  });
  // «Створити бюджет» (AC7, AC17): a deficit may stay, in part or in full; only more than N is refused, as the server says.
  const choiceStatus = alloc.allocation?.choice?.status;
  const createBlock: string | null =
    problems.size > 0
      ? fixReason
      : alloc.pending || alloc.failed || alloc.allocation === null
        ? t("planning.budget.wizard.dist.reason.wait")
        : choiceStatus === "over" || alloc.refused === "over"
          ? t("planning.budget.wizard.dist.reason.over")
          : null;

  return (
    <div className="bud-wiz">
      <Stepper
        steps={steps}
        label={t("planning.budget.wizard.steps")}
        onSelect={(i) => {
          if (i >= step) return;
          dropRows(null);
          setStep(i);
        }}
      />
      {step === 0 ? (
        <MethodStep method={method} onChange={setMethod} data={data} months={months} money={money} />
      ) : step === 1 ? (
        <PeriodStep wizard={wizard} startId={startId} onStart={setStartId} />
      ) : step === 3 ? (
        <DistributionStep
          currency={currency}
          today={today}
          load={distribution.load}
          reload={distribution.reload}
          alloc={alloc}
          chosen={chosen}
          onChosen={(k, v, problem) => {
            setProblem(k, problem);
            if (!problem) setChosen((old) => new Map(old).set(k, v));
          }}
          onCutLimits={() => {
            dropRows(null);
            setStep(2);
          }}
          money={money}
        />
      ) : (
        <LimitsStep
          data={data}
          groups={groups}
          tree={tree}
          refresh={refreshTree}
          method={method}
          incomes={incomes}
          onIncomes={setIncomes}
          onIncomeProblem={(id, problem) => setProblem(`${INCOME}${id}`, problem)}
          limits={limits}
          removed={removed}
          onRemoved={(id) => setRemoved((old) => new Set(old).add(id))}
          onLimit={(id, v, problem) => {
            setProblem(id, problem);
            if (!problem) {
              setLimits((old) => new Map(old).set(id, v));
              // A limit typed again brings the category back into the budget (FR 25).
              if (v !== null && v !== "")
                setRemoved((old) => {
                  if (!old.has(id)) return old;
                  const next = new Set(old);
                  next.delete(id);
                  return next;
                });
            }
          }}
          months={months}
          money={money}
        />
      )}
      {step === 2 ? <LimitsStrip state={alloc} money={money} /> : null}
      {step === 3 &&
      alloc.allocation !== null &&
      !alloc.pending &&
      !alloc.failed &&
      alloc.refused === null ? (
        <div className="bud-wiz-strip" role="status">
          <SpendableLine
            spendable={alloc.allocation.spendable}
            hint={t("planning.budget.wizard.spendable.hint.distribute")}
            money={money}
          />
        </div>
      ) : null}
      {failed ? (
        <p role="alert" className="bud-wiz-error">
          {t("planning.budget.wizard.error.create")}
        </p>
      ) : null}
      <div className="bud-wiz-actions">
        {step > 0 ? (
          <Button
            variant="secondary"
            onClick={() => {
              dropRows(null);
              setStep(step - 1);
            }}
            label={t("planning.budget.wizard.back")}
          />
        ) : null}
        <span className="bud-wiz-grow" />
        <Button variant="secondary" onClick={onClose} label={t("planning.budget.wizard.cancel")} />
        {step < 3 ? (
          <Button
            variant="primary"
            onClick={next}
            {...(step === 1 && periodBlocked
              ? { disabled: true as const, disabledReason: t("planning.budget.wizard.period.choose") }
              : step === 2 && problems.size > 0
                ? { disabled: true as const, disabledReason: fixReason }
                : {})}
            label={t("planning.budget.wizard.next")}
          />
        ) : (
          <Button
            variant="primary"
            onClick={() => void submit()}
            loading={busy}
            {...(createBlock !== null ? { disabled: true as const, disabledReason: createBlock } : {})}
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
  groups,
  tree,
  refresh,
  method,
  incomes,
  onIncomes,
  onIncomeProblem,
  limits,
  onLimit,
  removed,
  onRemoved,
  months,
  money,
}: {
  data: Ready;
  groups: readonly WizardGroup[];
  tree: Tree;
  refresh: () => Promise<void>;
  method: Method;
  incomes: readonly IncomeRow[];
  onIncomes: (rows: readonly IncomeRow[]) => void;
  onIncomeProblem: (id: string, problem: boolean) => void;
  limits: ReadonlyMap<string, string | null>;
  onLimit: (id: string, v: string | null, problem: boolean) => void;
  removed: ReadonlySet<string>;
  onRemoved: (id: string) => void;
  months: readonly string[];
  money: (m: { amount: string; currency: string }) => string;
}) {
  const { t, locale } = useI18n();
  const spending = method === "spending";
  const rangeGen = rangeOf(t, locale, months, "genitive");
  // The row being added under the list of income categories: the chosen category and its plan (FR 21).
  const [adding, setAdding] = useState<{ category: string; amount: string | null } | null>(null);
  const [addProblem, setAddProblem] = useState(false);
  const creating = useRef<"income" | "expense">("expense");
  const actions = useCategoryActions({
    tree,
    onChanged: () => void refresh(),
    onCreated: (id) => {
      void refresh().then(() => {
        // «Нова категорія доходу…» fills the row being added; «Нова категорія…» of a group adds its row at once (FR 22).
        if (creating.current === "income") setAdding((a) => ({ category: id, amount: a?.amount ?? null }));
      });
    },
  });
  const averages = new Map(data.wizard.fromSpending.incomes.map((i) => [i.categoryId, i.average]));
  const names = new Map(incomeCategories(tree).map((c) => [c.id, c.name]));
  const free = incomeCategories(tree).filter((c) => !incomes.some((r) => r.id === c.id));
  const total = incomes.reduce((sum, r) => (r.amount === null ? sum : sum.plus(r.amount)), new Decimal("0"));
  const confirmAdd = () => {
    if (adding === null || adding.category === "" || addProblem) return;
    onIncomes([...incomes, { id: adding.category, amount: adding.amount }]);
    setAdding(null);
    setAddProblem(false);
  };
  const cancelAdd = () => {
    setAdding(null);
    setAddProblem(false);
  };
  const NEW_INCOME = "__new";
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
        <div className="bud-wiz-income-head">
          <h3 className="ws-text-heading-3">{t("planning.budget.wizard.income.title")}</h3>
          <p className="bud-wiz-income-sum">
            <span className="ws-muted">{t("planning.budget.wizard.income.sum")}</span>{" "}
            <strong>{money({ amount: total.toFixed(), currency: data.currency })}</strong>
          </p>
        </div>
        {spending && data.wizard.fromSpending.incomeIrregular ? (
          <p className="ws-muted">{t("planning.budget.wizard.limits.income.irregular")}</p>
        ) : null}
        {/* FR 21 (owner, 2026-11-26): the row to add is the first of the list, above the categories. */}
        {adding !== null ? (
          <div className="bud-wiz-income-add">
            <Select
              label={t("planning.budget.wizard.income.category")}
              value={adding.category}
              onChange={(v) => {
                if (v === NEW_INCOME) {
                  creating.current = "income";
                  actions.addIncome();
                } else setAdding({ ...adding, category: v });
              }}
              options={[
                ...free.map((c) => ({ value: c.id, label: c.name })),
                { value: NEW_INCOME, label: t("planning.budget.wizard.income.new") },
              ]}
            />
            <AmountField
              label={t("planning.budget.wizard.income.col.plan")}
              currency={data.currency}
              value={adding.amount}
              onChange={(v, problem) => {
                setAddProblem(problem !== null);
                if (problem === null) setAdding({ ...adding, amount: v });
              }}
            />
            <IconButton
              icon="check"
              label={t("planning.budget.wizard.income.confirm")}
              onClick={confirmAdd}
            />
            <IconButton icon="close" label={t("planning.budget.wizard.cancel")} onClick={cancelAdd} />
          </div>
        ) : (
          <div className="bud-wiz-income-new">
            <Button
              variant="secondary"
              onClick={() => setAdding({ category: "", amount: null })}
              label={t("planning.budget.wizard.income.add")}
            />
            <span className="ws-muted">{t("planning.budget.wizard.income.add.hint")}</span>
          </div>
        )}
        {incomes.length > 0 ? (
          <table className="bud-wiz-table">
            <thead>
              <tr>
                <th scope="col">{t("planning.budget.wizard.limits.col.category")}</th>
                {spending ? <th scope="col">{t("planning.budget.wizard.limits.col.average")}</th> : null}
                <th scope="col">{t("planning.budget.wizard.income.col.plan")}</th>
                <th scope="col">
                  <span className="ws-visually-hidden">{t("planning.budget.wizard.income.remove")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {incomes.map((r) => {
                const name = names.get(r.id) ?? "";
                const incomeCategory = tree.groups.flatMap((g) => g.categories).find((c) => c.id === r.id);
                const average = averages.get(r.id);
                return (
                  <tr key={r.id}>
                    <th scope="row">{name}</th>
                    {spending ? <td className="bud-num">{average ? money(average) : "—"}</td> : null}
                    <td>
                      <AmountField
                        label={t("planning.budget.wizard.income.of", { category: name })}
                        labelHidden
                        currency={data.currency}
                        value={r.amount}
                        onChange={(v, problem) => {
                          onIncomeProblem(r.id, problem !== null);
                          if (problem === null)
                            onIncomes(incomes.map((x) => (x.id === r.id ? { ...x, amount: v } : x)));
                        }}
                      />
                    </td>
                    <td className="bud-menu">
                      <span className="bud-row-actions">
                        {incomeCategory ? (
                          <IncomeRowMenu category={incomeCategory} actions={actions} />
                        ) : null}
                        <IconButton
                          icon="close"
                          label={t("planning.budget.wizard.income.removeOf", { name })}
                          onClick={() => {
                            onIncomeProblem(r.id, false);
                            onIncomes(incomes.filter((x) => x.id !== r.id));
                          }}
                        />
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : null}
      </div>
      <table className="bud-wiz-table">
        <thead>
          <tr>
            <th scope="col">{t("planning.budget.wizard.limits.col.category")}</th>
            {spending ? <th scope="col">{t("planning.budget.wizard.limits.col.average")}</th> : null}
            <th scope="col">{t("planning.budget.wizard.limits.col.limit")}</th>
            <th scope="col">
              <span className="ws-visually-hidden">{t("categories.more")}</span>
            </th>
          </tr>
        </thead>
        {groups.map((g) => (
          <tbody key={g.id}>
            <tr className="bud-group-row">
              <th scope="rowgroup" colSpan={spending ? 2 : 1}>
                {g.name}
              </th>
              <td className="bud-wiz-group-add" colSpan={2}>
                <AddCategoryMenu
                  group={g.name}
                  onNew={() => {
                    creating.current = "expense";
                    actions.addTo(g.id);
                  }}
                />
              </td>
            </tr>
            {g.categories.map((c) => {
              const category = tree.groups.flatMap((x) => x.categories).find((x) => x.id === c.id);
              return (
                <tr key={c.id}>
                  <th scope="row">
                    <span className="bud-name">
                      {c.name}
                      {/* FR 25: the marks are visible at once, as the action is done. */}
                      {category?.essential === true ? <StatusMark id="v.mandatory" /> : null}
                      {removed.has(c.id) ? <UnbudgetedMark /> : null}
                    </span>
                  </th>
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
                  <td>
                    {category ? (
                      <RowMenu
                        category={category}
                        actions={actions}
                        onChanged={() => void refresh()}
                        // The wizard keeps the limits on screen: «Прибрати з бюджету» empties this one.
                        removeFromBudget={() => {
                          onLimit(c.id, null, false);
                          onRemoved(c.id);
                        }}
                      />
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        ))}
      </table>
      <p className="ws-muted">{t("planning.budget.wizard.limits.outside")}</p>
      {actions.dialogs}
    </section>
  );
}
