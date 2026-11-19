import { useRef, useState } from "react";
import { formatMoney, useI18n } from "@willowsum/i18n";
import { AmountField, Button, DateField, Popover } from "@willowsum/ui";
import { outcome, useAuthApi } from "../../auth/api.ts";
import { afterContribution, type Goal } from "./model.ts";

/**
 * CMP-61@PoC FR 8, AC8, BUD-05@PoC FR 6 (canvas PocPlanGoalCardContribute): «Внести» opens a popover from its button
 * with «Сума» and «Дата» and the buttons «Скасувати» and «Додати внесок» (`role="dialog"`, no backdrop). A manual mark:
 * no money moves; a contribution over the target is allowed. The line under the fields shows the goal after it.
 */
export function ContributeButton({
  goal,
  today,
  quiet = false,
  onAdded,
}: {
  goal: Goal;
  today: string;
  /** An achieved goal: «Внести» is a quiet action (BUD-05 FR 13). */
  quiet?: boolean;
  onAdded: () => void;
}) {
  const { t, locale } = useI18n();
  const api = useAuthApi();
  const anchor = useRef<HTMLSpanElement>(null);
  const key = useRef<string>(crypto.randomUUID());
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState<string | null>(null);
  const [date, setDate] = useState(today);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const currency = goal.collected.currency;

  const close = () => {
    setOpen(false);
    setAmount(null);
    setTouched(false);
    setFailed(false);
    setDate(today);
  };
  const after = amount !== null ? afterContribution(goal, amount) : null;

  const submit = async () => {
    setTouched(true);
    if (amount === null || busy) return;
    setBusy(true);
    setFailed(false);
    const done = await outcome(
      api.POST("/v1/goals/{goalId}/contributions", {
        params: { path: { goalId: goal.id }, header: { "Idempotency-Key": key.current } },
        body: { amount: { amount, currency }, date },
      }),
    );
    setBusy(false);
    if (!done.ok) {
      setFailed(true);
      return;
    }
    key.current = crypto.randomUUID();
    close();
    onAdded();
  };

  return (
    <span className="ws-popover-host" ref={anchor}>
      <Button
        label={t("planning.goals.contribute")}
        // eslint-disable-next-line no-restricted-syntax -- «plus» is the icon name, not a plan
        icon="plus"
        variant={quiet ? "secondary" : "primary"}
        onClick={() => (open ? close() : setOpen(true))}
      />
      <Popover
        open={open}
        onClose={close}
        label={t("planning.goals.contribute.title", { name: goal.name })}
        anchor={anchor}
        align="start"
      >
        <form
          className="goal-contribute"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <AmountField
            label={t("planning.goals.contribute.amount")}
            required
            currency={currency}
            value={amount}
            hint={t("planning.goals.contribute.amountHint")}
            error={touched && amount === null ? t("newTx.required") : undefined}
            onChange={(value) => setAmount(value)}
          />
          <DateField
            label={t("planning.goals.contribute.date")}
            required
            value={date}
            today={today}
            onChange={setDate}
          />
          {after ? (
            <p className="ws-muted">
              {t("planning.goals.contribute.after", {
                collected: formatMoney(locale, after.collected.amount, after.collected.currency),
                target: formatMoney(locale, goal.target.amount, goal.target.currency),
                percent: after.percent,
              })}
            </p>
          ) : null}
          {failed ? <p role="alert">{t("planning.goals.contribute.error")}</p> : null}
          <div className="goal-contribute-actions">
            <Button label={t("planning.goals.contribute.cancel")} onClick={close} />
            <Button
              label={t("planning.goals.contribute.submit")}
              variant="primary"
              type="submit"
              loading={busy}
            />
          </div>
        </form>
      </Popover>
    </span>
  );
}
