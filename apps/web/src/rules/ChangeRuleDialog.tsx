import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@willowsum/i18n";
import { ErrorState, Skeleton } from "@willowsum/ui";
import { outcome, useAuthApi } from "../auth/api.ts";
import { RuleDialog } from "./RuleDialog.tsx";
import { useRules, type Condition, type Rule } from "./api.ts";

const fold = (s: string) => s.normalize("NFC").toLocaleLowerCase("uk").trim();

/** An enabled rule whose only condition is «Мерчант дорівнює <мерчант>» (the shape «Запам'ятати» and the pencil make). */
const isMerchantRule = (r: Rule, merchant: string) =>
  r.enabled &&
  r.conditions.length === 1 &&
  r.conditions.every(
    (c) => c.field === "merchant" && c.operator === "equals" && fold(c.value) === fold(merchant),
  );

type Merchant =
  { kind: "loading" } | { kind: "ready"; name: string | null } | { kind: "error"; supportId?: string };

/**
 * BUD-14@PoC FR 13: the pencil «Змінити правило» of S-047 opens the editor of the rule of the transaction's merchant
 * (an enabled rule whose only condition is «Мерчант = <мерчант>»); when there is none, a new rule with that merchant as
 * its condition. The merchant is the cleaned name the server matches the field «Мерчант» against
 * (`GET /v1/transactions/{id}/merchant`), not the raw counterparty; a transaction with no merchant gets a new rule with
 * no condition filled in. Both reads start when the pencil is pressed, not with the page.
 */
export function ChangeRuleDialog({ transactionId, onClose }: { transactionId: string; onClose: () => void }) {
  const { t } = useI18n();
  const api = useAuthApi();
  const { rules, refs, reload } = useRules();
  const [merchant, setMerchant] = useState<Merchant>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    void outcome(
      api.GET("/v1/transactions/{transactionId}/merchant", { params: { path: { transactionId } } }),
    ).then((o) => {
      if (!live) return;
      if (o.ok) setMerchant({ kind: "ready", name: o.data.merchant?.name ?? null });
      else
        setMerchant(
          o.kind === "problem" && o.supportId ? { kind: "error", supportId: o.supportId } : { kind: "error" },
        );
    });
    return () => {
      live = false;
    };
  }, [api, transactionId, attempt]);
  const retry = useCallback(() => {
    setMerchant({ kind: "loading" });
    setAttempt((n) => n + 1);
    reload();
  }, [reload]);

  if (rules.kind === "error" || rules.kind === "off" || merchant.kind === "error") {
    const supportId =
      merchant.kind === "error" ? merchant.supportId : rules.kind === "error" ? rules.supportId : undefined;
    return <ErrorState text={t("rules.load.error")} code={supportId} onRetry={retry} />;
  }
  if (rules.kind !== "ready" || merchant.kind !== "ready" || refs.categories === null)
    return (
      <div role="status" aria-busy="true" aria-label={t("rules.dialog.title")}>
        <Skeleton variant="row" lines={2} />
      </div>
    );
  const name = merchant.name;
  const existing = name === null ? undefined : rules.data.find((r) => isMerchantRule(r, name));
  const prefill: readonly Condition[] =
    name === null ? [] : [{ field: "merchant", operator: "equals", value: name }];
  return (
    <RuleDialog rule={existing ?? null} prefill={prefill} refs={refs} onClose={onClose} onSaved={onClose} />
  );
}
