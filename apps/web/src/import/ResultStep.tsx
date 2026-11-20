import { useState, type ReactNode } from "react";
import { formatNumber, useI18n, type MessageKey, type Translate } from "@willowsum/i18n";
import { Button, Dialog, EmptyState, ErrorState, Icon, Segmented, Skeleton, Stepper } from "@willowsum/ui";
import type { IconName } from "@willowsum/ui";
import { importPath, TRANSACTIONS } from "../routing/routes.ts";
import { hrefFor } from "../routing/useHashPath.ts";
import { canRollback, plural, tilesOf, whenText, type RefusedRow } from "./resultModel.ts";
import type { BatchResult, RollbackMode, RolledBack } from "./resultApi.ts";
import { useResultStep, type ResultView } from "./useResultStep.ts";
import type { Failure } from "./useReviewStep.ts";
import { PAGE } from "./reviewApi.ts";
import "./import.css";

/** The text an API failure is shown with: its own code (and the support id), as «Код: …». */
const codeOf = (f: Failure): string | undefined => f.supportId ?? (f.code ? f.code : undefined);

const ISSUE = {
  unreadable: "importReview.issue.unreadable",
  currency: "importReview.issue.currency",
  "too-precise": "importReview.issue.too-precise",
  fee: "importReview.issue.fee",
  account: "importReview.issue.account",
  text: "importReview.issue.text",
} as const satisfies Record<string, MessageKey>;

/** A refusal that a second try of the same apply does not change: the batch itself has to change first. */
const DEFINITIVE = new Set([
  "IMPORT_NOT_READY",
  "IMPORT_PLAN_TOO_LARGE",
  "IMPORT_APPLY_UNSUPPORTED",
  "ACCOUNT_CLOSED",
]);

/**
 * IMP-08@PoC c) (wave 2, row 138): S-174 «Результат» — canvas PocMoneyImport3 and its «Тексти» board PocMoneyImport3Texts.
 * Opening `/import/<batch>/result` (where «Застосувати» of the review leads) applies the reviewed batch and shows the outcome:
 * the counts of created, replaced and skipped rows, what is left to do after it — the pairs of transfers («Пари · N»), the
 * transactions without a category («До розбору»), the card payments recorded as transfers — and «Відкотити» for 7 days.
 * A refused apply (all rows or none) lists the rows with the API's issue codes. Every number is the API's.
 */
export function ResultStep({ batchId }: { batchId: string }) {
  const { t } = useI18n();
  const step = useResultStep(batchId);
  const { view } = step;

  const head = (
    <Stepper
      steps={[
        { label: t("import.step.files"), state: "done" },
        { label: t("import.step.review"), state: "done" },
        { label: t("import.step.result"), state: "current" },
      ]}
      label={t("import.steps.label")}
      onSelect={(i) => {
        window.location.assign(hrefFor(importPath(batchId, i === 0 ? "files" : "review")));
      }}
    />
  );
  const title = (text: string) => <h2 className="imp-review-title">{text}</h2>;
  const shell = (children: ReactNode, busy = false) => (
    <div className="imp imp-result" {...(busy ? { "aria-busy": true } : {})}>
      {head}
      {children}
    </div>
  );

  switch (view.kind) {
    case "loading":
      return shell(
        <>
          {title(t("importResult.title"))}
          <p role="status" className="imp-intro">
            {t("importResult.loading")}
          </p>
          <Skeleton variant="row" lines={4} />
        </>,
        true,
      );
    case "applying":
      return shell(
        <>
          {title(t("importResult.applying.title"))}
          <p role="status" className="imp-intro">
            {t("importResult.applying.text")}
          </p>
          <Skeleton variant="row" lines={4} />
        </>,
        true,
      );
    case "missing":
      return shell(
        <EmptyState
          icon="upload"
          title={t("import.notFound.title")}
          text={t("import.notFound.text")}
          primary={{ label: t("import.notFound.action"), href: hrefFor("/import") }}
        />,
      );
    case "cancelled":
      return shell(
        <EmptyState
          icon="upload"
          title={t("importResult.cancelled.title")}
          text={t("importResult.cancelled.text")}
          primary={{ label: t("import.notFound.action"), href: hrefFor("/import") }}
        />,
      );
    case "not-parsed":
      return shell(
        <EmptyState
          icon="documents"
          title={t("importResult.notParsed.title")}
          text={t("importResult.notParsed.text")}
          primary={{ label: t("importResult.toFiles"), href: hrefFor(importPath(batchId)) }}
        />,
      );
    case "error":
      return shell(
        <>
          {title(t("importResult.title"))}
          <ErrorState text={errorText(t, view)} code={codeOf(view.failure)} onRetry={step.retry} />
          {view.where === "apply" && !DEFINITIVE.has(view.failure.code ?? "") ? (
            <p className="imp-intro">{t("importResult.error.safe")}</p>
          ) : null}
          {view.where === "apply" && view.failure.code === "IMPORT_NOT_READY" ? (
            <div className="imp-footer">
              <Button label={t("importResult.toReview")} href={hrefFor(importPath(batchId, "review"))} />
            </div>
          ) : null}
          {view.where === "apply" && view.failure.code === "ACCOUNT_CLOSED" ? (
            <div className="imp-footer">
              <Button label={t("importResult.toFiles")} href={hrefFor(importPath(batchId))} />
            </div>
          ) : null}
        </>,
      );
    case "refused":
      return shell(<Refused batchId={batchId} view={view} onRetry={step.retry} />);
    case "done":
      return shell(
        <Done
          result={view.result}
          already={view.already}
          rolledBack={step.rolledBack}
          rolling={step.rolling}
          rollbackFailure={step.rollbackFailure}
          onRollback={step.rollback}
          onOpenRollback={step.clearRollbackFailure}
        />,
      );
  }
}

function errorText(t: Translate, v: Extract<ResultView, { kind: "error" }>): string {
  const c = v.failure.code;
  if (v.where === "batch") return t("import.error.batch");
  if (v.where === "result") return t("importResult.error.result");
  if (v.failure.network) return t("importResult.error.applyNetwork");
  if (c === "IMPORT_NOT_READY") return t("importResult.notReady");
  if (c === "IMPORT_PLAN_TOO_LARGE") return t("importResult.tooLarge");
  if (c === "IMPORT_APPLY_UNSUPPORTED") return t("importResult.unsupported");
  if (c === "ACCOUNT_CLOSED") return t("importResult.accountClosed");
  if (c === "BATCH_STATE_CONFLICT") return t("importResult.conflict");
  return t("importResult.error.apply");
}

// ——— A refused apply: all rows or none (IMP-05 FR 11), the rows with the API's issue codes ———

function Refused({
  batchId,
  view,
  onRetry,
}: {
  batchId: string;
  view: Extract<ResultView, { kind: "refused" }>;
  onRetry: () => void;
}) {
  const { t, locale } = useI18n();
  const [shown, setShown] = useState(PAGE);
  const total = view.rows.length;
  const code = codeOf(view.failure);
  return (
    <>
      <h2 className="imp-review-title">{t("importResult.refused.title")}</h2>
      <p className="imp-banner imp-banner-error" role="alert">
        <Icon name="warning" size={16} />
        <span>
          {t("importResult.refused.text")}
          {code ? ` ${t("import.refused.code", { code })}` : ""}
        </span>
      </p>
      {total > 0 ? (
        <section className="imp-list">
          <h3 className="imp-result-heading">
            {t("importResult.refused.list", { count: formatNumber(locale, String(total)) })}
          </h3>
          <ul>
            {view.rows.slice(0, shown).map((r, i) => (
              <li key={`${r.fileId ?? ""}/${r.row ?? ""}/${i}`} className="imp-result-issue">
                <RefusedLine r={r} names={view.names} />
              </li>
            ))}
          </ul>
          <div className="imp-result-more">
            <p className="imp-summary">
              {t("importReview.shown", {
                shown: formatNumber(locale, String(Math.min(shown, total))),
                total: formatNumber(locale, String(total)),
              })}
            </p>
            {shown < total ? (
              <Button label={t("importReview.more")} onClick={() => setShown((n) => n + PAGE)} />
            ) : null}
          </div>
        </section>
      ) : null}
      <footer className="imp-footer">
        <Button label={t("importResult.toReview")} href={hrefFor(importPath(batchId, "review"))} />
        <span className="imp-spacer" />
        <Button label={t("importResult.retry")} variant="primary" onClick={onRetry} />
      </footer>
    </>
  );
}

function RefusedLine({ r, names }: { r: RefusedRow; names: ReadonlyMap<string, string> }) {
  const { t } = useI18n();
  const name = r.fileId === null ? null : (names.get(r.fileId) ?? r.fileId);
  const where =
    name === null
      ? t("importResult.refused.batch")
      : r.row === null
        ? t("importResult.refused.file", { file: name })
        : t("importResult.refused.row", { file: name, row: r.row });
  const known = r.issue in ISSUE;
  return (
    <>
      <b className="imp-result-where">{where}</b>
      <span>
        {t(known ? ISSUE[r.issue as keyof typeof ISSUE] : "importReview.issue.other")}
        {known ? "" : ` (${r.issue})`}
      </span>
    </>
  );
}

// ——— The outcome ———

function Done({
  result,
  already,
  rolledBack,
  rolling,
  rollbackFailure,
  onRollback,
  onOpenRollback,
}: {
  result: BatchResult;
  already: boolean;
  rolledBack: RolledBack["rollback"] | null;
  rolling: boolean;
  rollbackFailure: Failure | null;
  onRollback: (mode: RollbackMode) => Promise<boolean>;
  onOpenRollback: () => void;
}) {
  const { t, locale } = useI18n();
  const num = (n: number) => formatNumber(locale, String(n));
  const { batch, followUp } = result;
  const gone = batch.state === "rolled-back";
  const tiles = tilesOf(result.result.counts);
  const files = plural(t, locale, "importResult.files", batch.files.accepted, num(batch.files.accepted));

  return (
    <>
      <h2 className="imp-review-title">
        {gone ? t("importResult.rolledBack.title") : t("importResult.title")}
      </h2>
      <p className="imp-intro imp-result-sub">{files}</p>
      {already && !gone ? (
        <p className="imp-banner imp-banner-ok" role="status">
          <Icon name="check" size={16} />
          <span>{t("importResult.already", { date: whenText(locale, result.appliedAt) })}</span>
        </p>
      ) : null}

      {gone ? (
        <RolledBackNote rolledBack={rolledBack} />
      ) : (
        <>
          <ul className="imp-result-tiles" aria-label={t("importResult.counts.label")}>
            {(
              [
                ["importResult.tile.created", tiles.created],
                ["importResult.tile.replaced", tiles.replaced],
                ["importResult.tile.skipped", tiles.skipped],
              ] as const
            ).map(([key, n]) => (
              <li key={key} className="imp-result-tile">
                <span className="imp-result-tile-label">{t(key)}</span>
                <b className="imp-result-tile-n">{num(n)}</b>
              </li>
            ))}
          </ul>

          {followUp ? (
            <section className="imp-result-follow" aria-label={t("importResult.follow.label")}>
              <FollowLine
                icon="transactions"
                text={
                  followUp.transferProposals.more
                    ? t("importResult.pairs.more", { count: num(followUp.transferProposals.count) })
                    : plural(
                        t,
                        locale,
                        "importResult.pairs",
                        followUp.transferProposals.count,
                        num(followUp.transferProposals.count),
                      )
                }
                action={
                  followUp.transferProposals.count > 0
                    ? {
                        label: t("importResult.pairs.link", {
                          count: `${num(followUp.transferProposals.count)}${followUp.transferProposals.more ? "+" : ""}`,
                        }),
                        href: hrefFor(`${TRANSACTIONS.path}/pairs`),
                        primary: false,
                      }
                    : null
                }
              />
              <FollowLine
                icon="tag"
                text={plural(
                  t,
                  locale,
                  "importResult.uncategorized",
                  followUp.uncategorized,
                  num(followUp.uncategorized),
                )}
                action={
                  followUp.uncategorized > 0
                    ? {
                        label: t("importResult.uncategorized.link"),
                        href: hrefFor(`${TRANSACTIONS.path}/review`),
                        primary: true,
                      }
                    : null
                }
              />
              {followUp.cardPaymentTransfers > 0 ? (
                <FollowLine
                  icon="card"
                  text={plural(
                    t,
                    locale,
                    "importResult.cardTransfers",
                    followUp.cardPaymentTransfers,
                    num(followUp.cardPaymentTransfers),
                  )}
                  action={null}
                />
              ) : null}
            </section>
          ) : null}

          <RollbackLine
            result={result}
            rolling={rolling}
            failure={rollbackFailure}
            onRollback={onRollback}
            onOpen={onOpenRollback}
          />
        </>
      )}

      <footer className="imp-footer">
        <span className="imp-spacer" />
        <Button label={t("importResult.again")} href={hrefFor("/import")} />
        <Button
          label={t("importResult.toTransactions")}
          variant="primary"
          href={hrefFor(TRANSACTIONS.path)}
        />
      </footer>
    </>
  );
}

function FollowLine({
  icon,
  text,
  action,
}: {
  icon: IconName;
  text: string;
  action: { label: string; href: string; primary: boolean } | null;
}) {
  return (
    <div className="imp-result-line">
      <Icon name={icon} size={20} />
      <span className="imp-result-text">{text}</span>
      {action ? (
        <Button label={action.label} href={action.href} variant={action.primary ? "primary" : "secondary"} />
      ) : null}
    </div>
  );
}

function RolledBackNote({ rolledBack }: { rolledBack: RolledBack["rollback"] | null }) {
  const { t, locale } = useI18n();
  const num = (n: number) => formatNumber(locale, String(n));
  const lines: [MessageKey, number][] = rolledBack
    ? [
        ["importResult.rolledBack.done", rolledBack.counts["rolledBack"] ?? 0],
        ["importResult.rolledBack.kept", rolledBack.counts["kept"] ?? 0],
        ["importResult.rolledBack.transfers", rolledBack.counts["transfers"] ?? 0],
        ["importResult.rolledBack.restored", rolledBack.counts["restored"] ?? 0],
      ]
    : [];
  return (
    <section className="imp-result-follow" role="status">
      <div className="imp-result-line">
        <Icon name="check" size={20} />
        <span className="imp-result-text">{t("importResult.rolledBack.text")}</span>
      </div>
      {lines
        // The first line is always shown; the others only when there is something to say.
        .filter(([key, n], i) => i === 0 || (n > 0 && key !== "importResult.rolledBack.done"))
        .map(([key, n]) => (
          <div key={key} className="imp-result-line">
            <span className="imp-result-text">{t(key, { count: num(n) })}</span>
          </div>
        ))}
    </section>
  );
}

/** «Партію можна відкотити протягом 7 днів.» and «Відкотити партію» (IMP-04 FR 8; the dialog asks which changed rows to keep). */
function RollbackLine({
  result,
  rolling,
  failure,
  onRollback,
  onOpen,
}: {
  result: BatchResult;
  rolling: boolean;
  failure: Failure | null;
  onRollback: (mode: RollbackMode) => Promise<boolean>;
  onOpen: () => void;
}) {
  const { t, locale } = useI18n();
  const [now] = useState(() => Date.now());
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<RollbackMode>("keep-changed");
  const { batch } = result;
  if (batch.state !== "applied") return null;
  if (!canRollback(batch, now))
    return (
      <p className="imp-result-rollback">
        <Icon name="info" size={16} /> {t("importResult.rollback.expired")}
      </p>
    );
  return (
    <div className="imp-result-rollback">
      <Icon name="info" size={16} />
      <span>
        {t("importResult.rollback.note")}{" "}
        {t("importResult.rollback.until", { date: whenText(locale, batch.rollbackUntil!) })}
      </span>
      <Button
        label={t("importResult.rollback.action")}
        onClick={() => {
          onOpen();
          setOpen(true);
        }}
      />
      <Dialog
        open={open}
        onClose={() => (rolling ? undefined : setOpen(false))}
        title={t("importResult.rollback.dialog.title")}
        text={t("importResult.rollback.dialog.text")}
        icon="warning"
        tone="warning"
        align="start"
        closeLabel={t("shell.close")}
        busy={rolling}
        error={failure ? rollbackError(t, failure) : undefined}
        actions={[
          { label: t("importResult.rollback.cancel"), onClick: () => setOpen(false), variant: "secondary" },
          {
            label: t("importResult.rollback.confirm"),
            busyLabel: t("importResult.rollback.busy"),
            variant: "danger",
            onClick: () => {
              void onRollback(mode).then((done) => {
                if (done) setOpen(false);
              });
            },
          },
        ]}
      >
        <Segmented
          legend={t("importResult.rollback.mode.label")}
          options={[
            { value: "keep-changed", label: t("importResult.rollback.mode.keep") },
            { value: "all", label: t("importResult.rollback.mode.all") },
          ]}
          value={mode}
          onChange={(v) => setMode(v as RollbackMode)}
        />
      </Dialog>
    </div>
  );
}

function rollbackError(t: Translate, f: Failure): ReactNode {
  const text = f.network
    ? t("importResult.rollback.error.network")
    : f.code === "IMPORT_ROLLBACK_EXPIRED"
      ? t("importResult.rollback.error.expired")
      : f.code === "BATCH_STATE_CONFLICT"
        ? t("importResult.rollback.error.conflict")
        : t("importResult.rollback.error");
  const code = codeOf(f);
  return code ? `${text} ${t("import.refused.code", { code })}` : text;
}
