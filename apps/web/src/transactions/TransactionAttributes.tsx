import { useId, useRef, useState } from "react";
import { Decimal } from "@willowsum/domain-kernel";
import { formatMoney, useI18n } from "@willowsum/i18n";
import { Icon } from "@willowsum/ui";
import type { Failure } from "../auth/failure.ts";
import { TRANSACTIONS } from "../routing/routes.ts";
import { hrefFor } from "../routing/useHashPath.ts";
import {
  changeFailure,
  type SpaceTag,
  type SplitCategory,
  type Transaction,
  type TransactionActions,
} from "./api.ts";
import { counted, monthName } from "./format.ts";
import { SplitDialog } from "./SplitDialog.tsx";

/**
 * The attributes of a transaction in its details (S-047; BUD-13@PoC FR 1, FR 2, FR 5, FR 8, AC1; board
 * PocMoneyTxDetail): «Теги», «Нотатка», the split with «Об'єднати назад», and «Розділити» and «Схожі транзакції».
 * Edits stay here until «Зберегти»; the details screen (wave 2 row 116) mounts it with `transactionActions`.
 */
export const NOTE_MAX = 2000;
export const TAG_MAX = 60;
export const TAGS_MAX = 20;

export interface TransactionAttributesProps {
  readonly transaction: Transaction;
  /** «Епіцентр · −120,00 € · 1 лист. 2026 р. · Поточний ··4417» for the dialog. */
  readonly summary: string;
  /** The space's tags (suggestions of «+ Тег»). */
  readonly spaceTags: readonly SpaceTag[];
  readonly categories: readonly SplitCategory[];
  /** The merchant's name for «Схожі транзакції»; null — the button is not shown. */
  readonly merchant: string | null;
  readonly actions: TransactionActions;
  readonly onChange: (t: Transaction) => void;
}

const sameTag = (a: string, b: string) => a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();

export function TransactionAttributes({
  transaction,
  summary,
  spaceTags,
  categories,
  merchant,
  actions,
  onChange,
}: TransactionAttributesProps) {
  const { t, locale } = useI18n();
  const id = useId();
  const [note, setNote] = useState(transaction.note ?? "");
  const [tags, setTags] = useState<string[]>(transaction.tags.map((x) => x.name));
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [limit, setLimit] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [splitOpen, setSplitOpen] = useState(false);
  const tagInput = useRef<HTMLInputElement>(null);

  const dirty =
    note !== (transaction.note ?? "") ||
    tags.length !== transaction.tags.length ||
    tags.some((x, i) => x !== transaction.tags[i]?.name);
  const names = new Map(categories.map((c) => [c.id, c.name]));
  const { currency } = transaction.amount;
  const money = (v: string) => formatMoney(locale, v, currency);
  const transfer = transaction.transfer !== null;

  const addTag = () => {
    const name = draft.trim();
    if (name === "") return;
    if (tags.length >= TAGS_MAX) {
      setLimit(true);
      return;
    }
    if (!tags.some((x) => sameTag(x, name))) {
      // A name the space has keeps the space's spelling (FR 2: case-insensitive).
      setTags([...tags, spaceTags.find((s) => sameTag(s.name, name))?.name ?? name]);
    }
    setDraft("");
    tagInput.current?.focus();
  };
  const removeTag = (name: string) => {
    setTags(tags.filter((x) => x !== name));
    setLimit(false);
  };

  const run = async (call: () => ReturnType<TransactionActions["saveAttributes"]>) => {
    setSaving(true);
    setFailure(null);
    const o = await call();
    setSaving(false);
    if (o.ok) {
      onChange(o.data);
      setNote(o.data.note ?? "");
      setTags(o.data.tags.map((x) => x.name));
    } else setFailure(changeFailure(o));
  };
  const save = () => run(() => actions.saveAttributes({ note: note.trim() === "" ? null : note, tags }));

  const split = transaction.split;
  const free = spaceTags.filter((s) => !tags.some((x) => sameTag(x, s.name)));

  return (
    <div className="tx-attrs" aria-busy={saving || undefined}>
      <div className="tx-attr-row">
        <span className="tx-attr-label" id={`${id}-tags`}>
          {t("tx.tags")}
        </span>
        <div className="tx-attr-value">
          <ul className="tx-tags" aria-labelledby={`${id}-tags`}>
            {tags.map((name) => (
              <li key={name} className="tx-tag">
                <span aria-hidden="true">•</span>
                <span>{name}</span>
                <button
                  type="button"
                  className="tx-tag-remove"
                  aria-label={t("tx.tags.remove", { name })}
                  onClick={() => removeTag(name)}
                >
                  <Icon name="close" size={16} />
                </button>
              </li>
            ))}
          </ul>
          {tags.length === 0 && !adding ? <span className="tx-hint">{t("tx.tags.empty")}</span> : null}
          {adding ? (
            <span className="tx-tag-add">
              <input
                ref={tagInput}
                className="auth-input"
                aria-label={t("tx.tags.new")}
                list={`${id}-suggest`}
                maxLength={TAG_MAX}
                value={draft}
                disabled={limit}
                autoComplete="off"
                autoFocus
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addTag();
                  } else if (e.key === "Escape") setAdding(false);
                }}
              />
              <datalist id={`${id}-suggest`}>
                {free.map((s) => (
                  <option key={s.id} value={s.name} />
                ))}
              </datalist>
              {spaceTags.length === 0 ? <span className="tx-hint">{t("tx.tags.none")}</span> : null}
            </span>
          ) : (
            <button
              type="button"
              className="tx-link-button"
              onClick={() => (tags.length >= TAGS_MAX ? setLimit(true) : setAdding(true))}
            >
              {t("tx.tags.add")}
            </button>
          )}
          {limit ? (
            <p className="auth-field-error" role="alert">
              <Icon name="warning" size={16} />
              <span>
                <b>{t("recurring.form.error.word")}</b> {t("tx.tags.limit")}
              </span>
            </p>
          ) : null}
        </div>
      </div>

      <div className="tx-attr-row">
        <label className="tx-attr-label" htmlFor={`${id}-note`}>
          {t("tx.note")}
        </label>
        <div className="tx-attr-value">
          <textarea
            id={`${id}-note`}
            className="auth-input tx-note-input"
            placeholder={t("tx.note.empty")}
            maxLength={NOTE_MAX}
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
      </div>

      {split ? (
        <div className="tx-attr-row">
          <span className="tx-attr-label">{t("tx.split.label")}</span>
          <div className="tx-attr-value">
            <p>
              <span className="tx-badge">
                {split.mode === "months"
                  ? counted(t, locale, "tx.split.badge", split.parts.length)
                  : t("tx.split.badge.categories")}
              </span>
              {split.needsReview ? (
                <span className="tx-badge tx-badge-warn">{t("tx.split.needsReview")}</span>
              ) : null}
            </p>
            <ol className="tx-split-parts">
              {split.parts.map((p, i) => (
                <li key={`${p.categoryId}-${p.month ?? i}`} className="tx-schedule-row">
                  <span className="tx-schedule-index">{i + 1}</span>
                  <span className="tx-schedule-month">
                    {p.month ? `${monthName(locale, p.month, true)} · ` : ""}
                    {names.get(p.categoryId) ?? t("tx.split.unknownCategory")}
                  </span>
                  <span className="ws-amount">{money(new Decimal(p.amount.amount).toFixed())}</span>
                </li>
              ))}
            </ol>
            <button
              type="button"
              className="ws-button"
              aria-disabled={saving || undefined}
              onClick={() => (saving ? undefined : void run(actions.unsplit))}
            >
              {t("tx.split.unsplit")}
            </button>
          </div>
        </div>
      ) : null}

      {failure ? (
        <p className="auth-field-error" role="alert">
          <Icon name="warning" size={16} />
          <span>
            <b>{t("recurring.form.error.word")}</b> {t("tx.error.save")} {t(failure.key)}
            {failure.code ? ` ${t("recurring.error.code", { code: failure.code })}` : ""}
          </span>
        </p>
      ) : null}
      {saving ? (
        <p className="tx-hint" role="status">
          {t("tx.saving")}
        </p>
      ) : null}
      {dirty ? (
        <div className="app-page-actions">
          <button
            type="button"
            className="ws-button ws-button-primary"
            aria-disabled={saving || undefined}
            onClick={() => (saving ? undefined : void save())}
          >
            {t("tx.save")}
          </button>
        </div>
      ) : null}

      <div className="tx-attr-actions">
        <button
          type="button"
          className="ws-button"
          aria-disabled={transfer || undefined}
          aria-describedby={transfer ? `${id}-transfer` : undefined}
          onClick={() => (transfer ? undefined : setSplitOpen(true))}
        >
          {t("tx.split.open")}
        </button>
        {merchant ? (
          <a
            className="ws-button"
            href={`${hrefFor(TRANSACTIONS.path)}?merchant=${encodeURIComponent(merchant)}`}
          >
            <Icon name="search" size={16} />
            {t("tx.similar")}
          </a>
        ) : null}
      </div>
      {transfer ? (
        <p className="ws-disabled-reason" id={`${id}-transfer`}>
          {t("tx.split.noTransfer")}
        </p>
      ) : null}

      {splitOpen ? (
        <SplitDialog
          transaction={transaction}
          summary={summary}
          categories={categories}
          onSave={actions.split}
          onSaved={(x) => {
            setSplitOpen(false);
            onChange(x);
          }}
          onClose={() => setSplitOpen(false)}
        />
      ) : null}
    </div>
  );
}
