import { useState } from "react";
import { formatDate, formatMoney, formatNumber, speakMoney, useI18n, type MessageKey } from "@willowsum/i18n";
import { Badge, Button, EmptyState, ErrorState, Segmented, Skeleton } from "@willowsum/ui";
import { useAuthApi } from "../auth/api.ts";
import { changeFailure } from "./api.ts";
import { dismissPair, markPair, usePairs, type Proposal } from "./pairs.ts";
import "./pairs.css";

/**
 * S-059 «Пари» (IMP-03@PoC FR 17, FR 18, FR 20, FR 21; canvas PocMoneyPairs, texts PocMoneyPairsTexts): the tab «Пари · N»
 * of «Транзакції» — a segmented switch «Пропозиції · N» · «Односторонні» · «Підтверджені» (a radio group, not tabs) and the
 * cards of the open proposals with «Підтвердити» and «Не пара». There is no «Поєднати вручну» (FR 24, AC22): a manual pair
 * is «Позначити як переказ» in the details of a transaction. The board's card «Переказ брокеру» and the fee text for
 * USD→EUR are left out (#459 item 1): the currency difference is a loss or a gain (FR 21).
 */
type Part = "proposals" | "oneWay" | "confirmed";

const EVIDENCE: Readonly<Record<Proposal["evidence"][number]["code"], MessageKey>> = {
  "exact-amount": "pairs.evidence.exactAmount",
  "amount-less-fee": "pairs.evidence.amountLessFee",
  "rate-within-1": "pairs.evidence.rateWithin1",
  "rate-within-3": "pairs.evidence.rateWithin3",
  "same-day": "pairs.evidence.sameDay",
  "days-apart": "pairs.evidence.daysApart",
  "same-wallet-group": "pairs.evidence.sameWallet",
};
const CONFIDENCE: Readonly<Record<Proposal["confidence"], MessageKey>> = {
  high: "pairs.confidence.high",
  medium: "pairs.confidence.medium",
  low: "pairs.confidence.low",
};

export function PairsPanel({ onCount }: { onCount: (count: number) => void }) {
  const { t } = useI18n();
  const { state, reload, reloading } = usePairs();
  const [part, setPart] = useState<Part>("proposals");
  const count = state.kind === "ready" ? state.data.proposals.count : null;
  const options = [
    {
      value: "proposals",
      label: count === null ? t("pairs.part.proposals") : t("pairs.part.proposalsCount", { count }),
    },
    { value: "oneWay", label: t("pairs.part.oneWay") },
    { value: "confirmed", label: t("pairs.part.confirmed") },
  ];
  return (
    <div className="pairs">
      <p className="ws-muted pairs-intro">{t("pairs.intro")}</p>
      <div className="pairs-bar">
        <Segmented
          legend={t("pairs.parts")}
          options={options}
          value={part}
          onChange={(v) => setPart(v as Part)}
        />
        <Button label={t("pairs.rescan")} variant="quiet" loading={reloading} onClick={reload} />
      </div>
      {part !== "proposals" ? (
        <p className="ws-muted" role="status">
          {t(part === "oneWay" ? "pairs.oneWay.hint" : "pairs.notReady")}
          {part === "oneWay" ? ` ${t("pairs.notReady")}` : ""}
        </p>
      ) : state.kind === "loading" ? (
        <div aria-busy="true" aria-label={t("pairs.loading")}>
          <Skeleton variant="block" lines={3} height={168} />
        </div>
      ) : state.kind === "error" || state.kind === "off" ? (
        <ErrorState
          text={t("pairs.error.title")}
          code={state.kind === "error" ? state.supportId : undefined}
          onRetry={reload}
          retrying={reloading}
        />
      ) : state.data.proposals.items.length === 0 ? (
        <EmptyState
          placement="block"
          title={t("pairs.empty.title")}
          text={t("pairs.empty.text")}
          primary={{ label: t("pairs.rescan"), onClick: reload }}
        />
      ) : (
        <ul className="pairs-list">
          {state.data.proposals.items.map((p) => (
            <li key={`${p.outflow.transactionId}:${p.inflow.transactionId}`}>
              <ProposalCard
                proposal={p}
                names={state.data.names}
                onDone={() => {
                  onCount(Math.max(0, state.data.proposals.count - 1));
                  reload();
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ProposalCard({
  proposal: p,
  names,
  onDone,
}: {
  proposal: Proposal;
  names: ReadonlyMap<string, string>;
  onDone: () => void;
}) {
  const { t, locale } = useI18n();
  const api = useAuthApi();
  const [busy, setBusy] = useState<"confirm" | "dismiss" | null>(null);
  const [failure, setFailure] = useState<{ code?: string | undefined } | null>(null);
  const run = async (kind: "confirm" | "dismiss") => {
    if (busy) return;
    setBusy(kind);
    setFailure(null);
    const act = kind === "confirm" ? markPair : dismissPair;
    const o = await act(api, p.outflow.transactionId, p.inflow.transactionId);
    setBusy(null);
    if (o.ok) onDone();
    else setFailure({ code: changeFailure(o).code });
  };
  const kind = t(p.pairKind === "exchange" ? "pairs.kind.exchange" : "pairs.kind.transfer");
  const out = p.outflow.amount;
  const inn = p.inflow.amount;
  const side = (s: Proposal["outflow"]) => (
    <div className="pairs-side">
      <p className="pairs-side-where">
        {names.get(s.accountId) ?? "—"} · {formatDate(locale, s.date)}
      </p>
      <p className="pairs-side-amount ws-tabular">
        <span aria-label={speakMoney(locale, s.amount.amount, s.amount.currency, { signed: true })}>
          {formatMoney(locale, s.amount.amount, s.amount.currency, { signed: true })}
        </span>
      </p>
    </div>
  );
  const difference = p.difference;
  const loss = difference?.amount.startsWith("-") ?? false;
  return (
    <article className="ws-card pairs-card" aria-label={`${kind}: ${out.currency} → ${inn.currency}`}>
      <header className="pairs-head">
        <h3 className="ws-text-heading-3">{kind}</h3>
        <Badge
          label={t(CONFIDENCE[p.confidence], { score: p.score })}
          tone={p.confidence === "high" ? "positive" : "attention"}
        />
        {p.ambiguousWith.length > 0 ? (
          <Badge label={t("pairs.ambiguous", { count: p.ambiguousWith.length })} tone="neutral" />
        ) : null}
      </header>
      <div className="pairs-sides">
        {side(p.outflow)}
        <span className="pairs-arrow" aria-hidden="true">
          →
        </span>
        {side(p.inflow)}
      </div>
      {p.kind === "same-currency" && p.fee ? (
        <p className="pairs-fee">
          <span aria-hidden="true">! </span>
          {t("pairs.fee", { amount: formatMoney(locale, p.fee.amount, p.fee.currency) })}
        </p>
      ) : null}
      {p.kind === "cross-currency" ? (
        <div className="pairs-fee">
          {difference && !/^[-+]?0*(\.0*)?$/.test(difference.amount) ? (
            <p>
              <span aria-hidden="true">! </span>
              {t(loss ? "pairs.difference.loss" : "pairs.difference.gain", {
                amount: formatMoney(locale, difference.amount.replace(/^-/, ""), difference.currency),
              })}
            </p>
          ) : null}
          <p className="ws-muted">
            {p.bankRate ? t("pairs.rate.bank", { rate: formatNumber(locale, p.bankRate) }) : null}
            {p.bankRate && p.rate ? " · " : null}
            {p.rate ? t("pairs.rate.reference", { rate: formatNumber(locale, p.rate.rate) }) : null}
            {!p.bankRate && !p.rate ? t("pairs.rate.none") : null}
          </p>
        </div>
      ) : null}
      <section aria-label={t("pairs.why")}>
        <p className="pairs-why ws-muted">{t("pairs.why")}</p>
        <ul className="pairs-evidence">
          {p.evidence.map((e) => (
            <li key={e.code}>{t(EVIDENCE[e.code], { days: e.days ?? 0 })}</li>
          ))}
        </ul>
      </section>
      {failure ? (
        <p className="pairs-error" role="alert">
          {t("pairs.action.error")}
          {failure.code ? ` ${t("state.error.code", { code: failure.code })}` : ""}
        </p>
      ) : null}
      <div className="pairs-actions">
        <Button label={t("pairs.dismiss")} loading={busy === "dismiss"} onClick={() => void run("dismiss")} />
        <Button
          label={t("pairs.confirm")}
          variant="primary"
          loading={busy === "confirm"}
          onClick={() => void run("confirm")}
        />
      </div>
    </article>
  );
}
