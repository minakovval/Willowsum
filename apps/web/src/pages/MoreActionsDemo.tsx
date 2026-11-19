import { useT } from "@willowsum/i18n";
import { MoreActions, RowActions } from "@willowsum/ui";

/**
 * CMP-61@PoC AC10, AC11 in the design-system gallery: a single extra action is a named button, several are «…»;
 * the row of a table has the pencil (edit in place) and «…» at its end.
 */
export function MoreActionsDemo() {
  const t = useT();
  const duplicate = { id: "duplicate", label: t("gallery.moreActions.duplicate"), icon: "note" as const };
  const exportItem = { id: "export", label: t("gallery.moreActions.export"), icon: "download" as const };
  const remove = {
    id: "delete",
    label: t("gallery.moreActions.delete"),
    icon: "trash" as const,
    danger: true,
  };
  return (
    <div className="gallery-more-actions">
      <p className="ws-muted">{t("gallery.moreActions.intro")}</p>
      <figure data-case="one">
        <figcaption className="ws-text-label ws-muted">{t("gallery.moreActions.one")}</figcaption>
        <MoreActions items={[exportItem]} />
      </figure>
      <figure data-case="many">
        <figcaption className="ws-text-label ws-muted">{t("gallery.moreActions.many")}</figcaption>
        <MoreActions items={[duplicate, exportItem, remove]} />
      </figure>
      <figure data-case="row">
        <figcaption className="ws-text-label ws-muted">{t("gallery.moreActions.row")}</figcaption>
        <RowActions
          items={[duplicate, remove]}
          editLabel={t("gallery.moreActions.rowEdit")}
          onEdit={() => undefined}
        />
      </figure>
    </div>
  );
}
