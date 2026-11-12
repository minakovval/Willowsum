import {
  useEffect,
  useId,
  useState,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useT } from "@willowsum/i18n";
import { Icon } from "@willowsum/ui";
import type { FieldError } from "./rules.ts";

/**
 * Minimal form fields of the sign-up and sign-in cards, built to CMP-02@PoC (label above, 40 px field, error with
 * the word «Помилка» replacing the hint, `aria-invalid`, `aria-describedby`, the required mark in words too). The
 * design-system Field (packages/ui) does not exist yet; these move there with it (follow-up).
 */
interface FieldFrameProps {
  readonly id: string;
  readonly label: string;
  readonly required?: boolean | undefined;
  readonly hint?: ReactNode | undefined;
  readonly hintId: string;
  readonly error: string | null;
  readonly errorId: string;
  readonly children: ReactNode;
  readonly after?: ReactNode;
}

function FieldFrame({ id, label, required, hint, hintId, error, errorId, children, after }: FieldFrameProps) {
  const t = useT();
  return (
    <div className="auth-field">
      <label className="auth-label" htmlFor={id}>
        {label}
        {required && (
          <>
            <span className="auth-required" aria-hidden="true">
              {" *"}
            </span>
            <span className="ws-visually-hidden">{`, ${t("auth.required")}`}</span>
          </>
        )}
      </label>
      {children}
      {error ? (
        <span className="auth-field-error" id={errorId}>
          <Icon name="warning" size={16} />
          <span>
            <b>{t("auth.error.word")}</b> {error}
          </span>
        </span>
      ) : hint ? (
        <span className="auth-hint" id={hintId}>
          {hint}
        </span>
      ) : null}
      {after}
    </div>
  );
}

const describedBy = (...ids: (string | false | null | undefined)[]) =>
  ids.filter(Boolean).join(" ") || undefined;

export function useFieldError(error: FieldError): string | null {
  const t = useT();
  return error ? t(error.key, error.params) : null;
}

interface TextFieldProps {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onBlur?: () => void;
  readonly error?: string | null;
  readonly required?: boolean | undefined;
  readonly type?: "text" | "email";
  readonly autoComplete: string;
  readonly name: string;
  readonly maxLength?: number;
  readonly inputMode?: InputHTMLAttributes<HTMLInputElement>["inputMode"];
}

export function TextField({
  label,
  value,
  onChange,
  onBlur,
  error = null,
  required,
  type = "text",
  autoComplete,
  name,
  maxLength,
  inputMode,
}: TextFieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <FieldFrame
      id={id}
      label={label}
      required={required}
      hintId={`${id}-hint`}
      error={error}
      errorId={errorId}
    >
      <input
        id={id}
        className="auth-input"
        name={name}
        type={type}
        value={value}
        autoComplete={autoComplete}
        spellCheck={false}
        autoCapitalize={type === "email" ? "off" : undefined}
        inputMode={inputMode}
        maxLength={maxLength}
        aria-required={required || undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(error && errorId)}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
      />
    </FieldFrame>
  );
}

interface PasswordFieldProps {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onBlur?: () => void;
  readonly error?: string | null;
  readonly hint?: ReactNode | undefined;
  readonly required?: boolean | undefined;
  /** AC22: the password manager keeps working whether the text is shown or not. */
  readonly autoComplete: "current-password" | "new-password";
  readonly name: string;
  /** Any change hides the password again (AC19: after the form is sent). */
  readonly hideSignal: number;
  readonly after?: ReactNode;
}

/**
 * Password field with «Показати пароль» and the Caps Lock hint (ACC-01@PoC FR 11, AC18–AC22; GRID-06 FR 4).
 * - The toggle is a `type="button"` with a fixed accessible name and `aria-pressed`; it never sends the form; with
 *   the keyboard the focus stays on it, and a mouse press does not take the caret out of the field.
 * - Shown or hidden, `autocomplete` stays, and auto-capitalisation, autocorrection and spellcheck are off.
 * - The shown state lives only in this component: it resets after sending (`hideSignal`), on leaving the page
 *   (unmount, `pagehide`) and is never stored.
 * - The Caps Lock hint sits in a polite live region that exists before it is filled, so it is announced without
 *   interrupting.
 */
export function PasswordField({
  label,
  value,
  onChange,
  onBlur,
  error = null,
  hint,
  required,
  autoComplete,
  name,
  hideSignal,
  after,
}: PasswordFieldProps) {
  const t = useT();
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const capsId = `${id}-caps`;
  const [shown, setShown] = useState(false);
  const [capsLock, setCapsLock] = useState(false);

  // AC19: a new signal (the form was sent) hides the password again, in the same render.
  const [seenSignal, setSeenSignal] = useState(hideSignal);
  if (seenSignal !== hideSignal) {
    setSeenSignal(hideSignal);
    setShown(false);
  }
  useEffect(() => {
    const hide = () => setShown(false);
    window.addEventListener("pagehide", hide);
    return () => window.removeEventListener("pagehide", hide);
  }, []);

  const readCaps = (e: KeyboardEvent<HTMLInputElement>) => setCapsLock(e.getModifierState("CapsLock"));

  return (
    <FieldFrame
      id={id}
      label={label}
      required={required}
      hint={hint}
      hintId={hintId}
      error={error}
      errorId={errorId}
      after={
        <>
          {after}
          <span className="auth-caps" id={capsId} role="status" aria-live="polite">
            {capsLock && (
              <>
                <Icon name="warning" size={16} />
                {t("auth.password.capsLock")}
              </>
            )}
          </span>
        </>
      }
    >
      <span className="auth-input-wrap">
        <input
          id={id}
          className="auth-input auth-input-password"
          name={name}
          type={shown ? "text" : "password"}
          value={value}
          autoComplete={autoComplete}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          aria-required={required || undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(error ? errorId : hint ? hintId : null, capsLock && capsId)}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={readCaps}
          onKeyUp={readCaps}
          onBlur={() => {
            setCapsLock(false);
            onBlur?.();
          }}
        />
        <button
          type="button"
          className="ws-icon-button auth-reveal"
          aria-label={t("auth.password.show")}
          title={t("auth.password.show")}
          aria-pressed={shown}
          aria-controls={id}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setShown((s) => !s)}
        >
          <Icon name={shown ? "eye-off" : "eye"} size={20} />
        </button>
      </span>
    </FieldFrame>
  );
}
