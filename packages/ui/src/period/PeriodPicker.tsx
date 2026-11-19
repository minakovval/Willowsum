import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { IconButton } from "../icons/IconButton.tsx";
import { Icon } from "../icons/Icon.tsx";

export interface PeriodChoice {
  id: string;
  label: string;
}

export interface PeriodPickerProps {
  /** «Тип періоду» (the group's accessible name and the first control's name prefix). */
  typeLabel: string;
  /** The types the page allows, in order; a type the page does not allow is not passed (CMP-72 AC4). */
  types: readonly PeriodChoice[];
  type: string;
  onTypeChange: (type: string) => void;
  /** The periods of the chosen type, newest first, for the list that the name opens. */
  periods: readonly PeriodChoice[];
  period: string;
  /** The name of the chosen period («Жовтень 2026»). */
  periodLabel: string;
  /** The accessible name of the period list. */
  periodListLabel: string;
  prevLabel: string;
  nextLabel: string;
  /** «‹» is off when there is no earlier period with data; `prevHint` says why («Даних раніше немає»). */
  prevDisabled?: boolean;
  prevHint?: string;
  nextDisabled?: boolean;
  onPrev: () => void;
  onNext: () => void;
  onPeriodChange: (period: string) => void;
  /** The polite announcement after a change («Показано: Жовтень 2026»). */
  announce: (periodLabel: string) => string;
  /** «Тип періоду: Місяць». */
  typeName: (typeLabel: string) => string;
}

/**
 * CMP-72@PoC, main mode: the type of the period, then the concrete one — one 38 px group (1 px `border-control`, radius 8,
 * `surface-200`) of «Тип періоду ˅» and «‹ Жовтень 2026 ›»; each control's hit area is 44 px. Both lists are listboxes:
 * ↑ ↓ move, Enter chooses, Esc closes and gives the focus back to the opener. A change is announced politely.
 */
export function PeriodPicker(props: PeriodPickerProps) {
  const [announcement, setAnnouncement] = useState("");
  const touched = useRef(false);
  const { periodLabel, announce } = props;
  useEffect(() => {
    if (touched.current) setAnnouncement(announce(periodLabel));
  }, [periodLabel, announce]);
  const user =
    <A extends unknown[]>(fn: (...a: A) => void) =>
    (...a: A) => {
      touched.current = true;
      fn(...a);
    };
  const typeLabel = props.types.find((x) => x.id === props.type)?.label ?? "";
  return (
    <div className="ws-period-picker" role="group" aria-label={props.typeLabel}>
      <ListControl
        className="ws-period-type"
        name={props.typeName(typeLabel)}
        text={typeLabel}
        listLabel={props.typeLabel}
        choices={props.types}
        value={props.type}
        mark
        onChoose={user(props.onTypeChange)}
      />
      <div className="ws-period-current">
        <IconButton
          icon="chevron-left"
          label={
            props.prevDisabled && props.prevHint ? `${props.prevLabel}. ${props.prevHint}` : props.prevLabel
          }
          aria-disabled={props.prevDisabled || undefined}
          onClick={user(() => (props.prevDisabled ? undefined : props.onPrev()))}
        />
        <ListControl
          className="ws-period-name"
          name={props.periodLabel}
          text={props.periodLabel}
          listLabel={props.periodListLabel}
          choices={props.periods}
          value={props.period}
          onChoose={user(props.onPeriodChange)}
        />
        <IconButton
          icon="chevron-right"
          label={props.nextLabel}
          aria-disabled={props.nextDisabled || undefined}
          onClick={user(() => (props.nextDisabled ? undefined : props.onNext()))}
        />
      </div>
      <p className="ws-visually-hidden" role="status" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}

function ListControl({
  className,
  name,
  text,
  listLabel,
  choices,
  value,
  mark = false,
  onChoose,
}: {
  className: string;
  name: string;
  text: string;
  listLabel: string;
  choices: readonly PeriodChoice[];
  value: string;
  mark?: boolean;
  onChoose: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const list = root.current;
    (
      list?.querySelector<HTMLElement>('[role="option"][aria-selected="true"]') ??
      list?.querySelector<HTMLElement>('[role="option"]')
    )?.focus();
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  const close = () => {
    setOpen(false);
    opener.current?.focus();
  };
  const onListKey = (e: KeyboardEvent<HTMLUListElement>) => {
    const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="option"]')];
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      items[(at + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      items[e.key === "Home" ? 0 : items.length - 1]?.focus();
    } else if (e.key === "Tab") setOpen(false);
  };

  return (
    <div ref={root} className={`ws-period-control ${className}`}>
      <button
        ref={opener}
        type="button"
        className="ws-period-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={name}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span>{text}</span>
        <Icon name="chevron-down" size={16} />
      </button>
      {open ? (
        <ul
          id={listId}
          role="listbox"
          aria-label={listLabel}
          className="ws-period-list"
          onKeyDown={onListKey}
        >
          {choices.map((c) => (
            <li key={c.id} role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={c.id === value}
                className="ws-period-option"
                onClick={() => {
                  onChoose(c.id);
                  close();
                }}
              >
                <span aria-hidden="true" className="ws-period-mark">
                  {mark && c.id === value ? "✓" : ""}
                </span>
                {c.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
