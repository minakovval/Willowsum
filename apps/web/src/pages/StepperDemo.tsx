import { useState } from "react";
import { useT } from "@willowsum/i18n";
import { DateField, Stepper, type StepState } from "@willowsum/ui";

const TODAY = "2026-11-02";
const ROWS: readonly (readonly StepState[])[] = [
  ["current", "unavailable", "unavailable"],
  ["done", "current", "available"],
  ["attention", "current", "unavailable"],
];

/**
 * CMP-14@PoC Stepper (size `dialog`) in every state and CMP-02@PoC «Тип «дата»» on synthetic values: today with the
 * calendar, an empty required date with its error, a disabled one with its reason.
 */
export function StepperDemo() {
  const t = useT();
  const [step, setStep] = useState(0);
  const [date, setDate] = useState(TODAY);
  const names = [t("newTx.step.main"), t("newTx.step.party"), t("newTx.step.more")];
  return (
    <div className="gallery-select">
      <p className="ws-muted">{t("gallery.stepper.intro")}</p>
      {ROWS.map((states, i) => (
        <Stepper
          key={i}
          label={t("newTx.steps")}
          steps={states.map((state, n) => ({
            label: names[n]!,
            state: n === step && i === 1 ? "current" : state,
          }))}
          onSelect={setStep}
        />
      ))}
      <div className="gallery-select__grid">
        <DateField
          label={t("newTx.date")}
          required
          value={date}
          onChange={setDate}
          today={TODAY}
          max={TODAY}
          chips={[
            { label: t("newTx.date.today"), value: TODAY },
            { label: t("newTx.date.yesterday"), value: "2026-11-01" },
          ]}
          limitNote={t("newTx.date.limit")}
        />
        <DateField
          label={t("newTx.date")}
          required
          value=""
          onChange={() => undefined}
          today={TODAY}
          error={t("newTx.required")}
        />
        <DateField
          label={t("newTx.date")}
          value={TODAY}
          onChange={() => undefined}
          today={TODAY}
          disabled
          disabledReason={t("gallery.stepper.disabledReason")}
        />
      </div>
    </div>
  );
}
