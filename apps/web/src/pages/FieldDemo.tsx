import { useState } from "react";
import { useT } from "@willowsum/i18n";
import { AmountField, Field, Icon } from "@willowsum/ui";

/**
 * CMP-02@PoC Field in the design-system gallery, on synthetic values: empty with placeholder and hint, filled,
 * required with the 40-character counter, error, disabled with its reason, read-only, the search field, and the
 * amount variant (currency on the right, an abbreviated amount in a 120 px field, a rounded «≈» value and one to
 * type in: «12,345» shows the decimals error on leaving). Hover and focus are seen by pointing and tabbing.
 */
const NAME_MAX = 40;

export function FieldDemo() {
  const t = useT();
  const [name, setName] = useState(t("gallery.field.nameValue"));
  const [note, setNote] = useState("");
  const [search, setSearch] = useState("");
  const [amount, setAmount] = useState<string | null>(null);

  const cases = [
    {
      id: "empty",
      field: (
        <Field
          label={t("gallery.field.note")}
          value={note}
          onChange={setNote}
          placeholder={t("gallery.field.notePlaceholder")}
          hint={t("gallery.field.noteHint")}
        />
      ),
    },
    {
      id: "required",
      field: (
        <Field
          label={t("gallery.field.name")}
          value={name}
          onChange={setName}
          required
          maxLength={NAME_MAX}
          counter
        />
      ),
    },
    {
      id: "error",
      field: (
        <Field
          label={t("gallery.field.rate")}
          value={t("gallery.field.rateValue")}
          suffix={t("gallery.field.percent")}
          error={t("gallery.field.rateError")}
        />
      ),
    },
    {
      id: "disabled",
      field: (
        <Field
          label={t("gallery.field.currency")}
          value={t("gallery.field.currencyValue")}
          disabled
          hint={t("gallery.field.currencyReason")}
        />
      ),
    },
    {
      id: "readonly",
      field: <Field label={t("gallery.field.account")} value={t("gallery.field.accountValue")} readOnly />,
    },
    {
      id: "search",
      field: (
        <Field
          label={t("gallery.field.search")}
          type="search"
          size="search"
          value={search}
          onChange={setSearch}
          placeholder={t("gallery.field.searchPlaceholder")}
          prefix={<Icon name="search" size={16} />}
        />
      ),
    },
    {
      id: "amount",
      field: (
        <AmountField
          label={t("gallery.field.amount")}
          currency="EUR"
          value={amount}
          onChange={(v, problem) => {
            if (problem === null) setAmount(v);
          }}
          placeholder={t("gallery.field.amountPlaceholder")}
          hint={t("gallery.field.amountHint")}
        />
      ),
    },
    {
      id: "abbreviated",
      field: <AmountField label={t("gallery.field.balance")} currency="EUR" value="4512300000.00" />,
      narrow: true,
    },
    {
      id: "approx",
      field: <AmountField label={t("gallery.field.share")} currency="UAH" value="0.3333" />,
    },
  ] as const;

  return (
    <div className="gallery-field">
      <p className="ws-muted">{t("gallery.field.intro")}</p>
      <div className="gallery-field__grid">
        {cases.map((c) => (
          <figure key={c.id} className="gallery-field__case" data-case={`field-${c.id}`}>
            <figcaption className="ws-text-label ws-muted">{t(`gallery.field.case.${c.id}`)}</figcaption>
            <div className="ws-card">
              <div className={"narrow" in c ? "gallery-field__narrow" : undefined}>{c.field}</div>
            </div>
          </figure>
        ))}
      </div>
    </div>
  );
}
