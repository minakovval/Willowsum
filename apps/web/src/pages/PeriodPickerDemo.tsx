import { useState } from "react";
import { useI18n, useT } from "@willowsum/i18n";
import { formatPeriodMonth, PeriodPicker, Segmented } from "@willowsum/ui";

/**
 * CMP-72@PoC PeriodPicker and CMP-12@PoC Segmented in the design-system gallery, on synthetic periods: a live picker,
 * one with «‹» inactive («Даних раніше немає»), one with «›» inactive, and the «З порівнянням / Рік: план і факт» switch.
 */
const MONTHS = ["2026-08", "2026-09", "2026-10", "2026-11"] as const;

function Picker({
  caseId,
  start,
  noPrev,
  noNext,
}: {
  caseId: string;
  start: string;
  noPrev?: boolean;
  noNext?: boolean;
}) {
  const { t, locale } = useI18n();
  const label = (m: string) => formatPeriodMonth(locale, m);
  const [type, setType] = useState("month");
  const [period, setPeriod] = useState(start);
  const at = MONTHS.indexOf(period as (typeof MONTHS)[number]);
  return (
    <div data-case={caseId}>
      <PeriodPicker
        typeLabel={t("planning.compare.picker.type")}
        typeName={(x) => t("planning.compare.picker.typeName", { type: x })}
        types={(["month", "quarter", "ytd", "year"] as const).map((id) => ({
          id,
          label: t(`planning.compare.type.${id}`),
        }))}
        type={type}
        onTypeChange={setType}
        periods={[...MONTHS].reverse().map((id) => ({ id, label: label(id) }))}
        period={period}
        periodLabel={label(period)}
        periodListLabel={t("planning.compare.picker.list")}
        prevLabel={t("planning.compare.picker.prev")}
        nextLabel={t("planning.compare.picker.next")}
        prevDisabled={noPrev ?? at === 0}
        prevHint={t("planning.compare.picker.noEarlier")}
        nextDisabled={noNext ?? at === MONTHS.length - 1}
        onPrev={() => setPeriod(MONTHS[Math.max(0, at - 1)]!)}
        onNext={() => setPeriod(MONTHS[Math.min(MONTHS.length - 1, at + 1)]!)}
        onPeriodChange={setPeriod}
        announce={(p) => t("planning.compare.picker.shown", { period: p })}
      />
    </div>
  );
}

export function PeriodPickerDemo() {
  const t = useT();
  const [view, setView] = useState("compare");
  return (
    <div className="gallery-period">
      <Picker caseId="live" start="2026-10" />
      <Picker caseId="first" start="2026-08" noPrev />
      <Picker caseId="latest" start="2026-11" noNext />
      <div data-case="segmented">
        <Segmented
          legend={t("planning.compare.view.group")}
          value={view}
          onChange={setView}
          options={[
            { value: "compare", label: t("planning.compare.view.compare") },
            { value: "year", label: t("planning.compare.view.year") },
          ]}
        />
      </div>
    </div>
  );
}
