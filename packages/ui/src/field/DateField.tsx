import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { formatDate, formatLocaleOf, useI18n } from "@willowsum/i18n";
import { Icon } from "../icons/Icon.tsx";
import { pressHitArea, SelectFrame, useOutsidePress, type FieldStateProps } from "../select/listbox.tsx";

/** A quick choice under the calendar that the form sets («Сьогодні», «Учора»). */
export interface DateChip {
  label: string;
  /** `YYYY-MM-DD`. */
  value: string;
}

export interface DateFieldProps extends FieldStateProps {
  /** `YYYY-MM-DD`; `""` — no date yet. */
  value: string;
  onChange: (value: string) => void;
  /** «Сьогодні» of the space (`YYYY-MM-DD`): the date gets the grey «· сьогодні», its day the `focus` frame. */
  today: string;
  /** The last date that can be chosen (`YYYY-MM-DD`); later days are `aria-disabled`. */
  max?: string | undefined;
  chips?: readonly DateChip[] | undefined;
  /** The line under the calendar when there is a limit («Майбутні дати недоступні …»). */
  limitNote?: string | undefined;
  id?: string | undefined;
}

const DAY_MS = 86_400_000;
const toUtc = (iso: string): Date => new Date(`${iso}T00:00:00Z`);
const toIso = (d: Date): string => d.toISOString().slice(0, 10);
const addDays = (iso: string, n: number): string => toIso(new Date(toUtc(iso).getTime() + n * DAY_MS));
const monthOf = (iso: string): string => iso.slice(0, 7);
const firstOf = (month: string): string => `${month}-01`;

/** The same day `n` months on, clamped to the length of that month («31 січня» + 1 → «28 лютого»). */
function addMonths(iso: string, n: number): string {
  const d = toUtc(iso);
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d.getUTCDate(), last));
  return toIso(target);
}

/** The weeks of a month from Monday: `null` for the cells before the 1st and after the last day. */
function weeksOf(month: string): (string | null)[][] {
  const first = toUtc(firstOf(month));
  const lead = (first.getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const cells: (string | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: days }, (_, i) => addDays(firstOf(month), i)),
  ];
  while (cells.length % 7) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));
}

/**
 * CMP-02@PoC «Тип «дата»»: the 40 px frame with a calendar icon on the left and a chevron on the right; the value is the
 * date in the locale's format, the grey «· сьогодні» for today. A press or Alt+↓ opens the month calendar (300 px,
 * `role="dialog"` «Оберіть дату»): «Листопад 2026 ‹ ›», the weekdays from Monday, 34 px days (the chosen one `brand`,
 * today with a `focus` frame), the form's quick chips and the limit line. Days after `max` are `aria-disabled`. The days
 * are a `grid`: arrows move by a day or a week, Home / End to the start or end of the week, PageUp / PageDown by a
 * month, Enter chooses, Esc closes and gives the focus back to the field; Tab out closes it. An optional field shows
 * «Без дати» when empty and offers «Без дати» in the calendar to clear a chosen date.
 */
export function DateField(props: DateFieldProps) {
  const { value, onChange, today, max, chips, limitNote, id, disabled } = props;
  const { t, locale } = useI18n();
  const auto = useId();
  const base = id ?? `ws-date${auto}`;
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [focusDay, setFocusDay] = useState(value || today);
  const month = monthOf(focusDay);
  const allowed = useCallback((iso: string) => max === undefined || iso <= max, [max]);

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  }, []);
  const closeOutside = useCallback(() => close(false), [close]);
  useOutsidePress(open, root, closeOutside);

  // The focus follows the active day of the grid, the moment the calendar opens and after each move.
  useEffect(() => {
    if (!open) return;
    grid.current?.querySelector<HTMLElement>(`[data-day="${focusDay}"]`)?.focus();
  }, [open, focusDay]);

  const fmt = formatLocaleOf(locale);
  const title = useMemo(() => {
    const text = new Intl.DateTimeFormat(fmt, { month: "long", year: "numeric", timeZone: "UTC" })
      .formatToParts(toUtc(firstOf(month)))
      .filter((p) => p.type === "month" || p.type === "year" || p.type === "literal")
      .map((p) => p.value)
      .join("")
      .replace(/\s+\S*\.$/, "")
      .trim();
    return text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);
  }, [fmt, month, locale]);
  const weekdays = useMemo(() => {
    const short = new Intl.DateTimeFormat(fmt, { weekday: "short", timeZone: "UTC" });
    // 2024-01-01 was a Monday.
    return Array.from({ length: 7 }, (_, i) => {
      const text = short.format(toUtc(addDays("2024-01-01", i)));
      return text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);
    });
  }, [fmt, locale]);
  const long = useMemo(
    () => new Intl.DateTimeFormat(fmt, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }),
    [fmt],
  );

  const choose = (iso: string) => {
    if (!allowed(iso)) return;
    onChange(iso);
    close(true);
  };

  const onGridKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, () => string> = {
      ArrowLeft: () => addDays(focusDay, -1),
      ArrowRight: () => addDays(focusDay, 1),
      ArrowUp: () => addDays(focusDay, -7),
      ArrowDown: () => addDays(focusDay, 7),
      PageUp: () => addMonths(focusDay, -1),
      PageDown: () => addMonths(focusDay, 1),
      // The start and the end of the week (from Monday).
      Home: () => addDays(focusDay, -((toUtc(focusDay).getUTCDay() + 6) % 7)),
      End: () => addDays(focusDay, 6 - ((toUtc(focusDay).getUTCDay() + 6) % 7)),
    };
    const move = moves[e.key];
    if (move) {
      e.preventDefault();
      setFocusDay(move());
    }
  };

  // An optional date once chosen can go back to «Без дати».
  const clearable = !props.required && value !== "";
  const clear = () => {
    onChange("");
    close(true);
  };

  const openCalendar = () => {
    setFocusDay(value || today);
    setOpen(true);
  };

  return (
    <SelectFrame base={base} props={props}>
      {({ control, label, describedBy, invalid }) => (
        <div
          className="ws-select-box ws-date"
          ref={root}
          onMouseDown={pressHitArea}
          onBlur={(e) => {
            // Tab (or any focus move) out of the field and its calendar closes the calendar.
            const next = e.relatedTarget;
            if (open && next instanceof Node && !e.currentTarget.contains(next)) close(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape" && open) {
              e.preventDefault();
              e.stopPropagation();
              close(true);
            }
          }}
        >
          <button
            ref={trigger}
            id={control}
            type="button"
            className={["ws-select-control", "ws-select-trigger", !value && "ws-select-control--empty"]
              .filter(Boolean)
              .join(" ")}
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-labelledby={`${label} ${control}-value`}
            aria-required={props.required || undefined}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            disabled={disabled}
            onClick={() => (open ? close(true) : openCalendar())}
            onKeyDown={(e) => {
              if (!open && e.altKey && e.key === "ArrowDown") {
                e.preventDefault();
                openCalendar();
              }
            }}
          >
            <Icon name="calendar" size={16} tone="muted" />
            <span id={`${control}-value`} className="ws-select-value">
              {value
                ? formatDate(locale, value)
                : (props.placeholder ?? t(props.required ? "select.placeholder" : "date.none"))}
              {value && value === today ? (
                <span className="ws-date-today">{t("date.todaySuffix")}</span>
              ) : null}
            </span>
            <span className="ws-select-chevron">
              <Icon name={open ? "chevron-up" : "chevron-down"} size={16} tone="muted" />
            </span>
          </button>
          {open ? (
            <div className="ws-dropdown-panel ws-calendar" role="dialog" aria-label={t("date.dialog")}>
              <div className="ws-calendar-head">
                <span id={`${base}-month`} className="ws-calendar-title" aria-live="polite">
                  {title}
                </span>
                <span className="ws-calendar-navs">
                  <button
                    type="button"
                    className="ws-calendar-nav"
                    aria-label={t("date.prevMonth")}
                    onClick={() => setFocusDay(addMonths(focusDay, -1))}
                  >
                    <Icon name="chevron-left" size={16} />
                  </button>
                  <button
                    type="button"
                    className="ws-calendar-nav"
                    aria-label={t("date.nextMonth")}
                    onClick={() => setFocusDay(addMonths(focusDay, 1))}
                  >
                    <Icon name="chevron-right" size={16} />
                  </button>
                </span>
              </div>
              <div ref={grid} role="grid" aria-labelledby={`${base}-month`} onKeyDown={onGridKey}>
                <div role="row" className="ws-calendar-row">
                  {weekdays.map((w) => (
                    <span key={w} role="columnheader" className="ws-calendar-weekday">
                      {w}
                    </span>
                  ))}
                </div>
                {weeksOf(month).map((week, w) => (
                  <div role="row" key={w} className="ws-calendar-row">
                    {week.map((day, d) =>
                      day === null ? (
                        <span key={d} role="gridcell" className="ws-calendar-blank" />
                      ) : (
                        <button
                          key={day}
                          type="button"
                          role="gridcell"
                          className="ws-calendar-day"
                          data-day={day}
                          data-today={day === today || undefined}
                          aria-selected={day === value}
                          aria-disabled={!allowed(day) || undefined}
                          aria-label={long.format(toUtc(day))}
                          tabIndex={day === focusDay ? 0 : -1}
                          onClick={() => choose(day)}
                        >
                          {Number(day.slice(8))}
                        </button>
                      ),
                    )}
                  </div>
                ))}
              </div>
              {chips?.length || clearable ? (
                <div className="ws-calendar-chips">
                  {(chips ?? []).map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      className="ws-calendar-chip"
                      aria-pressed={c.value === value}
                      onClick={() => choose(c.value)}
                    >
                      {c.label}
                    </button>
                  ))}
                  {clearable ? (
                    <button type="button" className="ws-calendar-chip" onClick={() => clear()}>
                      {t("date.none")}
                    </button>
                  ) : null}
                </div>
              ) : null}
              {limitNote ? <p className="ws-calendar-note">{limitNote}</p> : null}
            </div>
          ) : null}
        </div>
      )}
    </SelectFrame>
  );
}
