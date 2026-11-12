import { useEffect, useState } from "react";
import { useT, type Translate } from "@willowsum/i18n";
import { hrefFor } from "../routing/useHashPath.ts";
import { outcome, useAuthApi } from "./api.ts";
import { AuthLayout, LinkLine, Notice, SubmitButton } from "./AuthLayout.tsx";
import { withBold } from "./emphasis.tsx";
import { failureOf, type Failure } from "./failure.ts";
import { navigate, SIGN_IN_PATH, SIGN_UP_PATH } from "./navigation.ts";
import { currentRegistration, leaveRegistration, updateRegistration } from "./registration.ts";
import { formatCountdown } from "./rules.ts";
import { deadlineIn, useCountdown } from "./useCountdown.ts";

/**
 * S-002 «Перевірте пошту» (ACC-01@PoC FR 8, 13, 15; AC4, AC23; canvas PocCheckEmail). The same screen for a new and a
 * taken address. «Надіслати ще раз» is inactive with a countdown for 60 s after a letter, and until the end of the
 * hour after 5 (the server's `resendAfterS` / `Retry-After`); a polite live region says when the wait starts and
 * ends, not every second. «Змінити email» closes this sign-up and returns to the filled-in form.
 */
export function CheckEmailPage() {
  const t = useT();
  const api = useAuthApi();
  const [registration] = useState(currentRegistration);
  const [resendAt, setResendAt] = useState<number | null>(registration?.resendAt ?? null);
  const seconds = useCountdown(resendAt);
  // What the polite live region says: once when a wait starts, once when it ends — never every second.
  const [waitText, setWaitText] = useState(() => waitAnnouncement(t, registration?.resendAt ?? null));
  const announcement = seconds > 0 ? waitText : waitText ? t("auth.checkEmail.readyAnnounce") : "";
  const [busy, setBusy] = useState<"resend" | "change" | null>(null);
  const [sent, setSent] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);

  // Without a sign-up in progress (a reload, a direct link) there is nothing to act on: back to the form.
  useEffect(() => {
    if (!registration) navigate(SIGN_UP_PATH, { replace: true });
  }, [registration]);

  useEffect(() => {
    updateRegistration({ resendAt });
  }, [resendAt]);

  function wait(at: number | null) {
    setResendAt(at);
    setWaitText(waitAnnouncement(t, at));
  }

  if (!registration) return null;

  async function resend() {
    if (!registration || busy || seconds > 0) return;
    setBusy("resend");
    setFailure(null);
    setSent(false);
    const result = await outcome(
      api.POST("/v1/registrations/resend", { body: { registrationToken: registration.token } }),
    );
    setBusy(null);
    if (result.ok) {
      setSent(true);
      wait(deadlineIn(result.data.resendAfterS));
      return;
    }
    if (result.kind === "problem" && result.problem.code === "RATE_LIMITED" && result.retryAfterS) {
      // AC4: 60 s since the last letter, or the hour's 5 letters used up — the button waits.
      wait(deadlineIn(result.retryAfterS));
      return;
    }
    setFailure(failureOf(result));
  }

  async function changeEmail() {
    if (!registration || busy) return;
    setBusy("change");
    setFailure(null);
    const result = await outcome(
      api.POST("/v1/registrations/change-email", { body: { registrationToken: registration.token } }),
    );
    setBusy(null);
    // A sign-up that no longer exists (expired, already closed) leaves the screen the same way.
    if (result.ok || (result.kind === "problem" && result.problem.code === "NOT_FOUND")) {
      leaveRegistration();
      navigate(SIGN_UP_PATH);
      return;
    }
    setFailure(failureOf(result));
  }

  return (
    <AuthLayout title={t("auth.page.checkEmail")}>
      <h1 className="auth-title">{t("auth.checkEmail.title")}</h1>
      <p>{withBold(t("auth.checkEmail.body", { email: registration.email }), registration.email)}</p>
      {sent && <Notice tone="info">{t("auth.checkEmail.sent")}</Notice>}
      {failure && (
        <Notice tone="error" code={failure.code}>
          {t(failure.key)}
        </Notice>
      )}
      <SubmitButton
        type="button"
        inactive={seconds > 0}
        busy={busy === "resend"}
        onClick={() => void resend()}
      >
        {seconds > 0
          ? t("auth.checkEmail.resendIn", { time: formatCountdown(seconds) })
          : t("auth.checkEmail.resend")}
      </SubmitButton>
      <span className="ws-visually-hidden" role="status" aria-live="polite">
        {announcement}
      </span>
      <LinkLine>
        {t("auth.checkEmail.wrongAddress")}{" "}
        <button
          type="button"
          className="auth-link-button"
          aria-disabled={busy !== null || undefined}
          onClick={() => void changeEmail()}
        >
          {t("auth.checkEmail.changeEmail")}
        </button>
      </LinkLine>
      <LinkLine>
        {t("auth.checkEmail.alreadyConfirmed")}{" "}
        <a href={hrefFor(SIGN_IN_PATH)}>{t("auth.checkEmail.signIn")}</a>
      </LinkLine>
    </AuthLayout>
  );
}

function waitAnnouncement(t: Translate, at: number | null): string {
  const left = at === null ? 0 : Math.ceil((at - Date.now()) / 1000);
  return left > 0 ? t("auth.checkEmail.waitAnnounce", { time: formatCountdown(left) }) : "";
}
