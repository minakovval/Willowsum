import { createContext, useContext, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { formatNumber, useI18n } from "@willowsum/i18n";
import { Icon } from "../icons/Icon.tsx";
import { Stepper, type StepState } from "../stepper/Stepper.tsx";
import { Dialog, type DialogAction, type DialogProps } from "./Dialog.tsx";

/** One field of the form as the dialog needs to know it: where it is, whether it is required and valid. */
export interface FormDialogField {
  /** The id the consumer uses with `form.errorOf(id)` and `form.leave(id)`. */
  id: string;
  /** The field's label, as in the reason line («Щоб продовжити, заповніть: Назва»). */
  label: string;
  /** The step (0-based) the field is on; 0 by default and in a form without steps. */
  step?: number | undefined;
  required?: boolean | undefined;
  /** The field has no value yet. */
  empty: boolean;
  /**
   * A blocking problem of a filled field, required or not («Такий рахунок уже є…», a malformed number). Shown under
   * the field once the user has left it; the main action stays inactive while it is there.
   */
  error?: string | null | undefined;
  /** What an empty required field says under it; by default «Обов’язкове поле». */
  emptyError?: string | undefined;
}

export interface FormDialogStep {
  /** A short name of a thematic group of fields: «Основне», «Залишок», «Додатково». */
  label: string;
}

/** What the content of each step gets to wire its fields. */
export interface FormDialogState {
  /** The step being rendered (0-based). */
  step: number;
  /** The error to pass to the field (`Field` `error`): shown only after the user has left the field. */
  errorOf: (id: string) => string | undefined;
  /** Pass to the field's `onBlur`: the field's error may show from now on. */
  leave: (id: string) => () => void;
}

export interface FormDialogProps extends Pick<
  DialogProps,
  "open" | "onClose" | "title" | "text" | "icon" | "tone" | "closeLabel" | "busy" | "error"
> {
  /** Two or more thematic steps when the form does not fit the dialog (п. 7); left out for a one-step form. */
  steps?: readonly FormDialogStep[] | undefined;
  /** Every field in the order of the form; required fields first (п. 3). */
  fields: readonly FormDialogField[];
  /** A verb with a noun («Додати рахунок») or «Зберегти» when editing (п. 6). */
  submitLabel: string;
  /** The main action's label while `busy` («Додаємо…»). */
  busyLabel?: string | undefined;
  /** Called only when every required field is filled and no field has a blocking error. */
  onSubmit: () => void;
  /** Editing: every step counts as passed from the start (п. 8). */
  editing?: boolean | undefined;
  /**
   * The reason line of an inactive action, for a form whose own text differs from the general one
   * («Щоб додати рахунок, заповніть: {fields}»). Each gets the field names joined; each falls back to the general text.
   */
  reason?:
    | {
        fill?: ((fields: string) => string) | undefined;
        fix?: ((fields: string) => string) | undefined;
        both?: ((empty: string, invalid: string) => string) | undefined;
      }
    | undefined;
  /** The step's content: the fields of `form.step`, one column, each full width, the label above. */
  children: (form: FormDialogState) => ReactNode;
}

interface FormContextValue {
  fields: readonly FormDialogField[];
  shows: (id: string) => boolean;
}

const FormContext = createContext<FormContextValue | null>(null);

/**
 * CMP-21@PoC «Форма створення або редагування сутності»: the 560 px dialog of a create or edit form, built on `Dialog`.
 * - One hint on top, «Поля з * обов’язкові.»; a field's error appears when the user leaves it, not while typing
 *   («Обов’язкове поле» for an empty required one) and goes once the value is valid.
 * - The bar: «Скасувати» at the start; «Назад» (from step 2), «Далі» (until the last step) and the main action at the
 *   end. The main action is inactive while any required field of the whole form is empty or any field has a blocking
 *   error, and is active on any step once they are all valid; «Далі» is inactive while the current step is not valid.
 *   An inactive button keeps its focus place, is described by the line above the buttons («Щоб продовжити,
 *   заповніть: Цільова сума», a field of another step with its number) and shows it on hover and focus.
 * - Steps (п. 7–8): the indicator under the title; a step opens only when every step before it is valid; back is
 *   always possible and every value is kept. All steps are rendered in one grid cell, the others hidden and inert,
 *   so the dialog keeps the height of the tallest step and the bar never moves.
 * - The dialog never scrolls: a form that does not fit the window minus 96 px is split into more steps by its author.
 */
export function FormDialog({
  open,
  onClose,
  title,
  text,
  icon,
  tone,
  closeLabel,
  busy,
  error,
  steps,
  fields,
  submitLabel,
  busyLabel,
  onSubmit,
  editing = false,
  reason,
  children,
}: FormDialogProps) {
  const { t, locale } = useI18n();
  const count = steps && steps.length > 1 ? steps.length : 1;
  const [current, setCurrent] = useState(0);
  const [visited, setVisited] = useState<ReadonlySet<number>>(() => new Set(editing ? range(count) : [0]));
  const [touched, setTouched] = useState<ReadonlySet<string>>(() => new Set());
  const stepsRef = useRef<HTMLDivElement | null>(null);
  const moved = useRef(false);
  const base = useId();
  // Opening again starts the form afresh: step 1, nothing left yet (state adjusted during render).
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setCurrent(0);
      setVisited(new Set(editing ? range(count) : [0]));
      setTouched(new Set());
    }
  }

  const stepOf = (f: FormDialogField) => (count > 1 ? Math.min(Math.max(f.step ?? 0, 0), count - 1) : 0);
  const missing = (f: FormDialogField) => Boolean(f.required) && f.empty;
  const broken = (f: FormDialogField) => !f.empty && Boolean(f.error);
  const bad = (f: FormDialogField) => missing(f) || broken(f);
  const stepValid = (i: number) => !fields.some((f) => stepOf(f) === i && bad(f));
  const reachable = (i: number) => range(i).every(stepValid);
  const formValid = !fields.some(bad);

  const stateOf = (i: number): StepState =>
    i === current
      ? "current"
      : !reachable(i)
        ? "unavailable"
        : visited.has(i)
          ? stepValid(i)
            ? "done"
            : "error"
          : "available";

  const go = (i: number) => {
    if (i === current || (i > current && !reachable(i))) return;
    moved.current = true;
    setCurrent(i);
    setVisited((v) => new Set([...v, i]));
  };

  // A new step takes the focus to its first field (else the step itself), so focus never stays on a hidden step.
  useLayoutEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    const step = stepsRef.current?.querySelector<HTMLElement>(`[data-step="${current}"]`);
    const field = step?.querySelector<HTMLElement>(
      "input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button",
    );
    (field ?? step)?.focus();
  }, [current]);

  const names = (list: readonly FormDialogField[]) =>
    list
      .map((f) =>
        stepOf(f) === current || count === 1
          ? f.label
          : t("dialog.form.fieldOnStep", {
              field: f.label,
              number: formatNumber(locale, String(stepOf(f) + 1)),
            }),
      )
      .join(t("dialog.form.listSeparator"));
  const empty = fields.filter(missing);
  const invalid = fields.filter(broken);
  const note = formValid
    ? undefined
    : empty.length > 0 && invalid.length > 0
      ? (reason?.both?.(names(empty), names(invalid)) ??
        t("dialog.form.reason.both", { empty: names(empty), invalid: names(invalid) }))
      : empty.length > 0
        ? (reason?.fill?.(names(empty)) ?? t("dialog.form.reason.fill", { fields: names(empty) }))
        : (reason?.fix?.(names(invalid)) ?? t("dialog.form.reason.fix", { fields: names(invalid) }));

  const last = current === count - 1;
  const actions: DialogAction[] = [
    { label: t("dialog.form.cancel"), onClick: onClose },
    ...(current > 0 ? [{ label: t("dialog.form.back"), onClick: () => go(current - 1) }] : []),
    ...(last
      ? []
      : [{ label: t("dialog.form.next"), disabled: !stepValid(current), onClick: () => go(current + 1) }]),
    { label: submitLabel, variant: "primary", busyLabel, disabled: !formValid, onClick: onSubmit },
  ];

  const byId = new Map(fields.map((f) => [f.id, f]));
  const errorOf = (id: string) => {
    const f = byId.get(id);
    if (!f || !touched.has(id)) return undefined;
    if (missing(f)) return f.emptyError ?? t("dialog.form.required");
    return broken(f) ? (f.error ?? undefined) : undefined;
  };
  const leave = (id: string) => () => setTouched((s) => (s.has(id) ? s : new Set([...s, id])));
  const shows = (id: string) => {
    const f = byId.get(id);
    return Boolean(f && (!f.empty || errorOf(id)));
  };

  // One hint on top, on the steps that have a required field (a step of optional fields has none: board S-052).
  const hinted = (i: number) => fields.some((f) => f.required && stepOf(f) === i);
  const hint = requiredHint(t("dialog.form.requiredHint"));

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      text={text}
      icon={icon}
      tone={tone}
      closeLabel={closeLabel}
      align="start"
      bar="form"
      busy={busy}
      error={error}
      note={note}
      actions={actions}
    >
      <FormContext.Provider value={{ fields, shows }}>
        {count > 1 && steps ? (
          <Stepper steps={steps.map((s, i) => ({ label: s.label, state: stateOf(i) }))} onSelect={go} />
        ) : null}
        <div ref={stepsRef} className="ws-form-steps">
          {range(count).map((i) => (
            <div
              key={i}
              id={`${base}-step-${i}`}
              className="ws-form-step"
              data-step={i}
              tabIndex={-1}
              inert={i !== current || undefined}
              aria-hidden={i !== current || undefined}
            >
              {hinted(i) ? <p className="ws-form-hint">{hint}</p> : null}
              {children({ step: i, errorOf, leave })}
            </div>
          ))}
        </div>
      </FormContext.Provider>
    </Dialog>
  );
}

export interface FormMoreProps {
  /** The heading names briefly what is inside: «Додатково: номер, нотатка». */
  label: string;
  /** The ids (from `fields`) of the fields inside. */
  fields: readonly string[];
  children: ReactNode;
}

/**
 * «Додатково» of a form (CMP-21 «Форма створення…», п. 4–5): the collapsible section of the remaining optional
 * fields, collapsed by default; it opens by itself while a field inside has a value or a shown error. Inside a
 * `FormDialog`.
 */
export function FormMore({ label, fields: ids, children }: FormMoreProps) {
  const form = useContext(FormContext);
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const forced = Boolean(form && ids.some((f) => form.shows(f)));
  const isOpen = expanded || forced;
  return (
    <section className="ws-form-more" data-open={isOpen || undefined}>
      <button
        type="button"
        className="ws-form-more-toggle"
        aria-expanded={isOpen}
        aria-controls={id}
        onClick={() => {
          if (!forced) setExpanded((v) => !v);
        }}
      >
        <Icon name={isOpen ? "chevron-up" : "chevron-down"} size={16} />
        <span>{label}</span>
      </button>
      <div id={id} className="ws-form-more-body" hidden={!isOpen}>
        {children}
      </div>
    </section>
  );
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

/** «Поля з * обов’язкові.» with the asterisk in `loss`, as on the field labels. */
function requiredHint(text: string): ReactNode {
  const at = text.indexOf("*");
  if (at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <span className="ws-field-required">{text.slice(at, at + 1)}</span>
      {text.slice(at + 1)}
    </>
  );
}
