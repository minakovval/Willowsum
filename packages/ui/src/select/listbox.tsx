import { useEffect, type MouseEvent, type ReactNode, type RefObject } from "react";
import { useT } from "@willowsum/i18n";
import { Icon } from "../icons/Icon.tsx";
import { Skeleton } from "../skeleton/Skeleton.tsx";

/** One choice of a list. `label` is the text the field shows when it is chosen. */
export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

/** A choice of the «з пошуком» variant: a chip, a logo or an icon before the name and an optional second line. */
export interface SearchOption extends SelectOption {
  /** A category chip with its coloured circle, an institution logo 24 px (CMP-03 «Варіант «з пошуком»»). */
  leading?: ReactNode;
  /** One format per list: the institution or the balance («залишок 5 200,00 €»). */
  secondary?: string;
}

/** A group of the «з пошуком» panel; an empty `title` draws no heading. */
export interface SearchGroup {
  id: string;
  title: string;
  options: readonly SearchOption[];
}

/** CMP-03 «Призначення»: the native list holds up to about 8 choices; a longer one is the «з пошуком» variant. */
export const SELECT_NATIVE_MAX = 8;

/** Which variant a list of `count` choices uses (CMP-03 AC4). */
export function selectVariant(count: number): "native" | "search" {
  return count > SELECT_NATIVE_MAX ? "search" : "native";
}

/** The id of the option at `index` of a listbox, for `aria-activedescendant`. */
export function optionId(listId: string, index: number): string {
  return `${listId}-o${index}`;
}

/**
 * ↑ ↓ (and Home / End where the focus is not in a text field) over the enabled options of a listbox. Returns the
 * next active index, or `null` when the key does not move.
 */
export function nextActive(
  key: string,
  active: number,
  enabled: readonly boolean[],
  withHomeEnd: boolean,
): number | null {
  const last = enabled.length - 1;
  const step = (from: number, dir: 1 | -1): number => {
    for (let i = from + dir; i >= 0 && i <= last; i += dir) if (enabled[i]) return i;
    return active;
  };
  if (key === "ArrowDown") return step(active, 1);
  if (key === "ArrowUp") return active < 0 ? step(last + 1, -1) : step(active, -1);
  if (withHomeEnd && key === "Home") return step(-1, 1);
  if (withHomeEnd && key === "End") return step(last + 1, -1);
  return null;
}

/** Close a panel on a press outside `root` (the field or the button with its panel). */
export function useOutsidePress(open: boolean, root: RefObject<HTMLElement | null>, close: () => void): void {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: Event) => {
      if (root.current && e.target instanceof Node && !root.current.contains(e.target)) close();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, root, close]);
}

/** Keep the active option in view while the arrows move it (jsdom has no `scrollIntoView`). */
export function useActiveInView(listId: string, active: number): void {
  useEffect(() => {
    if (active < 0) return;
    const el = document.getElementById(optionId(listId, active));
    el?.scrollIntoView?.({ block: "nearest" });
  }, [listId, active]);
}

/**
 * The control is drawn 40 px inside a 44 px hit area (`touch-target`): a press on the 2 px strip above or below it
 * (the box's `::after`) acts as a press on the control.
 */
export function pressHitArea(e: MouseEvent<HTMLElement>): void {
  if (e.target !== e.currentTarget) return;
  const control = e.currentTarget.querySelector<HTMLElement>(".ws-select-control");
  if (!control || (control as HTMLButtonElement).disabled) return;
  e.preventDefault();
  if (control instanceof HTMLSelectElement) {
    control.focus();
    try {
      control.showPicker?.();
    } catch {
      // Not every browser opens a select from script; the focus is enough there.
    }
  } else control.click();
}

/** One option row of a panel: the leading part, the full text (never cut), a check by the current choice. */
export function OptionRow({
  id,
  label,
  secondary,
  leading,
  selected,
  active,
  disabled,
  create,
  onChoose,
  onHover,
}: {
  id: string;
  label: string;
  secondary?: string | undefined;
  leading?: ReactNode;
  selected: boolean;
  active: boolean;
  disabled?: boolean | undefined;
  create?: boolean;
  onChoose: () => void;
  onHover: () => void;
}) {
  const cls = ["ws-select-option", active && "ws-select-option--active", create && "ws-select-option--create"]
    .filter(Boolean)
    .join(" ");
  return (
    <div
      id={id}
      role="option"
      className={cls}
      aria-selected={selected}
      aria-disabled={disabled || undefined}
      // The focus stays in the search field or on the listbox; the press only chooses.
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        if (!disabled) onChoose();
      }}
      onMouseMove={onHover}
    >
      {create ? <Icon name="plus" size={16} /> : leading}
      <span className="ws-select-option__text">
        <span className="ws-select-option__label">{label}</span>
        {secondary ? <span className="ws-select-option__secondary">{secondary}</span> : null}
      </span>
      {selected ? (
        <span className="ws-select-option__check">
          <Icon name="check" size={16} />
        </span>
      ) : null}
    </div>
  );
}

/** What every variant with a label above it shares (CMP-03 «Будова», CMP-02 «Стани»). */
export interface FieldStateProps {
  /** The label above the field, ordinary case. */
  label: string;
  /** What to choose; replaced by the error. */
  hint?: string | undefined;
  /** What to do, without the word «Помилка» («Оберіть валюту рахунку.»); the field adds the marker and the word. */
  error?: string | undefined;
  required?: boolean | undefined;
  disabled?: boolean | undefined;
  /** Why the field is disabled, shown beside it (DS-06 AC7). */
  disabledReason?: string | undefined;
  /** The choices are loading: a skeleton in the shape of the field (CMP-22). */
  loading?: boolean | undefined;
  /** The text of the empty value; default «Оберіть…». */
  placeholder?: string | undefined;
  className?: string | undefined;
}

export interface FieldIds {
  control: string;
  label: string;
  describedBy: string | undefined;
  invalid: boolean;
}

/** The label, the hint or the error and the disabled reason around a control; the loading skeleton instead of it. */
export function SelectFrame({
  base,
  props,
  children,
}: {
  base: string;
  props: FieldStateProps;
  children: (ids: FieldIds) => ReactNode;
}) {
  const t = useT();
  const { label, hint, error, required, disabled, disabledReason, loading, className } = props;
  const invalid = Boolean(error) && !disabled;
  const ids = {
    control: `${base}-control`,
    label: `${base}-label`,
    note: `${base}-note`,
    reason: `${base}-reason`,
  };
  const note = invalid ? (
    <p id={ids.note} className="ws-select-error" role="alert">
      <span aria-hidden="true">{t("select.errorMark")}</span>
      <span>{t("select.error", { message: error ?? "" })}</span>
    </p>
  ) : hint ? (
    <p id={ids.note} className="ws-select-hint">
      {hint}
    </p>
  ) : null;
  const reason =
    disabled && disabledReason ? (
      <p id={ids.reason} className="ws-disabled-reason">
        {disabledReason}
      </p>
    ) : null;
  const describedBy = [note && ids.note, reason && ids.reason].filter(Boolean).join(" ") || undefined;
  return (
    <div className={["ws-select", className].filter(Boolean).join(" ")}>
      <label id={ids.label} htmlFor={ids.control} className="ws-select-label">
        {label}
        {required ? (
          <>
            <span className="ws-select-required-mark" aria-hidden="true">
              {" *"}
            </span>
            <span className="ws-select-required">{t("select.required")}</span>
          </>
        ) : null}
      </label>
      {loading ? (
        <Skeleton variant="block" field />
      ) : (
        children({ control: ids.control, label: ids.label, describedBy, invalid })
      )}
      {loading ? null : note}
      {loading ? null : reason}
    </div>
  );
}
