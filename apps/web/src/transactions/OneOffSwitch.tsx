import { useState } from "react";
import { useAuthApi } from "../auth/api.ts";
import type { Failure } from "../auth/failure.ts";
import { useT } from "@willowsum/i18n";
import { changeFailure } from "./api.ts";
import { saveOneOff, type TransactionDetail } from "./detail.ts";

/**
 * BUD-06@PoC FR 8, AC4: the switch «Одноразова витрата» in S-047 «Деталь транзакції» (`PUT …/one-off`). The page waits for
 * the server like the other changes of the details (no optimistic UI): the switch keeps the saved value and is disabled
 * while «Зберігаємо…» shows; the transaction the API answers with replaces the shown one. A refusal is said with its
 * reason (400 `oneOff: not_expense`, 409 `TRANSACTION_IN_TRANSFER`) and the support code.
 */
export function OneOffSwitch({
  transaction,
  onSaved,
}: {
  transaction: TransactionDetail;
  onSaved: (t: TransactionDetail) => void;
}) {
  const t = useT();
  const api = useAuthApi();
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);

  const change = async (next: boolean) => {
    if (saving) return;
    setSaving(true);
    setFailure(null);
    const o = await saveOneOff(api, transaction.id, next);
    setSaving(false);
    if (o.ok) return onSaved(o.data);
    if (o.kind === "problem" && o.problem.code === "TRANSACTION_IN_TRANSFER")
      return setFailure({ key: "txDetail.oneOff.error.transfer", code: o.supportId });
    if (
      o.kind === "problem" &&
      o.problem.code === "VALIDATION_FAILED" &&
      o.problem.errors?.some((e) => e.issue === "not_expense")
    )
      return setFailure({ key: "txDetail.oneOff.error.notExpense", code: o.supportId });
    setFailure(changeFailure(o));
  };

  return (
    <div className="txd-oneoff">
      <label className="ws-switch">
        <input
          type="checkbox"
          role="switch"
          checked={transaction.oneOff}
          disabled={saving}
          aria-describedby="txd-oneoff-hint"
          onChange={(e) => void change(e.target.checked)}
        />
        <span className="ws-switch-track" aria-hidden="true" />
        <span>{t("txDetail.oneOff.label")}</span>
      </label>
      <p id="txd-oneoff-hint" className="ws-muted">
        {t("txDetail.oneOff.hint")}
      </p>
      {saving ? (
        <p className="ws-muted" role="status">
          {t("tx.saving")}
        </p>
      ) : failure ? (
        <p role="alert">
          <strong className="txd-error-title">{t("field.error.word")}</strong> {t(failure.key)}
          {failure.code ? ` ${t("tx.error.code", { code: failure.code })}` : ""}
        </p>
      ) : null}
    </div>
  );
}
