import { useState } from "react";
import { newIdempotencyKey } from "@willowsum/api-contract";
import { useI18n, type MessageKey } from "@willowsum/i18n";
import { Icon, RowActions, Skeleton, StatusMark, type MenuItem } from "@willowsum/ui";
import { outcome, useAuthApi, type Outcome } from "../auth/api.ts";
import { failureOf } from "../auth/failure.ts";
import { AppLayout } from "../pages/AppLayout.tsx";
import { childPath, RECURRING } from "../routing/routes.ts";
import { hrefFor } from "../routing/useHashPath.ts";
import { useDocumentTitle } from "../useDocumentTitle.ts";
import {
  kyivToday,
  loadRecurring,
  useLoad,
  type Payment,
  type Proposal,
  type RecurringData,
  type Charge,
  type Status,
} from "./data.ts";
import { PlanGrid, PlanRegion } from "../planning/PlanGrid.tsx";
import { RecurringCalendar } from "./Calendar.tsx";
import { LoadError } from "./LoadError.tsx";
import { Nearest, Summary } from "./Summary.tsx";
import { AmountChange, ChargeStatus } from "./status.tsx";
import { counted, expectedText, FREQUENCY_KEYS, monthTitle, shortDate } from "./format.ts";

/**
 * BUD-07@PoC c), S-141 «Регулярні платежі» (boards PocPlanRecurring, PocPlanRecurringEmpty): the proposals found in
 * the transactions with «Не регулярний» and «Підтвердити» (FR 4), the payments by group (FR 7: «Підписки», other
 * payments, income) with their next date, account and amount, «Додати вручну» (FR 6) and the states of the view.
 * The statuses of charges (FR 8–10, 21) with «Залишити» and «Позначити пропущеним», the change of an amount, the
 * calendar of the month with «Пропущено» (GRID-04 AC 4), the legend and the nearest charges come from the statuses and
 * charges of the API. What the API lacks (the totals for a month and a year, payments in other currencies, the
 * occurrences of a week ahead, pause and «Позначити скасованим», the payment details) is the next slice.
 */
export function RecurringPage({ today = kyivToday() }: { today?: string }) {
  const { t } = useI18n();
  const title = t(RECURRING.label);
  useDocumentTitle(title);
  const { result, reload } = useLoad(loadRecurring);
  const [notice, setNotice] = useState<string | null>(null);

  const decided = (message: string) => {
    setNotice(message);
    reload();
  };

  return (
    <AppLayout sectionId={RECURRING.sectionId} pageId={RECURRING.id}>
      <Header title={title} today={today} data={result.state === "ready" ? result.data : null} />
      <p className="rec-notice" role="status" id="rec-notice">
        {notice}
      </p>
      {result.state === "loading" ? (
        <section className="ws-card rec-card" aria-label={title}>
          <Skeleton variant="row" lines={6} />
        </section>
      ) : result.state === "error" ? (
        <LoadError failure={result.failure} onRetry={reload} />
      ) : result.data.payments.length === 0 ? (
        <section className="ws-card rec-card rec-empty" aria-labelledby="rec-empty-title">
          <div className="rec-empty-body">
            <span className="rec-empty-icon">
              <Icon name="recurring" size={24} />
            </span>
            <h2 id="rec-empty-title" className="ws-text-heading-3">
              {t("recurring.empty.title")}
            </h2>
            <p className="ws-muted">{t("recurring.empty.body")}</p>
            <AddLink />
          </div>
          <Proposals data={result.data} onDecided={decided} />
        </section>
      ) : (
        <>
          {result.data.proposals.length > 0 ? (
            <section className="ws-card rec-card" aria-labelledby="rec-proposals-title">
              <Proposals data={result.data} onDecided={decided} />
            </section>
          ) : null}
          {/* GRID-04@PoC FR 5: the calendar 8 and the totals with the nearest charges 4, the details on 12. */}
          <PlanGrid page="recurring">
            <PlanRegion name="calendar" span={8}>
              <RecurringCalendar data={result.data} today={today} />
            </PlanRegion>
            <div className="plan-region plan-span-4 plan-stack" data-plan-region="side">
              <PlanRegion name="summary" span={12}>
                <Summary data={result.data} />
              </PlanRegion>
              <PlanRegion name="upcoming" span={12}>
                <Nearest data={result.data} today={today} />
              </PlanRegion>
            </div>
            <PlanRegion name="details" span={12}>
              <PaymentsTable data={result.data} onDecided={decided} />
            </PlanRegion>
          </PlanGrid>
        </>
      )}
    </AppLayout>
  );
}

function Header({ title, today, data }: { title: string; today: string; data: RecurringData | null }) {
  const { t, locale } = useI18n();
  const month = monthTitle(locale, today);
  const subtitle =
    data && data.payments.length > 0
      ? t("recurring.subtitle", { count: counted(t, locale, "recurring.count", data.payments.length), month })
      : t("recurring.subtitle.month", { month });
  return (
    <div className="app-page-head rec-head">
      <div className="rec-head-text">
        <h1>{title}</h1>
        <p className="ws-muted">{subtitle}</p>
      </div>
      {data && data.payments.length > 0 ? <AddLink /> : null}
    </div>
  );
}

function AddLink() {
  const { t } = useI18n();
  return (
    <a className="ws-button ws-button-primary" href={hrefFor(childPath("newRecurring"))}>
      <Icon name="plus" size={16} />
      <span>{t("recurring.add")}</span>
    </a>
  );
}

const initials = (name: string): string =>
  name
    .split(/[\s·]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => [...w][0]?.toLocaleUpperCase() ?? "")
    .join("");

function Tile({ name }: { name: string }) {
  return (
    <span className="rec-tile" aria-hidden="true">
      {initials(name)}
    </span>
  );
}

type Decision = "confirm" | "reject";

/** FR 4: a proposal shows its frequency, expected amount and date; «Підтвердити» or «Не регулярний». */
function Proposals({ data, onDecided }: { data: RecurringData; onDecided: (message: string) => void }) {
  const { t, locale } = useI18n();
  const api = useAuthApi();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ key: MessageKey; code?: string | undefined } | null>(null);
  if (data.proposals.length === 0) return null;

  const decide = async (p: Proposal, decision: Decision) => {
    if (busy) return;
    setBusy(p.key);
    setError(null);
    const init = { params: { header: { "Idempotency-Key": newIdempotencyKey() } }, body: { key: p.key } };
    const o: Outcome<unknown> =
      decision === "confirm"
        ? await outcome(api.POST("/v1/recurring/proposals/confirm", init))
        : await outcome(api.POST("/v1/recurring/proposals/reject", init));
    setBusy(null);
    const name = p.merchant.name;
    if (o.ok) {
      onDecided(
        t(decision === "confirm" ? "recurring.proposal.confirmed" : "recurring.proposal.rejected", { name }),
      );
    } else if (o.kind === "problem" && o.problem.code === "RECURRING_PROPOSAL_GONE") {
      onDecided(t("recurring.proposal.gone"));
    } else {
      setError({ key: failureOf(o).key, code: failureOf(o).code });
    }
  };

  return (
    <div className="rec-proposals">
      <div className="rec-section-head">
        <h2 id="rec-proposals-title" className="rec-label">
          {t("recurring.proposals.title")}
        </h2>
        <p className="ws-muted rec-hint">
          {t("recurring.proposals.hint", {
            count: counted(t, locale, "recurring.proposals.count", data.proposals.length),
          })}
        </p>
      </div>
      {error ? (
        <p className="rec-action-error" role="alert">
          <Icon name="warning" size={16} />
          <span>
            {t("recurring.action.error")} {t(error.key)}
            {error.code ? ` ${t("recurring.error.code", { code: error.code })}` : ""}
          </span>
        </p>
      ) : null}
      <ul className="rec-proposal-list" aria-labelledby="rec-proposals-title">
        {data.proposals.map((p) => {
          const account = data.accounts.get(p.accountId)?.label;
          const meta = [
            t(FREQUENCY_KEYS[p.frequency]),
            p.variable ? t("recurring.variable") : null,
            t("recurring.proposal.next", { date: shortDate(locale, p.nextDate) }),
            account ?? null,
            counted(t, locale, "recurring.proposal.charges", p.transactionIds.length),
          ].filter((x): x is string => x !== null);
          const pending = busy === p.key;
          return (
            <li key={p.key} className="rec-proposal">
              <Tile name={p.merchant.name} />
              <span className="rec-proposal-text">
                <b>{p.merchant.name}</b>
                <span className="ws-muted rec-meta">{meta.join(" · ")}</span>
              </span>
              <span className="rec-amount">
                {expectedText(t, locale, p.expectedAmount, p.type, p.variable)}
              </span>
              <button
                type="button"
                className="ws-button"
                aria-label={t("recurring.reject.named", { name: p.merchant.name })}
                aria-disabled={busy !== null || undefined}
                onClick={() => void decide(p, "reject")}
              >
                {t("recurring.reject")}
              </button>
              <button
                type="button"
                className="ws-button"
                aria-label={t("recurring.confirm.named", { name: p.merchant.name })}
                aria-disabled={busy !== null || undefined}
                aria-busy={pending || undefined}
                onClick={() => void decide(p, "confirm")}
              >
                <Icon name="check" size={16} />
                <span>{t("recurring.confirm")}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {data.more ? <p className="ws-muted rec-hint">{t("recurring.proposals.more")}</p> : null}
    </div>
  );
}

const byNext = (a: Payment, b: Payment): number => {
  if (a.nextDate !== b.nextDate) {
    if (a.nextDate === null) return 1;
    if (b.nextDate === null) return -1;
    return a.nextDate < b.nextDate ? -1 : 1;
  }
  return a.name.localeCompare(b.name);
};

/** FR 7 (part): «Підписки», the other payments and the income, each by the next date. */
function PaymentsTable({ data, onDecided }: { data: RecurringData; onDecided: (message: string) => void }) {
  const { t } = useI18n();
  const sorted = [...data.payments].sort(byNext);
  const groups: { id: string; key: MessageKey; items: Payment[] }[] = [
    {
      id: "subscriptions",
      key: "recurring.group.subscriptions",
      items: sorted.filter((p) => p.type === "expense" && p.subscription),
    },
    {
      id: "other",
      key: "recurring.group.other",
      items: sorted.filter((p) => p.type === "expense" && !p.subscription),
    },
    { id: "income", key: "recurring.group.income", items: sorted.filter((p) => p.type === "income") },
  ];
  const columns: MessageKey[] = [
    "recurring.column.payment",
    "recurring.column.frequency",
    "recurring.column.next",
    "recurring.column.account",
    "recurring.column.amount",
    "recurring.column.last",
    "recurring.column.actions",
  ];
  return (
    <section className="ws-card rec-card rec-all" aria-labelledby="rec-all-title">
      <div className="rec-section-head">
        <h2 id="rec-all-title" className="rec-label">
          {t("recurring.all.title")}
        </h2>
        <p className="ws-muted rec-hint">{t("recurring.all.hint")}</p>
      </div>
      <div className="ws-table-wrap">
        <table className="ws-table rec-table">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c} scope="col" className={c === "recurring.column.amount" ? "rec-num" : undefined}>
                  {c === "recurring.column.actions" ? (
                    <span className="ws-visually-hidden">{t(c)}</span>
                  ) : (
                    t(c)
                  )}
                </th>
              ))}
            </tr>
          </thead>
          {groups
            .filter((g) => g.items.length > 0)
            .map((g) => (
              <tbody key={g.id}>
                <tr className="rec-group">
                  <th scope="colgroup" colSpan={columns.length}>
                    {t(g.key, { count: g.items.length })}
                  </th>
                </tr>
                {g.items.map((p) => (
                  <PaymentRow
                    key={p.id}
                    payment={p}
                    data={data}
                    columns={columns.map((c) => t(c))}
                    onDecided={onDecided}
                  />
                ))}
              </tbody>
            ))}
        </table>
      </div>
    </section>
  );
}

function PaymentRow({
  payment: p,
  data,
  columns,
  onDecided,
}: {
  payment: Payment;
  data: RecurringData;
  columns: string[];
  onDecided: (message: string) => void;
}) {
  const { t, locale } = useI18n();
  const status = data.statuses.get(p.id);
  const last = status?.lastCharge ?? null;
  const category = p.categoryId ? data.categories.get(p.categoryId)?.name : undefined;
  const under = [category ?? t("recurring.noCategory"), p.variable ? t("recurring.variableAmount") : null]
    .filter((x): x is string => x !== null)
    .join(" · ");
  const account = p.accountId ? data.accounts.get(p.accountId)?.label : undefined;
  return (
    <tr>
      <th scope="row" data-label={columns[0]}>
        <span className="rec-payment">
          <Tile name={p.name} />
          <span className="rec-payment-text">
            <span className="rec-payment-name">
              {p.name}
              {status?.state === "possibly-cancelled" ? <StatusMark id="f.maybeCancelled" /> : null}
            </span>
            <span className="ws-muted rec-meta">{under}</span>
          </span>
        </span>
      </th>
      <td data-label={columns[1]}>{t(FREQUENCY_KEYS[p.frequency])}</td>
      <td data-label={columns[2]}>{p.nextDate ? shortDate(locale, p.nextDate) : t("recurring.ended")}</td>
      <td data-label={columns[3]} className="rec-account">
        {account ?? t("recurring.noAccount")}
      </td>
      <td data-label={columns[4]} className="rec-num rec-amount">
        {expectedText(t, locale, p.expectedAmount, p.type, p.variable)}
        {status?.amountChange ? <AmountChange type={p.type} change={status.amountChange} /> : null}
      </td>
      <td data-label={columns[5]}>{last ? <ChargeStatus type={p.type} charge={last} /> : null}</td>
      <td data-label={columns[6]} className="rec-actions">
        <PaymentActions payment={p} status={status} charges={data.charges.get(p.id)} onDecided={onDecided} />
      </td>
    </tr>
  );
}

/**
 * FR 21: «Позначити пропущеним» on each overdue charge of the payment (the API takes any overdue charge by its date) (the API refuses it for anyone but the Owner); FR 10: «Залишити» on
 * a payment «Можливо, скасований». Neither has a body; a refusal is said at the top of the page.
 */
function PaymentActions({
  payment: p,
  status,
  charges,
  onDecided,
}: {
  payment: Payment;
  status: Status | undefined;
  charges: readonly Charge[] | undefined;
  onDecided: (message: string) => void;
}) {
  const { t, locale } = useI18n();
  const api = useAuthApi();
  const items: MenuItem[] = [];
  const known = charges ?? (status?.lastCharge ? [status.lastCharge] : []);
  const overdue = known.filter((c) => c.status === "overdue");
  const run = async (call: Promise<Outcome<unknown>>, done: string) => {
    const o = await call;
    onDecided(o.ok ? done : `${t("recurring.action.error")} ${t(failureOf(o).key)}`);
  };
  for (const charge of overdue)
    items.push({
      id: `skip-${charge.dueOn}`,
      label:
        overdue.length > 1
          ? t("recurring.action.skip.dated", { date: shortDate(locale, charge.dueOn) })
          : t("recurring.action.skip"),
      icon: "check",
      onSelect: () =>
        void run(
          outcome(
            api.POST("/v1/recurring/payments/{paymentId}/charges/{dueOn}/skip", {
              params: { path: { paymentId: p.id, dueOn: charge.dueOn } },
            }),
          ),
          t("recurring.notice.skipped", { name: p.name, date: shortDate(locale, charge.dueOn) }),
        ),
    });
  if (status?.state === "possibly-cancelled")
    items.push({
      id: "keep",
      label: t("recurring.action.keep"),
      icon: "check",
      onSelect: () =>
        void run(
          outcome(
            api.POST("/v1/recurring/payments/{paymentId}/keep", { params: { path: { paymentId: p.id } } }),
          ),
          t("recurring.notice.kept", { name: p.name }),
        ),
    });
  return items.length > 0 ? <RowActions items={items} /> : null;
}
