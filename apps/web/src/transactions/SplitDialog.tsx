import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Decimal } from "@willowsum/domain-kernel";
import { formatLocaleOf, formatMoney, useI18n, type MessageKey } from "@willowsum/i18n";
import { Icon } from "@willowsum/ui";
import type { Outcome } from "../auth/api.ts";
import type { Failure } from "../auth/failure.ts";
import { EXPRESSION_MAX_LENGTH, evaluate } from "./calc.ts";
import { changeFailure, type SplitBody, type SplitCategory, type Transaction } from "./api.ts";
import { counted, monthName } from "./format.ts";
import {
  fieldText,
  minorUnits,
  MONTHS_MAX,
  MONTHS_MIN,
  monthShares,
  PARTS_MAX,
  PARTS_MIN,
  roundParts,
  type MonthShare,
} from "./split.ts";

/**
 * S-049 «Розділити транзакцію» (BUD-13@PoC FR 6, FR 7, AC2, AC3, AC5, AC8; boards PocMoneySplit, PocMoneySplitMonths):
 * a modal dialog over the details (S-047). «За категоріями» — 2–20 parts with a calculator in each amount; «На кілька
 * місяців» — «Починаючи з», «Місяців» 2–60, «Категорія» and the compact schedule (no scroll, the same height for any N).
 */
export interface SplitDialogProps {
  readonly transaction: Transaction;
  /** «Епіцентр · −120,00 € · 1 лист. 2026 р. · Поточний ··4417»: the line under the title. */
  readonly summary: string;
  readonly categories: readonly SplitCategory[];
  readonly onSave: (body: SplitBody) => Promise<Outcome<Transaction>>;
  readonly onSaved: (t: Transaction) => void;
  readonly onClose: () => void;
}

type Mode = "categories" | "months";
interface Row {
  readonly key: number;
  readonly categoryId: string;
  readonly text: string;
  /** FR 6: the unrounded value of the expression last worked out in this field; null once the field is typed in. */
  readonly exact: Decimal | null;
}

function useDecimalComma(): boolean {
  const { locale } = useI18n();
  const parts = new Intl.NumberFormat(formatLocaleOf(locale)).formatToParts(1.5);
  return parts.find((p) => p.type === "decimal")?.value === ",";
}

export function SplitDialog({
  transaction,
  summary,
  categories,
  onSave,
  onSaved,
  onClose,
}: SplitDialogProps) {
  const { t, locale } = useI18n();
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const comma = useDecimalComma();
  const { currency } = transaction.amount;
  const total = new Decimal(transaction.amount.amount).abs();
  const negative = transaction.amount.amount.startsWith("-");
  const money = (v: Decimal) => formatMoney(locale, v.toFixed(), currency);
  const kind = negative ? "expense" : "income";
  const choices = categories.filter((c) => c.kind === kind);

  const existing = transaction.split;
  const [mode, setMode] = useState<Mode>(existing?.mode ?? "categories");
  const nextKey = useRef(2);
  const [rows, setRows] = useState<Row[]>(() =>
    existing?.mode === "categories"
      ? existing.parts.map((p, i) => ({
          key: i,
          categoryId: p.categoryId,
          text: fieldText(new Decimal(p.amount.amount).abs(), currency, comma),
          exact: null,
        }))
      : [
          { key: 0, categoryId: "", text: "", exact: null },
          { key: 1, categoryId: "", text: "", exact: null },
        ],
  );
  const [start, setStart] = useState(existing?.parts[0]?.month ?? transaction.date.slice(0, 7));
  const [monthsText, setMonthsText] = useState(
    existing?.mode === "months" ? String(existing.parts.length) : "12",
  );
  const [monthCategory, setMonthCategory] = useState(
    existing?.mode === "months" ? (existing.parts[0]?.categoryId ?? "") : "",
  );
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);

  // Focus goes into the dialog and back to the opener when it closes (DS-14; NFR-08). A layout effect: focus returns
  // in the same commit that removes the dialog, not in a later task where it would rest on `body` for a moment.
  useLayoutEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLElement>("input:checked")?.focus();
    return () => opener?.focus();
  }, []);

  const values = rows.map((r) => r.exact ?? evaluate(r.text, comma));
  const parts = roundParts(
    values.map((v) => v ?? new Decimal("0")),
    total,
    currency,
  );
  const allotted = parts.reduce((s, v) => s.plus(v), new Decimal("0"));
  const rest = total.minus(allotted);

  const months = /^\d{1,2}$/.test(monthsText.trim()) ? Number.parseInt(monthsText, 10) : NaN;
  const monthsOk = months >= MONTHS_MIN && months <= MONTHS_MAX;
  const shares = monthsOk && /^\d{4}-\d{2}$/.test(start) ? monthShares(total, currency, start, months) : null;

  let reason: MessageKey | null = null;
  let reasonParams: Record<string, string> | undefined;
  if (mode === "categories") {
    if (rows.some((r) => r.categoryId === "")) reason = "tx.split.reason.category";
    else if (values.some((v, i) => v === null || !parts[i]!.gt(0))) reason = "tx.split.reason.amount";
    else if (!rest.isZero()) {
      reason = "tx.split.reason.sum";
      reasonParams = { amount: money(total) };
    }
  } else if (!monthsOk) reason = "tx.split.reason.months";
  else if (!/^\d{4}-\d{2}$/.test(start)) reason = "tx.split.reason.start";
  else if (shares === null) reason = "tx.split.reason.tooSmall";
  else if (monthCategory === "") reason = "tx.split.reason.monthCategory";

  const signed = (v: Decimal) => (negative ? v.neg() : v).toFixed();
  const save = async () => {
    if (reason !== null || saving) return;
    const body: SplitBody =
      mode === "categories"
        ? { mode, parts: rows.map((r, i) => ({ categoryId: r.categoryId, amount: signed(parts[i]!) })) }
        : { mode, startMonth: start, months, categoryId: monthCategory };
    setSaving(true);
    setFailure(null);
    const o = await onSave(body);
    setSaving(false);
    if (o.ok) onSaved(o.data);
    else setFailure(changeFailure(o));
  };

  const setRow = (key: number, change: Partial<Row>) =>
    setRows((old) => old.map((r) => (r.key === key ? { ...r, ...change } : r)));
  // «=», Enter or leaving the field: the field shows its rounded amount, the exact value is kept, so the rounding
  // remainder of all parts goes to the first part (FR 6), whose field then shows it.
  const settle = (row: Row) => {
    const v = evaluate(row.text, comma);
    if (v === null) return;
    setRows((old) => {
      const next = old.map((r) => (r.key === row.key ? { ...r, exact: v.abs() } : r));
      const exact = next.map((r) => r.exact ?? evaluate(r.text, comma));
      const rounded = roundParts(
        exact.map((x) => x ?? new Decimal("0")),
        total,
        currency,
      );
      // Same rule as roundParts (half to even): compares the first part's own rounding with the adjusted one.
      const own0 = exact[0]?.toDecimalPlaces(minorUnits(currency), Decimal.ROUND_HALF_EVEN);
      return next.map((r, i) =>
        r.key === row.key || (i === 0 && own0 !== undefined && !own0.eq(rounded[0]!))
          ? { ...r, text: fieldText(rounded[i]!, currency, comma) }
          : r,
      );
    });
  };

  // Escape closes; Tab stays inside the dialog (aria-modal).
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab") return;
    const focusable = [
      ...(dialogRef.current?.querySelectorAll<HTMLElement>(
        "button, input, select, textarea, [href], [tabindex]:not([tabindex='-1'])",
      ) ?? []),
    ].filter(
      (el) =>
        !el.hasAttribute("disabled") &&
        !(el instanceof HTMLInputElement && el.type === "radio" && !el.checked),
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last?.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first?.focus();
    }
  };

  const options = (
    <>
      <option value="">{t("tx.split.categoryPick")}</option>
      {choices.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </>
  );

  return (
    <div className="tx-scrim">
      <div
        ref={dialogRef}
        className="tx-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
      >
        <button
          type="button"
          className="ws-icon-button tx-dialog-close"
          aria-label={t("tx.split.close")}
          onClick={onClose}
        >
          <Icon name="close" size={20} />
        </button>
        <div className="tx-dialog-body">
          <h2 id={titleId} className="tx-dialog-title">
            {t("tx.split.title")}
          </h2>
          <p className="tx-dialog-summary">{summary}</p>
          <p className="tx-dialog-explain">
            {t(mode === "categories" ? "tx.split.explain.categories" : "tx.split.explain.months")}
          </p>
          <fieldset className="tx-segmented">
            <legend className="ws-visually-hidden">{t("tx.split.how")}</legend>
            {(["categories", "months"] as const).map((m) => (
              <label key={m} className="tx-segment">
                <input
                  type="radio"
                  name={`${titleId}-mode`}
                  checked={mode === m}
                  onChange={() => setMode(m)}
                />
                <span>{t(m === "categories" ? "tx.split.mode.categories" : "tx.split.mode.months")}</span>
              </label>
            ))}
          </fieldset>

          {mode === "categories" ? (
            <>
              <ol className="tx-parts">
                {rows.map((row, i) => (
                  <li key={row.key} className="tx-part">
                    <span className="tx-part-index" aria-hidden="true">
                      {i + 1}
                    </span>
                    <select
                      className="auth-input tx-part-category"
                      aria-label={t("tx.split.part.category", { n: String(i + 1) })}
                      value={row.categoryId}
                      onChange={(e) => setRow(row.key, { categoryId: e.target.value })}
                    >
                      {options}
                    </select>
                    <span className="tx-part-amount">
                      <input
                        className="auth-input"
                        inputMode="decimal"
                        autoComplete="off"
                        aria-label={t("tx.split.part.amount", { n: String(i + 1) })}
                        aria-describedby={`${titleId}-calc`}
                        aria-invalid={(row.text !== "" && values[i] === null) || undefined}
                        maxLength={EXPRESSION_MAX_LENGTH}
                        value={row.text}
                        onChange={(e) => setRow(row.key, { text: e.target.value, exact: null })}
                        onBlur={() => settle(row)}
                        onKeyDown={(e) => {
                          if (e.key === "=" || e.key === "Enter") {
                            e.preventDefault();
                            settle(row);
                          }
                        }}
                      />
                      <span className="tx-part-currency" aria-hidden="true">
                        {currency}
                      </span>
                    </span>
                    <button
                      type="button"
                      className="ws-icon-button"
                      aria-label={t("tx.split.part.remove", { n: String(i + 1) })}
                      disabled={rows.length <= PARTS_MIN}
                      onClick={() => setRows((old) => old.filter((r) => r.key !== row.key))}
                    >
                      <Icon name="close" size={20} />
                    </button>
                  </li>
                ))}
              </ol>
              <p id={`${titleId}-calc`} className="tx-hint">
                {t("tx.split.calcHint")}
              </p>
              <button
                type="button"
                className="tx-link-button"
                disabled={rows.length >= PARTS_MAX}
                onClick={() =>
                  setRows((old) => [
                    ...old,
                    { key: nextKey.current++, categoryId: "", text: "", exact: null },
                  ])
                }
              >
                <Icon name="plus" size={16} />
                {t("tx.split.addPart")}
              </button>
              <Note done={rest.isZero()}>
                {rest.isZero() ? (
                  <>
                    <b>{t("tx.split.done", { amount: money(allotted), total: money(total) })}</b>{" "}
                    {t("tx.split.canSave")}
                  </>
                ) : (
                  <>
                    <b>
                      {rest.gt(0)
                        ? t("tx.split.left", { amount: money(rest) })
                        : t("tx.split.over", { amount: money(rest.abs()) })}
                    </b>{" "}
                    {t("tx.split.allotted", { amount: money(allotted), total: money(total) })}
                  </>
                )}
              </Note>
            </>
          ) : (
            <>
              <div className="tx-month-fields">
                <Field label={t("tx.split.start")} required>
                  {(id) => (
                    <input
                      id={id}
                      className="auth-input"
                      type="month"
                      value={start}
                      onChange={(e) => setStart(e.target.value)}
                      aria-required="true"
                    />
                  )}
                </Field>
                <Field label={t("tx.split.months")} required narrow>
                  {(id) => (
                    <input
                      id={id}
                      className="auth-input tx-num"
                      inputMode="numeric"
                      autoComplete="off"
                      value={monthsText}
                      onChange={(e) => setMonthsText(e.target.value)}
                      aria-required="true"
                      aria-invalid={!monthsOk || undefined}
                    />
                  )}
                </Field>
                <Field label={t("tx.split.category")}>
                  {(id) => (
                    <select
                      id={id}
                      className="auth-input"
                      value={monthCategory}
                      onChange={(e) => setMonthCategory(e.target.value)}
                    >
                      {options}
                    </select>
                  )}
                </Field>
              </div>
              <Schedule shares={shares} money={money} />
            </>
          )}

          {failure ? (
            <p className="auth-field-error" role="alert">
              <Icon name="warning" size={16} />
              <span>
                <b>{t("recurring.form.error.word")}</b> {t("tx.split.error")} {t(failure.key)}
                {failure.code ? ` ${t("recurring.error.code", { code: failure.code })}` : ""}
              </span>
            </p>
          ) : null}
        </div>
        <div className="tx-dialog-foot">
          {reason ? (
            <p className="ws-disabled-reason tx-reason" id={`${titleId}-reason`}>
              {t(reason, reasonParams)}
            </p>
          ) : null}
          <div className="tx-dialog-actions">
            <button type="button" className="ws-button" onClick={onClose}>
              {t("tx.split.cancel")}
            </button>
            <button
              type="button"
              className="ws-button ws-button-primary"
              aria-disabled={reason !== null || saving || undefined}
              aria-describedby={reason ? `${titleId}-reason` : undefined}
              onClick={() => void save()}
            >
              {saving ? t("tx.saving") : t("tx.split.save")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Note({ done, children }: { done: boolean; children: ReactNode }) {
  return (
    <div className={done ? "tx-note tx-note-done" : "tx-note"} role="status">
      <Icon name={done ? "check" : "info"} size={16} />
      <span>{children}</span>
    </div>
  );
}

function Field({
  label,
  required,
  narrow,
  children,
}: {
  label: string;
  required?: boolean;
  narrow?: boolean;
  children: (id: string) => ReactNode;
}) {
  const { t } = useI18n();
  const id = useId();
  return (
    <div className={narrow ? "auth-field tx-field-narrow" : "auth-field"}>
      <label className="auth-label" htmlFor={id}>
        {label}
        {required ? (
          <>
            <span className="auth-required" aria-hidden="true">
              {" *"}
            </span>
            <span className="ws-visually-hidden">{`, ${t("recurring.form.required")}`}</span>
          </>
        ) : null}
      </label>
      {children(id)}
    </div>
  );
}

/**
 * FR 6, AC8: the first two shares, one line «3–(N−1) · ще N−3 частин по X» and the last share with the rounding note;
 * the full schedule is in the details after saving. The block keeps the height of four lines for any N.
 */
function Schedule({
  shares,
  money,
}: {
  shares: readonly MonthShare[] | null;
  money: (v: Decimal) => string;
}) {
  const { t, locale } = useI18n();
  if (!shares) return <div className="tx-schedule tx-schedule-empty" />;
  const n = shares.length;
  const first = shares[0]!;
  const last = shares[n - 1]!;
  const period = `${monthName(locale, first.month)} – ${monthName(locale, last.month)}`;
  const line = (s: MonthShare, note?: string) => (
    <li key={s.index} className="tx-schedule-row">
      <span className="tx-schedule-index">{s.index}</span>
      <span className="tx-schedule-month">
        <span>{monthName(locale, s.month, true)}</span>
        {note ? <span className="tx-hint">{note}</span> : null}
      </span>
      <span className="ws-amount">{money(s.amount)}</span>
    </li>
  );
  return (
    <div className="tx-schedule">
      <p className="tx-schedule-head">
        <b>
          {t("tx.split.scheduleHead", {
            parts: counted(t, locale, "tx.split.parts", n),
            amount: money(first.amount),
          })}
        </b>
        <span className="tx-hint">{` · ${period}`}</span>
      </p>
      <ol className="tx-schedule-list">
        {shares.slice(0, Math.min(2, n - 1)).map((s) => line(s))}
        {n > 3 ? (
          <li className="tx-schedule-row tx-schedule-more">
            <span className="tx-schedule-index" aria-hidden="true">
              ⋯
            </span>
            <span className="tx-schedule-month">
              {t("tx.split.more", {
                range: n > 4 ? `3–${String(n - 1)}` : "3",
                parts: counted(t, locale, "tx.split.moreParts", n - 3),
                amount: money(first.amount),
              })}
            </span>
          </li>
        ) : null}
        {line(last, t("tx.split.lastNote"))}
      </ol>
    </div>
  );
}
