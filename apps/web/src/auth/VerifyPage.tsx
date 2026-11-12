import { useEffect, useRef, useState } from "react";
import { useT } from "@willowsum/i18n";
import { Icon } from "@willowsum/ui";
import { START_PATH } from "../routing/routes.ts";
import { hrefFor, pathFromHash } from "../routing/useHashPath.ts";
import { outcome, useAuthApi, type Outcome } from "./api.ts";
import { AuthLayout, LinkLine, Notice, SubmitButton } from "./AuthLayout.tsx";
import { failureOf, type Failure } from "./failure.ts";
import {
  forgetHashQuery,
  hashParam,
  navigate,
  SIGN_IN_PATH,
  SIGN_UP_PATH,
  VERIFY_PATH,
} from "./navigation.ts";
import { formatCountdown } from "./rules.ts";
import { deadlineIn, useCountdown } from "./useCountdown.ts";

const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;
type Result = "confirmed" | "expired" | "already-used" | "invalid";

/**
 * The page of the confirmation link (`#/verify?token=…`; ACC-01@PoC FR 4, 14; AC5, AC6, AC24) and S-003
 * «Посилання недійсне» (canvas PocLinkInvalid). The token is in the URL fragment, so it never reaches a server log or a
 * Referer, and it leaves the address bar once it is read. Confirmed → «Email підтверджено» with «Увійти» (no
 * session is created). Expired → S-003 with «Надіслати ще раз». Already used → the sign-in page, or «Планування →
 * Бюджет» when a session is active. The address is not shown on S-003: the link's token does not reveal it.
 */
export function VerifyPage() {
  const [link, setLink] = useState(() => ({ token: hashParam("token"), n: 0 }));

  useEffect(() => {
    forgetHashQuery(VERIFY_PATH);
    // A second link opened while this page is shown changes only the fragment: no new page, no remount. Read its
    // token and drop it from the address bar as well.
    const onHashChange = () => {
      if (pathFromHash(window.location.hash) !== VERIFY_PATH) return;
      const token = hashParam("token");
      if (token === null) return;
      forgetHashQuery(VERIFY_PATH);
      setLink((l) => ({ token, n: l.n + 1 }));
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  return <VerifyLink key={link.n} token={link.token} />;
}

function VerifyLink({ token }: { readonly token: string | null }) {
  const t = useT();
  const api = useAuthApi();
  const wellFormed = token !== null && TOKEN_SHAPE.test(token);
  const [result, setResult] = useState<Result | null>(wellFormed ? null : "invalid");
  const [failure, setFailure] = useState<Failure | null>(null);
  const [attempt, setAttempt] = useState(0);
  const pending = useRef<{ attempt: number; promise: Promise<Outcome<{ result: Result }>> } | null>(null);

  useEffect(() => {
    if (token === null || !wellFormed) return;
    // One request per attempt, also when the effect runs twice (StrictMode): the link works once.
    if (pending.current?.attempt !== attempt)
      pending.current = {
        attempt,
        promise: outcome(api.POST("/v1/email-confirmations", { body: { token } })),
      };
    let cancelled = false;
    void pending.current.promise.then(async (o) => {
      if (cancelled) return;
      if (!o.ok) {
        setFailure(failureOf(o));
        return;
      }
      if (o.data.result !== "already-used") {
        setResult(o.data.result);
        return;
      }
      // AC24: a used link signs nobody in; it opens the sign-in page, or the budget with an active session.
      const session = await outcome(api.GET("/v1/session"));
      if (!cancelled) navigate(session.ok ? START_PATH : SIGN_IN_PATH, { replace: true });
    });
    return () => {
      cancelled = true;
    };
  }, [api, token, wellFormed, attempt]);

  if (failure)
    return (
      <AuthLayout title={t("auth.page.verify")}>
        <h1 className="auth-title">{t("auth.page.verify")}</h1>
        <Notice tone="error" code={failure.code}>
          {t(failure.key)}
        </Notice>
        <SubmitButton
          type="button"
          inactive={false}
          variant="secondary"
          onClick={() => {
            setFailure(null);
            setAttempt((n) => n + 1);
          }}
        >
          {t("auth.verify.retry")}
        </SubmitButton>
      </AuthLayout>
    );

  if (result === null)
    return (
      <AuthLayout title={t("auth.page.verify")}>
        <h1 className="auth-title">{t("auth.page.verify")}</h1>
        <p className="auth-progress" role="status">
          <span className="ws-spinner" aria-hidden="true" />
          {t("auth.verify.checking")}
        </p>
      </AuthLayout>
    );

  if (result === "confirmed")
    return (
      <AuthLayout title={t("auth.verify.confirmedTitle")}>
        <span className="auth-tile auth-tile-positive">
          <Icon name="check" size={24} />
        </span>
        <h1 className="auth-title">{t("auth.verify.confirmedTitle")}</h1>
        <p className="auth-intro">{t("auth.verify.confirmedBody")}</p>
        <a className="ws-button ws-button-primary auth-submit" href={hrefFor(SIGN_IN_PATH)}>
          {t("auth.verify.signIn")}
        </a>
      </AuthLayout>
    );

  return <LinkInvalid token={result === "expired" ? token : null} />;
}

/** S-003 «Посилання недійсне»: with «Надіслати ще раз» for an expired link (AC6), else the way back. */
function LinkInvalid({ token }: { readonly token: string | null }) {
  const t = useT();
  const api = useAuthApi();
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [resendAt, setResendAt] = useState<number | null>(null);
  const seconds = useCountdown(resendAt);

  async function resend() {
    if (token === null || busy || seconds > 0) return;
    setBusy(true);
    setFailure(null);
    const result = await outcome(api.POST("/v1/email-confirmations/resend", { body: { token } }));
    setBusy(false);
    if (result.ok) {
      setSent(true);
      setResendAt(deadlineIn(result.data.resendAfterS));
      return;
    }
    if (result.kind === "problem" && result.problem.code === "RATE_LIMITED" && result.retryAfterS) {
      setResendAt(deadlineIn(result.retryAfterS));
      return;
    }
    setFailure(failureOf(result));
  }

  return (
    <AuthLayout title={t("auth.linkInvalid.title")}>
      <span className="auth-tile auth-tile-warning">
        <Icon name="warning" size={24} />
      </span>
      <h1 className="auth-title">{t("auth.linkInvalid.title")}</h1>
      <p className="auth-intro">
        {token !== null ? t("auth.linkInvalid.expiredBody") : t("auth.linkInvalid.invalidBody")}
      </p>
      {sent && <Notice tone="info">{t("auth.linkInvalid.sent")}</Notice>}
      {failure && (
        <Notice tone="error" code={failure.code}>
          {t(failure.key)}
        </Notice>
      )}
      {token !== null ? (
        <SubmitButton type="button" inactive={seconds > 0} busy={busy} onClick={() => void resend()}>
          {seconds > 0
            ? t("auth.checkEmail.resendIn", { time: formatCountdown(seconds) })
            : t("auth.linkInvalid.resend")}
        </SubmitButton>
      ) : (
        <a className="ws-button ws-button-primary auth-submit" href={hrefFor(SIGN_UP_PATH)}>
          {t("auth.linkInvalid.signUp")}
        </a>
      )}
      <LinkLine>
        <a href={hrefFor(SIGN_IN_PATH)}>{t("auth.linkInvalid.backToSignIn")}</a>
      </LinkLine>
    </AuthLayout>
  );
}
