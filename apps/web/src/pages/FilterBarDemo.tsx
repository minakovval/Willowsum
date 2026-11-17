import { useState } from "react";
import { useT } from "@willowsum/i18n";
import { FilterBar, FilterChecks, FilterRow, type FilterChipItem } from "@willowsum/ui";

/**
 * CMP-32@PoC FilterBar in the design-system gallery, on synthetic values: «Фільтри · N» with the chips of the applied
 * filters, the panel with «Рахунки» (several values) and «Тип» (one value), «Скинути все» and «Застосувати».
 */
export function FilterBarDemo() {
  const t = useT();
  const accounts = [
    { value: "a1", label: t("gallery.filterBar.acc1") },
    { value: "a2", label: t("gallery.filterBar.acc2") },
    { value: "a3", label: t("gallery.filterBar.acc3") },
  ];
  const empty = { accounts: [] as string[], type: [] as string[] };
  const [applied, setApplied] = useState({ accounts: ["a1", "a3"], type: ["out"] });
  const [draft, setDraft] = useState(applied);
  const names = (ids: readonly string[]) =>
    ids.map((id) => accounts.find((a) => a.value === id)?.label ?? "").join(", ");
  const typeLabel = (v: string | undefined) =>
    v === "in" ? t("tx.filter.type.in") : v === "out" ? t("tx.filter.type.out") : t("tx.filter.any.type");
  const chips: FilterChipItem[] = [];
  if (applied.accounts.length > 0)
    chips.push({
      id: "accounts",
      field: t("tx.filter.accounts"),
      value: names(applied.accounts),
      text:
        applied.accounts.length === 1
          ? t("tx.filter.chip.account", { name: names(applied.accounts) })
          : t("tx.filter.chip.accounts", { count: applied.accounts.length }),
    });
  if (applied.type.length > 0) {
    const value = t(applied.type[0] === "in" ? "tx.filter.type.inChip" : "tx.filter.type.outChip");
    chips.push({ id: "type", field: t("tx.filter.type"), value, text: t("tx.filter.chip.type", { value }) });
  }
  return (
    <div className="ws-card gallery-filter-bar" data-case="filter-bar">
      <FilterBar
        count={chips.length}
        chips={chips}
        onOpen={() => setDraft(applied)}
        onRemove={(id) => setApplied((a) => ({ ...a, [id]: [] }))}
        onApply={() => setApplied(draft)}
        onReset={() => setApplied(empty)}
      >
        <FilterRow
          label={t("tx.filter.accounts")}
          summary={draft.accounts.length > 0 ? names(draft.accounts) : t("tx.filter.any.accounts")}
          unset={draft.accounts.length === 0}
        >
          <FilterChecks
            label={t("tx.filter.accounts")}
            options={accounts}
            value={draft.accounts}
            anyLabel={t("tx.filter.any.accountsOption")}
            onChange={(v) => setDraft((d) => ({ ...d, accounts: v }))}
          />
        </FilterRow>
        <FilterRow
          label={t("tx.filter.type")}
          summary={typeLabel(draft.type[0])}
          unset={draft.type.length === 0}
        >
          <FilterChecks
            label={t("tx.filter.type")}
            multiple={false}
            anyLabel={t("tx.filter.any.type")}
            options={[
              { value: "out", label: t("tx.filter.type.out") },
              { value: "in", label: t("tx.filter.type.in") },
            ]}
            value={draft.type}
            onChange={(v) => setDraft((d) => ({ ...d, type: v }))}
          />
        </FilterRow>
      </FilterBar>
    </div>
  );
}
