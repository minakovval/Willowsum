import { useId, useState, type FormEvent } from "react";
import { useT } from "@willowsum/i18n";
import { START_PATH } from "../routing/routes.ts";
import { hrefFor } from "../routing/useHashPath.ts";
import { outcome, useAuthApi } from "./api.ts";
import { AuthLayout, LinkLine, Notice, SubmitButton } from "./AuthLayout.tsx";
import { Captcha } from "./captcha/Captcha.tsx";
import type { CaptchaConfig } from "./captcha/config.ts";
import { withBold } from "./emphasis.tsx";
import { failureOf, type Failure } from "./failure.ts";
import { PasswordField, TextField } from "./fields.tsx";
import { navigate, SIGN_UP_PATH } from "./navigation.ts";
import { formatCountdown } from "./rules.ts";
import { deadlineIn, useCountdown } from "./useCountdown.ts";

/** The lockout lasts 15 min (ACC-01 «Блокування»); used only when the server sent no `Retry-After`. */
const LOCK_FALLBACK_S = 15 * 60;

interface Unconfirmed {
  readonly email: string;
  readonly token: string;
}

/**
 * S-004 «Вхід» (ACC-01@PoC FR 2, 5, 9, 11, 12; AC7, AC13–AC15, AC18–AC22; canvas PocSignIn, PocSignInLocked,
 * PocSignInUnconfirmed). Only email and password: no Google, Apple or sign-in link. One message for a wrong email
 * or password. After 5 failures the server locks the email for 15 min: «Увійти» waits with a countdown and the
 * CAPTCHA is in the card; afterwards every attempt sends it. An unconfirmed account gets «Спершу підтвердіть email»
 * with «Надіслати лист ще раз». Signed in → «Планування → Бюджет» (the start page).
 */
export function SignInPage({ captcha }: { readonly captcha?: CaptchaConfig | undefined } = {}) {
  const t = useT();
  const api = useAuthApi();
  const summaryId = useId();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [hideSignal, setHideSignal] = useState(0);
  const [busy, setBusy] = useState<"sign-in" | "resend" | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const lockSeconds = useCountdown(lockedUntil);
  const [captchaNeeded, setCaptchaNeeded] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = useState(0);
  const [unconfirmed, setUnconfirmed] = useState<Unconfirmed | null>(null);
  const [resendAt, setResendAt] = useState<number | null>(null);
  const resendSeconds = useCountdown(resendAt);
  const [resent, setResent] = useState(false);

  // When the lockout is over, the message moves on to the CAPTCHA that every attempt now needs.
  const locked = lockSeconds > 0;

  const inactive =
    email.trim() === "" || password === "" || locked || (captchaNeeded && captchaToken === null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || inactive) return;
    setBusy("sign-in");
    setFailure(null);
    setResent(false);
    setHideSignal((n) => n + 1);
    const result = await outcome(
      api.POST("/v1/sessions", {
        body: { email: email.trim(), password, ...(captchaToken ? { captchaToken } : {}) },
      }),
    );
    setBusy(null);
    if (captchaNeeded) {
      setCaptchaToken(null);
      setCaptchaReset((n) => n + 1);
    }
    if (result.ok) {
      if (result.data.status === "signed-in") {
        navigate(START_PATH);
        return;
      }
      if (result.data.registrationToken) {
        setUnconfirmed({ email: email.trim(), token: result.data.registrationToken });
        setResendAt(deadlineIn(result.data.resendAfterS));
      }
      return;
    }
    setUnconfirmed(null);
    if (result.kind === "problem") {
      switch (result.problem.code) {
        case "INVALID_CREDENTIALS":
          setPassword("");
          setFailure({ key: "auth.signIn.invalid", code: result.supportId });
          return;
        case "SIGN_IN_LOCKED":
          setPassword("");
          setCaptchaNeeded(true);
          setLockedUntil(deadlineIn(result.retryAfterS ?? LOCK_FALLBACK_S));
          return;
        case "CAPTCHA_REQUIRED":
          // The first time: the CAPTCHA appears. With a CAPTCHA that did not pass: an error.
          if (!captchaNeeded) {
            setCaptchaNeeded(true);
            return;
          }
          break;
      }
    }
    setPassword("");
    setFailure(failureOf(result));
  }

  async function resend() {
    if (!unconfirmed || busy || resendSeconds > 0) return;
    setBusy("resend");
    setFailure(null);
    setResent(false);
    const result = await outcome(
      api.POST("/v1/registrations/resend", { body: { registrationToken: unconfirmed.token } }),
    );
    setBusy(null);
    if (result.ok) {
      setResent(true);
      setResendAt(deadlineIn(result.data.resendAfterS));
      return;
    }
    if (result.kind === "problem" && result.problem.code === "RATE_LIMITED" && result.retryAfterS) {
      setResendAt(deadlineIn(result.retryAfterS));
      return;
    }
    setFailure(failureOf(result));
  }

  const summary = locked
    ? null
    : captchaNeeded && captchaToken === null && email.trim() !== "" && password !== ""
      ? t("auth.signUp.fixCaptcha")
      : null;

  return (
    <AuthLayout title={t("auth.page.signIn")}>
      <h1 className="auth-title">{t("auth.signIn.title")}</h1>
      {locked ? (
        <Notice tone="error" title={t("auth.signIn.lockedTitle")}>
          {t("auth.signIn.lockedBody")}
        </Notice>
      ) : captchaNeeded && !failure ? (
        <Notice tone="warning">{t("auth.signIn.captchaNow")}</Notice>
      ) : null}
      {unconfirmed && (
        <Notice tone="warning" title={t("auth.signIn.unconfirmedTitle")}>
          {withBold(t("auth.signIn.unconfirmedBody", { email: unconfirmed.email }), unconfirmed.email)}
        </Notice>
      )}
      {resent && <Notice tone="info">{t("auth.signIn.resent")}</Notice>}
      {failure && (
        <Notice tone="error" code={failure.code}>
          {t(failure.key)}
        </Notice>
      )}
      <form className="auth-form" noValidate onSubmit={submit}>
        <TextField
          label={t("auth.field.email")}
          name="email"
          type="email"
          value={email}
          onChange={setEmail}
          required
          autoComplete="username"
          inputMode="email"
        />
        <PasswordField
          label={t("auth.field.password")}
          name="password"
          value={password}
          onChange={setPassword}
          required
          autoComplete="current-password"
          hideSignal={hideSignal}
        />
        {captchaNeeded && (
          <Captcha onToken={setCaptchaToken} resetSignal={captchaReset} action="sign-in" config={captcha} />
        )}
        {unconfirmed && (
          <SubmitButton
            type="button"
            variant="secondary"
            inactive={resendSeconds > 0}
            busy={busy === "resend"}
            onClick={() => void resend()}
          >
            {resendSeconds > 0
              ? t("auth.signIn.resendIn", { time: formatCountdown(resendSeconds) })
              : t("auth.signIn.resend")}
          </SubmitButton>
        )}
        {summary && (
          <p className="auth-summary" id={summaryId}>
            {summary}
          </p>
        )}
        <SubmitButton
          inactive={inactive}
          busy={busy === "sign-in"}
          describedBy={summary ? summaryId : undefined}
        >
          {locked
            ? t("auth.signIn.submitIn", { time: formatCountdown(lockSeconds) })
            : t("auth.signIn.submit")}
        </SubmitButton>
      </form>
      <LinkLine>
        {t("auth.signIn.noAccount")} <a href={hrefFor(SIGN_UP_PATH)}>{t("auth.signIn.createAccount")}</a>
      </LinkLine>
    </AuthLayout>
  );
}
