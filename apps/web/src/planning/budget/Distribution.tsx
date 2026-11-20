import { useEffect, useRef, useState, type ReactNode } from "react";
import { formatNumber, useI18n } from "@willowsum/i18n";
import { AmountField, Button, Skeleton } from "@willowsum/ui";
import { useAuthApi } from "../../auth/api.ts";
import { GoalDialog } from "../goals/GoalDialog.tsx";
import {
  loadDistribution,
  previewAllocation,
  type Allocation,
  type Distribution,
  type PlanArgs,
} from "./distribution.ts";
import { createBody, type Money } from "./wizard.ts";

/** What the server said about the plan not saved yet; `pending` while a newer request is on its way. */
export interface AllocationState {
  readonly allocation: Allocation | null;
  readonly pending: boolean;
  readonly failed: boolean;
  readonly retry: () => void;
}

/**
 * The server's calculation for the plan on screen (BUD-02@PoC FR 3, FR 15, AC6, AC7): runs again on every change of the
 * limits, the income plan or the chosen amounts; an answer to an older request is dropped.
 */
export function useAllocation(args: PlanArgs | null, chosen: readonly string[]): AllocationState {
  const api = useAuthApi();
  // The last answer and the request (its key) it answers; `pending` is derived: the key of the screen moved on.
  const [done, setDone] = useState<{ key: string; allocation: Allocation | null; failed: boolean }>({
    key: "",
    allocation: null,
    failed: false,
  });
  const [attempt, setAttempt] = useState(0);
  const key = args ? `${attempt}${JSON.stringify([createBody(args), chosen])}` : "";
  const latest = useRef(key);
  useEffect(() => {
    latest.current = key;
    if (!args) return;
    void previewAllocation(api, args, chosen).then((o) => {
      if (latest.current !== key) return;
      setDone((s) => ({ key, allocation: o.ok ? o.data : s.allocation, failed: !o.ok }));
    });
    // The arguments are rebuilt on every render; the key stands for their content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, key]);
  return {
    allocation: done.allocation,
    pending: args !== null && done.key !== key,
    failed: args !== null && done.key === key && done.failed,
    retry: () => setAttempt((n) => n + 1),
  };
}

/** AC6: the bottom strip of the limits step. Nothing while the server cannot tell (`balance: null`) or has not answered. */
export function LimitsStrip({ state, money }: { state: AllocationState; money: (m: Money) => string }) {
  const { t } = useI18n();
  const b = state.allocation?.balance;
  if (!b) return null;
  return (
    <div className="bud-wiz-strip" role="status">
      <strong>{t("planning.budget.wizard.strip.unallocated", { amount: money(b.unallocated) })}</strong>
      <span className="ws-muted">
        {t("planning.budget.wizard.strip.formula", {
          income: money(state.allocation!.incomePlan),
          limits: money(state.allocation!.limits),
          recurring: money(b.recurringOutsideLimits),
        })}
      </span>
    </div>
  );
}

type Row = { readonly key: string; readonly title: string; readonly hint: string | null };

/** Keys of the chosen amounts: `plan:` rows of a surplus, `src:` rows of a deficit. */
export const PLAN = "plan:";
export const SRC = "src:";

export function DistributionStep({
  currency,
  today,
  load,
  reload,
  alloc,
  chosen,
  onChosen,
  onCutLimits,
  money,
}: {
  currency: string;
  today: string;
  load: { state: "loading" } | { state: "error" } | { state: "ready"; data: Distribution };
  reload: () => void;
  alloc: AllocationState;
  chosen: ReadonlyMap<string, string | null>;
  onChosen: (key: string, value: string | null, problem: boolean) => void;
  onCutLimits: () => void;
  money: (m: Money) => string;
}) {
  const { t, locale } = useI18n();
  const [creating, setCreating] = useState(false);
  if (load.state === "error" || alloc.failed) {
    return (
      <section aria-labelledby="bud-wiz-h" role="alert">
        <h2 id="bud-wiz-h" className="ws-text-heading-2">
          {t("planning.budget.wizard.step.distribute")}
        </h2>
        <p className="ws-muted">{t("planning.budget.wizard.dist.error")}</p>
        <Button
          variant="secondary"
          onClick={() => {
            reload();
            alloc.retry();
          }}
          label={t("planning.budget.error.retry")}
        />
      </section>
    );
  }
  if (load.state === "loading" || alloc.allocation === null) return <Skeleton variant="row" lines={4} />;
  const d = load.data;
  const a = alloc.allocation;
  const b = a.balance;
  const field = (row: Row) => (
    <div className="bud-wiz-row" key={row.key}>
      <span>
        <strong>{row.title}</strong>
        {row.hint ? <span className="ws-muted">{row.hint}</span> : null}
      </span>
      <AmountField
        label={t("planning.budget.wizard.dist.amountOf", { name: row.title })}
        labelHidden
        currency={currency}
        value={chosen.get(row.key) ?? null}
        onChange={(v, problem) => onChosen(row.key, v, problem !== null)}
      />
    </div>
  );
  const group = (title: string, hint: string | null, rows: readonly ReactNode[], action?: ReactNode) =>
    rows.length === 0 && !action ? null : (
      <div className="bud-wiz-group">
        <h3 className="ws-text-eyebrow">
          {title}
          {hint ? <span className="ws-muted"> {hint}</span> : null}
        </h3>
        {rows}
        {action}
      </div>
    );
  const rate = (r: string | null) =>
    r === null ? null : t("planning.budget.wizard.dist.debt.rate", { rate: `${formatNumber(locale, r)} %` });
  const planText = <p className="ws-muted">{t("planning.budget.wizard.dist.planOnly")}</p>;
  const choice = a.choice;
  const over = choice?.status === "over";
  const overNote = over ? (
    <p role="alert" className="bud-wiz-error">
      {t("planning.budget.wizard.dist.over", { amount: money(b?.amount ?? a.limits) })}
    </p>
  ) : null;

  if (b === null) {
    return (
      <section aria-labelledby="bud-wiz-h">
        <h2 id="bud-wiz-h" className="ws-text-heading-2">
          {t("planning.budget.wizard.step.distribute")}
        </h2>
        <p>{t("planning.budget.wizard.dist.unknown")}</p>
      </section>
    );
  }
  if (b.kind === "balanced") {
    return (
      <section aria-labelledby="bud-wiz-h">
        <h2 id="bud-wiz-h" className="ws-text-heading-2">
          {t("planning.budget.wizard.step.distribute")}
        </h2>
        <p>{t("planning.budget.wizard.dist.balanced")}</p>
      </section>
    );
  }
  const tile = (label: string, value: string, warn = false) => (
    <div className="bud-wiz-tile" data-warn={warn}>
      <dt className="ws-muted">{label}</dt>
      <dd>{value}</dd>
    </div>
  );

  if (b.kind === "surplus") {
    const goalRows = d.goals.map((g) =>
      field({
        key: `${PLAN}goal:${g.id}`,
        title: g.name,
        hint: g.requiredMonthly
          ? t("planning.budget.wizard.dist.goal.need", {
              collected: money(g.collected),
              target: money(g.target),
              need: money(g.requiredMonthly),
            })
          : t("planning.budget.wizard.dist.goal.noDate", {
              collected: money(g.collected),
              target: money(g.target),
            }),
      }),
    );
    const debtRows = d.debts.map((x) =>
      field({
        key: `${PLAN}debt:${x.id}`,
        title: x.name,
        hint: [
          t("planning.budget.wizard.dist.debt.balance", { balance: money(x.balance) }),
          rate(x.annualRate),
          x.minimum ? t("planning.budget.wizard.dist.debt.minimum", { minimum: money(x.minimum) }) : null,
        ]
          .filter((p) => p !== null)
          .join(" · "),
      }),
    );
    return (
      <section aria-labelledby="bud-wiz-h" className="bud-wiz-dist">
        <h2 id="bud-wiz-h" className="ws-text-heading-2">
          {t("planning.budget.wizard.dist.surplus.title")}
        </h2>
        <p className="ws-muted">
          {t("planning.budget.wizard.dist.surplus.lead", { amount: money(b.amount) })}
        </p>
        <dl className="bud-wiz-tiles">
          {tile(t("planning.budget.wizard.dist.surplusTile"), money(b.amount))}
          {tile(
            t("planning.budget.wizard.dist.allocated"),
            choice ? money(choice.chosen) : money({ amount: "0", currency }),
          )}
          {tile(t("planning.budget.wizard.dist.rest"), choice ? money(choice.rest) : money(b.amount))}
        </dl>
        {group(
          t("planning.budget.wizard.dist.goals"),
          t("planning.budget.wizard.dist.goals.hint"),
          goalRows,
          <Button
            variant="secondary"
            onClick={() => setCreating(true)}
            label={`+ ${t("planning.budget.wizard.dist.newGoal")}`}
          />,
        )}
        {group(t("planning.budget.wizard.dist.debts"), t("planning.budget.wizard.dist.debts.hint"), debtRows)}
        {group(t("planning.budget.wizard.dist.savings"), t("planning.budget.wizard.dist.savings.hint"), [
          field({ key: `${PLAN}save`, title: t("planning.budget.wizard.dist.savings.row"), hint: null }),
        ])}
        <div className="bud-wiz-row">
          <span>
            <strong>{t("planning.budget.wizard.dist.leave")}</strong>
            <span className="ws-muted">{t("planning.budget.wizard.dist.leave.hint")}</span>
          </span>
          <output className="bud-num">{choice ? money(choice.rest) : money(b.amount)}</output>
        </div>
        {overNote}
        {planText}
        {creating ? (
          <GoalDialog
            goals={d.goals}
            today={today}
            fallbackCurrency={currency}
            onClose={() => setCreating(false)}
            onSaved={() => {
              setCreating(false);
              reload();
            }}
          />
        ) : null}
      </section>
    );
  }

  // A deficit: the question and the sources; «Зменшити ліміти» goes back to the limits (the server takes it as lower limits).
  return (
    <section aria-labelledby="bud-wiz-h" className="bud-wiz-dist">
      <h2 id="bud-wiz-h" className="ws-text-heading-2">
        {t("planning.budget.wizard.dist.deficit.title", { amount: money(b.amount) })}
      </h2>
      <p className="ws-muted">{t("planning.budget.wizard.dist.deficit.lead")}</p>
      <dl className="bud-wiz-tiles">
        {tile(t("planning.budget.wizard.dist.income"), money(a.incomePlan))}
        {tile(t("planning.budget.wizard.dist.limits"), money(a.limits))}
        {tile(t("planning.budget.wizard.dist.deficitTile"), `−${money(b.amount)}`, true)}
      </dl>
      {group(t("planning.budget.wizard.dist.sources"), null, [
        ...d.goals.map((g) =>
          field({
            key: `${SRC}goal:${g.id}`,
            title: t("planning.budget.wizard.dist.fromGoal", { name: g.name }),
            hint: t("planning.budget.wizard.dist.fromGoal.hint"),
          }),
        ),
        ...d.savings.map((s) =>
          field({
            key: `${SRC}save:${s.id}`,
            title: t("planning.budget.wizard.dist.fromSavings", { account: accountName(s) }),
            hint: s.amount ? money(s.amount) : null,
          }),
        ),
        ...d.cards.map((c) =>
          field({
            key: `${SRC}card:${c.id}`,
            title: t("planning.budget.wizard.dist.toDebt", { account: accountName(c) }),
            hint: c.amount
              ? t("planning.budget.wizard.dist.toDebt.hint", { available: money(c.amount) })
              : null,
          }),
        ),
        <div className="bud-wiz-row" key="cut">
          <span>
            <strong>{t("planning.budget.wizard.dist.cutLimits")}</strong>
            <span className="ws-muted">{t("planning.budget.wizard.dist.cutLimits.hint")}</span>
          </span>
          <Button
            variant="secondary"
            onClick={onCutLimits}
            label={t("planning.budget.wizard.dist.cutLimits")}
          />
        </div>,
      ])}
      <div className="bud-wiz-covered" role="status">
        <strong>
          {t("planning.budget.wizard.dist.covered", {
            covered: money(choice?.chosen ?? { amount: "0", currency }),
            total: money(b.amount),
          })}
        </strong>
        <span className="ws-muted">
          {money(choice?.rest ?? b.amount)} {t("planning.budget.wizard.dist.left")}
        </span>
      </div>
      {overNote}
      {planText}
    </section>
  );
}

const accountName = (s: { name: string; mask: string | null }) => (s.mask ? `${s.name} ${s.mask}` : s.name);

/** The lists of the rows, read when the step opens; `reload` after a new goal. */
export function useDistribution(currency: string, enabled: boolean) {
  const api = useAuthApi();
  const [load, setLoad] = useState<
    { state: "loading" } | { state: "error" } | { state: "ready"; data: Distribution }
  >({
    state: "loading",
  });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void loadDistribution(api, currency).then((r) => {
      if (live) setLoad(r.ok ? { state: "ready", data: r.data } : { state: "error" });
    });
    return () => {
      live = false;
    };
  }, [api, currency, enabled, attempt]);
  return { load, reload: () => setAttempt((n) => n + 1) };
}
