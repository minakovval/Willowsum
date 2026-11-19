import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useI18n } from "@willowsum/i18n";
import { currencyPlaces, displayAmount, editAmount } from "@willowsum/ui";
import type { Money } from "./model.ts";

/** An empty cell: no value for the row in this month (the board's «—»). */
export const NO_VALUE = "—";

/**
 * BUD-17@PoC FR 2 (S-126): one cell of the grid, edited in place — no «Зберегти»: leaving the cell (or Enter) saves
 * it, Escape gives the shown value back. The amount is a decimal string from the API to `onCommit` (the text the user
 * typed is read by the currency's rules, never turned into a number). Not being edited, the cell shows the amount in
 * the currency's digits; with the focus it shows every digit of the value to edit. A cell with no `onCommit` is read
 * only (a past month, a debt payment).
 */
export function PlanCellInput({
  amount,
  currency,
  label,
  pending,
  onCommit,
}: {
  amount: Money | null;
  currency: string;
  /** The accessible name: «Продукти, грудень». */
  label: string;
  /** The text being saved: the cell keeps showing what the user typed until the server answers. */
  pending?: string | undefined;
  onCommit?: ((text: string) => void) | undefined;
}) {
  const { locale } = useI18n();
  const places = currencyPlaces(currency);
  const [draft, setDraft] = useState<string | null>(null);
  const shown = amount === null ? NO_VALUE : displayAmount(locale, amount.amount, places).text;
  const readOnly = onCommit === undefined;
  const input = useRef<HTMLInputElement | null>(null);
  const cancelled = useRef(false);
  // The whole text is selected when the cell opens for editing (a number is typed over).
  const editing = draft !== null;
  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  const leave = () => {
    const text = draft;
    const skip = cancelled.current;
    cancelled.current = false;
    setDraft(null);
    if (!skip && text !== null) onCommit?.(text);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") e.currentTarget.blur();
    else if (e.key === "Escape") {
      cancelled.current = true;
      setDraft(null);
      e.currentTarget.blur();
    }
  };

  return (
    <input
      type="text"
      className="plan-cell"
      inputMode="decimal"
      autoComplete="off"
      aria-label={label}
      readOnly={readOnly}
      title={amount !== null ? shown : undefined}
      value={draft ?? pending ?? shown}
      ref={input}
      onFocus={() => {
        cancelled.current = false;
        if (!readOnly) setDraft(amount === null ? "" : editAmount(locale, amount.amount, places));
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={leave}
      onKeyDown={onKeyDown}
    />
  );
}
