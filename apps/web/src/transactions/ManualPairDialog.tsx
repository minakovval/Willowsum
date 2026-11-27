import { useState } from "react";
import { formatDate, formatMoney, formatNumber, speakMoney, useI18n } from "@willowsum/i18n";
import { Dialog, ErrorState, Skeleton } from "@willowsum/ui";
import { useAuthApi } from "../auth/api.ts";
import { changeFailure, type Transaction } from "./api.ts";
import { markPair, useCounterparts, type Counterpart } from "./pairs.ts";
import "./pairs.css";

/**
 * «Позначити як переказ» (IMP-03@PoC FR 24, AC17–AC21; canvas PocMoneyPairs, texts PocMoneyPairsTexts): opens in the
 * details of a transaction from «…» — no page of its own (AC22). The list is what the server gives
 * (`GET …/transfer-candidates`): the rule of dates and of 5 % is its, not the screen's. A radio per candidate; the
 * difference under the list; «Поєднати в пару» is inactive until a candidate is chosen. A candidate in another currency
 * with no rate for the date is not markable (`markable: false`): it is shown with that reason, its radio is inactive.
 * The category of the fee cannot be changed yet: the server has no such action (PR body).
 */
export function ManualPairDialog({
  transaction,
  onClose,
  onPaired,
}: {
  transaction: Transaction;
  onClose: () => void;
  onPaired: (t: Transaction) => void;
}) {
  const { t } = useI18n();
  const api = useAuthApi();
  const { state, reload } = useCounterparts(transaction.id);
  const [chosen, setChosen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ code?: string | undefined } | null>(null);
  const ready = state.kind === "ready" ? state.data : null;
  const items = ready?.counterparts.items ?? [];
  const picked = items.find((c) => c.transactionId === chosen) ?? null;

  const pair = async () => {
    if (!picked || busy) return;
    setBusy(true);
    setError(null);
    const o = await markPair(api, transaction.id, picked.transactionId);
    setBusy(false);
    if (o.ok) onPaired(o.data);
    else setError({ code: changeFailure(o).code });
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={t("pairs.manual.title")}
      text={t("pairs.manual.text")}
      align="start"
      size="default"
      closeLabel={t("shell.close")}
      busy={busy}
      error={
        error ? (
          <>
            {t("pairs.manual.error")}
            {error.code ? ` ${t("state.error.code", { code: error.code })}` : ""}
          </>
        ) : undefined
      }
      note={picked || state.kind !== "ready" || items.length === 0 ? undefined : t("pairs.manual.choose")}
      actions={[
        { label: t("newTx.cancel"), onClick: onClose, variant: "secondary" },
        {
          label: t("pairs.manual.pair"),
          busyLabel: t("pairs.manual.busy"),
          onClick: () => void pair(),
          variant: "primary",
          disabled: !picked,
        },
      ]}
    >
      {state.kind === "loading" ? (
        <div aria-busy="true" aria-label={t("pairs.loading")}>
          <Skeleton variant="row" lines={3} />
        </div>
      ) : state.kind !== "ready" ? (
        <ErrorState
          placement="block"
          text={t("pairs.manual.loadError")}
          code={state.kind === "error" ? state.supportId : undefined}
          onRetry={reload}
        />
      ) : items.length === 0 ? (
        <div role="status">
          <p>{t("pairs.manual.empty")}</p>
          <p className="ws-muted">{t("pairs.manual.oneWay")}</p>
        </div>
      ) : (
        <>
          <fieldset className="pair-candidates">
            <legend>{t("pairs.manual.candidates")}</legend>
            {items.map((c) => (
              <Candidate
                key={c.transactionId}
                c={c}
                name={ready!.names.get(c.accountId) ?? "—"}
                checked={chosen === c.transactionId}
                onChoose={() => setChosen(c.transactionId)}
              />
            ))}
          </fieldset>
          {picked ? <Difference c={picked} /> : null}
        </>
      )}
    </Dialog>
  );
}

function Difference({ c }: { c: Counterpart }) {
  const { t, locale } = useI18n();
  const d = c.difference;
  if (c.kind === "same-currency") {
    if (!d || /^[-+]?0*(\.0*)?$/.test(d.amount)) return null;
    return (
      <p className="pairs-fee" role="status">
        {t("pairs.manual.fee", { amount: formatMoney(locale, d.amount.replace(/^-/, ""), d.currency) })}
      </p>
    );
  }
  const loss = d?.amount.startsWith("-") ?? false;
  return (
    <div className="pairs-fee" role="status">
      {d && !/^[-+]?0*(\.0*)?$/.test(d.amount) ? (
        <p>
          {t(loss ? "pairs.difference.loss" : "pairs.difference.gain", {
            amount: formatMoney(locale, d.amount.replace(/^-/, ""), d.currency),
          })}
        </p>
      ) : null}
      <p className="ws-muted">
        {c.bankRate ? t("pairs.rate.bank", { rate: formatNumber(locale, c.bankRate) }) : null}
        {c.bankRate && c.rate ? " · " : null}
        {c.rate ? t("pairs.rate.reference", { rate: formatNumber(locale, c.rate.rate) }) : null}
      </p>
    </div>
  );
}

function Candidate({
  c,
  name,
  checked,
  onChoose,
}: {
  c: Counterpart;
  name: string;
  checked: boolean;
  onChoose: () => void;
}) {
  const { t, locale } = useI18n();
  const text = [formatDate(locale, c.date), name, c.description ?? c.counterparty]
    .filter(Boolean)
    .join(" · ");
  return (
    <label className="pair-candidate">
      <input
        type="radio"
        name="pair-candidate"
        checked={checked}
        disabled={!c.markable}
        onChange={onChoose}
      />
      <span className="pair-candidate-text">
        <span>{text}</span>
        {!c.markable ? <span className="ws-muted">{t("pairs.manual.noRate")}</span> : null}
      </span>
      <span
        className="pair-candidate-amount ws-tabular"
        aria-label={speakMoney(locale, c.amount.amount, c.amount.currency, { signed: true })}
      >
        {formatMoney(locale, c.amount.amount, c.amount.currency, { signed: true })}
      </span>
    </label>
  );
}
