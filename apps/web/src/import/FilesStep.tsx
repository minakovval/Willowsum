import { useRef, useState, type DragEvent } from "react";
import { useI18n, type MessageKey, type Translate } from "@willowsum/i18n";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Icon,
  Select,
  Skeleton,
  Stepper,
  type BadgeTone,
} from "@willowsum/ui";
import { childPath, importPath } from "../routing/routes.ts";
import { hrefFor } from "../routing/useHashPath.ts";
import { type AccountItem } from "./api.ts";
import {
  choiceLabel,
  choicesOf,
  countsOf,
  nextBlock,
  rowsText,
  sizeText,
  type Choice,
  type FileRow,
} from "./model.ts";
import "./import.css";
import { useImportStep } from "./useImportStep.ts";

const ACCEPT = ".csv,.tsv,.xlsx,.xls";
const NEXT_REASON = {
  none: "import.next.none",
  busy: "import.next.busy",
  account: "import.next.account",
  failed: "import.next.failed",
} as const satisfies Record<string, MessageKey>;
const REASON_WORD = {
  iban: "import.account.reason.iban",
  card: "import.account.reason.card",
  currency: "import.account.reason.currency",
} as const satisfies Record<string, MessageKey>;

/** The rejection codes of file-storage and of a batch whose texts the catalogue holds (IMP-01 FR 13–15). */
const KNOWN_CODES: ReadonlySet<string> = new Set([
  "UNSUPPORTED_FORMAT",
  "ENCRYPTED",
  "CORRUPTED",
  "NO_TRANSACTIONS",
  "FILE_TOO_LARGE",
  "REQUEST_TOO_LARGE",
  "ARCHIVE_LIMIT",
  "TOO_MANY_ROWS",
  "TOO_MANY_CELLS",
  "TOO_MANY_SHEETS",
  "PARSE_TIMEOUT",
  "PARSE_MEMORY",
  "SPACE_STORAGE_LIMIT",
  "BATCH_TOO_MANY_FILES",
  "BATCH_TOO_LARGE",
]);

/**
 * The text of a refusal by its code (IMP-01 FR 15): the catalogue's, or — for a code it does not know — the API's own
 * text in the user's language, or a plain «Файл не прийнято».
 */
function reasonText(t: Translate, locale: string, row: FileRow): string {
  if (row.phase === "network") return t("import.refused.network");
  if (row.code === "BATCH_STATE_CONFLICT") return t("import.refused.batchState");
  if (row.code !== null && KNOWN_CODES.has(row.code)) return t(`import.refused.${row.code}` as MessageKey);
  return row.message?.[locale === "uk" ? "uk" : "en"] ?? t("import.refused.generic");
}

export function FilesStep({ batchId, onClose }: { batchId: string | null; onClose: () => void }) {
  const { t } = useI18n();
  const step = useImportStep(batchId, (id) => window.location.replace(hrefFor(importPath(id))));
  const { accounts, batch, rows } = step;
  const picker = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [editing, setEditing] = useState<ReadonlySet<string>>(new Set());

  const steps = [
    { label: t("import.step.files"), state: "current" as const },
    { label: t("import.step.review"), state: "unavailable" as const },
    { label: t("import.step.result"), state: "unavailable" as const },
  ];
  const head = (
    <Stepper
      steps={steps}
      label={t("import.steps.label")}
      onSelect={() => {
        /* the later steps open through «Далі» only */
      }}
    />
  );

  if (accounts.kind === "loading" || batch.kind === "loading")
    return (
      <div className="imp" aria-busy="true">
        {head}
        <Skeleton variant="row" lines={3} />
      </div>
    );
  if (accounts.kind === "error")
    return (
      <div className="imp">
        {head}
        <ErrorState
          text={t("import.error.accounts")}
          code={accounts.supportId}
          onRetry={step.reloadAccounts}
        />
      </div>
    );
  if (batch.kind === "error")
    return (
      <div className="imp">
        {head}
        <ErrorState
          text={t("import.error.batch")}
          code={batch.supportId}
          onRetry={() => window.location.reload()}
        />
      </div>
    );
  if (batch.kind === "missing")
    return (
      <div className="imp">
        {head}
        <EmptyState
          icon="upload"
          title={t("import.notFound.title")}
          text={t("import.notFound.text")}
          primary={{ label: t("import.notFound.action"), href: hrefFor("/import") }}
        />
      </div>
    );
  if (accounts.accounts.length === 0)
    return (
      <div className="imp">
        {head}
        <EmptyState
          icon="accounts"
          title={t("import.noAccounts.title")}
          text={t("import.noAccounts.text")}
          primary={{ label: t("import.noAccounts.action"), href: hrefFor(childPath("newAccount")) }}
        />
      </div>
    );

  const choices = choicesOf(accounts.accounts);
  const byId = new Map(choices.map((c) => [c.id, c]));
  const counts = countsOf(rows);
  const block = nextBlock(rows);
  const changed = rows.some((r) => r.recipeFormat === "changed");

  const take = (files: FileList | null) => {
    if (files && files.length > 0) step.addFiles(Array.from(files));
    if (picker.current) picker.current.value = "";
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    take(e.dataTransfer.files);
  };
  const leave = async () => {
    await step.cancel();
    onClose();
  };

  return (
    <div className="imp">
      {head}
      <p className="imp-intro ws-muted">{t("import.intro")}</p>

      <div
        className="imp-drop"
        data-dragging={dragging || undefined}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <span className="imp-drop-icon" aria-hidden="true">
          <Icon name="upload" size={24} />
        </span>
        <p className="imp-drop-title">{dragging ? t("import.drop.release") : t("import.drop.title")}</p>
        <p className="imp-drop-formats ws-muted">{t("import.drop.formats")}</p>
        <input
          ref={picker}
          type="file"
          multiple
          accept={ACCEPT}
          className="ws-visually-hidden"
          tabIndex={-1}
          aria-label={t("import.drop.label")}
          onChange={(e) => take(e.target.files)}
        />
        <Button label={t("import.drop.choose")} onClick={() => picker.current?.click()} />
      </div>

      {step.refreshFailed ? (
        <ErrorState placement="block" text={t("import.error.refresh")} onRetry={step.retryResume} />
      ) : null}

      {changed ? (
        <p className="imp-banner" role="status">
          <Icon name="warning" size={16} /> {t("import.template.banner")}
        </p>
      ) : null}

      {rows.length > 0 ? (
        <section className="imp-list" aria-label={t("import.list.label")}>
          <div className="imp-head" aria-hidden="true">
            <span className="imp-c-file">{t("import.col.file")}</span>
            <span className="imp-c-account">{t("import.col.account")}</span>
            <span className="imp-c-state">{t("import.col.state")}</span>
          </div>
          <ul>
            {rows.map((row) => (
              <FileLine
                key={row.key}
                row={row}
                choices={choices}
                accounts={accounts.accounts}
                byId={byId}
                editing={editing.has(row.key)}
                saveFailed={step.saveFailed === row.fileId}
                onEdit={() => setEditing((old) => new Set(old).add(row.key))}
                onChoose={(accountId) => {
                  setEditing((old) => {
                    const next = new Set(old);
                    next.delete(row.key);
                    return next;
                  });
                  if (row.fileId) void step.choose(row.fileId, accountId);
                }}
                onRetryUpload={() => step.retryUpload(row.key)}
                onRetryParse={() => row.fileId && void step.retryParse(row.fileId)}
                onAnother={() => {
                  step.dismiss(row.key);
                  picker.current?.click();
                }}
              />
            ))}
          </ul>
        </section>
      ) : null}

      <footer className="imp-footer">
        <Button label={t("import.footer.cancel")} onClick={() => void leave()} />
        <span className="imp-spacer" />
        {rows.length > 0 ? (
          <span className="imp-summary ws-muted" role="status">
            {t("import.footer.summary", {
              ready: counts.ready,
              parsing: counts.parsing,
              action: counts.action,
              failed: counts.failed,
            })}
          </span>
        ) : null}
        {block === null && batchId ? (
          <Button
            label={t("import.footer.next")}
            variant="primary"
            href={hrefFor(importPath(batchId, "review"))}
          />
        ) : (
          <Button
            label={t("import.footer.next")}
            variant="primary"
            disabled
            disabledReason={t(NEXT_REASON[block ?? "busy"])}
          />
        )}
      </footer>
    </div>
  );
}

interface LineProps {
  row: FileRow;
  choices: readonly Choice[];
  accounts: readonly AccountItem[];
  byId: ReadonlyMap<string, Choice>;
  editing: boolean;
  saveFailed: boolean;
  onEdit: () => void;
  onChoose: (accountId: string) => void;
  onRetryUpload: () => void;
  onRetryParse: () => void;
  onAnother: () => void;
}

function FileLine(p: LineProps) {
  const { t, locale } = useI18n();
  const { row } = p;
  const meta = [
    row.sizeBytes !== null ? sizeText(t, locale, row.sizeBytes) : null,
    row.rowCount !== null ? rowsText(t, locale, row.rowCount) : null,
  ].filter((x): x is string => x !== null);
  const refused = row.phase === "rejected" || row.phase === "failed" || row.phase === "network";
  const busy = row.phase === "uploading" || row.phase === "parsing";
  const own = row.accountId ? p.byId.get(row.accountId) : undefined;
  const asking = row.phase === "needs-account" || p.editing;
  const suggested = row.refusal?.suggestedAccountId ? p.byId.get(row.refusal.suggestedAccountId) : undefined;
  const tone: BadgeTone = refused ? "negative" : row.phase === "needs-account" ? "attention" : "info";

  return (
    <li className="imp-row" data-phase={row.phase}>
      <span className="imp-file-icon" aria-hidden="true">
        <Icon name="documents" size={20} />
      </span>
      <span className="imp-c-file imp-file">
        <b className="imp-name">{row.name}</b>
        {meta.length > 0 ? <span className="imp-meta ws-muted">{meta.join(" · ")}</span> : null}
      </span>

      <span className="imp-c-account">
        {refused ? (
          <span className="imp-reason">
            <span>{reasonText(t, locale, row)}</span>
            {row.code ? (
              <span className="ws-muted">{t("import.refused.code", { code: row.code })}</span>
            ) : null}
          </span>
        ) : asking ? (
          <span className="imp-choose">
            <Select
              className="imp-account"
              label={t("import.account.selectLabel", { name: row.name })}
              placeholder={t("import.account.choose")}
              value={row.accountId ?? ""}
              options={p.choices.map((c) => ({ value: c.id, label: choiceLabel(t, c) }))}
              onChange={(v) => v && p.onChoose(v)}
              error={p.saveFailed ? t("import.account.saveFailed") : undefined}
            />
            {row.refusal && row.refusal.reasons.length > 0 ? (
              <span className="imp-note imp-note-warn">
                {t("import.account.other", {
                  reasons: row.refusal.reasons.map((r) => t(REASON_WORD[r.kind])).join(", "),
                })}
              </span>
            ) : suggested ? (
              <span className="imp-note imp-note-warn">
                {t("import.account.unsure", { account: suggested.label })}
              </span>
            ) : null}
          </span>
        ) : own ? (
          <span className="imp-account-line">
            <span className="imp-account-name">{choiceLabel(t, own)}</span>
            <span className="imp-note ws-muted">{t("import.account.detected")}</span>
            <Button
              size="sm"
              variant="quiet"
              className="imp-change"
              label={t("import.account.change")}
              onClick={p.onEdit}
            />
          </span>
        ) : null}
        {row.recipeFormat === "match" ? (
          <span className="imp-note ws-muted">{t("import.template.match")}</span>
        ) : null}
        {row.recipeFormat === "changed" ? (
          <span className="imp-note imp-note-warn">{t("import.template.changed")}</span>
        ) : null}
      </span>

      <span className="imp-c-state imp-state">
        {busy ? (
          <span className="imp-busy" role="status">
            <span className="ws-progress-text">
              {t(row.phase === "uploading" ? "import.state.uploading" : "import.state.parsing")}
            </span>
            <span
              className="ws-progress-track"
              role="progressbar"
              aria-label={t(
                row.phase === "uploading" ? "import.progress.uploading" : "import.progress.parsing",
                { name: row.name },
              )}
            />
          </span>
        ) : (
          <Badge
            tone={tone}
            label={t(
              refused
                ? "import.state.error"
                : row.phase === "needs-account"
                  ? "import.state.action"
                  : "import.state.ready",
            )}
          />
        )}
        {row.phase === "network" ? (
          <Button size="sm" label={t("import.action.retry")} onClick={p.onRetryUpload} />
        ) : row.phase === "failed" ? (
          <span className="imp-actions">
            <Button size="sm" label={t("import.action.retry")} onClick={p.onRetryParse} />
            <Button size="sm" variant="quiet" label={t("import.action.another")} onClick={p.onAnother} />
          </span>
        ) : row.phase === "rejected" ? (
          <Button size="sm" variant="quiet" label={t("import.action.another")} onClick={p.onAnother} />
        ) : null}
      </span>
    </li>
  );
}
