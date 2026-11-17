import { useState } from "react";
import { useI18n } from "@willowsum/i18n";
import { Button, Dialog, Icon, IconButton, Progress } from "@willowsum/ui";
import { outcome, useAuthApi } from "../auth/api.ts";
import { transactionPath } from "../routing/routes.ts";
import { hrefFor } from "../routing/useHashPath.ts";
import {
  actionOf,
  bulkFailure,
  issueText,
  plural,
  reasonsText,
  reasonText,
  setTracked,
  skippedCount,
  type BulkFailure,
  type BulkReport,
  type Tracked,
} from "./bulk.ts";
import { BulkError } from "./BulkDialog.tsx";

const REPORT = {
  setCategory: "bulk.report.setCategory",
  addTags: "bulk.report.addTags",
  confirmCategory: "bulk.report.confirmCategory",
} as const;
const PROGRESS = {
  setCategory: "bulk.progress.setCategory",
  addTags: "bulk.progress.addTags",
  confirmCategory: "bulk.progress.confirmCategory",
} as const;

/**
 * The strip above the list (DAT-03@PoC FR 6, 8–10; canvas PocBulkProgress, PocBulkReport): «Оброблено X з N» while the
 * action runs; then the report — changed and skipped with reasons, «Деталі», «Відмінити» with the time left of the
 * 24-hour window (inactive after it, AC4); «Перервано» with «Продовжити»; after «Відмінити» — restored and «не
 * відновлено». `now` — the clock of the time left. `onChanged` — the records changed (the list reads its page again).
 */
export function BulkBanner({
  tracked,
  failed,
  reload,
  now,
  onChanged,
}: {
  tracked: Tracked;
  failed: { code?: string | undefined } | null;
  reload: () => void;
  now: () => number;
  onChanged: () => void;
}) {
  const { t, locale } = useI18n();
  const api = useAuthApi();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<BulkFailure | null>(null);
  const [details, setDetails] = useState(false);
  const report = tracked.report;
  if (failed)
    return (
      <div className="bulk-banner" role="alert">
        <BulkError failure={{ kind: "failed", code: failed.code }} onRetry={reload} />
      </div>
    );
  if (report === null) return null;
  const action = actionOf(report.action) ?? "setCategory";
  const close = () => setTracked(null);
  const act = (path: "undo" | "resume") => {
    setBusy(true);
    setFailure(null);
    const params = { params: { path: { actionId: report.id } } };
    void outcome(
      path === "undo"
        ? api.POST("/v1/bulk-actions/{actionId}/undo", params)
        : api.POST("/v1/bulk-actions/{actionId}/resume", params),
    ).then((o) => {
      setBusy(false);
      if (!o.ok) {
        setFailure(bulkFailure(o));
        return;
      }
      setTracked({ id: report.id, report: o.data });
      if (o.data.status !== "running") onChanged();
    });
  };

  if (report.status === "running") {
    const title = tracked.label
      ? t("bulk.progress.setCategoryTo", { name: tracked.label })
      : t(PROGRESS[action]);
    return (
      <div className="bulk-banner bulk-banner-progress" role="status" aria-label={t("bulk.progress.label")}>
        <div className="bulk-banner-line">
          <strong>{action === "setCategory" ? title : t(PROGRESS[action])}</strong>
          <span className="ws-muted ws-tabular">
            {t("bulk.progress.count", { processed: report.processed, count: report.count })}
          </span>
          <span className="ws-muted bulk-banner-end">{t("bulk.progress.keepWorking")}</span>
        </div>
        <Progress value={report.processed} max={report.count} label={t("bulk.progress.label")} />
      </div>
    );
  }

  const skipped = skippedCount(report.skipped);
  const target = plural(t, locale, "bulk.tx", report.count);
  let title: string;
  let body: string[] = [];
  if (report.status === "undone") {
    title = t("bulk.report.undone", { restored: report.undo.restored, notRestored: report.undo.notRestored });
  } else if (report.status === "interrupted") {
    title = t("bulk.report.interrupted");
    body = [t("bulk.progress.count", { processed: report.processed, count: report.count })];
  } else {
    title = t(REPORT[action], { changed: report.changed, target });
    if (skipped > 0)
      body.push(t("bulk.report.skipped", { count: skipped, reasons: reasonsText(t, report.skipped) }));
  }
  const left = report.undo.until ? Date.parse(report.undo.until) - now() : 0;
  const canUndo = report.status !== "undone" && report.undo.available && left > 0;
  if (canUndo) {
    const minutes = Math.floor(left / 60_000);
    body.push(t("bulk.report.undoLeft", { hours: Math.floor(minutes / 60), minutes: minutes % 60 }));
  }

  return (
    <div className="bulk-banner" role="status">
      <Icon name={report.status === "interrupted" ? "warning" : "check"} size={20} />
      <div className="bulk-banner-text">
        <strong>{title}</strong>
        {body.length ? <span className="ws-muted">{body.join(" ")}</span> : null}
        {failure ? <BulkError failure={failure} /> : null}
      </div>
      <div className="bulk-banner-actions">
        {report.skippedRecords.length > 0 ? (
          <Button size="sm" label={t("bulk.report.details")} onClick={() => setDetails(true)} />
        ) : null}
        {report.status === "interrupted" ? (
          <Button size="sm" label={t("bulk.report.resume")} loading={busy} onClick={() => act("resume")} />
        ) : null}
        {report.status !== "undone" ? (
          <Button
            size="sm"
            label={t("bulk.report.undo")}
            loading={busy}
            onClick={() => act("undo")}
            {...(canUndo ? {} : { disabled: true as const, disabledReason: t("bulk.report.undoGone") })}
          />
        ) : null}
        <IconButton icon="close" label={t("bulk.report.closeBanner")} onClick={close} />
      </div>
      {details ? <Details report={report} onClose={() => setDetails(false)} /> : null}
    </div>
  );
}

/** «Деталі»: each skipped record with its reason; an unavailable one is never named (AC5). */
function Details({ report, onClose }: { report: BulkReport; onClose: () => void }) {
  const t = useI18n().t;
  return (
    <Dialog
      open
      onClose={onClose}
      title={t("bulk.details.title")}
      closeLabel={t("bulk.close")}
      align="start"
      actions={[{ label: t("bulk.close"), onClick: onClose, variant: "secondary" }]}
    >
      <ul className="bulk-details">
        {report.skippedRecords.map((r) => (
          <li key={r.id}>
            {r.reason === "unavailable" ? (
              <span>{t("bulk.details.unavailable")}</span>
            ) : (
              <a href={hrefFor(transactionPath(r.id))}>{t("bulk.details.open")}</a>
            )}{" "}
            <span className="ws-muted">
              — {r.reason === "invalid" ? issueText(t, r.issue) : reasonText(t, r.reason)}
            </span>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
