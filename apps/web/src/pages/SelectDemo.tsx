import { useState } from "react";
import { useI18n } from "@willowsum/i18n";
import { AccountSelect, CategorySelect, ListButton, Select, type CategoryChoice } from "@willowsum/ui";

/**
 * CMP-03@PoC Select in the design-system gallery on synthetic values: the native list in every state (with a hint,
 * a long value cut, empty, error, disabled with its reason, loading), the «з пошуком» variant for categories and
 * accounts, and the «кнопка-список з підписом» buttons of a toolbar.
 */
export function SelectDemo() {
  const { t } = useI18n();
  const g = (key: string) => t(`gallery.select.${key}` as Parameters<typeof t>[0]);
  const currencies = [
    { value: "EUR", label: g("eur") },
    { value: "UAH", label: g("uah") },
    { value: "USD", label: g("usdLong") },
  ];
  const [currency, setCurrency] = useState("EUR");
  const [long, setLong] = useState("USD");
  const [empty, setEmpty] = useState("");
  const [category, setCategory] = useState("groceries");
  const [account, setAccount] = useState("current");
  const [filter, setFilter] = useState("all");
  const [base, setBase] = useState("avg3");
  const [view, setView] = useState("full");

  const cat = (value: string, n: number): CategoryChoice => ({
    value,
    label: g(`cat.${value}`),
    color: `chart-cat-${n}`,
    icon: "budget",
  });
  const food = [cat("groceries", 1), cat("cafe", 2), cat("delivery", 3)];
  const home = [cat("rent", 4), cat("utilities", 5), cat("repair", 6)];
  const transport = [cat("fuel", 7), cat("taxi", 8), cat("parking", 1)];
  const noop = () => undefined;

  return (
    <div className="gallery-select">
      <p className="ws-muted">{g("intro")}</p>
      <div className="gallery-select__grid">
        <figure data-case="default">
          <figcaption className="ws-text-label ws-muted">{g("default")}</figcaption>
          <Select
            label={g("currency")}
            options={currencies}
            value={currency}
            onChange={setCurrency}
            hint={g("hint")}
          />
        </figure>
        <figure data-case="long">
          <figcaption className="ws-text-label ws-muted">{g("long")}</figcaption>
          <Select label={g("currency")} options={currencies} value={long} onChange={setLong} />
        </figure>
        <figure data-case="empty">
          <figcaption className="ws-text-label ws-muted">{g("empty")}</figcaption>
          <Select label={g("currency")} options={currencies} value={empty} onChange={setEmpty} required />
        </figure>
        <figure data-case="error">
          <figcaption className="ws-text-label ws-muted">{g("error")}</figcaption>
          <Select
            label={g("currency")}
            options={currencies}
            value=""
            onChange={noop}
            required
            error={g("errorText")}
          />
        </figure>
        <figure data-case="disabled">
          <figcaption className="ws-text-label ws-muted">{g("disabled")}</figcaption>
          <Select
            label={g("bank")}
            options={[{ value: "bank", label: g("bankName") }]}
            value="bank"
            onChange={noop}
            disabled
            disabledReason={g("disabledReason")}
          />
        </figure>
        <figure data-case="loading">
          <figcaption className="ws-text-label ws-muted">{g("loading")}</figcaption>
          <Select label={g("currency")} options={[]} value="" onChange={noop} loading />
        </figure>
      </div>

      <div className="gallery-select__grid">
        <figure data-case="categories">
          <figcaption className="ws-text-label ws-muted">{g("categories")}</figcaption>
          <CategorySelect
            label={g("category")}
            value={category}
            onChange={setCategory}
            merchant={g("merchant")}
            top={[food[0]!]}
            groups={[
              { id: "food", title: g("group.food"), categories: food },
              { id: "home", title: g("group.home"), categories: home },
              { id: "transport", title: g("group.transport"), categories: transport },
            ]}
            onCreate={noop}
          />
        </figure>
        <figure data-case="accounts">
          <figcaption className="ws-text-label ws-muted">{g("accounts")}</figcaption>
          <AccountSelect
            label={g("account")}
            value={account}
            onChange={setAccount}
            accounts={[
              { value: "current", name: g("acc.current"), last4: "4417", secondary: g("acc.currentBalance") },
              { value: "credit", name: g("acc.credit"), last4: "9021", secondary: g("acc.creditBalance") },
              { value: "savings", name: g("acc.savings"), last4: "3308", secondary: g("acc.savingsBalance") },
            ]}
            onCreate={noop}
          />
        </figure>
      </div>

      <figure data-case="list-buttons">
        <figcaption className="ws-text-label ws-muted">{g("listButtons")}</figcaption>
        <div className="gallery-select__row">
          <ListButton
            label={g("category")}
            options={[
              { value: "all", label: g("all") },
              ...food.map((c) => ({ value: c.value, label: c.label })),
            ]}
            value={filter}
            onChange={setFilter}
          />
          <ListButton
            label={g("compare")}
            options={[
              { value: "prev", label: g("cmp.prev"), secondary: g("cmp.prevNote") },
              { value: "avg3", label: g("cmp.avg3"), secondary: g("cmp.avg3Note") },
              { value: "avg6", label: g("cmp.avg6"), secondary: g("cmp.avg6Note") },
            ]}
            value={base}
            onChange={setBase}
          />
          <ListButton
            label={g("view")}
            options={[
              { value: "full", label: g("viewFull") },
              { value: "short", label: g("viewShort") },
            ]}
            value={view}
            onChange={setView}
          />
        </div>
      </figure>
    </div>
  );
}
