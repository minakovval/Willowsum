import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useT } from "@willowsum/i18n";
import { Icon } from "../icons/Icon.tsx";
import { useOutsidePress } from "../select/listbox.tsx";
import { TruncatedText } from "../tooltip/Tooltip.tsx";
import type { FilterChipItem } from "./FilterBar.tsx";

export interface CardFilterOption {
  readonly id: string;
  readonly label: string;
  /** How many records this value holds (the whole set, not the filtered one). */
  readonly count: number;
  readonly checked: boolean;
}

export interface CardFilterSection {
  readonly id: string;
  /** The section's heading («Тип», «Стан», «Групи»). */
  readonly label: string;
  readonly options: readonly CardFilterOption[];
}

export interface CardFilterProps {
  /** The number of chosen values: «Фільтри · N»; 0 — «Фільтри». */
  count: number;
  sections: readonly CardFilterSection[];
  /** A value was checked or unchecked: the consumer applies it at once (no «Застосувати»). */
  onToggle: (sectionId: string, optionId: string) => void;
  /** «Скинути» in the menu. */
  onReset: () => void;
  /** «Показано N з M» in the menu foot. */
  shown: number;
  all: number;
  className?: string | undefined;
}

/**
 * CMP-32@PoC variant «у картці» (FR 8, AC 8): the filter of one card or table. The same button «Фільтри · N» as the
 * FilterBar, but it opens a menu under it (`aria-haspopup="menu"`): sections with a heading, each value a
 * `menuitemcheckbox` with its count on the right. A choice acts at once, without «Застосувати»; the menu stays open
 * for the next choice, and ends with «Скинути» and «Показано N з M». Escape or a press outside closes it and the
 * focus goes back to the button. The chips of the chosen values are `CardFilterChips`.
 */
export function CardFilter({ count, sections, onToggle, onReset, shown, all, className }: CardFilterProps) {
  const t = useT();
  const menuId = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  }, []);
  const closeOutside = useCallback(() => close(false), [close]);
  useOutsidePress(open, root, closeOutside);
  useEffect(() => {
    if (open) menu.current?.querySelector<HTMLElement>("[role='menuitemcheckbox']")?.focus();
  }, [open]);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const items = [...(menu.current?.querySelectorAll<HTMLElement>("[role='menuitemcheckbox']") ?? [])];
    if (items.length === 0) return;
    e.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLElement);
    const step = e.key === "ArrowDown" ? 1 : -1;
    items[(at + step + items.length) % items.length]?.focus();
  };

  return (
    <div className={["ws-filter-bar", className].filter(Boolean).join(" ")} ref={root}>
      <button
        ref={button}
        type="button"
        className="ws-filter-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close(true) : setOpen(true))}
      >
        <Icon name="filter" size={16} tone="muted" />
        {count > 0 ? t("filter.buttonCount", { count }) : t("filter.button")}
      </button>
      {open ? (
        <div
          ref={menu}
          id={menuId}
          role="menu"
          aria-label={t("filter.card.menu")}
          className="ws-filter-panel ws-card-filter-menu"
          onKeyDown={onKey}
        >
          {sections.map((section) => (
            <div key={section.id} role="group" aria-label={section.label} className="ws-card-filter-section">
              <p className="ws-card-filter-heading" aria-hidden="true">
                {section.label}
              </p>
              {section.options.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={option.checked}
                  className="ws-card-filter-item"
                  onClick={() => onToggle(section.id, option.id)}
                >
                  <span
                    className="ws-check-box"
                    aria-hidden="true"
                    data-checked={option.checked || undefined}
                  >
                    {option.checked ? <Icon name="check" size={16} /> : null}
                  </span>
                  <span className="ws-card-filter-label">{option.label}</span>
                  <span className="ws-card-filter-count">{option.count}</span>
                </button>
              ))}
            </div>
          ))}
          <div className="ws-card-filter-foot">
            <button type="button" className="ws-card-filter-reset" onClick={onReset}>
              {t("filter.card.reset")}
            </button>
            <span className="ws-muted">{t("filter.card.shown", { shown, total: all })}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** The chips of the chosen values under the card's heading: «Стан: перевищено ×», each with its own «×» (CMP-64). */
export function CardFilterChips({
  chips,
  onRemove,
}: {
  chips: readonly FilterChipItem[];
  onRemove: (id: string) => void;
}) {
  const t = useT();
  if (chips.length === 0) return null;
  return (
    <ul className="ws-filter-chips" aria-label={t("filter.chips")}>
      {chips.map((chip) => {
        const name = t("filter.remove", { field: chip.field, value: chip.value });
        return (
          <li key={chip.id} className="ws-filter-chip">
            <TruncatedText text={chip.text} className="ws-filter-chip__text" />
            <button
              type="button"
              className="ws-filter-chip__remove"
              aria-label={name}
              title={name}
              onClick={() => onRemove(chip.id)}
            >
              <Icon name="close" size={16} tone="muted" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
