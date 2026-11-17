import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { currencySymbolOf, formatNumber, translate, useI18n, type MessageKey } from "@willowsum/i18n";
import { Icon } from "../icons/Icon.tsx";
import { useTooltip } from "../tooltip/Tooltip.tsx";
import { formatCompactNumber } from "../amount/compact.ts";
import { currencyPlaces, displayAmount, editAmount, parseAmountInput, type AmountProblem } from "./amount.ts";

export interface FieldProps {
  /** The visible label above the field; never moved into it or replaced by the placeholder. */
  label: string;
  value: string;
  onChange?: ((value: string) => void) | undefined;
  onBlur?: (() => void) | undefined;
  /** Shown in the empty field, in the same type as the entered text, `ink-muted`. */
  placeholder?: string | undefined;
  /** What to enter («До 999 999 999,99»); also the reason beside a disabled field. Replaced by `error`. */
  hint?: ReactNode;
  /** What to do, without the word «Помилка» (the field adds it): «Введіть число, наприклад 3 000,00.» */
  error?: string | null | undefined;
  /** «*» in `loss` after the label and the word «обов’язкове поле» for screen readers; `aria-required`. */
  required?: boolean | undefined;
  disabled?: boolean | undefined;
  readOnly?: boolean | undefined;
  /** `date`: the browser's own date input (YYYY-MM-DD value), until the design system has a date picker. */
  type?: "text" | "email" | "search" | "tel" | "url" | "date" | undefined;
  inputMode?: InputHTMLAttributes<HTMLInputElement>["inputMode"];
  name?: string | undefined;
  autoComplete?: string | undefined;
  id?: string | undefined;
  /** Inside the field on the left: an icon (the magnifier of a search field). Decorative. */
  prefix?: ReactNode;
  /** Inside the field on the right in `ink-muted`: the unit or currency. Read after the label. */
  suffix?: ReactNode;
  /** The field takes no more characters than this (names: 40). */
  maxLength?: number | undefined;
  /** With `maxLength`: the counter «32 / 40» inside the field on the right. */
  counter?: boolean | undefined;
  /** `search` — the 36 px field above a list. */
  size?: "default" | "search" | undefined;
  className?: string | undefined;
}

interface ViewProps extends Omit<FieldProps, "value" | "onChange" | "onBlur"> {
  /** The text in the input. */
  text: string;
  onText?: ((text: string) => void) | undefined;
  onFocus?: (() => void) | undefined;
  onLeave?: (() => void) | undefined;
  /** Not editing: the shorter text shown when `text` does not fit (an amount's «4,51 млрд»). */
  short?: string | null | undefined;
  /** The full value for the tooltip; defaults to `text`. */
  full?: string | undefined;
  /** The amount variant: tabular figures and the decimal keyboard. */
  numeric?: boolean | undefined;
}

/**
 * The width the input may take in its box. An abbreviated amount shrinks the input to its own text
 * (`field-sizing: content`), so its width alone no longer says how much room there is: it is read with the
 * abbreviated style taken off for that one synchronous layout and put back at once.
 */
function roomOf(el: HTMLInputElement): number {
  const abbreviated = el.dataset["abbreviated"];
  if (abbreviated === undefined) return el.clientWidth;
  delete el.dataset["abbreviated"];
  const room = el.clientWidth;
  el.dataset["abbreviated"] = abbreviated;
  return room;
}

const ids = (...list: (string | false | null | undefined)[]) => list.filter(Boolean).join(" ") || undefined;

/**
 * Whether `text` fits the input's width, measured with a hidden copy in the same type. Re-measured when the
 * text or the width changes; while the field is edited it is not measured (the full text is shown then).
 */
function useFits(text: string, enabled: boolean) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const probeRef = useRef<HTMLSpanElement | null>(null);
  const [fit, setFit] = useState<{ text: string; fits: boolean }>({ text, fits: true });

  useLayoutEffect(() => {
    const el = inputRef.current;
    const p = probeRef.current;
    if (!enabled || !el || !p) return;
    const measure = () => {
      p.textContent = text;
      const fits = p.getBoundingClientRect().width <= roomOf(el) + 0.5;
      setFit((prev) => (prev.text === text && prev.fits === fits ? prev : { text, fits }));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el.parentElement ?? el);
    return () => ro.disconnect();
  }, [text, enabled]);

  return { inputRef, probeRef, fits: !enabled || fit.text !== text || fit.fits };
}

function FieldView({
  label,
  text,
  onText,
  onFocus,
  onLeave,
  short,
  full,
  numeric,
  placeholder,
  hint,
  error,
  required,
  disabled,
  readOnly,
  type = "text",
  inputMode,
  name,
  autoComplete,
  id: ownId,
  prefix,
  suffix,
  maxLength,
  counter,
  size = "default",
  className,
}: ViewProps) {
  const { t, locale } = useI18n();
  const autoId = useId();
  const id = ownId ?? autoId;
  const [editing, setEditing] = useState(false);
  const { inputRef, probeRef, fits } = useFits(text, !editing && text !== "");
  const abbreviated = !fits && !!short;
  const { triggerProps, tooltip } = useTooltip(full ?? text, !fits);
  const invalid = !!error;
  const state = disabled ? "disabled" : readOnly ? "readonly" : invalid ? "error" : "default";

  const messageId = `${id}-message`;
  const suffixId = `${id}-suffix`;
  const counterId = `${id}-counter`;
  const showCounter = counter && maxLength !== undefined;

  const setInput = (el: HTMLInputElement | null) => {
    inputRef.current = el;
    triggerProps?.ref(el);
  };
  const focus = (e: FocusEvent<HTMLInputElement>) => {
    setEditing(true);
    triggerProps?.onFocus(e);
    onFocus?.();
  };
  const blur = (e: FocusEvent<HTMLInputElement>) => {
    setEditing(false);
    triggerProps?.onBlur(e);
    onLeave?.();
  };

  return (
    <div className={className ? `ws-field ${className}` : "ws-field"} data-state={state}>
      <label className="ws-field-label" htmlFor={id}>
        {label}
        {required && (
          <>
            <span className="ws-field-required" aria-hidden="true">
              {" *"}
            </span>
            <span className="ws-visually-hidden">{`, ${t("field.required")}`}</span>
          </>
        )}
      </label>
      <div
        className="ws-field-box"
        data-size={size}
        onMouseDown={(e) => {
          // A press on the box outside the input (beside a short amount, on the unit) puts the caret in it.
          if (e.target === inputRef.current || disabled) return;
          e.preventDefault();
          inputRef.current?.focus();
        }}
      >
        {prefix && (
          <span className="ws-field-prefix" aria-hidden="true">
            {prefix}
          </span>
        )}
        <input
          ref={setInput}
          id={id}
          className="ws-field-input"
          type={type}
          name={name}
          value={abbreviated ? short : text}
          placeholder={placeholder}
          autoComplete={autoComplete}
          inputMode={numeric ? "decimal" : inputMode}
          maxLength={maxLength}
          disabled={disabled}
          readOnly={readOnly}
          data-numeric={numeric || undefined}
          data-abbreviated={abbreviated || undefined}
          aria-required={required || undefined}
          aria-invalid={invalid || undefined}
          aria-describedby={ids(
            (invalid || !!hint) && messageId,
            !!suffix && suffixId,
            showCounter && counterId,
            triggerProps?.["aria-describedby"],
          )}
          onChange={(e) => {
            const next = maxLength === undefined ? e.target.value : e.target.value.slice(0, maxLength);
            onText?.(next);
          }}
          onFocus={focus}
          onBlur={blur}
          onMouseEnter={triggerProps?.onMouseEnter}
          onMouseLeave={triggerProps?.onMouseLeave}
          onMouseDown={triggerProps?.onMouseDown}
        />
        <span ref={probeRef} className="ws-field-probe" aria-hidden="true" />
        {showCounter && (
          <span className="ws-field-counter" id={counterId}>
            {t("field.counter", {
              count: formatNumber(locale, String(text.length)),
              max: formatNumber(locale, String(maxLength)),
            })}
          </span>
        )}
        {suffix && (
          <span className="ws-field-suffix" id={suffixId}>
            {suffix}
          </span>
        )}
      </div>
      {/* The error is announced at once when it appears; the region exists before it is filled. */}
      <div className="ws-field-live" aria-live="assertive">
        {invalid && (
          <span className="ws-field-error" id={messageId}>
            <Icon name="warning" size={16} />
            <span>{`${t("field.error.word")} ${error}`}</span>
          </span>
        )}
      </div>
      {!invalid && hint && (
        <span className="ws-field-hint" id={messageId}>
          {hint}
        </span>
      )}
      {tooltip}
    </div>
  );
}

/**
 * CMP-02@PoC Field: a one-line field with its label above, the hint below and the error in place of the hint.
 * States: hover and focus (the `ink` border, the 3 px `focus` ring around the whole field), error (`loss` border,
 * «Помилка. …» with a marker, `aria-invalid`), disabled (`disabled-bg`, `disabled-ink`, no border), read-only
 * (`surface-100`), empty (placeholder and hint). The field never grows: a longer text is cut off with an ellipsis
 * and, only then, the full text is in a tooltip (CMP-25). Visible 40 px (search 36 px), touch area 44 px.
 */
export function Field({ value, onChange, onBlur, ...rest }: FieldProps) {
  return <FieldView {...rest} text={value} onText={onChange} onLeave={onBlur} />;
}

export interface AmountFieldProps extends Omit<
  FieldProps,
  "value" | "onChange" | "type" | "inputMode" | "maxLength" | "counter" | "suffix"
> {
  /** The amount as a decimal string («4512300000.00»), or null when empty. */
  value: string | null;
  /**
   * The new amount padded to the currency's digits, or null with the problem the field shows itself
   * («invalid», «places») or with none when the field is empty. Called as the user types (valid text only)
   * and when the field is left.
   */
  onChange?: ((value: string | null, problem: AmountProblem | null) => void) | undefined;
  /** ISO 4217 code: the digits of the amount and the suffix. */
  currency: string;
  /** Shown on the right in `ink-muted`; default: the currency symbol of the language («€», «₴»). */
  suffix?: ReactNode;
}

/**
 * CMP-02@PoC «Вміст», «Довгі значення»: the amount field. Decimal keyboard, tabular figures. Leaving the field
 * pads the amount to the currency's digits («12,3» → «12,30»); more digits than the currency has, or text that is
 * not a number, is an error that says what to do. Not being edited, an amount that does not fit is shown
 * abbreviated with a dotted underline («4,51 млрд») and the full value in the tooltip; a value with more digits
 * than the currency's is shown rounded with «≈». The focus brings back the full value. The value lives in the
 * consumer's state as a decimal string, never as the shown text.
 */
export function AmountField({ value, onChange, onBlur, currency, suffix, error, ...rest }: AmountFieldProps) {
  const { t, locale } = useI18n();
  const places = currencyPlaces(currency);
  const [draft, setDraft] = useState<string | null>(null);
  const [problem, setProblem] = useState<AmountProblem | null>(null);
  // The text the focus put in the field: leaving it unchanged keeps the value as it was (even «≈ 0,33»).
  const start = useRef<string | null>(null);

  const shown = value === null ? null : displayAmount(locale, value, places);
  const text =
    draft ?? (shown ? (shown.approx ? t("field.amount.approx", { value: shown.text }) : shown.text) : "");
  const short = draft === null && value !== null ? formatCompactNumber({ value, locale }) : null;

  const nameKey = `amount.spoken.currency.${currency}.other`;
  const named = translate(locale, nameKey as MessageKey);
  const ownError =
    problem === "places"
      ? t("field.amount.error.places", {
          places: formatNumber(locale, String(places)),
          currency: named === nameKey ? currency : named,
        })
      : problem === "invalid"
        ? t("field.amount.error.number", { example: displayAmount(locale, "3000", places).text })
        : null;

  return (
    <FieldView
      {...rest}
      numeric
      text={text}
      short={short}
      suffix={suffix ?? currencySymbolOf(locale, currency)}
      error={error ?? ownError}
      onFocus={() => {
        if (draft !== null) return;
        start.current = value === null ? "" : editAmount(locale, value, places);
        setDraft(start.current);
      }}
      onText={(next) => {
        setDraft(next);
        const parsed = parseAmountInput(next, locale, places);
        if (parsed.problem === null) {
          setProblem(null);
          onChange?.(parsed.value, null);
        }
      }}
      onLeave={() => {
        if (draft !== null && draft === start.current) {
          setDraft(null);
        } else if (draft !== null) {
          const parsed = parseAmountInput(draft, locale, places);
          setProblem(parsed.problem);
          if (parsed.problem === null) setDraft(null);
          onChange?.(parsed.value, parsed.problem);
        }
        onBlur?.();
      }}
    />
  );
}
