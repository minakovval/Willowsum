import { useId, useState, type FormEvent } from "react";
import { useT } from "@willowsum/i18n";
import { hrefFor } from "../routing/useHashPath.ts";
import { outcome, useAuthApi } from "./api.ts";
import { AuthLayout, LinkLine, Notice, SubmitButton } from "./AuthLayout.tsx";
import { Captcha } from "./captcha/Captcha.tsx";
import type { CaptchaConfig } from "./captcha/config.ts";
import { failureOf, type Failure } from "./failure.ts";
import { PasswordField, TextField, useFieldError } from "./fields.tsx";
import { CHECK_EMAIL_PATH, navigate, SIGN_IN_PATH } from "./navigation.ts";
import { signUpDraft, startRegistration } from "./registration.ts";
import {
  emailError,
  EMAIL_MAX_LENGTH,
  nameError,
  newPasswordError,
  PASSWORD_MIN_LENGTH,
  passwordStrength,
} from "./rules.ts";
import { deadlineIn } from "./useCountdown.ts";

/**
 * S-001 «Реєстрація» (ACC-01@PoC FR 1, 3, 11, 12; AC1–AC3, AC10, AC18–AC22; canvas PocSignUp). Name, email and a
 * password with the strength indicator and «Показати пароль»; the CAPTCHA in the card; no consent boxes and no
 * Google or Apple. «Створити акаунт» stays inactive while a field is invalid or the CAPTCHA is not passed, and the
 * reason is shown by the field and under the button. The answer is always «Перевірте пошту» (FR 8).
 */
export function SignUpPage({ captcha }: { readonly captcha?: CaptchaConfig | undefined } = {}) {
  const t = useT();
  const api = useAuthApi();
  const summaryId = useId();
  const [draft] = useState(signUpDraft);
  const [name, setName] = useState(draft?.name ?? "");
  const [email, setEmail] = useState(draft?.email ?? "");
  const [password, setPassword] = useState("");
  const [touched, setTouched] = useState({ name: draft !== null, email: draft !== null, password: false });
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = useState(0);
  const [hideSignal, setHideSignal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);

  const errors = { name: nameError(name), email: emailError(email), password: newPasswordError(password) };
  const nameText = useFieldError(touched.name ? errors.name : null);
  const emailText = useFieldError(touched.email ? errors.email : null);
  // The password's reason shows while typing (canvas PocSignUp), the others after leaving the field.
  const passwordText = useFieldError(touched.password || password !== "" ? errors.password : null);

  const labels = {
    name: t("auth.field.name"),
    email: t("auth.field.email"),
    password: t("auth.field.password"),
  };
  const invalid = (Object.keys(errors) as (keyof typeof errors)[]).filter((k) => errors[k] !== null);
  const inactive = invalid.length > 0 || captchaToken === null;
  const summary =
    invalid.length > 0
      ? t("auth.signUp.fix", { fields: invalid.map((k) => labels[k]).join(", ") })
      : captchaToken === null
        ? t("auth.signUp.fixCaptcha")
        : null;

  const strength = passwordStrength(password);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (inactive) {
      setTouched({ name: true, email: true, password: true });
      return;
    }
    setBusy(true);
    setFailure(null);
    setHideSignal((n) => n + 1);
    const result = await outcome(
      api.POST("/v1/registrations", {
        body: { name: name.trim(), email: email.trim(), password, captchaToken },
      }),
    );
    setBusy(false);
    setCaptchaToken(null);
    setCaptchaReset((n) => n + 1);
    if (result.ok) {
      startRegistration({
        name: name.trim(),
        email: email.trim(),
        token: result.data.registrationToken,
        resendAt: deadlineIn(result.data.resendAfterS),
      });
      navigate(CHECK_EMAIL_PATH);
      return;
    }
    // Entered data stay, except the password (ACC-01 «Помилка мережі»).
    setPassword("");
    setFailure(failureOf(result));
  }

  return (
    <AuthLayout title={t("auth.page.signUp")}>
      <h1 className="auth-title">{t("auth.signUp.title")}</h1>
      <p className="auth-intro">{t("auth.signUp.intro")}</p>
      {failure && (
        <Notice tone="error" code={failure.code}>
          {t(failure.key)}
        </Notice>
      )}
      <form className="auth-form" noValidate onSubmit={submit}>
        <TextField
          label={labels.name}
          name="name"
          value={name}
          onChange={setName}
          onBlur={() => setTouched((s) => ({ ...s, name: true }))}
          error={nameText}
          required
          autoComplete="name"
        />
        <TextField
          label={labels.email}
          name="email"
          type="email"
          value={email}
          onChange={setEmail}
          onBlur={() => setTouched((s) => ({ ...s, email: true }))}
          error={emailText}
          required
          autoComplete="email"
          inputMode="email"
          maxLength={EMAIL_MAX_LENGTH}
        />
        <PasswordField
          label={labels.password}
          name="password"
          value={password}
          onChange={setPassword}
          onBlur={() => setTouched((s) => ({ ...s, password: true }))}
          error={passwordText}
          hint={t("auth.password.hint", { min: PASSWORD_MIN_LENGTH })}
          required
          autoComplete="new-password"
          hideSignal={hideSignal}
          after={
            password !== "" && (
              <span className="auth-strength" data-level={strength}>
                <span className="auth-strength-bar" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
                <span>{t("auth.password.strength", { level: t(`auth.password.strength.${strength}`) })}</span>
              </span>
            )
          }
        />
        <Captcha onToken={setCaptchaToken} resetSignal={captchaReset} action="sign-up" config={captcha} />
        {summary && (
          <p className="auth-summary" id={summaryId}>
            {summary}
          </p>
        )}
        <SubmitButton
          inactive={inactive}
          busy={busy}
          describedBy={summary ? summaryId : undefined}
          onInactiveClick={() => setTouched({ name: true, email: true, password: true })}
        >
          {t("auth.signUp.submit")}
        </SubmitButton>
      </form>
      <LinkLine>
        {t("auth.signUp.haveAccount")} <a href={hrefFor(SIGN_IN_PATH)}>{t("auth.signUp.signIn")}</a>
      </LinkLine>
    </AuthLayout>
  );
}
