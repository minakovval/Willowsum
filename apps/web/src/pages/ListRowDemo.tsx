import { useState, type ReactNode } from "react";
import { useI18n } from "@willowsum/i18n";
import { Icon, ListRow, type IconName } from "@willowsum/ui";

/**
 * CMP-27@PoC ListRow in the design-system gallery, on synthetic values: an account with a status and a change, a
 * debt (a real minus), a selectable row, an archived record, a long name and the loading skeleton. Hover, pressed
 * and focus are shown by pointing at, pressing and tabbing to the rows.
 */
const row = (cls: string, caption: string, children: ReactNode, narrow = false) => (
  <figure className="gallery-rows__case" data-case={`list-row-${cls}`} key={cls}>
    <figcaption className="ws-text-label ws-muted">{caption}</figcaption>
    <div className={`ws-card gallery-rows__list${narrow ? " gallery-rows__narrow" : ""}`}>{children}</div>
  </figure>
);

const leading = (name: IconName) => <Icon name={name} size={24} />;

export function ListRowDemo() {
  const { t } = useI18n();
  const [selected, setSelected] = useState(true);
  const [opened, setOpened] = useState("");
  const open = (name: string) => () => setOpened(name);
  return (
    <div className="gallery-rows">
      <p className="ws-muted">{t("gallery.listRow.intro")}</p>
      {row(
        "account",
        t("gallery.listRow.account"),
        <ListRow
          leading={leading("accounts")}
          title={t("gallery.listRow.accountName")}
          meta={t("gallery.listRow.accountMeta")}
          badge={{ label: t("gallery.listRow.active"), tone: "positive" }}
          amount={{ value: "11400.00", currency: "EUR" }}
          delta={{ percent: "12.4", period: "month" }}
          onOpen={open("account")}
        />,
      )}
      {row(
        "debt",
        t("gallery.listRow.debt"),
        <ListRow
          leading={leading("mortgage")}
          title={t("gallery.listRow.mortgage")}
          meta={t("gallery.listRow.mortgageMeta")}
          amount={{ value: "-180000.00", currency: "EUR" }}
          delta={{ percent: "-0.8" }}
          onOpen={open("debt")}
        />,
      )}
      {row(
        "selected",
        t("gallery.listRow.selected"),
        <ListRow
          leading={leading("card")}
          title={t("gallery.listRow.card")}
          meta={t("gallery.listRow.cardMeta")}
          amount={{ value: "-640.00", currency: "EUR" }}
          selected={selected}
          onSelectedChange={setSelected}
          onOpen={open("selected")}
        />,
      )}
      {row(
        "archived",
        t("gallery.listRow.archived"),
        <ListRow
          leading={leading("accounts")}
          title={t("gallery.listRow.savings")}
          meta={t("gallery.listRow.savingsMeta")}
          amount={{ value: "0.00", currency: "EUR" }}
          archived
          onOpen={open("archived")}
        />,
      )}
      {row(
        "long",
        t("gallery.listRow.long"),
        <ListRow
          leading={leading("accounts")}
          title={t("gallery.listRow.longName")}
          meta={t("gallery.listRow.longMeta")}
          badge={{ label: t("gallery.listRow.active"), tone: "positive" }}
          amount={{ value: "1234567890.55", currency: "UAH" }}
          onOpen={open("long")}
        />,
        true,
      )}
      {row("loading", t("gallery.listRow.loading"), <ListRow title="" loading />)}
      <p className="ws-muted" aria-live="polite" data-case="list-row-opened">
        {opened ? t("gallery.listRow.opened", { name: opened }) : ""}
      </p>
    </div>
  );
}
