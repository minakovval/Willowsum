import { useT } from "@willowsum/i18n";
import { Icon } from "../icons/Icon.tsx";

/**
 * The state of one step (CMP-14@PoC «Стани»): the current one, a passed one («✓», can be pressed), one not opened yet
 * that can be reached, one that cannot be reached yet (`aria-disabled`), and a passed one that has an error again («!»).
 */
export type StepState = "current" | "done" | "available" | "unavailable" | "error";

export interface StepperStep {
  label: string;
  state: StepState;
}

export interface StepperProps {
  /** The accessible name of the list («Кроки форми»). */
  label: string;
  steps: readonly StepperStep[];
  /** A press on a step that can be pressed (passed, available, with an error); never for the current or unavailable one. */
  onSelect: (index: number) => void;
}

const NAME_KEY = {
  current: "stepper.step.current",
  available: "stepper.step",
  done: "stepper.step.done",
  unavailable: "stepper.step.unavailable",
  error: "stepper.step.error",
} as const;

/**
 * CMP-14@PoC Stepper, size `dialog`: «1 Основне · 2 … · 3 …» above a form with steps (CMP-21@PoC FR 7). The current step
 * is a pill on `tint-info` with its number on `brand` and `aria-current="step"`; a passed one has «✓» on `gain`; an
 * available one its number on `surface-300`; an unavailable one is grey (`disabled-ink` on `disabled-bg`) and does
 * nothing on a press or Enter; a passed one with an error has «!» on `tint-warning`. Each step reads its number, name
 * and state.
 */
export function Stepper({ label, steps, onSelect }: StepperProps) {
  const t = useT();
  return (
    <ol className="ws-stepper" aria-label={label}>
      {steps.map((step, index) => {
        const number = index + 1;
        const pressable = step.state !== "current" && step.state !== "unavailable";
        return (
          <li key={step.label} className="ws-stepper-item">
            {index > 0 ? <span className="ws-stepper-line" aria-hidden="true" /> : null}
            <button
              type="button"
              className="ws-stepper-step"
              data-state={step.state}
              aria-current={step.state === "current" ? "step" : undefined}
              aria-disabled={step.state === "unavailable" || undefined}
              tabIndex={pressable ? undefined : -1}
              aria-label={t(NAME_KEY[step.state], { number, step: step.label })}
              onClick={() => {
                if (pressable) onSelect(index);
              }}
            >
              <span className="ws-stepper-mark" aria-hidden="true">
                {step.state === "done" ? (
                  <Icon name="check" size={16} />
                ) : step.state === "error" ? (
                  t("stepper.errorMark")
                ) : (
                  number
                )}
              </span>
              <span className="ws-stepper-label">{step.label}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
