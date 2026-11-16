import { useState } from "react";
import { Decimal } from "@willowsum/domain-kernel";
import { formatDate, formatMoney, useI18n } from "@willowsum/i18n";
import type { SplitCategory, Transaction, TransactionActions } from "../transactions/api.ts";
import { monthShares } from "../transactions/split.ts";
import { TransactionAttributes } from "../transactions/TransactionAttributes.tsx";

/**
 * Gallery (developer tool, synthetic values): the attributes of a transaction (S-047) and «Розділити транзакцію»
 * (S-049) of BUD-13@PoC b) until the details screen (wave 2 row 116) mounts them on the API. Saving stays on the page.
 */
const CATEGORIES: readonly SplitCategory[] = [
  { id: "c0000000-0000-4000-8000-000000000001", name: "Дім", kind: "expense" },
  { id: "c0000000-0000-4000-8000-000000000002", name: "Сад", kind: "expense" },
  { id: "c0000000-0000-4000-8000-000000000003", name: "Продукти", kind: "expense" },
  { id: "c0000000-0000-4000-8000-000000000004", name: "Страхування авто", kind: "expense" },
];

const TAGS = [
  { id: "a0000000-0000-4000-8000-000000000001", name: "ремонт-кухні", count: 12 },
  { id: "a0000000-0000-4000-8000-000000000002", name: "повернути", count: 3 },
];

const SAMPLE: Transaction = {
  id: "70000000-0000-4000-8000-000000000001",
  accountId: "9b0e7a6e-0000-4000-8000-000000000002",
  amount: { amount: "-240.00", currency: "EUR" },
  type: "expense",
  date: "2026-11-01",
  counterparty: "Leroy Merlin",
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
  recordedAt: "2026-11-01T10:00:00Z",
};

export function TransactionDemo() {
  const { locale } = useI18n();
  const [tx, setTx] = useState<Transaction>(SAMPLE);
  const total = new Decimal(tx.amount.amount);
  const actions: TransactionActions = {
    split: async (body) => {
      const parts =
        body.mode === "categories"
          ? body.parts.map((p) => ({
              categoryId: p.categoryId,
              month: null,
              amount: { amount: p.amount, currency: "EUR" },
            }))
          : (monthShares(total.abs(), "EUR", body.startMonth, body.months) ?? []).map((s) => ({
              categoryId: body.categoryId,
              month: s.month,
              amount: { amount: s.amount.neg().toFixed(), currency: "EUR" },
            }));
      return { ok: true, data: { ...tx, split: { mode: body.mode, needsReview: false, parts } } };
    },
    unsplit: async () => ({ ok: true, data: { ...tx, split: null } }),
    saveAttributes: async (body) => ({
      ok: true,
      data: {
        ...tx,
        note: body.note ?? null,
        tags: (body.tags ?? []).map((name) => ({ id: TAGS.find((x) => x.name === name)?.id ?? name, name })),
      },
    }),
  };
  const summary = [
    tx.counterparty,
    formatMoney(locale, tx.amount.amount, "EUR"),
    formatDate(locale, tx.date),
  ].join(" · ");
  return (
    <div className="ws-card gallery-transaction">
      <TransactionAttributes
        key={JSON.stringify(tx)}
        transaction={tx}
        summary={summary}
        spaceTags={TAGS}
        categories={CATEGORIES}
        merchant={tx.counterparty}
        actions={actions}
        onChange={setTx}
      />
    </div>
  );
}
