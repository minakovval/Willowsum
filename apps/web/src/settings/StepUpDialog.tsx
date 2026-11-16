import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useT } from "@willowsum/i18n";
import { Icon } from "@willowsum/ui";
import { outcome, useAuthApi } from "../auth/api.ts";
import { failureOf, type Failure } from "../auth/failure.ts";
import { PasswordField } from "../auth/fields.tsx";

/** The lockout lasts 15 min (ACC-01, NFR-01 FR 13) when the server does not say how long is left. */
const LOCK_FALLBACK_S = 15 * 60;

export type StepUpAction = "password-change";

/**
 * S-032 «Підтвердіть, що це ви» (ACC-05@PoC FR 5, business rules; NFR-01@PoC FR 13, AC6–AC8; board PocStepUp): a
 * modal dialog that asks only for the current password right before the action — no code by email, no passkey.
 * - The password goes to `POST /v1/session/step-up` and is cleared from the field after every answer; it is never
 *   kept anywhere else. The one-time confirmation it returns goes straight to `onConfirmed` and is not stored.
 * - A wrong password: the general «Пароль неправильний», no hint and no count of attempts left.
 * - The lockout (429 `SIGN_IN_LOCKED`): «Вхід тимчасово заблоковано. Спробуйте через N хв», the time from
 *   `Retry-After`; the field and «Підтвердити» go, only «Закрити» stays (the server may have ended the session).
 * - `again`: an earlier confirmation was not accepted (used, expired, another action), so the password is asked
 *   again (AC8).
 * The browser's modal `<dialog>` keeps the page behind it inert; Escape, «Закрити» and «Скасувати» close it and the
 * focus goes back to the control that opened it.
 */
export function StepUpDialog({
  action,
  again = false,
  onConfirmed,
  onClose,
}: {
  action: StepUpAction;
  again?: boolean;
  onConfirmed: (stepUpToken: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const api = useAuthApi();
  const titleId = useId();
  const bodyId = useId();
  const ref = useRef<HTMLDialogElement>(null);
  const [password, setPassword] = useState("");
  const [hideSignal, setHideSignal] = useState(0);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [lockedMinutes, setLockedMinutes] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) dialog.showModal();
    dialog.querySelector<HTMLInputElement>("input")?.focus();
    return () => {
      if (dialog.open) dialog.close();
      opener?.focus();
    };
  }, []);

  const focusField = () => ref.current?.querySelector<HTMLInputElement>("input")?.focus();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || lockedMinutes !== null) return;
    setFailure(null);
    if (password === "") {
      setFieldError(t("auth.error.passwordRequired"));
      focusField();
      return;
    }
    setBusy(true);
    setFieldError(null);
    const o = await outcome(api.POST("/v1/session/step-up", { body: { action, password } }));
    setBusy(false);
    setPassword("");
    setHideSignal((n) => n + 1);
    if (o.ok) {
      onConfirmed(o.data.stepUpToken);
      return;
    }
    if (o.kind === "problem" && o.problem.code === "STEP_UP_PASSWORD_INVALID") {
      setFieldError(t("stepUp.invalid"));
      focusField();
      return;
    }
    if (o.kind === "problem" && o.problem.code === "SIGN_IN_LOCKED") {
      setLockedMinutes(Math.max(1, Math.ceil((o.retryAfterS ?? LOCK_FALLBACK_S) / 60)));
      return;
    }
    setFailure(failureOf(o));
  }

  return (
    <dialog
      ref={ref}
      className="step-up"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <form onSubmit={submit} noValidate>
        <button
          type="button"
          className="ws-icon-button step-up-close"
          aria-label={t("stepUp.close")}
          title={t("stepUp.close")}
          onClick={onClose}
        >
          <Icon name="close" size={20} />
        </button>
        <div className="step-up-body">
          <h2 id={titleId} className="step-up-title">
            {t("stepUp.title")}
          </h2>
          <p id={bodyId} className="ws-muted step-up-text">
            {again ? t("stepUp.again") : t("stepUp.body")}
          </p>
          {lockedMinutes !== null ? (
            <p className="step-up-alert" role="alert">
              <Icon name="warning" size={16} />
              <span>{t("stepUp.locked", { minutes: lockedMinutes })}</span>
            </p>
          ) : (
            <PasswordField
              label={t("stepUp.password")}
              value={password}
              onChange={setPassword}
              error={fieldError}
              required
              autoComplete="current-password"
              name="current-password"
              hideSignal={hideSignal}
            />
          )}
          {failure ? (
            <p className="step-up-alert" role="alert">
              <Icon name="warning" size={16} />
              <span>
                {t(failure.key)}
                {failure.code ? ` · ${t("auth.error.code", { code: failure.code })}` : null}
              </span>
            </p>
          ) : null}
        </div>
        <div className="step-up-actions">
          {lockedMinutes !== null ? (
            <button type="button" className="ws-button" onClick={onClose}>
              {t("stepUp.close")}
            </button>
          ) : (
            <>
              <button type="button" className="ws-button" onClick={onClose} disabled={busy}>
                {t("stepUp.cancel")}
              </button>
              <button type="submit" className="ws-button ws-button-primary" aria-disabled={busy || undefined}>
                {busy ? t("auth.busy") : t("stepUp.confirm")}
              </button>
            </>
          )}
        </div>
      </form>
    </dialog>
  );
}
