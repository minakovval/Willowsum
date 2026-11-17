import { useState } from "react";
import { formatNumber, useI18n } from "@willowsum/i18n";
import { Button, IconButton, Icon, Skeleton } from "@willowsum/ui";
import type { AccountsSummary, Loaded } from "./api.ts";
import { counted, money, rateDate } from "./format.ts";

type Breakdown = AccountsSummary["moneyTogether"]["breakdown"][number];

/** The tint of each currency's segment and legend dot, largest first (DS-07 fill steps 1–4). */
const SERIES = 4;

/**
 * FIN-01@PoC FR 18, AC12, EC1: «Гроші разом» — cash accounts minus credit-card debt in the profile currency, the rate
 * source and date, then «За валютами»: a bar with a segment per currency and a legend where a foreign currency shows
 * its own amount first and, muted under it, «≈ <equivalent> · <share> %»; the profile currency shows its amount and
 * share only. Loans are not in it (the server leaves them out). A stale rate shows «≈» (EC1).
 */
export function MoneyTogether({ state, retry }: { state: Loaded<AccountsSummary>; retry: () => void }) {
  const { t, locale } = useI18n();
  const titleId = "accounts-money-together";
  if (state.kind === "off") return null;
  if (state.kind === "loading")
    return (
      <section className="ws-card accounts-money" aria-labelledby={titleId}>
        <h2 id={titleId} className="ws-label">
          {t("accounts.moneyTogether.title")}
        </h2>
        <Skeleton variant="block" />
      </section>
    );
  if (state.kind === "error")
    return (
      <section className="ws-card accounts-money" aria-labelledby={titleId}>
        <h2 id={titleId} className="ws-label">
          {t("accounts.moneyTogether.title")}
        </h2>
        <p role="alert">{t("accounts.card.error")}</p>
        <Button label={t("accounts.error.retry")} size="sm" onClick={retry} />
      </section>
    );
  const s = state.data;
  const m = s.moneyTogether;
  const caption = m.rate
    ? t("accounts.moneyTogether.caption", { currency: s.currency, date: rateDate(locale, m.rate.date) })
    : t("accounts.moneyTogether.captionNoRate", { currency: s.currency });
  const total = m.total ? money(locale, m.total) : "—";
  return (
    <section className="ws-card accounts-money" aria-labelledby={titleId}>
      <h2 id={titleId} className="ws-label">
        {t("accounts.moneyTogether.title")}
      </h2>
      <p className="accounts-caption ws-muted">{caption}</p>
      <p className="accounts-total">
        {m.approximate && m.total ? t("accounts.approx", { amount: total }) : total}
      </p>
      {m.breakdown.length > 0 ? (
        <>
          <h3 className="ws-label accounts-breakdown-title">{t("accounts.moneyTogether.breakdown")}</h3>
          <div className="accounts-bar" aria-hidden="true">
            {m.breakdown.map((b, i) =>
              b.percent ? (
                <span
                  key={b.currency}
                  className={`accounts-bar-part accounts-series-${String((i % SERIES) + 1)}`}
                  style={{ flexGrow: b.percent }}
                />
              ) : null,
            )}
          </div>
          <ul className="accounts-legend">
            {m.breakdown.map((b, i) => (
              <LegendItem key={b.currency} item={b} index={i} profile={s.currency} />
            ))}
          </ul>
        </>
      ) : null}
      {/* An account whose currency has no rate at all is left out of the total (it is never counted as 0). */}
      {m.unavailableCount > 0 ? (
        <p className="ws-muted accounts-small">{t("accounts.moneyTogether.unavailable")}</p>
      ) : null}
    </section>
  );
}

function LegendItem({ item, index, profile }: { item: Breakdown; index: number; profile: string }) {
  const { t, locale } = useI18n();
  const share = item.percent === null ? null : formatNumber(locale, String(item.percent));
  const foreign = item.currency !== profile;
  let under: string | null = null;
  if (foreign && item.equivalent && share !== null)
    under = t("accounts.legend.equivalent", { amount: money(locale, item.equivalent), percent: share });
  else if (foreign && item.equivalent)
    under = t("accounts.approx", { amount: money(locale, item.equivalent) });
  else if (share !== null) under = t("accounts.legend.share", { percent: share });
  return (
    <li className="accounts-legend-item">
      <span className={`accounts-dot accounts-series-${String((index % SERIES) + 1)}`} aria-hidden="true" />
      <span>
        <span className="accounts-legend-main">
          <span className="ws-muted">{item.currency}</span> <strong>{money(locale, item.amount)}</strong>
        </span>
        {under ? <span className="accounts-legend-under ws-muted">{under}</span> : null}
      </span>
    </li>
  );
}

/** FIN-01@PoC FR 21: «Джерела даних» — «Імпорт виписок» and «Вручну» with the number of active accounts in each. */
export function Sources({ state }: { state: Loaded<AccountsSummary> }) {
  const { t, locale } = useI18n();
  const titleId = "accounts-sources";
  if (state.kind === "off") return null;
  return (
    <section className="ws-card accounts-sources" aria-labelledby={titleId}>
      <h2 id={titleId} className="ws-label">
        {t("accounts.sources.title")}
      </h2>
      {state.kind === "loading" ? (
        <Skeleton variant="text" />
      ) : state.kind === "error" ? (
        <p>{t("accounts.card.error")}</p>
      ) : (
        <>
          <p className="accounts-caption ws-muted">
            {counted(
              t,
              locale,
              "accounts.activeCount",
              state.data.sources.import + state.data.sources.manual,
            )}
          </p>
          <dl className="accounts-sources-list">
            <div>
              <dt>{t("accounts.sources.import")}</dt>
              <dd>{counted(t, locale, "accounts.sources.count", state.data.sources.import)}</dd>
            </div>
            <div>
              <dt>{t("accounts.sources.manual")}</dt>
              <dd>{counted(t, locale, "accounts.sources.count", state.data.sources.manual)}</dd>
            </div>
          </dl>
        </>
      )}
    </section>
  );
}

/**
 * FIN-01@PoC EC1 (canvas PocMoneyAccountsStale): no NBU rate for today — the amounts in the profile currency use the
 * last known rate; the banner names its date. In PoC there are no bank connections, so it speaks of the rate only.
 */
export function RateBanner({ summary }: { summary: AccountsSummary }) {
  const { t, locale } = useI18n();
  const [closed, setClosed] = useState(false);
  const stale = summary.moneyTogether.breakdown
    .filter((b) => b.approximate && b.rateDate)
    .map((b) => b.rateDate!)
    .sort()[0];
  if (closed || !stale) return null;
  return (
    <div className="accounts-banner" role="status">
      <Icon name="warning" size={20} />
      <div>
        <p className="accounts-banner-title">{t("accounts.stale.title")}</p>
        <p>{t("accounts.stale.body", { date: rateDate(locale, stale) })}</p>
      </div>
      <IconButton icon="close" label={t("accounts.stale.close")} onClick={() => setClosed(true)} />
    </div>
  );
}
