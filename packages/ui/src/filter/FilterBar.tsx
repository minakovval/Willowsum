import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useT } from "@willowsum/i18n";
import { Button } from "../button/Button.tsx";
import { Icon } from "../icons/Icon.tsx";
import { TruncatedText } from "../tooltip/Tooltip.tsx";
import { nextActive, optionId, OptionRow, useActiveInView, useOutsidePress } from "../select/listbox.tsx";

/** One active filter as a chip «значення ×»: `text` is shown, `field` and `value` name its remove button. */
export interface FilterChipItem {
  readonly id: string;
  /** The filter's name for the remove button («Рахунки»). */
  readonly field: string;
  /** The value for the remove button («Поточний ··4417»). */
  readonly value: string;
  /** What the chip shows («Рахунок: Поточний ··4417»). */
  readonly text: string;
}

export interface FilterBarProps {
  /** The number of active filters: «Фільтри · N»; 0 — «Фільтри». */
  count: number;
  chips: readonly FilterChipItem[];
  /** «×» of a chip: removes that one filter at once. */
  onRemove: (id: string) => void;
  /** The panel opens: the consumer starts its draft from the applied filters. */
  onOpen?: (() => void) | undefined;
  /** «Застосувати»: the consumer applies the draft and the panel closes; `false` — the draft is not valid, it stays open. */
  onApply: () => boolean | void;
  /** «Скинути все»: the consumer removes every filter; the panel closes. */
  onReset: () => void;
  /** The rows of the panel (`FilterRow`), as the list's schema gives them. */
  children: ReactNode;
  className?: string | undefined;
}

/**
 * CMP-32@PoC FilterBar above a list: the button «Фільтри · N» (a native `button`, `aria-haspopup="dialog"`,
 * `aria-expanded`), the chips of the active filters with their «×», and the panel under the button — a `dialog`
 * without a scrim, with rows «підпис — випадний список» and «Скинути все» and «Застосувати» (without a count) at its
 * foot. The chips are a list named «Застосовані фільтри» (CMP-64). The list changes only on «Застосувати», «Скинути
 * все» or a chip's «×»; a choice in the panel changes the draft
 * only. Escape or a press outside closes the panel without applying; the focus goes back to the button.
 */
export function FilterBar({
  count,
  chips,
  onRemove,
  onOpen,
  onApply,
  onReset,
  children,
  className,
}: FilterBarProps) {
  const t = useT();
  const panelId = `ws-filter-panel${useId()}`;
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const chipList = useRef<HTMLUListElement>(null);
  /** The place of the chip whose «×» was pressed, until the chips change. */
  const removed = useRef<number | null>(null);

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  }, []);
  const closeOutside = useCallback(() => close(false), [close]);
  useOutsidePress(open, root, closeOutside);
  useEffect(() => {
    if (open) panel.current?.querySelector<HTMLElement>("button, input, [tabindex]")?.focus();
  }, [open]);
  // CMP-64 «Клавіатура і екранний читач»: after «×» the focus goes to the next chip (the previous one when it was the
  // last), or to «Фільтри» when no chip is left.
  const chipKey = chips.map((c) => c.id).join(" ");
  useEffect(() => {
    const at = removed.current;
    if (at === null) return;
    removed.current = null;
    const buttons = chipList.current?.querySelectorAll<HTMLElement>(".ws-filter-chip__remove") ?? [];
    const next = buttons[Math.min(at, buttons.length - 1)];
    (next ?? button.current)?.focus();
  }, [chipKey]);

  const show = () => {
    onOpen?.();
    setOpen(true);
  };
  const onPanelKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    }
  };

  return (
    <div className={["ws-filter-bar", className].filter(Boolean).join(" ")} ref={root}>
      <button
        ref={button}
        type="button"
        className="ws-filter-button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => (open ? close(true) : show())}
      >
        <Icon name="filter" size={16} tone="muted" />
        {count > 0 ? t("filter.buttonCount", { count }) : t("filter.button")}
      </button>
      {open ? (
        <div
          ref={panel}
          id={panelId}
          role="dialog"
          aria-label={t("filter.panel")}
          className="ws-filter-panel"
          onKeyDown={onPanelKey}
        >
          <div className="ws-filter-rows">{children}</div>
          <div className="ws-filter-actions">
            <Button
              label={t("filter.reset")}
              onClick={() => {
                close(true);
                onReset();
              }}
            />
            <Button
              variant="primary"
              label={t("filter.apply")}
              onClick={() => {
                if (onApply() !== false) close(true);
              }}
            />
          </div>
        </div>
      ) : null}
      {chips.length > 0 ? (
        <ul ref={chipList} className="ws-filter-chips" aria-label={t("filter.chips")}>
          {chips.map((chip, index) => {
            const name = t("filter.remove", { field: chip.field, value: chip.value });
            return (
              <li key={chip.id} className="ws-filter-chip">
                <TruncatedText text={chip.text} className="ws-filter-chip__text" />
                <button
                  type="button"
                  className="ws-filter-chip__remove"
                  aria-label={name}
                  title={name}
                  onClick={() => {
                    removed.current = index;
                    onRemove(chip.id);
                  }}
                >
                  <Icon name="close" size={16} tone="muted" />
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

const RowContext = createContext<{ close: () => void } | null>(null);

export interface FilterRowProps {
  /** The filter's name on the left («Рахунки»). */
  label: string;
  /** What is chosen: names through a comma («Поточний ··4417, Кредитна ··9021»), cut with «…» (full text in the tooltip). */
  summary: string;
  /** Nothing is chosen: the summary («Усі», «Будь-який») is grey. */
  unset?: boolean | undefined;
  /** What the drop-down holds: a list of values (`FilterChecks`) or fields such as «від» and «до». */
  popup?: "listbox" | "dialog" | undefined;
  children: ReactNode;
}

/**
 * One row of the CMP-32 panel: the label on the left and a drop-down button with the chosen values; the values are
 * inside the drop-down (check boxes, a range «від — до»). Escape closes the drop-down only, back to its button.
 */
export function FilterRow({ label, summary, unset, popup = "listbox", children }: FilterRowProps) {
  const t = useT();
  const labelId = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  }, []);
  const closeOutside = useCallback(() => close(false), [close]);
  useOutsidePress(open, root, closeOutside);
  useEffect(() => {
    if (open) panel.current?.querySelector<HTMLElement>('[role="listbox"], input, button')?.focus();
  }, [open]);
  const context = useMemo(() => ({ close: () => close(true) }), [close]);

  return (
    <div className="ws-filter-row">
      <span id={labelId} className="ws-filter-row__label">
        {label}
      </span>
      <div className="ws-filter-row__control" ref={root}>
        <button
          ref={button}
          type="button"
          className="ws-filter-row__button"
          data-unset={unset || undefined}
          aria-haspopup={popup}
          aria-expanded={open}
          aria-label={t("select.listButton.name", { label, value: summary })}
          onClick={() => setOpen((v) => !v)}
          onKeyDown={(e) => {
            if (!open && e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
            }
          }}
        >
          <TruncatedText text={summary} className="ws-filter-row__value" />
          <Icon name={open ? "chevron-up" : "chevron-down"} size={16} tone="muted" />
        </button>
        {open ? (
          <div
            ref={panel}
            className="ws-dropdown-panel ws-filter-row__panel"
            role={popup === "dialog" ? "group" : undefined}
            aria-labelledby={popup === "dialog" ? labelId : undefined}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                close(true);
              }
            }}
          >
            <RowContext.Provider value={context}>{children}</RowContext.Provider>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export interface FilterChecksProps {
  /** The name of the list for screen readers (the row's label). */
  label: string;
  options: readonly { readonly value: string; readonly label: string }[];
  /** The chosen values; empty — nothing chosen («Усі»). */
  value: readonly string[];
  onChange: (value: string[]) => void;
  /** Several values with check boxes (the default); `false` — one value, the drop-down closes on the choice. */
  multiple?: boolean | undefined;
  /** The first option that clears the choice («Усі рахунки», «Будь-який»); chosen while `value` is empty. */
  anyLabel?: string | undefined;
}

/**
 * The values inside a `FilterRow`: a `listbox` (`aria-multiselectable` for several values); ↑ ↓ Home End move,
 * Space or Enter checks the value (one value: chooses it and closes the drop-down).
 */
export function FilterChecks({
  label,
  options,
  value,
  onChange,
  multiple = true,
  anyLabel,
}: FilterChecksProps) {
  const listId = `ws-filter-checks${useId()}`;
  const row = useContext(RowContext);
  const all = anyLabel === undefined ? options : [{ value: "", label: anyLabel }, ...options];
  const isChosen = (v: string) => (v === "" ? value.length === 0 : value.includes(v));
  const first = all.findIndex((o) => isChosen(o.value));
  const [active, setActive] = useState(first >= 0 ? first : 0);
  useActiveInView(listId, active);

  const choose = (index: number) => {
    const option = all[index];
    if (!option) return;
    if (option.value === "") onChange([]);
    else if (!multiple) onChange([option.value]);
    else
      onChange(
        value.includes(option.value) ? value.filter((v) => v !== option.value) : [...value, option.value],
      );
    if (!multiple) row?.close();
  };

  return (
    <div
      id={listId}
      role="listbox"
      tabIndex={0}
      aria-label={label}
      aria-multiselectable={multiple || undefined}
      aria-activedescendant={all.length > 0 ? optionId(listId, active) : undefined}
      className="ws-select-list ws-filter-checks"
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          choose(active);
          return;
        }
        const next = nextActive(
          e.key,
          active,
          all.map(() => true),
          true,
        );
        if (next !== null) {
          e.preventDefault();
          setActive(next);
        }
      }}
    >
      {all.map((o, i) => (
        <OptionRow
          key={o.value || "any"}
          id={optionId(listId, i)}
          label={o.label}
          selected={isChosen(o.value)}
          active={i === active}
          checkbox={multiple}
          onChoose={() => choose(i)}
          onHover={() => setActive(i)}
        />
      ))}
    </div>
  );
}
