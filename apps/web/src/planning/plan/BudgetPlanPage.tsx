import { useCallback, useState } from "react";
import { formatMoney, useI18n, type Locale } from "@willowsum/i18n";
import { Button, Icon, Skeleton, currencyPlaces, displayAmount, parseAmountInput } from "@willowsum/ui";
import { Decimal } from "@willowsum/domain-kernel";
import { AppLayout } from "../../pages/AppLayout.tsx";
import { BUDGET, childPath } from "../../routing/routes.ts";
import { hrefFor } from "../../routing/useHashPath.ts";
import { useDocumentTitle } from "../../useDocumentTitle.ts";
import { useAuthApi, outcome } from "../../auth/api.ts";
import { failureOf } from "../../auth/failure.ts";
import { kyivToday, useLoad } from "../../recurring/data.ts";
import { BudgetTabs } from "../BudgetTabs.tsx";
import "../budget/budget.css";
import "./plan.css";
import { NO_VALUE } from "./PlanCellInput.tsx";
import { monthWord, labelText, PlanTable, type CommitHandler } from "./PlanTable.tsx";
import {
  buildView,
  loadPlan,
  readGrid,
  type Grid,
  type PlanCell,
  type PlanRow,
  type PlanView,
} from "./model.ts";

type Notice =
  | {
      readonly kind: "changed";
      readonly category: string;
      readonly month: string;
      readonly from: string;
      readonly to: string;
    }
  | {
      readonly kind: "past" | "save" | "invalid" | "places" | "negative" | "tooLong";
      readonly text?: string;
    };

const addressOf = (c: PlanCell) => `${c.edit?.kind}:${c.edit?.lineId ?? ""}:${c.period}`;

/** The cell of `view` that the same address names (the cell re-read after a conflict). */
function sameCell(view: PlanView, cell: PlanCell): PlanCell | undefined {
  for (const s of view.sections)
    for (const item of s.items)
      if (item.type === "row")
        for (const c of item.row.cells) if (c.edit && addressOf(c) === addressOf(cell)) return c;
  return undefined;
}

/**
 * BUD-17@PoC b) (wave 2, row 127): S-126 «Бюджет → План» — the grid of 12 months on `GET /v1/budget/plan-grid`, a cell
 * saved at once by `PUT /v1/budget/plan-grid/cells` (FR 2). A cell changed in another window answers 409: the page
 * reads the grid again, shows the current value in the cell and says «Значення змінено в іншому вікні: {категорія},
 * {місяць}: A € → B €» (FR 3, AC4) — the user may enter their own value again. States: the skeleton of the grid, the
 * error with «Спробувати ще раз», and «План ще не заповнено» without a budget (FR «Стани інтерфейсу»).
 */
export function BudgetPlanPage({ today = kyivToday() }: { today?: string }) {
  const { t, locale } = useI18n();
  const api = useAuthApi();
  const title = t(BUDGET.label);
  useDocumentTitle(title);
  const { result, reload } = useLoad(loadPlan);
  const [fresh, setFresh] = useState<{ base: unknown; grid: Grid } | null>(null);
  const [pending, setPending] = useState<Readonly<Record<string, string>>>({});
  const [notice, setNotice] = useState<Notice | null>(null);

  const data = result.state === "ready" ? result.data : null;
  const ready = data?.kind === "ready" ? data : null;
  const grid = ready ? (fresh?.base === result ? fresh.grid : ready.grid) : null;
  const view = ready && grid ? buildView(grid, ready.names, today) : null;

  const commit: CommitHandler = useCallback(
    (row: PlanRow, cell: PlanCell, text: string) => {
      if (!view || !cell.edit) return;
      const places = currencyPlaces(view.currency);
      const parsed = parseAmountInput(text, locale, places);
      if (parsed.problem !== null) {
        setNotice({ kind: parsed.problem === "places" ? "places" : "invalid" });
        return;
      }
      const value = parsed.value;
      // A limit or a plan is not below zero and has at most 15 digits before the point: the field says so, the server is not asked.
      if (value !== null && value.startsWith("-")) {
        setNotice({ kind: "negative" });
        return;
      }
      if (value !== null && (value.split(".")[0] ?? "").length > 15) {
        setNotice({ kind: "tooLong" });
        return;
      }
      // Nothing changed: no request. An empty cell takes an own value back to the default; without one it stays.
      const current = cell.amount?.amount ?? null;
      if (value === null ? !cell.edit.own : current !== null && new Decimal(current).eq(value)) return;
      const key = addressOf(cell);
      setNotice(null);
      setPending((p) => ({ ...p, [key]: text }));
      void (async () => {
        const done = () =>
          setPending((p) => {
            const rest = { ...p };
            delete rest[key];
            return rest;
          });
        const saved = await outcome(
          api.PUT("/v1/budget/plan-grid/cells", {
            body: {
              period: cell.period,
              kind: cell.edit!.kind,
              lineId: cell.edit!.lineId,
              amount: value === null ? null : { amount: value, currency: view.currency },
              version: cell.edit!.version,
            },
          }),
        );
        const problem = !saved.ok && saved.kind === "problem" ? saved.problem : null;
        if (saved.ok || problem?.code === "VERSION_CONFLICT" || isPast(problem)) {
          const again = await readGrid(api);
          if (!again.ok) {
            reload();
            return;
          }
          setFresh({ base: result, grid: again.data });
          done();
          if (saved.ok) return;
          if (isPast(problem)) return setNotice({ kind: "past" });
          // The cell of the grid just read is the value of the other window (B); the user's own is A.
          const now = ready ? sameCell(buildView(again.data, ready.names, today), cell) : undefined;
          setNotice({
            kind: "changed",
            category: labelText(t, row.label),
            month: monthWord(t, locale, cell.period),
            from: value === null ? NO_VALUE : formatMoney(locale, value, view.currency),
            to: now?.amount ? formatMoney(locale, now.amount.amount, now.amount.currency) : NO_VALUE,
          });
          return;
        }
        done();
        setNotice({ kind: "save" });
      })();
    },
    [api, locale, reload, result, ready, t, today, view],
  );

  const failure = result.state === "error" ? failureOf(result.failure) : null;

  return (
    <AppLayout sectionId={BUDGET.sectionId} pageId={BUDGET.id}>
      <div className="app-page-head bud-head">
        <div className="plan-head">
          <h1>{title}</h1>
          {view ? (
            <p className="ws-muted">{t("planning.plan.subtitle", { currency: view.currency })}</p>
          ) : null}
        </div>
        {data && data.kind !== "none" ? (
          <a
            className="ws-icon-button"
            href={hrefFor(childPath("budgetGeneral"))}
            aria-label={t("planning.budget.settings.open")}
            title={t("planning.budget.settings.open")}
          >
            <Icon name="settings" size={20} />
          </a>
        ) : null}
      </div>
      <BudgetTabs selected="plan">
        {result.state === "error" && failure ? (
          <section className="ws-card bud-card" role="alert" aria-labelledby="plan-error-title">
            <h2 id="plan-error-title" className="ws-text-heading-3 bud-card-title">
              <Icon name="close" size={16} /> {t("planning.plan.error.title")}
            </h2>
            <p className="ws-muted">{t("planning.budget.error.body")}</p>
            <p>
              <button type="button" className="ws-button" onClick={reload}>
                {t("planning.budget.error.retry")}
              </button>
            </p>
            {failure.code ? (
              <p className="ws-muted">{t("planning.budget.error.code", { code: failure.code })}</p>
            ) : null}
          </section>
        ) : !data ? (
          <section className="ws-card bud-card" aria-label={t("planning.plan.table")}>
            <Skeleton variant="row" lines={8} />
          </section>
        ) : !view ? (
          <section className="app-empty" aria-labelledby="plan-empty-title">
            <Icon name={BUDGET.icon} size={40} tone="muted" />
            <h2 id="plan-empty-title" className="ws-text-heading-3">
              {t("planning.plan.empty.title")}
            </h2>
            <Button
              variant="primary"
              href={hrefFor(childPath("budgetNew"))}
              label={t("planning.plan.empty.action")}
            />
          </section>
        ) : (
          <section className="ws-card plan-card" aria-labelledby="plan-card-title">
            <header className="plan-card-head">
              <h2 id="plan-card-title" className="ws-text-label">
                {t("planning.plan.card.title")}
              </h2>
              <p className="ws-muted">{t("planning.plan.card.hint")}</p>
            </header>
            {notice ? (
              <p className="plan-notice" role="alert">
                <Icon name="warning" size={16} /> {noticeText(notice, t, locale, view.currency)}
              </p>
            ) : null}
            <PlanTable view={view} pending={pending} onCommit={commit} />
          </section>
        )}
      </BudgetTabs>
    </AppLayout>
  );
}

/** `400 VALIDATION_FAILED` on `period` with `past` (the month turned while the page was open). */
function isPast(
  problem: { code: string; errors?: readonly { path?: string; issue?: string }[] } | null,
): boolean {
  return (
    problem?.code === "VALIDATION_FAILED" &&
    (problem.errors ?? []).some((e) => e.path === "period" && e.issue === "past")
  );
}

function noticeText(n: Notice, t: ReturnType<typeof useI18n>["t"], locale: Locale, currency: string): string {
  switch (n.kind) {
    case "changed":
      return t("planning.plan.error.changed", {
        category: n.category,
        month: n.month,
        from: n.from,
        to: n.to,
      });
    case "past":
      return t("planning.plan.error.past");
    case "invalid":
      return t("field.amount.error.number", {
        example: displayAmount(locale, "3000", currencyPlaces(currency)).text,
      });
    case "places":
      return t("field.amount.error.places", { places: String(currencyPlaces(currency)), currency });
    case "negative":
      return t("planning.plan.error.negative");
    case "tooLong":
      return t("planning.plan.error.tooLong");
    case "save":
      return t("planning.plan.error.save");
  }
}
