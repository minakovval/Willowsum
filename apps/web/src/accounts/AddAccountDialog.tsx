import { useT } from "@willowsum/i18n";
import { Badge, Dialog, Icon, type IconName } from "@willowsum/ui";
import { childPath, IMPORT_WIZARD_PATH } from "../routing/routes.ts";
import { hrefFor } from "../routing/useHashPath.ts";

interface Way {
  id: string;
  icon: IconName;
  href: string;
  title: "action.importStatement" | "accounts.addWay.manual";
  text: "accounts.addWay.import.text" | "accounts.addWay.manual.text";
  recommended: boolean;
}

/** FIN-01@PoC FR 24, AC16: the order is fixed — import first («Рекомендовано»), then by hand. No «Підключити банк». */
const WAYS: readonly Way[] = [
  {
    id: "import",
    icon: "upload",
    href: hrefFor(IMPORT_WIZARD_PATH),
    title: "action.importStatement",
    text: "accounts.addWay.import.text",
    recommended: true,
  },
  {
    id: "manual",
    icon: "edit",
    href: hrefFor(childPath("newAccount")),
    title: "accounts.addWay.manual",
    text: "accounts.addWay.manual.text",
    recommended: false,
  },
];

/**
 * S-051 «Додати рахунок · вибір способу» (FIN-01@PoC FR 24, AC16; canvas PocMoneyAddAcc, PocMoneyAddAccTexts): a
 * dialog with two ways as links — «Імпортувати виписку» opens the import wizard, «Додати вручну» the form «Новий
 * рахунок» (S-052) — and «Скасувати».
 */
export function AddAccountDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("accounts.add")}
      align="start"
      closeLabel={t("shell.close")}
      actions={[{ label: t("accounts.addWay.cancel"), onClick: onClose }]}
    >
      <ul className="accounts-ways">
        {WAYS.map((w) => (
          <li key={w.id}>
            <a className="accounts-way" href={w.href} onClick={onClose}>
              <span className="accounts-way-icon" aria-hidden="true">
                <Icon name={w.icon} size={20} />
              </span>
              <span className="accounts-stack">
                <span className="accounts-way-title">
                  <strong>{t(w.title)}</strong>
                  {w.recommended ? <Badge tone="info" label={t("accounts.addWay.recommended")} /> : null}
                </span>
                <span className="ws-muted accounts-small">{t(w.text)}</span>
              </span>
              <Icon name="chevron-right" size={20} />
            </a>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
