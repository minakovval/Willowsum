import { formatLocaleOf, formatMoney, useI18n } from "@willowsum/i18n";
import { StatusMark } from "@willowsum/ui";
import { chargeMark } from "./status.tsx";
import { monthTitle } from "./format.ts";
import type { Charge, RecurringData } from "./data.ts";

const MAX_IN_CELL = 3;

const iso = (y: number, m: number, d: number): string =>
  `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** The weeks (Monday first) of the month of `today`, with the days of the neighbouring months that fill them. */
export function monthWeeks(today: string): { date: string; inMonth: boolean }[][] {
  const [y = 1970, m = 1] = today.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const lead = (first.getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const total = Math.ceil((lead + days) / 7) * 7;
  const cells = Array.from({ length: total }, (_, i) => {
    const at = new Date(Date.UTC(y, m - 1, 1 - lead + i));
    return {
      date: iso(at.getUTCFullYear(), at.getUTCMonth() + 1, at.getUTCDate()),
      inMonth: at.getUTCMonth() === m - 1,
    };
  });
  return Array.from({ length: total / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));
}

interface Item {
  paymentId: string;
  name: string;
  type: "expense" | "income";
  charge: Charge;
}

/**
 * BUD-07@PoC FR 7 and GRID-04@PoC AC 4: the charges of the month by date, each with its status mark (the word is in
 * the accessible name and in the legend); a skipped charge is «Пропущено» (FR 9). The API lists a payment's charges
 * through the next one, so a payment with several charges ahead in the month shows only the nearest.
 */
export function RecurringCalendar({ data, today }: { data: RecurringData; today: string }) {
  const { t, locale } = useI18n();
  const weeks = monthWeeks(today);
  const byDate = new Map<string, Item[]>();
  for (const p of data.payments)
    for (const charge of data.charges.get(p.id) ?? []) {
      const list = byDate.get(charge.dueOn) ?? [];
      list.push({ paymentId: p.id, name: p.name, type: p.type, charge });
      byDate.set(charge.dueOn, list);
    }
  const weekdays = (weeks[0] ?? []).map((c) =>
    new Intl.DateTimeFormat(formatLocaleOf(locale), { weekday: "short", timeZone: "UTC" }).format(
      new Date(`${c.date}T00:00:00Z`),
    ),
  );
  return (
    <section className="ws-card rec-card rec-calendar" aria-labelledby="rec-cal-title">
      <div className="rec-section-head">
        <h2 id="rec-cal-title" className="rec-label">
          {t("recurring.calendar.title")}
        </h2>
        <p className="ws-muted rec-hint">
          {t("recurring.calendar.hint", { month: monthTitle(locale, today) })}
        </p>
        <p className="ws-muted rec-hint">{t("recurring.calendar.partial")}</p>
      </div>
      <div className="rec-cal" role="grid" aria-labelledby="rec-cal-title">
        <div role="row" className="rec-cal-row rec-cal-head">
          {weekdays.map((w, i) => (
            <span key={i} role="columnheader" className="rec-cal-wd">
              {w}
            </span>
          ))}
        </div>
        {weeks.map((week) => (
          <div role="row" className="rec-cal-row" key={week[0]?.date}>
            {week.map((cell) => {
              const items = cell.inMonth ? (byDate.get(cell.date) ?? []) : [];
              const shown = items.slice(0, MAX_IN_CELL);
              return (
                <div
                  role="gridcell"
                  key={cell.date}
                  className="rec-cal-cell"
                  data-date={cell.date}
                  data-today={cell.date === today || undefined}
                  data-outside={!cell.inMonth || undefined}
                >
                  <span className="rec-cal-day">{Number(cell.date.slice(8))}</span>
                  <ul className="rec-cal-items">
                    {shown.map((it) => {
                      const mark = chargeMark(locale, it.type, it.charge);
                      const amount = formatMoney(
                        locale,
                        it.charge.amount?.amount ?? it.charge.expectedAmount.amount,
                        (it.charge.amount ?? it.charge.expectedAmount).currency,
                        { signed: it.type === "income" },
                      );
                      return (
                        <li key={it.paymentId} className="rec-cal-item" data-status={mark.id}>
                          <span className="rec-cal-name">{it.name}</span>
                          <span className="rec-cal-amount">{amount}</span>
                          <StatusMark id={mark.id} params={mark.params} markerOnly />
                        </li>
                      );
                    })}
                    {items.length > shown.length ? (
                      <li className="ws-muted rec-cal-more">
                        {t("recurring.calendar.more", { count: items.length - shown.length })}
                      </li>
                    ) : null}
                  </ul>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <Legend />
    </section>
  );
}

/** FR 9: the legend has three groups: the status of a charge, the change of the amount, the state of the payment. */
function Legend() {
  const { t } = useI18n();
  const groups: { title: string; marks: { id: string; params?: Record<string, string | number> }[] }[] = [
    {
      title: t("recurring.legend.charge"),
      marks: [
        { id: "d.paid", params: { date: t("recurring.legend.date") } },
        { id: "d.paidLate", params: { date: t("recurring.legend.date") } },
        { id: "d.expected" },
        { id: "d.overdue", params: { days: "N" } },
        { id: "d.skipped" },
        { id: "e.received", params: { date: t("recurring.legend.date") } },
        { id: "e.missing", params: { days: "N" } },
      ],
    },
    {
      title: t("recurring.legend.change"),
      marks: [
        { id: "f.riseExpense", params: { amount: t("recurring.legend.rose") } },
        { id: "f.fallExpense", params: { amount: t("recurring.legend.fell") } },
      ],
    },
    {
      title: t("recurring.legend.state"),
      marks: [{ id: "f.maybeCancelled" }],
    },
  ];
  return (
    <div className="rec-legend">
      {groups.map((g) => (
        <div key={g.title} className="rec-legend-group">
          <span className="rec-label">{g.title}</span>
          {g.marks.map((m) => (
            <StatusMark key={m.id} id={m.id} params={m.params ?? {}} />
          ))}
        </div>
      ))}
    </div>
  );
}
