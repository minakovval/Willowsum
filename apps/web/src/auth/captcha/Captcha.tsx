import { useEffect, useId, useRef, useState } from "react";
import { useI18n, useT } from "@willowsum/i18n";
import { Notice } from "../AuthLayout.tsx";
import { captchaConfig, SYNTHETIC_CAPTCHA_TOKEN, type CaptchaConfig } from "./config.ts";
import { loadTurnstile } from "./turnstile.ts";

export interface CaptchaProps {
  /** The widget's token, or `null` when there is none (not passed yet, expired, reset). */
  readonly onToken: (token: string | null) => void;
  /** Any change resets the widget: a token is good for one request only. The parent drops its token itself. */
  readonly resetSignal: number;
  /** The Turnstile action (`sign-up`, `sign-in`), for the provider's analytics. */
  readonly action: "sign-up" | "sign-in";
  /** Injected in tests; by default from the build's environment. */
  readonly config?: CaptchaConfig | undefined;
}

/**
 * The CAPTCHA check inside the card (ACC-01@PoC FR 12; GRID-06@PoC FR 3): Cloudflare Turnstile when the build has a
 * site key, otherwise the synthetic widget (local development, CI, tests: no network).
 */
export function Captcha({ config = captchaConfig(), ...props }: CaptchaProps) {
  return config.mode === "turnstile" ? (
    <TurnstileWidget siteKey={config.siteKey} {...props} />
  ) : (
    <SyntheticCaptcha {...props} />
  );
}

function SyntheticCaptcha({ onToken, resetSignal }: Omit<CaptchaProps, "config">) {
  const t = useT();
  const id = useId();
  const [checked, setChecked] = useState(false);
  const [seenSignal, setSeenSignal] = useState(resetSignal);
  if (seenSignal !== resetSignal) {
    setSeenSignal(resetSignal);
    setChecked(false);
  }
  return (
    <div className="auth-captcha" role="group" aria-label={t("auth.captcha.label")}>
      <input
        id={id}
        type="checkbox"
        className="auth-captcha-box"
        checked={checked}
        onChange={(e) => {
          setChecked(e.target.checked);
          onToken(e.target.checked ? SYNTHETIC_CAPTCHA_TOKEN : null);
        }}
      />
      <label htmlFor={id} className="auth-captcha-label">
        {t("auth.captcha.synthetic")}
      </label>
      <span className="auth-captcha-note">{t("auth.captcha.syntheticNote")}</span>
    </div>
  );
}

function TurnstileWidget({
  siteKey,
  onToken,
  resetSignal,
  action,
}: Omit<CaptchaProps, "config"> & { readonly siteKey: string }) {
  const t = useT();
  const { locale } = useI18n();
  const container = useRef<HTMLDivElement>(null);
  const widget = useRef<{ id: string; reset: (id: string) => void } | null>(null);
  const tokenSink = useRef(onToken);
  useEffect(() => {
    tokenSink.current = onToken;
  }, [onToken]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let remove: (() => void) | undefined;
    loadTurnstile().then(
      (api) => {
        if (cancelled || !container.current) return;
        const id = api.render(container.current, {
          sitekey: siteKey,
          action,
          language: locale,
          theme: "light",
          callback: (token) => tokenSink.current(token),
          "expired-callback": () => tokenSink.current(null),
          "error-callback": () => tokenSink.current(null),
        });
        if (id === undefined) return;
        widget.current = { id, reset: (w) => api.reset(w) };
        remove = () => api.remove(id);
      },
      () => {
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
      widget.current = null;
      remove?.();
    };
  }, [siteKey, action, locale]);

  useEffect(() => {
    if (widget.current) widget.current.reset(widget.current.id);
  }, [resetSignal]);

  return (
    <div className="auth-captcha-turnstile" role="group" aria-label={t("auth.captcha.label")}>
      <div ref={container} />
      {failed && <Notice tone="error">{t("auth.captcha.loadFailed")}</Notice>}
    </div>
  );
}
