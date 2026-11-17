import { useState } from "react";
import { useT } from "@willowsum/i18n";
import { Field, Icon, ListToolbar, MenuButton } from "@willowsum/ui";

/**
 * CMP-60@PoC Toolbar in the design-system gallery, on synthetic values: the search field without a shown label and
 * the icon button «Параметри» with its menu; ← and → move between them, the number of results is announced.
 */
export function ListToolbarDemo() {
  const t = useT();
  const [query, setQuery] = useState("");
  const [option, setOption] = useState(false);
  return (
    <div className="ws-card" data-case="toolbar">
      <ListToolbar
        label={t("tx.toolbar")}
        status={query ? t("gallery.toolbar.found") : undefined}
        end={
          <MenuButton
            menuLabel={t("tx.options")}
            ariaLabel={t("tx.options")}
            title={t("tx.options")}
            placement="down"
            align="end"
            className="ws-icon-button"
            items={[
              {
                id: "originals",
                label: t("tx.options.originalCurrencies"),
                icon: "money",
                checked: option,
                onSelect: () => setOption((v) => !v),
              },
            ]}
          >
            <Icon name="options" size={20} inButton />
          </MenuButton>
        }
      >
        <Field
          label={t("tx.search.label")}
          labelHidden
          type="search"
          size="search"
          value={query}
          onChange={setQuery}
          placeholder={t("tx.search.placeholder")}
          prefix={<Icon name="search" size={16} />}
        />
      </ListToolbar>
    </div>
  );
}
