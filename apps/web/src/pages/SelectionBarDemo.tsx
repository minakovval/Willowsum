import { useState } from "react";
import { useT } from "@willowsum/i18n";
import { SelectionBar, type MenuItem } from "@willowsum/ui";

/**
 * CMP-73@PoC SelectionBar in the design-system gallery, on synthetic values: «Вибрано N · Сума», «Вибрати всі M за
 * фільтром» and back, the menu «Дії з вибраними» with the three actions of «Транзакції», «×»; and the background state.
 */
export function SelectionBarDemo() {
  const t = useT();
  const [all, setAll] = useState(false);
  const [shown, setShown] = useState(true);
  const actions: MenuItem[] = [
    { id: "category", label: t("bulk.action.setCategory"), icon: "tag", onSelect: () => undefined },
    { id: "tags", label: t("bulk.action.addTags"), icon: "tag", onSelect: () => undefined },
    { id: "confirm", label: t("bulk.action.confirmCategory"), icon: "check", onSelect: () => undefined },
  ];
  return (
    <div className="ws-card" data-case="selection-bar">
      {shown ? (
        <SelectionBar
          count={all ? 42 : 10}
          sum={{ amount: { value: all ? "2384.70" : "2935.26", currency: "EUR" } }}
          filterCount={42}
          allSelected={all}
          actions={actions}
          onSelectAll={() => setAll(true)}
          onSelectPage={() => setAll(false)}
          onClear={() => setShown(false)}
        />
      ) : null}
      <SelectionBar
        count={3}
        sum={{ amount: { value: "-52.30", currency: "EUR" }, updating: true }}
        actions={actions}
        busy
        onClear={() => undefined}
      />
    </div>
  );
}
