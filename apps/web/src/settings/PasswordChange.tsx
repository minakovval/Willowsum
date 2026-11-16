import { useEffect, useRef, useState, type FormEvent } from "react";
import { useT } from "@willowsum/i18n";
import { Icon } from "@willowsum/ui";
import { outcome, useAuthApi } from "../auth/api.ts";
import { failureOf, type Failure } from "../auth/failure.ts";
import { PasswordField, useFieldError } from "../auth/fields.tsx";
import { newPasswordError, PASSWORD_MIN_LENGTH, type FieldError } from "../auth/rules.ts";
import { isSignedOut } from "./api.ts";
import { StepUpDialog } from "./StepUpDialog.tsx";

type Dialog = { readonly again: boolean } | null;

/**
 * «Змінити пароль» on «Профіль» (ACC-05@PoC FR 5, AC5; NFR-01@PoC FR 13, AC7, AC8). The new password is checked
 * here first (at least 12 characters, the explanation in the field; the server checks again). «Зберегти пароль»
 * then opens the step-up dialog (S-032) right before the change; its one-time confirmation goes straight into
 * `POST /v1/profile/password` and is never kept. A confirmation the server does not accept (`STEP_UP_REQUIRED`:
 * used, older than 5 min, another session or action) opens the dialog again. After the change the other sessions
 * end on the server and a security letter is sent; this session goes on.
 */
export function PasswordChange() {
  const t = useT();
  const api = useAuthApi();
  const openerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [hideSignal, setHideSignal] = useState(0);
  const [touched, setTouched] = useState(false);
  const [serverError, setServerError] = useState<FieldError>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [changed, setChanged] = useState(false);
  // After «Скасувати» or a change the form goes and the focus returns to «Змінити пароль».
  const [refocus, setRefocus] = useState(0);
  useEffect(() => {
    if (refocus > 0) openerRef.current?.focus();
  }, [refocus]);
  const error = serverError ?? newPasswordError(password);
  const errorText = useFieldError(touched ? error : null);

  const close = () => {
    setOpen(false);
    setPassword("");
    setTouched(false);
    setServerError(null);
    setFailure(null);
    setHideSignal((n) => n + 1);
  };

  function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    setFailure(null);
    if (busy || error) return;
    setDialog({ again: false });
  }

  async function change(stepUpToken: string) {
    setDialog(null);
    setBusy(true);
    const o = await outcome(api.POST("/v1/profile/password", { body: { password, stepUpToken } }));
    setBusy(false);
    if (o.ok) {
      close();
      setChanged(true);
      setRefocus((n) => n + 1);
      return;
    }
    if (o.kind === "problem" && o.problem.code === "STEP_UP_REQUIRED") {
      setDialog({ again: true });
      return;
    }
    setHideSignal((n) => n + 1);
    if (o.kind === "problem" && o.problem.code === "VALIDATION_FAILED") {
      setServerError({ key: "auth.error.passwordShort", params: { min: PASSWORD_MIN_LENGTH } });
      return;
    }
    const f = failureOf(o);
    setFailure(isSignedOut(o) ? { key: "settings.error.signedOut", code: f.code } : f);
  }

  return (
    <section className="ws-card settings-section" aria-labelledby="profile-password-title">
      <h2 id="profile-password-title" className="settings-section-title">
        {t("profile.password.change")}
      </h2>
      <p className="profile-status" role="status">
        {changed ? (
          <>
            <Icon name="check" size={16} />
            {t("profile.password.saved")}
          </>
        ) : null}
      </p>
      {open ? (
        <form className="profile-password" onSubmit={submit} noValidate>
          <p className="ws-muted">{t("profile.password.intro")}</p>
          <PasswordField
            label={t("profile.password.new")}
            value={password}
            onChange={(v) => {
              setPassword(v);
              setServerError(null);
            }}
            onBlur={() => setTouched(true)}
            error={errorText}
            hint={t("profile.password.hint", { min: PASSWORD_MIN_LENGTH })}
            required
            autoComplete="new-password"
            name="new-password"
            hideSignal={hideSignal}
          />
          {failure ? (
            <p className="step-up-alert" role="alert">
              <Icon name="warning" size={16} />
              <span>
                {t(failure.key)}
                {failure.code ? ` · ${t("auth.error.code", { code: failure.code })}` : null}
              </span>
            </p>
          ) : null}
          <div className="profile-actions">
            <button
              type="button"
              className="ws-button"
              onClick={() => {
                close();
                setRefocus((n) => n + 1);
              }}
            >
              {t("profile.password.cancel")}
            </button>
            <button type="submit" className="ws-button ws-button-primary" aria-disabled={busy || undefined}>
              {busy ? t("auth.busy") : t("profile.password.save")}
            </button>
          </div>
        </form>
      ) : (
        <p>
          <button
            ref={openerRef}
            type="button"
            className="ws-button"
            onClick={() => {
              setChanged(false);
              setOpen(true);
            }}
          >
            <Icon name="lock" size={16} />
            {t("profile.password.change")}
          </button>
        </p>
      )}
      {dialog ? (
        <StepUpDialog
          action="password-change"
          again={dialog.again}
          onConfirmed={(token) => void change(token)}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </section>
  );
}
