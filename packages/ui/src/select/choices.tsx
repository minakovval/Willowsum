import type { ReactNode } from "react";
import { useT } from "@willowsum/i18n";
import { Icon, type IconName } from "../icons/Icon.tsx";
import { SearchSelect } from "./SearchSelect.tsx";
import type { FieldStateProps, SearchGroup } from "./listbox.tsx";

/** A category of the list: its name, the colour token of its circle (`chart-cat-1` …) and its icon. */
export interface CategoryChoice {
  value: string;
  label: string;
  /** A colour token name without `--ws-` (`chart-cat-3`); the circle is that colour. */
  color: string;
  icon: IconName;
}

/** A category chip: a coloured circle with the category icon, then the name (CMP-03 «Категорії»). */
export function CategoryDot({ color, icon }: { color: string; icon: IconName }) {
  return (
    <span className="ws-select-dot" style={{ backgroundColor: `var(--ws-${color})` }}>
      <Icon name={icon} size={16} />
    </span>
  );
}

export interface CategorySelectProps extends FieldStateProps {
  value: string;
  onChange: (value: string) => void;
  /** The merchant or payee of the transaction, when known: the first group is «Часто для «<merchant>»». */
  merchant?: string | undefined;
  /** The first group: the categories often used with the merchant, or the recent ones. */
  top: readonly CategoryChoice[];
  /** Then every category by its group. */
  groups: readonly { id: string; title: string; categories: readonly CategoryChoice[] }[];
  /** «Нова категорія», always the last item. */
  onCreate: (query: string) => void;
  id?: string;
}

/**
 * CMP-03@PoC «з пошуком» for categories: the first group is «Часто для «<мерчанта>»» when the merchant or payee is
 * known, otherwise «Нещодавні»; then every category by its group; «Нова категорія» always last. Each category is a
 * chip with its coloured circle.
 */
export function CategorySelect({ merchant, top, groups, onCreate, ...rest }: CategorySelectProps) {
  const t = useT();
  const option = (c: CategoryChoice) => ({
    value: c.value,
    label: c.label,
    leading: <CategoryDot color={c.color} icon={c.icon} />,
  });
  const all: SearchGroup[] = [
    {
      id: "top",
      title: merchant ? t("select.category.frequent", { merchant }) : t("select.category.recent"),
      options: top.map(option),
    },
    ...groups.map((g) => ({ id: g.id, title: g.title, options: g.categories.map(option) })),
  ];
  return (
    <SearchSelect
      {...rest}
      groups={all}
      searchLabel={t("select.category.search")}
      create={{ label: t("select.category.new"), onCreate }}
    />
  );
}

/** An account of the list: its name, the last four digits and one optional second line of one format. */
export interface AccountChoice {
  value: string;
  name: string;
  /** The last four digits of the number: the mask «··NNNN» is in every item and in the chosen value. */
  last4: string;
  /** The institution or the balance («залишок 5 200,00 €»): one format per list. */
  secondary?: string;
  /** The institution logo, 24 px. */
  logo?: ReactNode;
}

export interface AccountSelectProps extends FieldStateProps {
  accounts: readonly AccountChoice[];
  value: string;
  onChange: (value: string) => void;
  /** «Новий рахунок», when the list allows it. */
  onCreate?: (query: string) => void;
  id?: string;
}

/** CMP-03@PoC «з пошуком» for accounts: the logo, the name with the mask «··NNNN» («Поточний ··4417»). */
export function AccountSelect({ accounts, onCreate, ...rest }: AccountSelectProps) {
  const t = useT();
  const options = accounts.map((a) => ({
    value: a.value,
    label: t("select.account.masked", { name: a.name, last4: a.last4 }),
    ...(a.secondary ? { secondary: a.secondary } : {}),
    leading: a.logo ? <span className="ws-select-logo">{a.logo}</span> : undefined,
  }));
  return (
    <SearchSelect
      {...rest}
      groups={[{ id: "accounts", title: "", options }]}
      searchLabel={t("select.account.search")}
      {...(onCreate ? { create: { label: t("select.account.new"), onCreate } } : {})}
    />
  );
}
