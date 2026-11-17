import { formatNumber, useI18n, type MessageKey } from "@willowsum/i18n";
import { Icon } from "../icons/Icon.tsx";

/**
 * The state of one step (CMP-14@PoC «Стани», CMP-21@PoC «Індикатор кроків»): `current`; `done` — passed, opens
 * again; `available` — not opened yet but reachable; `unavailable` — an earlier step still has an empty or invalid
 * required field; `error` — a passed step whose required field became empty or invalid: «!» in `loss` on
 * `tint-negative` (DS-06 AC9: the warning colours never mark an error).
 */
export type StepState = "current" | "done" | "available" | "unavailable" | "error";

export interface StepperStep {
  label: string;
  state: StepState;
}

export interface StepperProps {
  steps: readonly StepperStep[];
  /** The list's accessible name; by default «Кроки форми». */
  label?: string | undefined;
  /** A press (or Enter / Space) on a `done`, `available` or `error` step. */
  onSelect: (index: number) => void;
}

const NAME: Record<StepState, MessageKey> = {
  current: "stepper.step.current",
  done: "stepper.step.done",
  available: "stepper.step",
  unavailable: "stepper.step.unavailable",
  error: "stepper.step.error",
};

/**
 * The step indicator in the `dialog` size, under the title of a form split into steps (CMP-21@PoC «Форма
 * створення…», п. 7–8; card Stepper): a row of 44 px pills joined by 10 × 1 px dashes, each a 20 px circle with
 * the number or a marker («✓», «!») and the step's name. An `ol` with an accessible name; the current step has
 * `aria-current="step"`; passed, available and error steps are buttons; an unavailable step is not pressable and has
 * `aria-disabled="true"`. The state is in the marker and in the accessible name («Крок 2: Залишок — заповнено»), not
 * in colour alone. The `page` size of the wizards is CMP-14 (wave 2 row 64).
 */
export function Stepper({ steps, label, onSelect }: StepperProps) {
  const { t, locale } = useI18n();
  return (
    <ol className="ws-stepper" data-size="dialog" aria-label={label ?? t("stepper.form")}>
      {steps.map((step, i) => {
        const number = formatNumber(locale, String(i + 1));
        const name = t(NAME[step.state], { number, step: step.label });
        const marker =
          step.state === "done" ? (
            <Icon name="check" size={16} />
          ) : step.state === "error" ? (
            t("stepper.marker.error")
          ) : (
            number
          );
        const body = (
          <>
            <span className="ws-stepper-mark" aria-hidden="true">
              {marker}
            </span>
            <span className="ws-stepper-label" aria-hidden="true">
              {step.label}
            </span>
            <span className="ws-visually-hidden">{name}</span>
          </>
        );
        const pressable = step.state === "done" || step.state === "available" || step.state === "error";
        return (
          <li key={i} className="ws-stepper-item">
            {i > 0 ? <span className="ws-stepper-dash" aria-hidden="true" /> : null}
            {step.state === "current" ? (
              <span className="ws-stepper-step" data-state="current" aria-current="step">
                {body}
              </span>
            ) : (
              <button
                type="button"
                className="ws-stepper-step"
                data-state={step.state}
                aria-disabled={pressable ? undefined : "true"}
                tabIndex={pressable ? undefined : -1}
                onClick={() => {
                  if (pressable) onSelect(i);
                }}
              >
                {body}
              </button>
            )}
          </li>
        );
      })}
    </ol>
  );
}
