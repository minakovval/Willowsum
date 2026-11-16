import { useEffect, useState, type FormEvent } from "react";
import { useT } from "@willowsum/i18n";
import { Icon } from "@willowsum/ui";
import { hrefFor } from "../routing/useHashPath.ts";
import { outcome, useAuthApi } from "./api.ts";
import { AuthLayout, LinkLine, Notice, SubmitButton } from "./AuthLayout.tsx";
import { withBold } from "./emphasis.tsx";
import { failureOf, type Failure } from "./failure.ts";
import { PasswordField, StrengthMeter, TextField, useFieldError } from "./fields.tsx";
import { PASSWORD_RESET_PATH, SIGN_IN_PATH, TOKEN_SHAPE, useLinkToken } from "./navigation.ts";
import {
  emailError,
  EMAIL_MAX_LENGTH,
  formatCountdown,
  newPasswordError,
  PASSWORD_MIN_LENGTH,
} from "./rules.ts";
import { deadlineIn, useCountdown } from "./useCountdown.ts";

/** One letter per 60 s (ACC-01@PoC FR 15; the server answers the same either way, so the client waits by itself). */
const RESEND_AFTER_S = 60;

/**
 * S-007 «Відновлення пароля» (ACC-01@PoC FR 10, 11; canvas PocResetPassword, PocResetPasswordSent,
 * PocResetPasswordNew) in the narrow card of the sign-in screens (GRID-06@PoC FR 2). Without a token: the email
 * form, then «Перевірте пошту» with the same text for any address. With the letter's token (`?token=`): the new
 * password, after which every session of the account has ended; a used, replaced or old link shows «Посилання
 * недійсне». It is also where «Це був не я» leads (ACC-04@PoC AC7): sign-in stays refused until this is done.
 */
export function PasswordResetPage() {
  const link = useLinkToken(PASSWORD_RESET_PATH);
  // «Попросити нове посилання» on a dead link shows the email form; a newer link opened later shows its own form.
  const [askedNewAt, setAskedNewAt] = useState<number | null>(null);
  if (link.token === null || askedNewAt === link.n) return <RequestLink key={`request-${link.n}`} />;
  return <NewPassword key={link.n} token={link.token} onAskNew={() => setAskedNewAt(link.n)} />;
}

function RequestLink() {
  const t = useT();
  const api = useAuthApi();
  const [email, setEmail] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [resendAt, setResendAt] = useState<number | null>(null);
  const seconds = useCountdown(resendAt);
  const error = emailError(email);
  const errorText = useFieldError(touched ? error : null);

  async function send(e?: FormEvent) {
    e?.preventDefault();
    if (busy || seconds > 0) return;
    if (error) {
      setTouched(true);
      return;
    }
    setBusy(true);
    setFailure(null);
    const address = email.trim();
    const o = await outcome(api.POST("/v1/password-resets", { body: { email: address } }));
    setBusy(false);
    if (o.ok) {
      setSentTo(address);
      setResendAt(deadlineIn(RESEND_AFTER_S));
      return;
    }
    if (o.kind === "problem" && o.problem.code === "RATE_LIMITED" && o.retryAfterS) {
      setResendAt(deadlineIn(o.retryAfterS));
      return;
    }
    setFailure(failureOf(o));
  }

  const failureNotice = failure && (
    <Notice tone="error" code={failure.code}>
      {t(failure.key)}
    </Notice>
  );
  const back = (
    <LinkLine>
      <a href={hrefFor(SIGN_IN_PATH)}>{t("auth.linkInvalid.backToSignIn")}</a>
    </LinkLine>
  );

  if (sentTo !== null)
    return (
      <AuthLayout title={t("auth.checkEmail.title")}>
        <h1 className="auth-title">{t("auth.checkEmail.title")}</h1>
        <p className="auth-intro" role="status">
          {withBold(t("auth.reset.sentBody", { email: sentTo }), sentTo)}
        </p>
        {failureNotice}
        <SubmitButton
          type="button"
          variant="secondary"
          inactive={seconds > 0}
          busy={busy}
          onClick={() => void send()}
        >
          {seconds > 0
            ? t("auth.checkEmail.resendIn", { time: formatCountdown(seconds) })
            : t("auth.checkEmail.resend")}
        </SubmitButton>
        {back}
      </AuthLayout>
    );

  return (
    <AuthLayout title={t("auth.reset.title")}>
      <h1 className="auth-title">{t("auth.reset.title")}</h1>
      <p className="auth-intro">{t("auth.reset.intro")}</p>
      {failureNotice}
      <form className="auth-form" noValidate onSubmit={(e) => void send(e)}>
        <TextField
          label={t("auth.field.email")}
          name="email"
          type="email"
          value={email}
          onChange={setEmail}
          onBlur={() => setTouched(true)}
          error={errorText}
          required
          autoComplete="username"
          inputMode="email"
          maxLength={EMAIL_MAX_LENGTH}
        />
        <SubmitButton inactive={seconds > 0} busy={busy}>
          {seconds > 0
            ? t("auth.checkEmail.resendIn", { time: formatCountdown(seconds) })
            : t("auth.reset.send")}
        </SubmitButton>
      </form>
      {back}
    </AuthLayout>
  );
}

type LinkState = "checking" | "valid" | "invalid" | "changed";

function NewPassword({ token, onAskNew }: { readonly token: string; readonly onAskNew: () => void }) {
  const t = useT();
  const api = useAuthApi();
  const wellFormed = TOKEN_SHAPE.test(token);
  const [state, setState] = useState<LinkState>(wellFormed ? "checking" : "invalid");
  const [checkFailure, setCheckFailure] = useState<Failure | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [password, setPassword] = useState("");
  const [touched, setTouched] = useState(false);
  const [hideSignal, setHideSignal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const error = newPasswordError(password);
  const errorText = useFieldError(touched || password !== "" ? error : null);

  useEffect(() => {
    if (!wellFormed) return;
    let live = true;
    void outcome(api.POST("/v1/password-resets/check", { body: { token } })).then((o) => {
      if (!live) return;
      if (o.ok) setState("valid");
      else if (o.kind === "problem" && o.problem.code === "RESET_LINK_INVALID") setState("invalid");
      else setCheckFailure(failureOf(o));
    });
    return () => {
      live = false;
    };
  }, [api, token, wellFormed, attempt]);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (error) {
      setTouched(true);
      return;
    }
    setBusy(true);
    setFailure(null);
    setHideSignal((n) => n + 1);
    const o = await outcome(api.POST("/v1/password-resets/complete", { body: { token, password } }));
    setBusy(false);
    if (o.ok) setState("changed");
    else if (o.kind === "problem" && o.problem.code === "RESET_LINK_INVALID") setState("invalid");
    else setFailure(failureOf(o));
    setPassword("");
  }

  if (checkFailure)
    return (
      <AuthLayout title={t("auth.reset.newTitle")}>
        <h1 className="auth-title">{t("auth.reset.newTitle")}</h1>
        <Notice tone="error" code={checkFailure.code}>
          {t(checkFailure.key)}
        </Notice>
        <SubmitButton
          type="button"
          inactive={false}
          variant="secondary"
          onClick={() => {
            setCheckFailure(null);
            setAttempt((n) => n + 1);
          }}
        >
          {t("auth.verify.retry")}
        </SubmitButton>
      </AuthLayout>
    );

  switch (state) {
    case "checking":
      return (
        <AuthLayout title={t("auth.reset.newTitle")}>
          <h1 className="auth-title">{t("auth.reset.newTitle")}</h1>
          <p className="auth-progress" role="status">
            <span className="ws-spinner" aria-hidden="true" />
            {t("auth.verify.checking")}
          </p>
        </AuthLayout>
      );
    case "invalid":
      return (
        <AuthLayout title={t("auth.linkInvalid.title")}>
          <span className="auth-tile auth-tile-warning">
            <Icon name="warning" size={24} />
          </span>
          <h1 className="auth-title">{t("auth.linkInvalid.title")}</h1>
          <p className="auth-intro">{t("auth.reset.invalidBody")}</p>
          <SubmitButton type="button" inactive={false} onClick={onAskNew}>
            {t("auth.reset.askNew")}
          </SubmitButton>
          <LinkLine>
            <a href={hrefFor(SIGN_IN_PATH)}>{t("auth.linkInvalid.backToSignIn")}</a>
          </LinkLine>
        </AuthLayout>
      );
    case "changed":
      return (
        <AuthLayout title={t("auth.reset.changedTitle")}>
          <span className="auth-tile auth-tile-positive">
            <Icon name="check" size={24} />
          </span>
          <h1 className="auth-title">{t("auth.reset.changedTitle")}</h1>
          <p className="auth-intro" role="status">
            {t("auth.reset.changedBody")}
          </p>
          <a className="ws-button ws-button-primary auth-submit" href={hrefFor(SIGN_IN_PATH)}>
            {t("auth.verify.signIn")}
          </a>
        </AuthLayout>
      );
    case "valid":
      return (
        <AuthLayout title={t("auth.reset.newTitle")}>
          <h1 className="auth-title">{t("auth.reset.newTitle")}</h1>
          {failure && (
            <Notice tone="error" code={failure.code}>
              {t(failure.key)}
            </Notice>
          )}
          <form className="auth-form" noValidate onSubmit={(e) => void save(e)}>
            <PasswordField
              label={t("auth.reset.newPassword")}
              name="new-password"
              value={password}
              onChange={setPassword}
              onBlur={() => setTouched(true)}
              error={errorText}
              hint={t("auth.password.hint", { min: PASSWORD_MIN_LENGTH })}
              required
              autoComplete="new-password"
              hideSignal={hideSignal}
              after={<StrengthMeter password={password} />}
            />
            <Notice tone="warning" title={t("auth.reset.endsSessionsTitle")}>
              {t("auth.reset.endsSessionsBody")}
            </Notice>
            <SubmitButton inactive={false} busy={busy}>
              {t("auth.reset.save")}
            </SubmitButton>
          </form>
        </AuthLayout>
      );
  }
}
