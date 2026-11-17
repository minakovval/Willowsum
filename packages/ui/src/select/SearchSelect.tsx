import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useI18n } from "@willowsum/i18n";
import { Icon } from "../icons/Icon.tsx";
import {
  nextActive,
  pressHitArea,
  optionId,
  OptionRow,
  SelectFrame,
  useActiveInView,
  useOutsidePress,
  type FieldStateProps,
  type SearchGroup,
  type SearchOption,
} from "./listbox.tsx";

/** The creation item at the end of the list, when the list allows it (CMP-03 «Варіант «з пошуком»»). */
export interface SearchCreate {
  /** «Нова категорія», «+ Новий рахунок», or built from the search text («Додати «Кава» як нового контрагента»). */
  label: string | ((query: string) => string);
  onCreate: (query: string) => void;
}

export interface SearchSelectProps extends FieldStateProps {
  groups: readonly SearchGroup[];
  /** The chosen value; `""` — nothing chosen yet. */
  value: string;
  onChange: (value: string) => void;
  /** The text of the empty search field («Знайти категорію»); default «Пошук». */
  searchLabel?: string;
  create?: SearchCreate;
  /** What the chosen value shows before its name (the category chip, the institution logo). */
  showLeading?: boolean;
  /** The line of a search without a match, when the list has its own («Банк не знайдено…»); default «Нічого не знайдено». */
  nothingFound?: string;
  id?: string;
}

interface Row {
  option: SearchOption;
  index: number;
}

/**
 * CMP-03@PoC Select «з пошуком» for lists longer than 8 (accounts, categories, payees): the same 40 px control
 * opens a panel as wide as the field with a 36 px search field on top (the focus goes straight to it), groups with
 * 11 px headings, and the creation item last, after a divider. The search field is a `combobox` that controls the
 * `listbox`; ↑ ↓ move the active option (`aria-activedescendant`), Enter chooses, Esc closes; after a choice or Esc
 * the focus is back on the control.
 */
export function SearchSelect(props: SearchSelectProps) {
  const {
    groups,
    value,
    onChange,
    searchLabel,
    create,
    showLeading = true,
    nothingFound,
    id,
    placeholder,
    disabled,
  } = props;
  const { t, locale } = useI18n();
  const auto = useId();
  const base = id ?? `ws-search-select${auto}`;
  const listId = `${base}-list`;
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(-1);

  const chosen = useMemo(() => {
    for (const g of groups) for (const o of g.options) if (o.value === value) return o;
    return undefined;
  }, [groups, value]);

  // Case-insensitive substring of the name; groups without a match are left out.
  const needle = query.trim().toLocaleLowerCase(locale);
  const shown = useMemo(() => {
    let index = 0;
    const out: { group: SearchGroup; rows: Row[] }[] = [];
    for (const group of groups) {
      const rows = group.options
        .filter((o) => o.label.toLocaleLowerCase(locale).includes(needle))
        .map((option) => ({ option, index: index++ }));
      if (rows.length) out.push({ group, rows });
    }
    return { groups: out, count: index };
  }, [groups, needle, locale]);
  const enabled = [
    ...shown.groups.flatMap((g) => g.rows.map((r) => !r.option.disabled)),
    ...(create ? [true] : []),
  ];
  const createIndex = create ? shown.count : -1;

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    setQuery("");
    setActive(-1);
    if (refocus) trigger.current?.focus();
  }, []);
  const closeOutside = useCallback(() => close(false), [close]);
  useOutsidePress(open, root, closeOutside);
  useActiveInView(listId, active);
  useEffect(() => {
    if (open) search.current?.focus();
  }, [open]);

  const choose = (index: number) => {
    if (index === createIndex && create) {
      const text = query.trim();
      close(true);
      create.onCreate(text);
      return;
    }
    const row = shown.groups.flatMap((g) => g.rows).find((r) => r.index === index);
    if (!row || row.option.disabled) return;
    close(true);
    onChange(row.option.value);
  };

  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close(true);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (active >= 0) choose(active);
    } else if (e.key === "Tab") {
      close(false);
    } else {
      const next = nextActive(e.key, active, enabled, false);
      if (next !== null) {
        e.preventDefault();
        setActive(next);
      }
    }
  };

  const createLabel = create
    ? typeof create.label === "function"
      ? create.label(query.trim())
      : create.label
    : "";

  return (
    <SelectFrame base={base} props={props}>
      {({ control, label, describedBy, invalid }) => (
        <div className="ws-select-box" ref={root} onMouseDown={pressHitArea}>
          <button
            ref={trigger}
            id={control}
            type="button"
            className={["ws-select-control", "ws-select-trigger", !chosen && "ws-select-control--empty"]
              .filter(Boolean)
              .join(" ")}
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            aria-labelledby={`${label} ${control}-value`}
            aria-required={props.required || undefined}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            disabled={disabled}
            onClick={() => (open ? close(true) : setOpen(true))}
            onKeyDown={(e) => {
              if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
                e.preventDefault();
                setOpen(true);
              }
            }}
          >
            {chosen && showLeading ? chosen.leading : null}
            <span id={`${control}-value`} className="ws-select-value">
              {chosen ? chosen.label : (placeholder ?? t("select.placeholder"))}
            </span>
            <span className="ws-select-chevron">
              <Icon name={open ? "chevron-up" : "chevron-down"} size={16} tone="muted" />
            </span>
          </button>
          {open ? (
            <div className="ws-dropdown-panel">
              <span className="ws-select-search">
                <Icon name="search" size={16} tone="muted" />
                <input
                  ref={search}
                  type="text"
                  role="combobox"
                  aria-expanded="true"
                  aria-controls={listId}
                  aria-autocomplete="list"
                  aria-activedescendant={active >= 0 ? optionId(listId, active) : undefined}
                  aria-label={searchLabel ?? t("select.search")}
                  placeholder={searchLabel ?? t("select.search")}
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setActive(-1);
                  }}
                  onKeyDown={onSearchKey}
                />
              </span>
              {/* Always present, so the reader hears «Нічого не знайдено» when the text appears. */}
              <p className="ws-select-nothing" role="status">
                {shown.count === 0 ? (nothingFound ?? t("select.nothingFound")) : null}
              </p>
              <div id={listId} role="listbox" aria-labelledby={label} className="ws-select-list">
                {shown.groups.map(({ group, rows }) => (
                  <div
                    key={group.id}
                    role="group"
                    aria-labelledby={group.title ? `${listId}-g-${group.id}` : undefined}
                    className="ws-select-group"
                  >
                    {group.title ? (
                      <div
                        id={`${listId}-g-${group.id}`}
                        role="presentation"
                        className="ws-select-group-title"
                      >
                        {group.title}
                      </div>
                    ) : null}
                    {rows.map(({ option, index }) => (
                      <OptionRow
                        key={option.value}
                        id={optionId(listId, index)}
                        label={option.label}
                        secondary={option.secondary}
                        leading={option.leading}
                        selected={option.value === value}
                        active={index === active}
                        disabled={option.disabled}
                        onChoose={() => choose(index)}
                        onHover={() => setActive(index)}
                      />
                    ))}
                  </div>
                ))}
                {create ? (
                  <OptionRow
                    id={optionId(listId, createIndex)}
                    label={createLabel}
                    selected={false}
                    active={active === createIndex}
                    create
                    onChoose={() => choose(createIndex)}
                    onHover={() => setActive(createIndex)}
                  />
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </SelectFrame>
  );
}
