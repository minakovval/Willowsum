import { useState } from "react";
import { formatDate, formatMoney, useI18n } from "@willowsum/i18n";
import type { SplitCategory, Transaction } from "../transactions/api.ts";
import { SplitDialog } from "../transactions/SplitDialog.tsx";

/**
 * Gallery (developer tool, synthetic values): «Розділити транзакцію» (S-049) of BUD-13@PoC b); in the app S-047 opens
 * it from «Розділити» with `splitAction`. Saving stays on the page.
 */
const CATEGORIES: readonly SplitCategory[] = [
  { id: "c0000000-0000-4000-8000-000000000001", name: "Дім", kind: "expense" },
  { id: "c0000000-0000-4000-8000-000000000002", name: "Сад", kind: "expense" },
  { id: "c0000000-0000-4000-8000-000000000003", name: "Продукти", kind: "expense" },
  { id: "c0000000-0000-4000-8000-000000000004", name: "Страхування авто", kind: "expense" },
];

const SAMPLE: Transaction = {
  id: "70000000-0000-4000-8000-000000000001",
  accountId: "9b0e7a6e-0000-4000-8000-000000000002",
  amount: { amount: "-120.00", currency: "EUR" },
  type: "expense",
  date: "2026-11-01",
  counterparty: "Епіцентр",
  description: null,
  status: "posted",
  source: "manual",
  hidden: false,
  split: null,
  transfer: null,
  mergedInto: null,
  mergedDuplicates: [],
  note: null,
  tags: [],
  oneOff: false,
  review: null,
  version: 1,
  recordedAt: "2026-11-01T10:00:00Z",
  bankDescription: null,
  balanceAfter: null,
  importedFrom: null,
  originalAmount: null,
  exchangeRate: null,
  valueDate: null,
  bankReference: null,
  bankFee: null,
};

export function TransactionDemo() {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const summary = [
    SAMPLE.counterparty,
    formatMoney(locale, SAMPLE.amount.amount, "EUR"),
    formatDate(locale, SAMPLE.date),
  ].join(" · ");
  return (
    <div className="ws-card gallery-transaction">
      <p>{summary}</p>
      <button type="button" className="ws-button" onClick={() => setOpen(true)}>
        {t("tx.split.open")}
      </button>
      {open ? (
        <SplitDialog
          transaction={SAMPLE}
          summary={summary}
          categories={CATEGORIES}
          onSave={async () => ({ ok: true, data: SAMPLE })}
          onSaved={() => setOpen(false)}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}
