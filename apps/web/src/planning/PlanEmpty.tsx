import { useId } from "react";
import { useT, type MessageKey } from "@willowsum/i18n";
import { Icon, type IconName } from "@willowsum/ui";

/**
 * GRID-04@PoC EC1, EC2: the empty state of a «Планування» page whose data is not there yet — the title and the
 * explanation of its canvas board (PocPlanBudgetEmpty, PocPlanGoalsEmpty). The actions of the boards («Створити за
 * моїми витратами», «Нова ціль») come with the screens that own them (BUD-02, BUD-05).
 */
const KEYS = {
  budget: { title: "planning.budget.empty.title", body: "planning.budget.empty.body" },
  goals: { title: "planning.goals.empty.title", body: "planning.goals.empty.body" },
} as const satisfies Record<string, { title: MessageKey; body: MessageKey }>;

export function PlanEmpty({ icon, page }: { icon: IconName; page: keyof typeof KEYS }) {
  const id = useId();
  const t = useT();
  return (
    <section className="app-empty" aria-labelledby={id}>
      <Icon name={icon} size={40} tone="muted" />
      <h2 id={id} className="ws-text-heading-3">
        {t(KEYS[page].title)}
      </h2>
      <p className="ws-muted">{t(KEYS[page].body)}</p>
    </section>
  );
}
