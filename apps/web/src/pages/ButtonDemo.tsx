import { useEffect, useState } from "react";
import { useI18n, type MessageKey } from "@willowsum/i18n";
import { Button, ButtonRow, type ButtonVariant, type IconName } from "@willowsum/ui";

/**
 * CMP-01@PoC Button in the design-system gallery, on synthetic labels: each variant at rest, with an icon,
 * disabled (with its reason) and loading; the sizes and icon-only buttons; a dialog-style row; and a live case
 * whose «Зберегти» stays busy for a moment and ignores a second press. Hover, pressed and focus are shown by
 * pointing at, pressing and tabbing to the buttons.
 */
const VARIANTS: readonly {
  variant: ButtonVariant;
  label: MessageKey;
  title: MessageKey;
  icon: IconName;
}[] = [
  { variant: "primary", label: "gallery.button.import", title: "gallery.button.primary", icon: "upload" },
  {
    variant: "secondary",
    label: "gallery.button.newTransaction",
    title: "gallery.button.secondary",
    icon: "transactions",
  },
  { variant: "quiet", label: "gallery.button.history", title: "gallery.button.quiet", icon: "list" },
  { variant: "danger", label: "gallery.button.deleteAccount", title: "gallery.button.danger", icon: "trash" },
];
const BUSY_MS = 2000;

export function ButtonDemo() {
  const { t } = useI18n();
  const [saving, setSaving] = useState(false);
  const [saves, setSaves] = useState(0);
  useEffect(() => {
    if (!saving) return;
    const id = window.setTimeout(() => setSaving(false), BUSY_MS);
    return () => window.clearTimeout(id);
  }, [saving]);

  return (
    <div className="gallery-button">
      <p className="ws-muted">{t("gallery.button.intro")}</p>
      <table className="gallery-button__states">
        <thead>
          <tr>
            <th scope="col">{t("gallery.button.variant")}</th>
            <th scope="col">{t("gallery.button.rest")}</th>
            <th scope="col">{t("gallery.button.withIcon")}</th>
            <th scope="col">{t("gallery.button.disabled")}</th>
            <th scope="col">{t("gallery.button.loading")}</th>
          </tr>
        </thead>
        <tbody>
          {VARIANTS.map(({ variant, label, title, icon }) => (
            <tr key={variant} data-case={`button-${variant}`}>
              <th scope="row" className="ws-text-label ws-muted">
                {t(title)}
              </th>
              <td>
                <Button variant={variant} label={t(label)} />
              </td>
              <td>
                <Button variant={variant} label={t(label)} icon={icon} />
              </td>
              <td>
                <div className="gallery-button__disabled">
                  <Button
                    variant={variant}
                    label={t(label)}
                    disabled
                    disabledReason={t("gallery.button.reason")}
                  />
                </div>
              </td>
              <td>
                <Button variant={variant} label={t(label)} loading />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="gallery-button__grid">
        <figure className="gallery-button__case" data-case="button-sizes">
          <figcaption className="ws-text-label ws-muted">{t("gallery.button.sizes")}</figcaption>
          <div className="gallery-button__row">
            <Button variant="primary" label={t("gallery.button.confirm")} icon="check" />
            <Button size="sm" label={t("gallery.button.no")} />
            <Button size="sm" label={t("gallery.button.credit")} />
            <Button size="sm" variant="quiet" label={t("gallery.button.history")} />
          </div>
        </figure>
        <figure className="gallery-button__case" data-case="button-icon-only">
          <figcaption className="ws-text-label ws-muted">{t("gallery.button.iconOnly")}</figcaption>
          <div className="gallery-button__row">
            <Button iconOnly icon="filter" label={t("gallery.button.filter")} />
            <Button iconOnly icon="edit" label={t("gallery.button.edit")} />
            <Button size="sm" iconOnly icon="close" label={t("gallery.button.close")} />
          </div>
        </figure>
        <figure className="gallery-button__case" data-case="button-row">
          <figcaption className="ws-text-label ws-muted">{t("gallery.button.dialogRow")}</figcaption>
          <div className="ws-card">
            <ButtonRow>
              <Button variant="quiet" label={t("gallery.button.cancel")} />
              <Button variant="danger" label={t("gallery.button.dontSave")} />
              <Button variant="primary" label={t("gallery.button.saveGoal")} />
            </ButtonRow>
          </div>
        </figure>
        <figure className="gallery-button__case" data-case="button-live">
          <figcaption className="ws-text-label ws-muted">{t("gallery.button.live")}</figcaption>
          <div className="gallery-button__row">
            <Button
              variant="primary"
              label={t("gallery.button.save")}
              loading={saving}
              onClick={() => {
                setSaving(true);
                setSaves((n) => n + 1);
              }}
            />
            <span className="ws-muted" data-saves={saves}>
              {t("gallery.button.saves", { count: String(saves) })}
            </span>
          </div>
        </figure>
      </div>
    </div>
  );
}
