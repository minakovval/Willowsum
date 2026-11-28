import { useEffect, useId, useRef, useState } from "react";
import {
  formatDate,
  formatMoney,
  useI18n,
  type Locale,
  type MessageKey,
  type Translate,
} from "@willowsum/i18n";
import { Badge, CategoryDisc, IconButton } from "@willowsum/ui";
import { categoryOf, conditionText, counted, type Condition, type Refs, type RuleBody } from "../api.ts";
import { conditionsOf, type GroupId, type Suggestion } from "./api.ts";

/** «Якщо Мерчант = Сільпо · сума > 40,00 €»: the conditions of a suggestion as the rules table reads them. */
export function conditionsText(
  t: Translate,
  locale: Locale,
  conditions: readonly Condition[],
  refs: Refs,
): string {
  const parts = conditions.map((c, i) => conditionText(t, locale, c, refs.accounts, i === 0));
  return t("rules.cond.if", { conditions: parts.join(" · ") });
}

/** One group of the page (FR 21): «Впевнені», «Суперечливі» or «Переказ», with «Вибрати всі в групі». */
export function Group({
  id,
  rows,
  isSelected,
  canSelect,
  onSelectAll,
  children,
}: {
  id: GroupId;
  rows: readonly Suggestion[];
  isSelected: (s: Suggestion) => boolean;
  canSelect: (s: Suggestion) => boolean;
  onSelectAll: (on: boolean) => void;
  children: React.ReactNode;
}) {
  const { t } = useI18n();
  const headingId = useId();
  const boxId = useId();
  const box = useRef<HTMLInputElement>(null);
  const selectable = rows.filter(canSelect);
  const picked = selectable.filter(isSelected).length;
  useEffect(() => {
    if (box.current) box.current.indeterminate = picked > 0 && picked < selectable.length;
  }, [picked, selectable.length]);
  return (
    <section className="ws-card sug-group" role="group" aria-labelledby={headingId} data-group={id}>
      <header className="sug-group-head">
        <input
          ref={box}
          id={boxId}
          type="checkbox"
          className="sug-check"
          checked={selectable.length > 0 && picked === selectable.length}
          disabled={selectable.length === 0}
          aria-describedby={headingId}
          onChange={(e) => onSelectAll(e.target.checked)}
        />
        <h2 id={headingId} className="sug-group-title">
          {t(`suggestions.group.${id}` as MessageKey, { count: rows.length })}
        </h2>
        <span className="sug-group-hint ws-muted">{t(`suggestions.group.${id}.hint` as MessageKey)}</span>
        <label htmlFor={boxId} className="sug-group-all ws-muted">
          {t("suggestions.group.all")}
        </label>
      </header>
      <ul className="sug-list">{children}</ul>
    </section>
  );
}

/**
 * One suggestion (BUD-21@PoC FR 21; canvas PocMoneySuggestions): its conditions, its category, how many file rows match
 * and how many of them agree, since when the habit changed, how many existing transactions fit, the tags, the conflict
 * with a rule of the space, the file rows as evidence and the exceptions, the checkbox, the pencil and «Відхилити».
 */
export function SuggestionRow({
  s,
  refs,
  checked,
  disabled,
  edited,
  busy,
  onToggle,
  onEdit,
  onReject,
}: {
  s: Suggestion;
  refs: Refs;
  checked: boolean;
  disabled: boolean;
  edited: RuleBody | undefined;
  busy: boolean;
  onToggle: (on: boolean) => void;
  onEdit: () => void;
  onReject: () => void;
}) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const panel = useId();
  const conditions = edited ? (edited.conditions as Condition[]) : conditionsOf(s);
  const text = conditionsText(t, locale, conditions, refs);
  const categoryId = edited?.categoryId ?? s.categoryId;
  const category = categoryOf(refs, categoryId);
  const tags = edited ? (edited.tags ?? []) : s.tags;
  const gone = s.categoryDeleted && !edited;
  return (
    <li className="sug-row" data-ordinal={s.ordinal}>
      <input
        type="checkbox"
        className="sug-check"
        aria-label={`${t("suggestions.row.select")}: ${text}`}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onToggle(e.target.checked)}
      />
      <div className="sug-main">
        <span className="sug-text">{text}</span>
        <span className="sug-counts ws-muted">
          {counted(t, locale, "suggestions.rows", s.matched)},{" "}
          {counted(t, locale, "suggestions.match", s.agreeing)} ·{" "}
          {t("suggestions.existing", { count: s.existing })}
        </span>
        {s.since ? (
          <span className="sug-since">{t("suggestions.since", { date: formatDate(locale, s.since) })}</span>
        ) : null}
        {s.conflict ? (
          <span className="sug-notes">
            <Badge tone="attention" label={t("suggestions.conflict", { number: s.conflict.position })} />
          </span>
        ) : null}
        {gone ? (
          <span className="sug-notes">
            <Badge tone="attention" label={t("suggestions.row.deleted")} />
          </span>
        ) : null}
        {tags.length > 0 ? (
          <span className="sug-notes">
            <Badge tone="info" label={t("suggestions.tag", { tag: tags.join(", ") })} />
          </span>
        ) : null}
      </div>
      <span className="sug-category">
        {category && !gone ? (
          <span className="rules-category-chip">
            <CategoryDisc color={category.color} icon={category.icon} iconTone={category.iconTone} />
            {category.name}
          </span>
        ) : (
          <span className="ws-muted">—</span>
        )}
      </span>
      <div className="sug-actions">
        <button
          type="button"
          className="rules-link"
          aria-expanded={open}
          aria-controls={panel}
          onClick={() => setOpen((v) => !v)}
        >
          {t(open ? "suggestions.evidence.hide" : "suggestions.evidence.show")}
        </button>
        <IconButton icon="edit" label={`${t("suggestions.edit")}: ${text}`} onClick={onEdit} />
        <button type="button" className="sug-reject" disabled={busy} onClick={onReject}>
          {t("suggestions.reject")}
          <span className="ws-visually-hidden">: {text}</span>
        </button>
      </div>
      {open ? <Evidence id={panel} s={s} refs={refs} /> : null}
    </li>
  );
}

/** FR 14, FR 21: the numbers of the file rows behind the suggestion and the rows with another category (the exceptions). */
function Evidence({ id, s, refs }: { id: string; s: Suggestion; refs: Refs }) {
  const { t, locale } = useI18n();
  const { items, count } = s.exceptions;
  return (
    <div id={id} className="sug-evidence">
      <p className="sug-rows">
        {t("suggestions.rows.list", { rows: s.evidence.rows.join(", ") })}
        {s.evidence.more ? ` ${t("suggestions.rows.more")}` : ""}
      </p>
      {count > 0 ? (
        <div className="sug-exceptions" role="group" aria-label={t("suggestions.exceptions", { count })}>
          <p>
            <strong>{t("suggestions.exceptions", { count })}</strong>{" "}
            <span className="ws-muted">{t("suggestions.exceptions.text")}</span>
          </p>
          <ul>
            {items.map((x) => (
              <li key={x.row}>
                <span>{formatDate(locale, x.date)}</span>
                <span className="sug-amount">
                  {x.currency ? formatMoney(locale, x.amount, x.currency, { signed: true }) : x.amount}
                </span>
                <span className="ws-muted">{t("suggestions.exceptions.row", { row: x.row })}</span>
                <span>{categoryOf(refs, x.categoryId)?.name ?? "—"}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
