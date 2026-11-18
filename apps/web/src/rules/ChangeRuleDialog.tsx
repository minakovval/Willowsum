import { useI18n } from "@willowsum/i18n";
import { RuleDialog } from "./RuleDialog.tsx";
import { useRules } from "./api.ts";

const fold = (s: string) => s.normalize("NFC").toLocaleLowerCase("uk").trim();

/**
 * BUD-14@PoC FR 13: the pencil «Змінити правило» of S-047 opens the editor of the rule of the transaction's merchant
 * (a rule whose condition is «Мерчант = <мерчант>»); when there is none, a new rule with that merchant as its condition.
 * The rules are read when the pencil is pressed, not with the page.
 */
export function ChangeRuleDialog({ merchant, onClose }: { merchant: string; onClose: () => void }) {
  const { t } = useI18n();
  const { rules, refs } = useRules();
  if (rules.kind === "error" || rules.kind === "off")
    return (
      <p className="txd-error" role="alert">
        {t("rules.load.error")}
      </p>
    );
  if (rules.kind !== "ready" || refs.categories === null) return null;
  const existing = rules.data.find((r) =>
    r.conditions.some(
      (c) => c.field === "merchant" && c.operator === "equals" && fold(c.value) === fold(merchant),
    ),
  );
  return (
    <RuleDialog
      rule={existing ?? null}
      prefill={[{ field: "merchant", operator: "equals", value: merchant }]}
      refs={refs}
      onClose={onClose}
      onSaved={onClose}
    />
  );
}
