import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { formatMoney, useI18n, useT } from "@willowsum/i18n";
import { Badge, Button, Icon } from "@willowsum/ui";
import { useAuthApi, type Outcome } from "../auth/api.ts";
import type { Failure } from "../auth/failure.ts";
import { changeFailure } from "./api.ts";
import { loadTagNames, saveAttributes, type TransactionDetail } from "./detail.ts";
import { monthName } from "./format.ts";

/**
 * BUD-13@PoC b) in S-047 «Деталь транзакції» (FR 1, FR 2, FR 5, FR 8; canvas PocMoneyTxDetail): the rows «Теги» and
 * «Нотатка» and, for a split transaction, «Розділення» with every part. Empty: «Додайте тег», «Додайте нотатку»;
 * saving: «Зберігаємо…»; 20 tags: «Досягнуто 20 тегів» (BUD-13@PoC «Стани інтерфейсу»).
 */
export const NOTE_MAX = 2000;
export const TAG_NAME_MAX = 60;
export const TAGS_MAX = 20;

const tagKey = (name: string) => name.normalize("NFC").trim().toLocaleLowerCase();

type Save = (body: { note?: string | null; tags?: string[] }) => Promise<boolean>;

/** One save at a time for both rows; the transaction it answers with replaces the shown one. */
export function useAttributeSave(transactionId: string, onSaved: (t: TransactionDetail) => void) {
  const api = useAuthApi();
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const save: Save = async (body) => {
    if (saving) return false;
    setSaving(true);
    setFailure(null);
    const o: Outcome<TransactionDetail> = await saveAttributes(api, transactionId, body);
    setSaving(false);
    if (!o.ok) {
      setFailure(changeFailure(o));
      return false;
    }
    onSaved(o.data);
    return true;
  };
  return { save, saving, failure };
}

export function AttributeRows({
  transaction,
  locked,
  onSaved,
}: {
  transaction: TransactionDetail;
  /** A merged duplicate or a closed account: the server keeps the attributes as they are, so no editing. */
  locked: boolean;
  onSaved: (t: TransactionDetail) => void;
}) {
  const t = useT();
  const { save, saving, failure } = useAttributeSave(transaction.id, onSaved);
  return (
    <>
      <TagsRow tags={transaction.tags} locked={locked} save={save} saving={saving} />
      <NoteRow note={transaction.note} locked={locked} save={save} saving={saving} />
      {saving ? (
        <p className="ws-muted txd-attr-status" role="status">
          {t("tx.saving")}
        </p>
      ) : failure ? (
        <p className="txd-attr-status" role="alert">
          <strong className="txd-error-title">{t("field.error.word")}</strong> {t(failure.key)}
          {failure.code ? ` ${t("tx.error.code", { code: failure.code })}` : ""}
        </p>
      ) : null}
    </>
  );
}

function TagsRow({
  tags,
  locked,
  save,
  saving,
}: {
  tags: TransactionDetail["tags"];
  locked: boolean;
  save: Save;
  saving: boolean;
}) {
  const t = useT();
  const api = useAuthApi();
  const listId = useId();
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const [known, setKnown] = useState<string[]>([]);
  const [limit, setLimit] = useState(false);
  const addRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const full = tags.length >= TAGS_MAX;

  useEffect(() => {
    if (!adding) return;
    inputRef.current?.focus();
    let live = true;
    void loadTagNames(api).then((names) => {
      if (live) setKnown(names);
    });
    return () => {
      live = false;
    };
  }, [adding, api]);

  const refocus = useRef(false);
  useEffect(() => {
    // The add button is back after the field closes; focus returns to it (DS-14).
    if (!adding && refocus.current) {
      refocus.current = false;
      addRef.current?.focus();
    }
  });
  const close = () => {
    refocus.current = true;
    setAdding(false);
    setText("");
  };

  const names = tags.map((x) => x.name);
  const add = async () => {
    const name = text.normalize("NFC").trim();
    if (name === "") return close();
    if (names.some((n) => tagKey(n) === tagKey(name))) return close();
    if (names.length >= TAGS_MAX) {
      setLimit(true);
      return;
    }
    if (await save({ tags: [...names, name] })) close();
  };
  const remove = async (name: string) => {
    setLimit(false);
    await save({ tags: names.filter((n) => n !== name) });
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void add();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };

  return (
    <div>
      <dt>{t("newTx.tags")}</dt>
      <dd>
        {tags.length > 0 ? (
          <ul className="txd-tags" aria-label={t("newTx.tags")}>
            {tags.map((tag) => (
              <li key={tag.id} className="txd-tag">
                <span aria-hidden="true">•</span>
                {tag.name}
                {locked ? null : (
                  <button
                    type="button"
                    className="txd-tag-remove"
                    aria-label={t("txDetail.tag.remove", { name: tag.name })}
                    title={t("txDetail.tag.remove", { name: tag.name })}
                    disabled={saving}
                    onClick={() => void remove(tag.name)}
                  >
                    <Icon name="close" size={16} inButton />
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : null}
        {locked ? null : full || limit ? (
          <span className="ws-muted" role={limit ? "alert" : undefined}>
            {t("txDetail.tag.limit", { count: TAGS_MAX })}
          </span>
        ) : adding ? (
          <span className="txd-inline-edit">
            <input
              ref={inputRef}
              className="txd-input"
              aria-label={t("txDetail.tag.new")}
              list={listId}
              value={text}
              maxLength={TAG_NAME_MAX}
              disabled={saving}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKeyDown}
            />
            <datalist id={listId}>
              {known
                .filter((n) => !names.some((x) => tagKey(x) === tagKey(n)))
                .map((n) => (
                  <option key={n} value={n} />
                ))}
            </datalist>
            <Button label={t("txDetail.save")} size="sm" variant="primary" onClick={() => void add()} />
            <Button label={t("newTx.cancel")} size="sm" variant="quiet" onClick={close} />
          </span>
        ) : (
          <button
            ref={addRef}
            type="button"
            className="txd-add"
            disabled={saving}
            onClick={() => setAdding(true)}
          >
            {t(tags.length === 0 ? "txDetail.tag.addFirst" : "txDetail.tag.add")}
          </button>
        )}
      </dd>
    </div>
  );
}

function NoteRow({
  note,
  locked,
  save,
  saving,
}: {
  note: string | null;
  locked: boolean;
  save: Save;
  saving: boolean;
}) {
  const t = useT();
  const labelId = useId();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(note ?? "");
  const openerRef = useRef<HTMLButtonElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing) areaRef.current?.focus();
  }, [editing]);

  const refocus = useRef(false);
  useEffect(() => {
    // «Додайте нотатку» or «Змінити нотатку» is back after the field closes; focus returns to it (DS-14).
    if (!editing && refocus.current) {
      refocus.current = false;
      openerRef.current?.focus();
    }
  });
  const close = () => {
    refocus.current = true;
    setEditing(false);
  };
  const submit = async () => {
    const next = text.trim() === "" ? null : text;
    if (next === note) return close();
    if (await save({ note: next })) close();
  };

  return (
    <div>
      <dt id={labelId}>{t("txDetail.note")}</dt>
      <dd>
        {editing ? (
          <span className="txd-note-edit">
            <textarea
              ref={areaRef}
              aria-labelledby={labelId}
              className="txd-input txd-textarea"
              value={text}
              maxLength={NOTE_MAX}
              rows={3}
              disabled={saving}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  setText(note ?? "");
                  close();
                }
              }}
            />
            <span className="txd-inline-edit">
              <Button label={t("txDetail.save")} size="sm" variant="primary" onClick={() => void submit()} />
              <Button
                label={t("newTx.cancel")}
                size="sm"
                variant="quiet"
                onClick={() => {
                  setText(note ?? "");
                  close();
                }}
              />
            </span>
          </span>
        ) : note ? (
          <>
            <span className="txd-note">{note}</span>
            {locked ? null : (
              <button
                ref={openerRef}
                type="button"
                className="txd-add"
                disabled={saving}
                onClick={() => {
                  setText(note);
                  setEditing(true);
                }}
              >
                {t("txDetail.note.edit")}
              </button>
            )}
          </>
        ) : locked ? null : (
          <button
            ref={openerRef}
            type="button"
            className="txd-add txd-add-muted"
            disabled={saving}
            onClick={() => {
              setText("");
              setEditing(true);
            }}
          >
            {t("txDetail.note.add")}
          </button>
        )}
      </dd>
    </div>
  );
}

/**
 * BUD-13@PoC FR 6, FR 8, EC4: «Розділення» — every part after saving: by categories «<категорія> · <сума>», over months
 * the full schedule «<місяць> · <сума>»; a split the bank's new amount no longer matches is «потребує перегляду».
 */
export function SplitRow({
  split,
  names,
}: {
  split: NonNullable<TransactionDetail["split"]>;
  names: ReadonlyMap<string, string>;
}) {
  const { t, locale } = useI18n();
  const category = (id: string) => names.get(id) ?? t("transactionRow.uncategorized");
  const months = split.mode === "months";
  return (
    <div>
      <dt>{t("txDetail.split")}</dt>
      <dd className="txd-split">
        {split.needsReview ? <Badge label={t("txDetail.split.review")} tone="attention" /> : null}
        {months && split.parts[0] ? (
          <span className="ws-muted">{category(split.parts[0].categoryId)}</span>
        ) : null}
        <ol className="txd-split-parts" aria-label={t("txDetail.split")}>
          {split.parts.map((p, i) => (
            <li key={`${p.categoryId}-${p.month ?? i}`}>
              <span>{months && p.month ? monthName(locale, p.month, true) : category(p.categoryId)}</span>
              <span className="txd-split-amount">
                {formatMoney(locale, p.amount.amount, p.amount.currency)}
              </span>
            </li>
          ))}
        </ol>
      </dd>
    </div>
  );
}
