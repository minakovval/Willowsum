import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useT } from "@willowsum/i18n";
import { Icon } from "../icons/Icon.tsx";
import {
  nextActive,
  optionId,
  OptionRow,
  useActiveInView,
  useOutsidePress,
  type SearchOption,
} from "./listbox.tsx";

export interface ListButtonProps {
  /** The name of the parameter inside the button, without the colon («Категорія»). */
  label: string;
  /** The choices; `secondary` is a second line («липень–вересень 2026»). */
  options: readonly SearchOption[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * CMP-03@PoC Select «кнопка-список з підписом»: the single filter or parameter of a page or card in a toolbar
 * («Категорія: Усі ˅») and the view of a whole page. A 36 px button (44 px hit area) with the label, a colon and
 * the value inside it — no label above; a menu panel below it with a check by the current choice. The button has
 * `aria-haspopup="listbox"`, `aria-expanded` and the name «<label>: <value>». A value other than the default does
 * not change how the button looks; the default is chosen again from the list («Усі»).
 */
export function ListButton({ label, options, value, onChange, disabled, className }: ListButtonProps) {
  const t = useT();
  const listId = `ws-list-button${useId()}`;
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const current = options.findIndex((o) => o.value === value);
  const [active, setActive] = useState(-1);
  const enabled = options.map((o) => !o.disabled);
  const shownValue = current >= 0 ? options[current]!.label : "";

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  }, []);
  const closeOutside = useCallback(() => close(false), [close]);
  useOutsidePress(open, root, closeOutside);
  useActiveInView(listId, open ? active : -1);
  useEffect(() => {
    if (open) list.current?.focus();
  }, [open]);

  const show = () => {
    setActive(current >= 0 ? current : (nextActive("ArrowDown", -1, enabled, true) ?? -1));
    setOpen(true);
  };
  const choose = (index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    close(true);
    onChange(option.value);
  };

  const onListKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close(true);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (active >= 0) choose(active);
    } else if (e.key === "Tab") {
      close(false);
    } else {
      const next = nextActive(e.key, active, enabled, true);
      if (next !== null) {
        e.preventDefault();
        setActive(next);
      }
    }
  };

  return (
    <div className={["ws-list-button-wrap", className].filter(Boolean).join(" ")} ref={root}>
      <button
        ref={button}
        type="button"
        className="ws-list-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={t("select.listButton.name", { label, value: shownValue })}
        disabled={disabled}
        onClick={() => (open ? close(true) : show())}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault();
            show();
          }
        }}
      >
        <span className="ws-list-button__label">{t("select.listButton.label", { label })}</span>
        <span className="ws-list-button__value">{shownValue}</span>
        <Icon name={open ? "chevron-up" : "chevron-down"} size={16} tone="muted" />
      </button>
      {open ? (
        <div
          ref={list}
          id={listId}
          role="listbox"
          tabIndex={-1}
          aria-label={label}
          aria-activedescendant={active >= 0 ? optionId(listId, active) : undefined}
          className="ws-select-panel ws-select-list ws-list-button__panel"
          onKeyDown={onListKey}
        >
          {options.map((o, i) => (
            <OptionRow
              key={o.value}
              id={optionId(listId, i)}
              label={o.label}
              secondary={o.secondary}
              leading={o.leading}
              selected={i === current}
              active={i === active}
              disabled={o.disabled}
              onChoose={() => choose(i)}
              onHover={() => setActive(i)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
