import { useT } from "@willowsum/i18n";
import { Button } from "../button/Button.tsx";
import { Icon } from "../icons/Icon.tsx";
import { IconButton } from "../icons/IconButton.tsx";
import { MenuButton, type MenuItem } from "./MenuButton.tsx";

/**
 * CMP-61@PoC AC11: the extra actions of an entity in its heading. One action that is not dangerous is a button with
 * its own name — never a «…» with one item; two or more, or a dangerous one, are the «…» button «Ще дії» with a menu.
 */
export function MoreActions({ items }: { items: readonly MenuItem[] }) {
  const [only] = items;
  if (only === undefined) return null;
  if (items.length === 1 && !only.danger) {
    return only.href !== undefined ? (
      <Button label={only.label} icon={only.icon} href={only.href} />
    ) : (
      <Button label={only.label} icon={only.icon} onClick={() => only.onSelect?.()} />
    );
  }
  return <MoreMenu items={items} />;
}

/**
 * CMP-61@PoC AC10: the actions at the end of a table row. The «…» button «Ще дії» at the end of the row opens every
 * action of the row; the pencil before it (when the row has one) only starts editing the value in place.
 */
export function RowActions({
  items,
  editLabel,
  onEdit,
}: {
  items: readonly MenuItem[];
  /** The pencil's name and tooltip («Редагувати суму»). */
  editLabel?: string | undefined;
  onEdit?: (() => void) | undefined;
}) {
  return (
    <span className="ws-row-actions">
      {onEdit && editLabel ? <IconButton icon="edit" label={editLabel} onClick={onEdit} /> : null}
      {items.length > 0 ? <MoreMenu items={items} /> : null}
    </span>
  );
}

function MoreMenu({ items }: { items: readonly MenuItem[] }) {
  const t = useT();
  return (
    <span className="ws-row-actions">
      <MenuButton
        menuLabel={t("menu.moreActions")}
        ariaLabel={t("menu.moreActions")}
        title={t("menu.moreActions")}
        placement="down"
        align="end"
        className="ws-icon-button"
        items={items}
      >
        <Icon name="more" size={20} inButton />
      </MenuButton>
    </span>
  );
}
