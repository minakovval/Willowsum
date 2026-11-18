import { formatMoney, useI18n } from "@willowsum/i18n";
import { StatusMark } from "@willowsum/ui";
import type { Payment, RecurringData } from "./data.ts";
import { shortDate } from "./format.ts";

const NEAREST_DAYS = 30;
const SHOWN = 6;

const addDays = (isoDate: string, days: number): string => {
  const [y = 1970, m = 1, d = 1] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};

/**
 * BUD-07@PoC FR 7, FR 9 (part): how many charges are overdue («Прострочено · N», «Дохід не надійшов · N») and the
 * nearest charges of the next 30 days. The sums for a month and a year wait for the API (they need the occurrences
 * and the rates of payments in other currencies), so no total is shown rather than a wrong one.
 */
export function Summary({ data }: { data: RecurringData }) {
  const { t } = useI18n();
  const byId = new Map(data.payments.map((p) => [p.id, p]));
  let overdue = 0;
  let missing = 0;
  for (const [id, s] of data.statuses) {
    if (s.lastCharge?.status !== "overdue") continue;
    if (byId.get(id)?.type === "income") missing++;
    else overdue++;
  }
  return (
    <section className="ws-card rec-card rec-summary" aria-labelledby="rec-sum-title">
      <div className="rec-section-head">
        <h2 id="rec-sum-title" className="rec-label">
          {t("recurring.summary.title")}
        </h2>
      </div>
      <div className="rec-summary-body">
        {overdue > 0 ? <StatusMark id="d.summaryOverdue" params={{ count: overdue }} /> : null}
        {missing > 0 ? <StatusMark id="d.summaryMissing" params={{ count: missing }} /> : null}
        {overdue === 0 && missing === 0 ? <p className="ws-muted">{t("recurring.summary.none")}</p> : null}
      </div>
    </section>
  );
}

/** FR 7: the nearest charges of the next 30 days, each by its next date. */
export function Nearest({ data, today }: { data: RecurringData; today: string }) {
  const { t, locale } = useI18n();
  const to = addDays(today, NEAREST_DAYS);
  const nearest: Payment[] = data.payments
    .filter((p) => p.nextDate !== null && p.nextDate >= today && p.nextDate <= to)
    .sort((a, b) =>
      a.nextDate === b.nextDate
        ? a.name.localeCompare(b.name)
        : (a.nextDate ?? "") < (b.nextDate ?? "")
          ? -1
          : 1,
    );
  const shown = nearest.slice(0, SHOWN);
  return (
    <section className="ws-card rec-card rec-summary" aria-labelledby="rec-near-title">
      <div className="rec-section-head">
        <h2 id="rec-near-title" className="rec-label">
          {t("recurring.nearest.title")}
        </h2>
        <p className="ws-muted rec-hint">{t("recurring.nearest.hint", { count: nearest.length })}</p>
      </div>
      <div className="rec-summary-body">
        <ul className="rec-nearest">
          {shown.map((p) => (
            <li key={p.id}>
              <span className="rec-nearest-date">{p.nextDate ? shortDate(locale, p.nextDate) : ""}</span>
              <span className="rec-nearest-name">{p.name}</span>
              <span className="rec-amount">
                {formatMoney(locale, p.expectedAmount.amount, p.expectedAmount.currency, {
                  signed: p.type === "income",
                })}
              </span>
            </li>
          ))}
        </ul>
        {nearest.length > shown.length ? (
          <p className="ws-muted rec-hint">
            {t("recurring.nearest.more", { count: nearest.length - shown.length })}
          </p>
        ) : null}
      </div>
    </section>
  );
}
