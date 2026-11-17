import { useEffect, useState } from "react";
import { formatDate, useI18n, type MessageKey } from "@willowsum/i18n";
import { Button, IconButton, Progress } from "@willowsum/ui";
import { outcome, useAuthApi } from "../auth/api.ts";
import { POLL_MS } from "../transactions/bulk.ts";
import { codeOf, type Run } from "./api.ts";

/** The text of each refusal of «Відмінити» (BUD-14 «Стани інтерфейсу», README «Правила категорій»). */
const UNDO_REFUSED: Readonly<Record<string, MessageKey>> = {
  RULE_RUN_UNDO_EXPIRED: "rules.run.expired",
  RULE_RUN_UNDONE: "rules.run.alreadyUndone",
  RULE_RUN_RUNNING: "rules.run.running",
};

/**
 * The result of «Застосувати до N наявних транзакцій, що підходять» (BUD-14@PoC FR 7, AC2, AC4–AC6): the first 500 are
 * processed at once, the rest in the background with «Оброблено X з N»; then what changed, «Пропущено: ручні зміни (N)»
 * and «Відмінити» for 7 days (only values the run changed and nothing changed since). A running run is read every
 * second; when it ends the table is read again (its «Застосовано: N»). Not a toast: it stays until closed.
 */
export function RunNotice({
  run,
  onChange,
  onReload,
  onDismiss,
}: {
  run: Run;
  onChange: (run: Run) => void;
  onReload: () => void;
  onDismiss: () => void;
}) {
  const { t, locale } = useI18n();
  const api = useAuthApi();
  const [refused, setRefused] = useState<MessageKey | null>(null);
  const [busy, setBusy] = useState(false);
  const active = run.status === "running" || run.status === "undoing";

  useEffect(() => {
    if (!active) return;
    let live = true;
    const timer = window.setInterval(() => {
      void outcome(api.GET("/v1/category-rule-runs/{runId}", { params: { path: { runId: run.id } } })).then(
        (o) => {
          if (!live || !o.ok) return;
          onChange(o.data);
          if (o.data.status !== "running" && o.data.status !== "undoing") onReload();
        },
      );
    }, POLL_MS);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [api, active, run.id, onChange, onReload]);

  const undo = async () => {
    if (busy) return;
    setBusy(true);
    setRefused(null);
    const o = await outcome(
      api.POST("/v1/category-rule-runs/{runId}/undo", { params: { path: { runId: run.id } }, body: {} }),
    );
    setBusy(false);
    if (o.ok) {
      onChange(o.data);
      onReload();
    } else setRefused(UNDO_REFUSED[codeOf(o) ?? ""] ?? "rules.run.error");
  };

  const until = run.undo.until ? formatDate(locale, run.undo.until.slice(0, 10)) : null;
  return (
    <section className="ws-card rules-run" role="status">
      <div className="rules-run-body">
        {active ? (
          <Progress
            label={t(run.status === "undoing" ? "rules.run.undoing" : "rules.run.progress", {
              done: run.processed,
              total: run.count,
            })}
            value={run.processed}
            max={run.count}
            state="running"
            text={
              run.status === "undoing"
                ? t("rules.run.undoing")
                : t("rules.run.progress", { done: run.processed, total: run.count })
            }
          />
        ) : run.status === "undone" ? (
          <p>{t("rules.run.undone", { restored: run.undo.restored, notRestored: run.undo.notRestored })}</p>
        ) : (
          <>
            <p>{t("rules.run.done", { changed: run.changed, count: run.count })}</p>
            {run.skipped.manual > 0 ? (
              <p>{t("rules.run.skipped.manual", { count: run.skipped.manual })}</p>
            ) : null}
            {run.skipped.unavailable > 0 ? (
              <p>{t("rules.run.skipped.unavailable", { count: run.skipped.unavailable })}</p>
            ) : null}
            {run.undo.available && until ? (
              <p className="ws-muted">{t("rules.run.undoUntil", { date: until })}</p>
            ) : null}
          </>
        )}
        {refused ? (
          <p className="rules-failure" role="alert">
            {t(refused)}
          </p>
        ) : null}
      </div>
      <div className="rules-run-actions">
        {run.status === "completed" && run.undo.available ? (
          <Button label={t("rules.run.undo")} loading={busy} onClick={() => void undo()} />
        ) : null}
        {!active ? <IconButton icon="close" label={t("rules.run.dismiss")} onClick={onDismiss} /> : null}
      </div>
    </section>
  );
}
