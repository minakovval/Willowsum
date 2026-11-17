import { useEffect, useId, useState } from "react";
import { useI18n, type MessageKey } from "@willowsum/i18n";
import { Button, Dialog, Field, Select, Skeleton, type DialogAction } from "@willowsum/ui";
import { useAuthApi, type Outcome } from "../auth/api.ts";
import { useAccounts, type Account } from "./api.ts";
import type { AccountDetail } from "./card.ts";
import { maskedNumber, money } from "./format.ts";
import { closeAccount, fieldIssue, readClosing, type Closing, type Settlement } from "./manage.ts";

type Choice = Settlement["kind"];

/** The balance on the chosen date (`GET …/closing`), or why the date cannot close the account. */
type Preview =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly data: Closing }
  | { readonly kind: "date"; readonly error: MessageKey }
  | { readonly kind: "error"; readonly supportId?: string | undefined };

const DATE_ISSUES: Readonly<Record<string, MessageKey>> = {
  in_future: "accountClose.error.future",
  before_opening: "accountClose.error.beforeOpening",
  invalid: "accountClose.error.date",
};

/** A refusal about the date: the field shows it; anything else is the dialog's error. */
function dateError(o: Exclude<Outcome<unknown>, { ok: true }>): MessageKey | null {
  if (o.kind !== "problem") return null;
  if (o.problem.code === "ACCOUNT_ACTIVITY_AFTER_CLOSE") return "accountClose.error.activity";
  const issue = fieldIssue(o, "closedOn");
  return issue === null ? null : (DATE_ISSUES[issue] ?? "accountClose.error.date");
}

const supportOf = (o: Exclude<Outcome<unknown>, { ok: true }>) =>
  o.kind === "problem" ? o.supportId : undefined;

/** «Ощадний ··1180 · ПриватБанк» (canvas PocMoneyCloseAcc): the name with the mask, then the institution. */
function accountLabel(a: Account): string {
  const mask = a.number ? maskedNumber(a.number.last4) : null;
  const name = mask ? `${a.name} ${mask}` : a.name;
  return a.institution ? `${name} · ${a.institution.name}` : name;
}

/**
 * S-055 «Закрити рахунок» (FIN-12@PoC FR 7, FR 8, AC3, AC4; canvas PocMoneyCloseAcc), on the CMP-21 a) dialog: the
 * closing date (today of the space by default) and the balance on it from the server; a balance that is not zero asks
 * «Перенести на інший рахунок» (an active account with the same currency) or «Списати коригуванням». The server moves
 * the money and closes in one request; nothing is computed here. «Не закривати, лише приховати» is PoC v2 (S-055 in the
 * screen map) and is not offered.
 */
export function CloseAccountDialog({
  account,
  today,
  onCancel,
  onClosed,
  onGone,
}: {
  account: AccountDetail;
  /** «Сьогодні» of the space (П-27), YYYY-MM-DD. */
  today: string;
  onCancel: () => void;
  /** The account is closed (or was closed already): the card reads it again or the page moves on. */
  onClosed: () => void;
  /** The account is not in the caller's space (FIN-12@PoC AC6): the card reads it again and shows «не знайдено». */
  onGone: () => void;
}) {
  const { t, locale } = useI18n();
  const api = useAuthApi();
  const [date, setDate] = useState(today);
  const [attempt, setAttempt] = useState(0);
  // The answer for one date and attempt; another date or a retry shows «loading» until its own answer comes.
  const key = `${date}#${attempt}`;
  const [answer, setAnswer] = useState<{ readonly key: string; readonly preview: Preview } | null>(null);
  const badDate = !/^\d{4}-\d{2}-\d{2}$/.test(date);
  const [choice, setChoice] = useState<Choice>("transfer");
  const [target, setTarget] = useState("");
  const [targetError, setTargetError] = useState<MessageKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ key: MessageKey; supportId?: string | undefined } | null>(null);
  const accounts = useAccounts(false);
  const groupId = useId();

  useEffect(() => {
    if (badDate) return;
    let live = true;
    void readClosing(api, account.id, date).then((o) => {
      if (!live) return;
      if (o.ok) return setAnswer({ key, preview: { kind: "ready", data: o.data } });
      if (o.kind === "problem" && o.problem.code === "NOT_FOUND") return onGone();
      if (o.kind === "problem" && o.problem.code === "ACCOUNT_CLOSED") return onClosed();
      const error = dateError(o);
      setAnswer({
        key,
        preview: error ? { kind: "date", error } : { kind: "error", supportId: supportOf(o) },
      });
    });
    return () => {
      live = false;
    };
    // `onGone` and `onClosed` are the card's; a new date or a retry (a new `key`) reads the balance again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, account.id, key, badDate]);

  const preview: Preview = badDate
    ? { kind: "date", error: "accountClose.error.date" }
    : answer?.key === key
      ? answer.preview
      : { kind: "loading" };

  const owed = preview.kind === "ready" && !preview.data.zero ? preview.data.currencies : [];
  const owedCurrencies = owed
    .filter((c) => !/^[-+]?0*(\.0*)?$/.test(c.balance.amount))
    .map((c) => c.currency);

  // FIN-12@PoC AC4: the transfer goes to another active account that holds every currency left on this one.
  const targets =
    accounts.state.kind === "ready"
      ? accounts.state.data.filter(
          (a) =>
            a.id !== account.id &&
            a.status === "active" &&
            owedCurrencies.every((c) => a.currencies.some((x) => x.currency === c)),
        )
      : [];

  const settle = owed.length > 0;
  const transferOff = settle && accounts.state.kind === "ready" && targets.length === 0;
  const chosen: Choice = transferOff ? "adjustment" : choice;

  const submit = async () => {
    if (preview.kind !== "ready") return;
    if (settle && chosen === "transfer" && target === "") {
      setTargetError("accountClose.error.pick");
      return;
    }
    setBusy(true);
    setFailure(null);
    const settlement: Settlement | undefined = !settle
      ? undefined
      : chosen === "transfer"
        ? { kind: "transfer", toAccountId: target }
        : { kind: "adjustment" };
    const o = await closeAccount(api, account.id, { closedOn: date, ...(settlement ? { settlement } : {}) });
    setBusy(false);
    if (o.ok) return onClosed();
    if (o.kind === "problem") {
      const code = o.problem.code;
      if (code === "NOT_FOUND") return onGone();
      if (code === "ACCOUNT_CLOSED") return onClosed();
      if (code === "ACCOUNT_BALANCE_NOT_ZERO") {
        // The balance changed since it was shown: show the new one before anything is moved.
        setFailure({ key: "accountClose.error.changed" });
        setAttempt((n) => n + 1);
        return;
      }
      if (code === "ACCOUNT_POSTINGS_PENDING") return setFailure({ key: "accountClose.error.pending" });
      const error = dateError(o);
      if (error) return setAnswer({ key, preview: { kind: "date", error } });
      if (fieldIssue(o, "settlement.toAccountId") !== null)
        return setTargetError("accountClose.error.target");
    }
    setFailure({
      key: "accountClose.error.failed",
      supportId: o.kind === "problem" ? o.supportId : undefined,
    });
  };

  const action: MessageKey = !settle
    ? "accountClose.action.close"
    : chosen === "transfer"
      ? "accountClose.action.transfer"
      : "accountClose.action.writeOff";
  const actions: DialogAction[] = [
    { label: t("accountClose.cancel"), onClick: onCancel },
    {
      label: t(action),
      variant: "primary",
      busyLabel: t("accountClose.busy"),
      disabled: preview.kind !== "ready",
      onClick: () => void submit(),
    },
  ];

  return (
    <Dialog
      open
      onClose={onCancel}
      title={t("accountClose.title", { name: account.name })}
      text={t("accountClose.text")}
      closeLabel={t("accountClose.closeLabel")}
      align="start"
      actions={actions}
      busy={busy}
      error={
        failure ? (
          <>
            <p>{t(failure.key)}</p>
            {failure.supportId ? <p>{t("accounts.error.code", { code: failure.supportId })}</p> : null}
          </>
        ) : undefined
      }
    >
      <div className="aclose-date-row">
        <Field
          className="aclose-date"
          label={t("accountClose.date")}
          type="date"
          required
          value={date}
          onChange={(v) => {
            setFailure(null);
            setDate(v);
          }}
          error={preview.kind === "date" ? t(preview.error) : undefined}
        />
        <div
          className="aclose-balance"
          aria-live="polite"
          aria-busy={preview.kind === "loading" || undefined}
        >
          <span>{t("accountClose.balanceOn")}</span>
          {preview.kind === "loading" ? (
            <Skeleton variant="text" lines={1} />
          ) : preview.kind === "ready" ? (
            <b>{preview.data.currencies.map((c) => money(locale, c.balance)).join(" · ")}</b>
          ) : (
            <b>—</b>
          )}
        </div>
      </div>
      {preview.kind === "error" ? (
        <div className="aclose-error" role="alert">
          <p>{t("accountClose.error.balance")}</p>
          {preview.supportId ? <p>{t("accounts.error.code", { code: preview.supportId })}</p> : null}
          <Button label={t("accounts.error.retry")} onClick={() => setAttempt((n) => n + 1)} />
        </div>
      ) : null}
      {settle ? (
        <fieldset className="aclose-options">
          <legend className="ws-field-label" id={groupId}>
            {t("accountClose.question")}
          </legend>
          <div className="aclose-option" data-checked={chosen === "transfer" || undefined}>
            <label className="aclose-option-head">
              <input
                type="radio"
                name={`${groupId}-choice`}
                checked={chosen === "transfer"}
                disabled={transferOff}
                onChange={() => setChoice("transfer")}
              />
              <span className="aclose-option-body">
                <b>{t("accountClose.transfer")}</b>
                <span className="ws-muted">{t("accountClose.transfer.text")}</span>
              </span>
            </label>
            {chosen === "transfer" || transferOff ? (
              <Select
                className="aclose-target"
                label={t("accountClose.transfer.account")}
                required
                loading={accounts.state.kind === "loading"}
                disabled={transferOff}
                disabledReason={
                  transferOff
                    ? t("accountClose.transfer.none", { currencies: owedCurrencies.join(", ") })
                    : undefined
                }
                error={targetError ? t(targetError) : undefined}
                value={target}
                onChange={(v) => {
                  setTargetError(null);
                  setTarget(v);
                }}
                options={targets.map((a) => ({ value: a.id, label: accountLabel(a) }))}
              />
            ) : null}
          </div>
          <div className="aclose-option" data-checked={chosen === "adjustment" || undefined}>
            <label className="aclose-option-head">
              <input
                type="radio"
                name={`${groupId}-choice`}
                checked={chosen === "adjustment"}
                onChange={() => setChoice("adjustment")}
              />
              <span className="aclose-option-body">
                <b>{t("accountClose.writeOff")}</b>
                <span className="ws-muted">{t("accountClose.writeOff.text")}</span>
              </span>
            </label>
          </div>
        </fieldset>
      ) : null}
    </Dialog>
  );
}
