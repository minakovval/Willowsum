import { useEffect, useRef, type ReactNode } from "react";
import { useT } from "@willowsum/i18n";
import { Icon, MAIN_ID, Wordmark } from "@willowsum/ui";
import { UnsupportedBrowserNotice } from "../browser/UnsupportedBrowserNotice.tsx";
import { useDocumentTitle } from "../useDocumentTitle.ts";

/**
 * The narrow card of the sign-up, sign-in, recovery and «Це був не я» screens (canvas PocSignUp, PocSignIn…,
 * PocResetPassword…, PocNotMe; GRID-06@PoC FR 1, 2, 5): focus mode — the mark above one card, no navigation; on the
 * Expanded grid the mark and the card take the 6 middle columns of 12 (3 empty on each side). The page heading is the
 * card's title. In an unsupported browser the card starts with the notice of NFR-07@PoC EC1 (sign-in still works).
 */
export function AuthLayout({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  useDocumentTitle(title);
  return (
    <div className="auth-page">
      <div className="auth-column">
        <div className="auth-brand">
          <Wordmark />
        </div>
        <main id={MAIN_ID} className="auth-card" tabIndex={-1}>
          <UnsupportedBrowserNotice />
          {children}
        </main>
      </div>
    </div>
  );
}

/**
 * A message in the card: `error` is CMP-24's «✕ Помилка» with the support code on its own line (ARC-09 FR 3),
 * announced at once (`role="alert"`, it follows the user's action); `warning`, `info` (done) and `neutral` (a fact,
 * such as «Сесію завершено…», canvas PocSignInSessionEnded) are polite.
 */
const NOTICE_ICONS = { error: "close", warning: "warning", info: "check", neutral: "info" } as const;

export function Notice({
  tone,
  title,
  children,
  code,
  focus,
}: {
  readonly tone: "error" | "warning" | "info" | "neutral";
  readonly title?: string;
  readonly children?: ReactNode;
  readonly code?: string | undefined;
  /** Move the focus to the message when it appears (a whole-screen state, not a field error). */
  readonly focus?: boolean;
}) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focus) ref.current?.focus();
  }, [focus]);
  return (
    <div
      ref={ref}
      className={`auth-notice auth-notice-${tone}`}
      role={tone === "error" ? "alert" : "status"}
      tabIndex={focus ? -1 : undefined}
    >
      <span className="auth-notice-icon">
        <Icon name={NOTICE_ICONS[tone]} size={16} />
      </span>
      <span className="auth-notice-text">
        {tone === "error" && <b>{t("auth.error.word")} </b>}
        {title && <b>{title} </b>}
        {children}
        {code && <span className="auth-notice-code">{t("auth.error.code", { code })}</span>}
      </span>
    </div>
  );
}

/**
 * The card's main action (CMP-01). Inactive with `aria-disabled` rather than `disabled`, so it stays in the tab order
 * and announces why (ACC-01@PoC AC2: «неактивна, а біля поля показано причину»); while a request runs it shows the
 * spinner and is inactive (ACC-01 «Завантаження»).
 */
export function SubmitButton({
  children,
  inactive,
  busy,
  describedBy,
  onInactiveClick,
  variant = "primary",
  type = "submit",
  onClick,
}: {
  readonly children: ReactNode;
  readonly inactive: boolean;
  readonly busy?: boolean;
  readonly describedBy?: string | undefined;
  readonly onInactiveClick?: () => void;
  readonly variant?: "primary" | "secondary" | "danger";
  readonly type?: "submit" | "button";
  readonly onClick?: () => void;
}) {
  const t = useT();
  const off = inactive || Boolean(busy);
  return (
    <button
      type={type}
      className={`ws-button auth-submit${BUTTON_VARIANTS[variant]}`}
      aria-disabled={off || undefined}
      aria-busy={busy || undefined}
      aria-describedby={describedBy}
      onClick={(e) => {
        if (off) {
          e.preventDefault();
          if (!busy) onInactiveClick?.();
          return;
        }
        onClick?.();
      }}
    >
      {busy && <span className="ws-spinner" aria-hidden="true" />}
      {children}
      {busy && <span className="ws-visually-hidden">{` ${t("auth.busy")}`}</span>}
    </button>
  );
}

const BUTTON_VARIANTS = {
  primary: " ws-button-primary",
  secondary: "",
  danger: " auth-button-danger",
} as const;

export function LinkLine({ children }: { readonly children: ReactNode }) {
  return <p className="auth-link-line">{children}</p>;
}
