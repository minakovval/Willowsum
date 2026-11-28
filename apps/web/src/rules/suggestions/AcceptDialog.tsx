import { useEffect, useState } from "react";
import { formatDate, useI18n, type MessageKey } from "@willowsum/i18n";
import { Button, Dialog, IconButton, Progress } from "@willowsum/ui";
import { outcome, useAuthApi } from "../../auth/api.ts";
import { POLL_MS } from "../../transactions/bulk.ts";
import { codeOf, counted, type Run } from "../api.ts";
import {
  acceptSelected,
  loadTagNames,
  matchSelected,
  type AcceptItem,
  type AcceptMatches,
  type Accepted,
} from "./api.ts";

/** What the page learns when the acceptance went through: the rules written, and the run of «Застосувати до наявних». */
export type Done = Pick<Accepted, "rules" | "transfers" | "run">;

type Count =
  | { readonly kind: "counting" }
  | { readonly kind: "ready"; readonly data: AcceptMatches }
  | { readonly kind: "error" };

/** The text of each refusal of the acceptance (server «Прийняття», rows 237; `LIMIT_REACHED` — BUD-14 FR 3). */
const REFUSED: Readonly<Record<string, MessageKey>> = {
  HISTORY_SUGGESTION_CATEGORY_DELETED: "suggestions.accept.categoryDeleted",
  HISTORY_SUGGESTIONS_CHANGED: "suggestions.accept.changed",
  RULE_RUN_RUNNING: "rules.run.running",
  LIMIT_REACHED: "rules.error.limit",
};

/**
 * S-302 «Прийняти правила» (BUD-21@PoC FR 20, FR 22, FR 16; canvas PocMoneySuggestionAccept and its «Тексти» board): how
 * many rules will be created and below which, the tags that will be created, the selected suggestions that conflict with
 * a rule, the «Переказ» rules, and the box «Застосувати до N наявних транзакцій, що підходять» (off by default). The N,
 * and how many existing transactions a «Переказ» rule leaves untouched (owner decision 2026-11-28), are the server's.
 */
export function AcceptDialog({
  derivationId,
  items,
  tags,
  conflicting,
  transferRules,
  onClose,
  onDone,
}: {
  derivationId: string;
  items: AcceptItem[];
  /** The tags of the selected suggestions (after the pencil's changes), as written. */
  tags: readonly string[];
  conflicting: number;
  transferRules: number;
  onClose: () => void;
  onDone: (done: Done) => void;
}) {
  const { t, locale } = useI18n();
  const api = useAuthApi();
  const [count, setCount] = useState<Count>({ kind: "counting" });
  const [newTags, setNewTags] = useState<readonly string[]>([]);
  const [apply, setApply] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void matchSelected(api, derivationId, items).then((o) => {
      if (live) setCount(o.ok ? { kind: "ready", data: o.data } : { kind: "error" });
    });
    void loadTagNames(api).then((known) => {
      if (!live) return;
      const seen = new Set<string>();
      const fresh: string[] = [];
      for (const tag of tags) {
        const key = tag.normalize("NFC").trim().toLocaleLowerCase("uk");
        if (key === "" || seen.has(key) || known?.has(key)) continue;
        seen.add(key);
        fresh.push(tag);
      }
      setNewTags(fresh);
    });
    return () => {
      live = false;
    };
    // The selection is fixed while the dialog is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, derivationId]);

  const matches = count.kind === "ready" ? count.data : null;
  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const o = await acceptSelected(api, derivationId, items, apply && (matches?.count ?? 0) > 0);
    setBusy(false);
    if (o.ok) return onDone(o.data);
    setError(t(REFUSED[codeOf(o) ?? ""] ?? "suggestions.accept.error", { limit: 500 }));
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={t("suggestions.accept.title")}
      align="start"
      closeLabel={t("shell.close")}
      busy={busy}
      error={error ?? undefined}
      actions={[
        { label: t("dialog.form.cancel"), variant: "secondary", onClick: onClose },
        {
          label: t("suggestions.accept.submit", { count: items.length }),
          variant: "primary",
          onClick: () => void submit(),
          disabled: items.length === 0,
          busyLabel: t("suggestions.accept.busy"),
        },
      ]}
    >
      <div className="sug-accept">
        <p>{t("suggestions.accept.text", { count: items.length })}</p>
        {newTags.length > 0 ? (
          <p className="sug-accept-note" data-tone="info">
            {t("suggestions.accept.tags", { tags: newTags.join(", ") })}
          </p>
        ) : null}
        {conflicting > 0 ? (
          <p className="sug-accept-note" data-tone="attention">
            {t("suggestions.accept.conflicting", { count: conflicting })}
          </p>
        ) : null}
        {transferRules > 0 ? (
          <p className="sug-accept-note" data-tone="info">
            {t("suggestions.accept.transfers", { count: transferRules })}
          </p>
        ) : null}
        <div aria-live="polite" className="sug-accept-live">
          {count.kind === "counting" ? (
            <p className="ws-muted">{t("rules.apply.counting")}</p>
          ) : count.kind === "error" ? (
            <p className="ws-muted">{t("rules.apply.failed")}</p>
          ) : (
            <>
              {count.data.count === 0 ? (
                <p className="ws-muted">{t("rules.apply.none")}</p>
              ) : (
                <>
                  <label className="sug-apply">
                    <input type="checkbox" checked={apply} onChange={(e) => setApply(e.target.checked)} />
                    <span>{counted(t, locale, "rules.apply", count.data.count)}</span>
                  </label>
                  <p className="ws-muted sug-apply-text">{t("suggestions.accept.apply.text")}</p>
                  <p className="ws-muted sug-apply-text">{t("suggestions.accept.apply.off")}</p>
                </>
              )}
              {count.data.transfers > 0 ? (
                <p className="sug-accept-note" data-tone="info">
                  {t("suggestions.accept.transfersSkipped", { count: count.data.transfers })}
                </p>
              ) : null}
            </>
          )}
        </div>
      </div>
    </Dialog>
  );
}

/** The calendar day of an instant in the user's time zone (the deadline of «Скасувати застосування»). */
const localDay = (iso: string): string => {
  const d = new Date(iso);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
};

const UNDO_REFUSED: Readonly<Record<string, MessageKey>> = {
  RULE_RUN_UNDO_EXPIRED: "rules.run.expired",
  RULE_RUN_UNDONE: "rules.run.alreadyUndone",
  RULE_RUN_RUNNING: "rules.run.running",
};

/**
 * What the acceptance did (AC24, AC25): «Створено правил: N. Категорії наявних транзакцій не змінено.», or the progress
 * of the run, then «Категорії отримали … пропущено через ручні зміни: …» (and how many a «Переказ» rule left untouched)
 * with «Скасувати застосування» for 7 days. Stays until closed; the run is read every second while it runs.
 */
export function AcceptNotice({
  done,
  onChange,
  onDismiss,
  onReload,
}: {
  done: Done;
  onChange: (done: Done) => void;
  onDismiss: () => void;
  onReload: () => void;
}) {
  const { t, locale } = useI18n();
  const api = useAuthApi();
  const [refused, setRefused] = useState<MessageKey | null>(null);
  const [busy, setBusy] = useState(false);
  const run: Run | null = done.run as Run | null;
  const active = run !== null && (run.status === "running" || run.status === "undoing");

  useEffect(() => {
    if (!run || !active) return;
    let live = true;
    const timer = window.setInterval(() => {
      void outcome(api.GET("/v1/category-rule-runs/{runId}", { params: { path: { runId: run.id } } })).then(
        (o) => {
          if (!live || !o.ok) return;
          onChange({ ...done, run: o.data });
          if (o.data.status !== "running" && o.data.status !== "undoing") onReload();
        },
      );
    }, POLL_MS);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [api, active, run, done, onChange, onReload]);

  const undo = async () => {
    if (!run || busy) return;
    setBusy(true);
    setRefused(null);
    const o = await outcome(
      api.POST("/v1/category-rule-runs/{runId}/undo", { params: { path: { runId: run.id } }, body: {} }),
    );
    setBusy(false);
    if (o.ok) {
      onChange({ ...done, run: o.data });
      onReload();
    } else setRefused(UNDO_REFUSED[codeOf(o) ?? ""] ?? "rules.run.error");
  };

  const created = done.rules.length;
  const until = run?.undo.until ? formatDate(locale, localDay(run.undo.until)) : null;
  return (
    <section className="ws-card sug-notice" role="status">
      <div className="sug-notice-body">
        {run && active ? (
          <Progress
            label={t("suggestions.accept.progress", { done: run.processed, total: run.count })}
            value={run.processed}
            max={Math.max(run.count, 1)}
            state="running"
            text={t("suggestions.accept.progress", { done: run.processed, total: run.count })}
          />
        ) : run && run.status === "undone" ? (
          <p>{t("rules.run.undone", { restored: run.undo.restored, notRestored: run.undo.notRestored })}</p>
        ) : run ? (
          <>
            <p>
              {t("suggestions.accept.doneApplied", {
                count: created,
                applied: run.changed,
                skipped: run.skipped.manual,
              })}
            </p>
            {done.transfers > 0 ? (
              <p>{t("suggestions.accept.doneTransfers", { transfers: done.transfers })}</p>
            ) : null}
            {run.undo.available && until ? (
              <p className="ws-muted">{t("suggestions.accept.undoUntil", { date: until })}</p>
            ) : null}
          </>
        ) : (
          <>
            <p>{t("suggestions.accept.done", { count: created })}</p>
            {done.transfers > 0 ? (
              <p>{t("suggestions.accept.doneTransfers", { transfers: done.transfers })}</p>
            ) : null}
          </>
        )}
        {refused ? (
          <p className="rules-failure" role="alert">
            {t(refused)}
          </p>
        ) : null}
      </div>
      <div className="sug-notice-actions">
        {run && run.status === "completed" && run.undo.available ? (
          <Button label={t("suggestions.accept.undo")} loading={busy} onClick={() => void undo()} />
        ) : null}
        {!active ? <IconButton icon="close" label={t("rules.run.dismiss")} onClick={onDismiss} /> : null}
      </div>
    </section>
  );
}
