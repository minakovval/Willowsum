import { useState } from "react";
import { useI18n } from "@willowsum/i18n";
import { Field, FilterBar, FilterChecks, FilterRow } from "@willowsum/ui";
import {
  activeCount,
  chipsOf,
  FILTER_FIELDS,
  isSet,
  MAX_CHOSEN,
  MERCHANT_MAX_LENGTH,
  normalizeAmount,
  rangeText,
  ROW_LABEL,
  rowSummary,
  STATE_LABEL,
  TX_STATES,
  without,
  type FilterField,
  type TxFilters,
  type TxState,
  type TxType,
} from "./filters.ts";
import type { FilterNames } from "./filters.ts";
import type { FilterChoice } from "./list.ts";

/** What the amount fields hold while the panel is open: the text as typed, checked on «Застосувати». */
interface Draft extends TxFilters {
  readonly amountFromText: string;
  readonly amountToText: string;
}

const draftOf = (f: TxFilters): Draft => ({ ...f, amountFromText: f.amountFrom, amountToText: f.amountTo });

/**
 * FIN-03@PoC FR 22, DAT-01@PoC FR 4 — «Фільтри · N» of S-046 on CMP-32 (canvas PocMoneyTxFilters): the rows Період,
 * Рахунки, Категорії, Тип, Сума, Стан, Теги, Мерчант; a change in the panel changes the draft only, «Застосувати» applies it,
 * «Скинути все» and a chip's «×» apply at once.
 */
export function TransactionFilters({
  filters,
  onChange,
  accounts,
  tags,
  categories,
  names,
}: {
  filters: TxFilters;
  onChange: (next: TxFilters) => void;
  accounts: readonly FilterChoice[];
  tags: readonly FilterChoice[];
  categories: readonly FilterChoice[];
  names: FilterNames;
}) {
  const { t, locale } = useI18n();
  const [draft, setDraft] = useState<Draft>(() => draftOf(filters));
  const [amountError, setAmountError] = useState(false);
  const open = () => {
    setDraft(draftOf(filters));
    setAmountError(false);
  };
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const apply = (): boolean => {
    const from = normalizeAmount(draft.amountFromText);
    const to = normalizeAmount(draft.amountToText);
    // An amount the server cannot take is never sent: the panel stays open and the field says why.
    if (from === null || to === null) {
      setAmountError(true);
      return false;
    }
    setAmountError(false);
    onChange({
      dateFrom: draft.dateFrom,
      dateTo: draft.dateTo,
      accounts: draft.accounts,
      categories: draft.categories,
      type: draft.type,
      amountFrom: from,
      amountTo: to,
      state: draft.state,
      tags: draft.tags,
      merchant: draft.merchant.trim(),
    });
    return true;
  };

  const summary = (field: FilterField) => rowSummary(t, locale, draft, field, names);
  const label = (field: FilterField) => t(ROW_LABEL[field]);
  const row = (field: FilterField) => ({
    label: label(field),
    summary: summary(field),
    unset: !isSet(draft, field),
  });
  // While typed, the amount row shows the text as entered (it is checked on «Застосувати»).
  const typed = { from: draft.amountFromText.trim(), to: draft.amountToText.trim() };
  const amountShown =
    typed.from !== "" || typed.to !== ""
      ? { label: label("amount"), summary: rangeText(t, typed.from, typed.to, (v) => v), unset: false }
      : { label: label("amount"), summary: t("tx.filter.any.amount"), unset: true };

  return (
    <FilterBar
      count={activeCount(filters)}
      chips={chipsOf(t, locale, filters, names)}
      onRemove={(id) => onChange(without(filters, id as FilterField))}
      onOpen={open}
      onApply={apply}
      onReset={() => {
        setAmountError(false);
        onChange(FILTER_FIELDS.reduce(without, filters));
      }}
    >
      <FilterRow {...row("period")} popup="dialog">
        <div className="ws-filter-range">
          <Field
            label={t("tx.filter.from")}
            type="date"
            value={draft.dateFrom}
            onChange={(v) => set({ dateFrom: v })}
          />
          <Field
            label={t("tx.filter.to")}
            type="date"
            value={draft.dateTo}
            onChange={(v) => set({ dateTo: v })}
          />
        </div>
      </FilterRow>
      <FilterRow {...row("accounts")}>
        <FilterChecks
          label={label("accounts")}
          options={accounts}
          value={draft.accounts}
          anyLabel={t("tx.filter.any.accountsOption")}
          onChange={(v) => set({ accounts: v.slice(0, MAX_CHOSEN) })}
        />
      </FilterRow>
      <FilterRow {...row("categories")}>
        <FilterChecks
          label={label("categories")}
          options={categories}
          value={draft.categories}
          onChange={(v) => set({ categories: v.slice(0, MAX_CHOSEN) })}
        />
      </FilterRow>
      <FilterRow {...row("type")}>
        <FilterChecks
          label={label("type")}
          multiple={false}
          anyLabel={t("tx.filter.any.type")}
          options={[
            { value: "out", label: t("tx.filter.type.out") },
            { value: "in", label: t("tx.filter.type.in") },
          ]}
          value={draft.type ? [draft.type] : []}
          onChange={(v) => set({ type: (v[0] as TxType | undefined) ?? null })}
        />
      </FilterRow>
      <FilterRow {...amountShown} popup="dialog">
        <div className="ws-filter-range">
          <Field
            label={t("tx.filter.from")}
            inputMode="decimal"
            value={draft.amountFromText}
            onChange={(v) => set({ amountFromText: v })}
            error={
              amountError && normalizeAmount(draft.amountFromText) === null
                ? t("tx.filter.amountError")
                : null
            }
          />
          <Field
            label={t("tx.filter.to")}
            inputMode="decimal"
            value={draft.amountToText}
            onChange={(v) => set({ amountToText: v })}
            error={
              amountError && normalizeAmount(draft.amountToText) === null ? t("tx.filter.amountError") : null
            }
          />
        </div>
      </FilterRow>
      <FilterRow {...row("state")}>
        <FilterChecks
          label={label("state")}
          multiple={false}
          anyLabel={t("tx.filter.any.state")}
          options={TX_STATES.map((s) => ({ value: s, label: t(STATE_LABEL[s]) }))}
          value={draft.state ? [draft.state] : []}
          onChange={(v) => set({ state: (v[0] as TxState | undefined) ?? null })}
        />
      </FilterRow>
      <FilterRow {...row("tags")}>
        <FilterChecks
          label={label("tags")}
          options={tags}
          value={draft.tags}
          onChange={(v) => set({ tags: v.slice(0, MAX_CHOSEN) })}
        />
      </FilterRow>
      <FilterRow {...row("merchant")} popup="dialog">
        <div className="ws-filter-range">
          <Field
            label={t("tx.filter.contains")}
            value={draft.merchant}
            maxLength={MERCHANT_MAX_LENGTH}
            onChange={(v) => set({ merchant: v })}
          />
        </div>
      </FilterRow>
    </FilterBar>
  );
}
