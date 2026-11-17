import { useEffect, useState } from "react";
import type { paths } from "@willowsum/api-contract";
import { formatDateTime, useI18n, type MessageKey } from "@willowsum/i18n";
import { Icon } from "@willowsum/ui";
import { START_PATH } from "../routing/routes.ts";
import { hrefFor } from "../routing/useHashPath.ts";
import { outcome, useAuthApi } from "./api.ts";
import { AuthLayout, LinkLine, Notice, SubmitButton } from "./AuthLayout.tsx";
import { failureOf, type Failure } from "./failure.ts";
import {
  navigate,
  NOT_ME_PATH,
  PASSWORD_RESET_PATH,
  SIGN_IN_PATH,
  TOKEN_SHAPE,
  useLinkToken,
} from "./navigation.ts";

type SignIn = paths["/v1/not-me-links/check"]["post"]["responses"]["200"]["content"]["application/json"];
type Browser = SignIn["device"]["browser"];
type System = SignIn["device"]["os"];

type State =
  | { readonly kind: "checking" }
  | { readonly kind: "failed"; readonly failure: Failure }
  | { readonly kind: "invalid" }
  | { readonly kind: "valid"; readonly signIn: SignIn }
  | { readonly kind: "secured"; readonly email: string };

/**
 * S-004b «Це був не я» (ACC-04@PoC FR 5, AC7; canvas PocNotMe), the page of the new-device letter's link
 * (`#/not-me?token=…`). Opening it changes nothing: the page asks the server what the link is about and shows that
 * sign-in. Only «Захистити акаунт» acts — every session of the account ends, every sign-in is refused until the
 * password is changed, and a reset link goes to the account's email. «Це був я — нічого не робити» calls nothing.
 * A used link, one older than 7 days or an unknown one shows «Посилання недійсне».
 */
export function NotMePage() {
  const link = useLinkToken(NOT_ME_PATH);
  return <NotMeLink key={link.n} token={link.token} />;
}

function NotMeLink({ token }: { readonly token: string | null }) {
  const { t, locale } = useI18n();
  const api = useAuthApi();
  const wellFormed = token !== null && TOKEN_SHAPE.test(token);
  const [state, setState] = useState<State>(wellFormed ? { kind: "checking" } : { kind: "invalid" });
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);

  useEffect(() => {
    if (token === null || !wellFormed) return;
    let live = true;
    void outcome(api.POST("/v1/not-me-links/check", { body: { token } })).then((o) => {
      if (!live) return;
      if (o.ok) setState({ kind: "valid", signIn: o.data });
      else if (o.kind === "problem" && o.problem.code === "NOT_ME_LINK_INVALID")
        setState({ kind: "invalid" });
      else setState({ kind: "failed", failure: failureOf(o) });
    });
    return () => {
      live = false;
    };
  }, [api, token, wellFormed, attempt]);

  async function secure(email: string) {
    if (token === null || busy) return;
    setBusy(true);
    setFailure(null);
    const o = await outcome(api.POST("/v1/not-me-links/confirm", { body: { token } }));
    setBusy(false);
    if (o.ok) setState({ kind: "secured", email });
    else if (o.kind === "problem" && o.problem.code === "NOT_ME_LINK_INVALID") setState({ kind: "invalid" });
    else setFailure(failureOf(o));
  }

  async function itWasMe() {
    // Nothing changes on the server; the person goes on where a session would take them.
    const session = await outcome(api.GET("/v1/session"));
    navigate(session.ok ? START_PATH : SIGN_IN_PATH);
  }

  switch (state.kind) {
    case "checking":
      return (
        <AuthLayout title={t("auth.notMe.page")}>
          <h1 className="auth-title">{t("auth.notMe.page")}</h1>
          <p className="auth-progress" role="status">
            <span className="ws-spinner" aria-hidden="true" />
            {t("auth.verify.checking")}
          </p>
        </AuthLayout>
      );
    case "failed":
      return (
        <AuthLayout title={t("auth.notMe.page")}>
          <h1 className="auth-title">{t("auth.notMe.page")}</h1>
          <Notice tone="error" code={state.failure.code}>
            {t(state.failure.key)}
          </Notice>
          <SubmitButton
            type="button"
            inactive={false}
            variant="secondary"
            onClick={() => {
              setState({ kind: "checking" });
              setAttempt((n) => n + 1);
            }}
          >
            {t("auth.verify.retry")}
          </SubmitButton>
        </AuthLayout>
      );
    case "invalid":
      return (
        <AuthLayout title={t("auth.linkInvalid.title")}>
          <span className="auth-tile auth-tile-warning">
            <Icon name="warning" size={24} />
          </span>
          <h1 className="auth-title">{t("auth.linkInvalid.title")}</h1>
          <p className="auth-intro">{t("auth.notMe.invalidBody")}</p>
          <a className="ws-button ws-button-primary auth-submit" href={hrefFor(PASSWORD_RESET_PATH)}>
            {t("auth.notMe.resetPassword")}
          </a>
          <LinkLine>
            <a href={hrefFor(SIGN_IN_PATH)}>{t("auth.linkInvalid.backToSignIn")}</a>
          </LinkLine>
        </AuthLayout>
      );
    case "secured":
      return (
        <AuthLayout title={t("auth.notMe.securedTitle")}>
          <span className="auth-tile auth-tile-positive">
            <Icon name="check" size={24} />
          </span>
          <h1 className="auth-title">{t("auth.notMe.securedTitle")}</h1>
          <Notice tone="info" focus>
            {t("auth.notMe.securedBody", { email: state.email })}
          </Notice>
          <LinkLine>
            <a href={hrefFor(SIGN_IN_PATH)}>{t("auth.linkInvalid.backToSignIn")}</a>
          </LinkLine>
        </AuthLayout>
      );
    case "valid": {
      const { signIn } = state;
      const when = `${formatDateTime(locale, signIn.signedInAt, "UTC")} UTC`;
      const device = t("auth.notMe.device", {
        browser: t(BROWSERS[signIn.device.browser]),
        os: t(SYSTEMS[signIn.device.os]),
      });
      return (
        <AuthLayout title={t("auth.notMe.page")}>
          <span className="auth-tile auth-tile-negative">
            <Icon name="warning" size={24} />
          </span>
          <h1 className="auth-title">{t("auth.notMe.title")}</h1>
          <p className="auth-intro">{t("auth.notMe.intro", { email: signIn.email })}</p>
          <div className="auth-sign-in-facts">
            <b>{t("auth.notMe.when", { when })}</b>
            <span>{t("auth.notMe.where", { device, address: signIn.address })}</span>
          </div>
          <ul className="auth-steps">
            <li>
              <Icon name="check" size={16} />
              <span>{t("auth.notMe.stepSessions")}</span>
            </li>
            <li>
              <Icon name="check" size={16} />
              <span>{t("auth.notMe.stepPassword", { email: signIn.email })}</span>
            </li>
          </ul>
          {failure && (
            <Notice tone="error" code={failure.code}>
              {t(failure.key)}
            </Notice>
          )}
          <SubmitButton
            type="button"
            variant="danger"
            inactive={false}
            busy={busy}
            onClick={() => void secure(signIn.email)}
          >
            {t("auth.notMe.secure")}
          </SubmitButton>
          <p className="auth-link-line">
            <button type="button" className="auth-link-button" onClick={() => void itWasMe()}>
              {t("auth.notMe.itWasMe")}
            </button>
          </p>
          <p className="auth-footnote">{t("auth.notMe.oneTime")}</p>
        </AuthLayout>
      );
    }
  }
}

const BROWSERS: Record<Browser, MessageKey> = {
  chrome: "auth.device.chrome",
  edge: "auth.device.edge",
  firefox: "auth.device.firefox",
  safari: "auth.device.safari",
  opera: "auth.device.opera",
  other: "auth.device.otherBrowser",
};

const SYSTEMS: Record<System, MessageKey> = {
  windows: "auth.device.windows",
  macos: "auth.device.macos",
  ios: "auth.device.ios",
  android: "auth.device.android",
  linux: "auth.device.linux",
  chromeos: "auth.device.chromeos",
  other: "auth.device.otherSystem",
};
