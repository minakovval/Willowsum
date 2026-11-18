import { useEffect, useRef, useState } from "react";
import { formatDate, formatMoney, useI18n, type MessageKey } from "@willowsum/i18n";
import { Button, FormDialog, Icon, type FormDialogState } from "@willowsum/ui";
import { outcome, useAuthApi, type Outcome } from "../../auth/api.ts";
import type { AccountLabel } from "../../recurring/data.ts";
import type { Goal, Money } from "./model.ts";
import { chosenSum, leftAfter, loadSpendRows, SPEND_PAGE, spendBody, type SpendRow } from "./spend.ts";

type Rows =
  | { state: "loading" }
  | { state: "error"; supportId?: string }
  | { state: "ready"; rows: readonly SpendRow[] };

const initials = (name: string) => Array.from(name.trim())[0]?.toUpperCase() ?? "";

/**
 * S-139 «Витратити з цілі» (BUD-05@PoC FR 8, FR 9, AC 2; canvas PocPlanGoalSpend, PocPlanGoalSpendStep2) on the CMP-21
 * form dialog: two steps «1 Транзакції · 2 Після витрати». Step 1: the search, the outgoing transactions of the goal's
 * account (any account for a goal of marks), newest first, at most 6 rows with checkboxes and «Ще N транзакцій ·
 * показати наступні 6» (no scrolling), the line «Обрано N · сума · у цілі залишиться …». Step 2: the same line, the
 * note, and the switch «Закрити ціль» (a goal may be closed without the full sum). «Списати з цілі» is active from step 1
 * once a transaction is chosen. No «Створити актив» (FR 9). The API checks and writes the spend; the goal it answers
 * with is what the card shows next.
 */
export function SpendDialog({
  goal,
  accounts,
  onClose,
  onSpent,
  onGone,
}: {
  goal: Goal;
  accounts: ReadonlyMap<string, AccountLabel>;
  onClose: () => void;
  /** The spend is written (the goal changed). */
  onSpent: () => void;
  /** The goal was closed with the spend: it leaves the list. */
  onGone: () => void;
}) {
  const { t, locale } = useI18n();
  const api = useAuthApi();
  const key = useRef<string>(crypto.randomUUID());
  const [search, setSearch] = useState("");
  const [loaded, setLoaded] = useState<{ key: string; rows: Rows } | null>(null);
  const [reload, setReload] = useState(0);
  const [shown, setShown] = useState(SPEND_PAGE);
  // The chosen rows are kept with their data, so they stay chosen while the search changes the list.
  const [chosen, setChosen] = useState<ReadonlyMap<string, SpendRow>>(() => new Map());
  const [closing, setClosing] = useState(false);
  const [busy, setBusy] = useState(false);
  // The spend is written (a later try only closes the goal); the card reloads when the dialog is left.
  const [spent, setSpent] = useState(false);
  const [failure, setFailure] = useState<{ key: MessageKey; params?: Record<string, string> } | null>(null);
  const money = (m: Money) => formatMoney(locale, m.amount, m.currency);
  const currency = goal.target.currency;

  const want = `${reload}|${search}`;
  const rows: Rows = loaded?.key === want ? loaded.rows : { state: "loading" };
  useEffect(() => {
    let live = true;
    void loadSpendRows(api, goal, search).then((o: Outcome<readonly SpendRow[]>) => {
      if (!live) return;
      setLoaded({
        key: want,
        rows: o.ok
          ? { state: "ready", rows: o.data }
          : { state: "error", ...(o.kind === "problem" && o.supportId ? { supportId: o.supportId } : {}) },
      });
      setShown(SPEND_PAGE);
    });
    return () => {
      live = false;
    };
  }, [api, goal, search, want]);

  const picked = [...chosen.values()];
  const sum = chosenSum(picked, currency);
  const left = leftAfter(goal, sum);
  const count = picked.length;
  const plural = (n: number) => new Intl.PluralRules(locale === "uk" ? "uk-UA" : "en").select(n);

  const toggle = (row: SpendRow, on: boolean) =>
    setChosen((old) => {
      const next = new Map(old);
      if (on) next.set(row.id, row);
      else next.delete(row.id);
      return next;
    });

  const submit = async () => {
    if (busy || count === 0) return;
    setBusy(true);
    setFailure(null);
    const done = spent
      ? { ok: true as const }
      : await outcome(
          api.POST("/v1/goals/{goalId}/spends", {
            params: { path: { goalId: goal.id }, header: { "Idempotency-Key": key.current } },
            body: spendBody(picked),
          }),
        );
    if (!done.ok) {
      setBusy(false);
      const code = done.kind === "problem" ? done.problem.code : null;
      setFailure({
        key:
          code === "GOAL_SPEND_OVER_COLLECTED"
            ? "planning.goals.spend.error.over"
            : code === "VALIDATION_FAILED"
              ? "planning.goals.spend.error.invalid"
              : "planning.goals.spend.error.save",
      });
      if (code === "VALIDATION_FAILED") setReload((n) => n + 1);
      return;
    }
    setSpent(true);
    if (closing) {
      const closed = await outcome(
        api.POST("/v1/goals/{goalId}/close", { params: { path: { goalId: goal.id } } }),
      );
      setBusy(false);
      if (!closed.ok) {
        // The spend is written; only the closing failed: the dialog stays open and says so (a try closes only).
        setFailure({ key: "planning.goals.spend.error.close" });
        return;
      }
      onGone();
      return;
    }
    setBusy(false);
    onSpent();
  };

  const visible = rows.state === "ready" ? rows.rows.slice(0, shown) : [];
  const rest = rows.state === "ready" ? Math.max(0, rows.rows.length - shown) : 0;
  const chosenLine = (
    <span className="goal-spend-sum" aria-live="polite">
      <span>
        {t("planning.goals.spend.chosen", { count: String(count) })} ·{" "}
        <b>{money(sum ?? { amount: "0", currency })}</b>
      </span>
      <span className="ws-muted">{t("planning.goals.spend.left", { left: money(left) })}</span>
    </span>
  );

  const step = (form: FormDialogState) => {
    if (form.step === 0)
      return (
        <>
          <p className="goal-spend-collected">
            {t("planning.goals.spend.collected", {
              collected: money(goal.collected),
              target: money(goal.target),
            })}
          </p>
          <div className="goal-spend-find">
            <label className="goal-spend-search">
              <Icon name="search" size={16} />
              <input
                type="search"
                aria-label={t("planning.goals.spend.search")}
                placeholder={t("planning.goals.spend.search.placeholder")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <p className="ws-muted goal-spend-caption">{t("planning.goals.spend.caption")}</p>
          </div>
          {rows.state === "loading" ? (
            <p role="status" className="ws-muted">
              {t("planning.goals.spend.loading")}
            </p>
          ) : rows.state === "error" ? (
            <div role="alert" className="goal-spend-error">
              <p>{t("planning.goals.spend.error.load")}</p>
              {rows.supportId ? (
                <p className="ws-muted">{t("planning.goals.spend.error.code", { code: rows.supportId })}</p>
              ) : null}
              <Button
                label={t("planning.goals.spend.error.retry")}
                variant="secondary"
                onClick={() => setReload((n) => n + 1)}
              />
            </div>
          ) : visible.length === 0 ? (
            <p className="ws-muted">
              {t(search.trim() === "" ? "planning.goals.spend.empty" : "planning.goals.spend.noMatch")}
            </p>
          ) : (
            <ul className="goal-spend-list" aria-label={t("planning.goals.spend.list")}>
              {visible.map((r) => {
                const account = accounts.get(r.accountId);
                const amount = money({ amount: `-${r.amount.amount}`, currency: r.amount.currency });
                return (
                  <li key={r.id}>
                    <label className="goal-spend-row" data-checked={chosen.has(r.id) || undefined}>
                      <input
                        type="checkbox"
                        className="ws-row-check"
                        checked={chosen.has(r.id)}
                        disabled={spent}
                        aria-label={t("planning.goals.spend.pick", { name: r.merchant, amount })}
                        onChange={(e) => toggle(r, e.target.checked)}
                      />
                      <span className="goal-spend-logo" aria-hidden="true">
                        {initials(r.merchant)}
                      </span>
                      <span className="goal-spend-what">
                        <b>{r.merchant}</b>
                        <span className="ws-muted">
                          {`${formatDate(locale, r.date)}${account ? ` · ${account.label}${account.mask ? ` ${account.mask}` : ""}` : ""}`}
                        </span>
                      </span>
                      <span className="goal-spend-amount">{amount}</span>
                    </label>
                  </li>
                );
              })}
              {rest > 0 ? (
                <li>
                  <button
                    type="button"
                    className="goal-spend-more"
                    onClick={() => setShown((n) => n + SPEND_PAGE)}
                  >
                    {t(`planning.goals.spend.more.${plural(rest)}` as MessageKey, { count: String(rest) })}
                  </button>
                </li>
              ) : null}
            </ul>
          )}
          {spent ? (
            <p role="note" className="ws-muted goal-spend-locked">
              {t("planning.goals.spend.locked")}
            </p>
          ) : null}
          {chosenLine}
        </>
      );
    return (
      <>
        <p className="goal-spend-collected">
          {t("planning.goals.spend.collected", {
            collected: money(goal.collected),
            target: money(goal.target),
          })}
        </p>
        <span className="goal-spend-sum">
          {t(`planning.goals.spend.chosenOn.${plural(count)}` as MessageKey, { count: String(count) })} ·{" "}
          <b>{money(sum ?? { amount: "0", currency })}</b> ·{" "}
          {t("planning.goals.spend.left", { left: money(left) })}
        </span>
        <div role="note" className="goal-spend-note">
          <Icon name="info" size={16} />
          <span>{t("planning.goals.spend.note")}</span>
        </div>
        <label className="ws-switch goal-spend-close">
          <input
            type="checkbox"
            role="switch"
            checked={closing}
            onChange={(e) => setClosing(e.target.checked)}
          />
          <span className="ws-switch-track" aria-hidden="true" />
          <span>
            <span>{t("planning.goals.spend.closeGoal")}</span>
            <span className="ws-muted goal-spend-close-hint">
              {t("planning.goals.spend.closeGoal.hint", { left: money(left) })}
            </span>
          </span>
        </label>
      </>
    );
  };

  return (
    <FormDialog
      open
      onClose={spent ? onSpent : onClose}
      title={t("planning.goals.spend.title", { name: goal.name })}
      closeLabel={t("planning.goals.dialog.close")}
      steps={[
        { label: t("planning.goals.spend.step.pick") },
        { label: t("planning.goals.spend.step.after") },
      ]}
      fields={[
        {
          id: "transactions",
          label: t("planning.goals.spend.step.pick"),
          empty: false,
          error: count === 0 ? t("planning.goals.spend.pickOne") : null,
        },
      ]}
      reason={{ fix: () => t("planning.goals.spend.pickOne") }}
      submitLabel={t("planning.goals.spend.submit")}
      busyLabel={t("planning.goals.spend.busy")}
      busy={busy}
      error={failure ? t(failure.key) : undefined}
      onSubmit={() => void submit()}
    >
      {step}
    </FormDialog>
  );
}
