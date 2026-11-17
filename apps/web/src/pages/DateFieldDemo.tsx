import { useState } from "react";
import { useT } from "@willowsum/i18n";
import { DateField } from "@willowsum/ui";

const TODAY = "2026-11-02";

/**
 * CMP-02@PoC «Тип «дата»» on synthetic values: today with the calendar, an empty required date with its error, a
 * disabled one with its reason.
 */
export function DateFieldDemo() {
  const t = useT();
  const [date, setDate] = useState(TODAY);
  return (
    <div className="gallery-select">
      <p className="ws-muted">{t("gallery.date.intro")}</p>
      <div className="gallery-select__grid">
        <DateField
          label={t("gallery.date.label")}
          required
          value={date}
          onChange={setDate}
          today={TODAY}
          max={TODAY}
          chips={[
            { label: t("gallery.date.today"), value: TODAY },
            { label: t("gallery.date.yesterday"), value: "2026-11-01" },
          ]}
          limitNote={t("gallery.date.limit")}
        />
        <DateField
          label={t("gallery.date.label")}
          required
          value=""
          onChange={() => undefined}
          today={TODAY}
          error={t("gallery.date.required")}
        />
        <DateField
          label={t("gallery.date.label")}
          value={TODAY}
          onChange={() => undefined}
          today={TODAY}
          disabled
          disabledReason={t("gallery.date.disabledReason")}
        />
      </div>
    </div>
  );
}
