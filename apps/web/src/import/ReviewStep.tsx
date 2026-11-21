import { useId, useState } from "react";
import {
  formatMoney,
  formatNumber,
  useI18n,
  type Locale,
  type MessageKey,
  type Translate,
} from "@willowsum/i18n";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Icon,
  Segmented,
  Select,
  Skeleton,
  Stepper,
  type BadgeTone,
} from "@willowsum/ui";
import { importPath } from "../routing/routes.ts";
import { hrefFor } from "../routing/useHashPath.ts";
import type { Readiness } from "./api.ts";
import type { DecisionInput, Duplicate, FileReview, ReviewFilter } from "./reviewApi.ts";
import {
  bannersOf,
  dateText,
  duplicateCounts,
  questionCount,
  rowViews,
  type Banner,
  type FlagBanner,
  type ReviewFile,
  type RowView,
  type Tab,
} from "./reviewModel.ts";
import { rowsText } from "./model.ts";
import { useReviewStep, type Failure } from "./useReviewStep.ts";
import { armApply } from "./applyIntent.ts";
import "./import.css";

type StateKey = "ok" | "needs-review" | "needs-clarification" | "error" | "excluded";
const STATE_BADGE: Record<StateKey, { tone: BadgeTone; key: MessageKey } | null> = {
  ok: null,
  "needs-review": { tone: "attention", key: "importReview.state.needs-review" },
  "needs-clarification": { tone: "attention", key: "importReview.state.needs-clarification" },
  error: { tone: "negative", key: "importReview.state.error" },
  excluded: { tone: "neutral", key: "importReview.state.excluded" },
};
const DUPLICATE_BADGE = {
  repeat: "importReview.duplicate.repeat",
  duplicate: "importReview.duplicate.duplicate",
  "already-imported": "importReview.duplicate.already-imported",
  merge: "importReview.duplicate.merge",
  "possible-duplicate": "importReview.duplicate.possible-duplicate",
  replace: "importReview.duplicate.replace",
} as const satisfies Record<Duplicate["kind"], MessageKey>;
const FILTERS = [
  "ok",
  "needs-review",
  "needs-clarification",
  "error",
  "excluded",
  "sign-unconfirmed",
  "changed",
] as const satisfies readonly ReviewFilter[];
const SIGN_BASIS = {
  profile: "importReview.sign.basis.profile",
  card: "importReview.sign.basis.card",
  majority: "importReview.sign.basis.majority",
} as const;
const ISSUE = {
  unreadable: "importReview.issue.unreadable",
  currency: "importReview.issue.currency",
  "too-precise": "importReview.issue.too-precise",
  fee: "importReview.issue.fee",
  account: "importReview.issue.account",
  text: "importReview.issue.text",
} as const satisfies Record<string, MessageKey>;
const EVIDENCE = new Set([
  "decimal-separator",
  "thousands-separator",
  "ambiguous-integers",
  "mixed-separators",
  "no-decimal-evidence",
  "currency-column",
  "currency-in-header",
  "no-currency",
]);
const GROUP_ACTION = {
  accept: "importReview.group.decided.accept",
  exclude: "importReview.group.decided.exclude",
  "flip-sign": "importReview.group.decided.flip-sign",
} as const;

/** A button that answers a question: it waits (with its reason beside it) while an answer is being saved. */
function Decide(p: {
  label: string;
  deciding: boolean;
  onClick: () => void;
  variant?: "primary" | "secondary";
}) {
  const t = useI18n().t;
  return p.deciding ? (
    <Button
      label={p.label}
      variant={p.variant ?? "secondary"}
      disabled
      disabledReason={t("importReview.saving")}
    />
  ) : (
    <Button label={p.label} variant={p.variant ?? "secondary"} onClick={p.onClick} />
  );
}

/** The text an API failure is shown with: its own code (and the support id), as «Код: …». */
const codeOf = (f: Failure): string | undefined => f.supportId ?? (f.code ? f.code : undefined);

/**
 * IMP-08@PoC b) (wave 2, row 137): S-171 «Перевірка розпізнавання» — canvas PocMoneyImport2 (the panel «Як ми прочитали»,
 * the banners of the batch, «Назад» and «Застосувати»; the original of the file on the left is part 2 of the row and is not
 * here: the body is a grid with that one slot left free). The user reads the counters, answers the questions (an ambiguous
 * amount, the sign of a card, the order of day and month, a flag of the batch), sees the duplicates the apply would skip and
 * goes on to «Результат» (`/import/<batch>/result`, row 138) when the API says the batch is ready. Nothing is written here
 * but the answers; «Застосувати» is the address of the next step.
 */
export function ReviewStep({ batchId }: { batchId: string }) {
  const { t, locale } = useI18n();
  const step = useReviewStep(batchId);
  const { base } = step;

  const head = (
    <Stepper
      steps={[
        { label: t("import.step.files"), state: "done" },
        { label: t("import.step.review"), state: "current" },
        { label: t("import.step.result"), state: "unavailable" },
      ]}
      label={t("import.steps.label")}
      onSelect={(i) => {
        if (i === 0) window.location.assign(hrefFor(importPath(batchId)));
      }}
    />
  );
  const title = <h2 className="imp-review-title">{t("importReview.title")}</h2>;

  if (base.kind === "loading")
    return (
      <div className="imp" aria-busy="true">
        {head}
        {title}
        <Skeleton variant="row" lines={4} />
      </div>
    );
  if (base.kind === "error")
    return (
      <div className="imp">
        {head}
        {title}
        <ErrorState
          text={t("importReview.error.batch")}
          code={codeOf(base.failure)}
          onRetry={step.retryBase}
        />
      </div>
    );
  if (base.kind === "missing")
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
  if (base.kind === "closed")
    return (
      <div className="imp">
        {head}
        <EmptyState
          icon="upload"
          title={t("importReview.closed.title")}
          text={t("importReview.closed.text")}
          primary={
            base.state === "applied"
              ? { label: t("importReview.closed.result"), href: hrefFor(importPath(batchId, "result")) }
              : { label: t("import.notFound.action"), href: hrefFor("/import") }
          }
        />
      </div>
    );
  if (base.files.length === 0)
    return (
      <div className="imp">
        {head}
        {title}
        <EmptyState
          icon="documents"
          title={t("importReview.noFiles.title")}
          text={t("importReview.noFiles.text")}
          primary={{ label: t("importReview.back"), href: hrefFor(importPath(batchId)) }}
        />
      </div>
    );

  const file = base.files.find((f) => f.fileId === step.fileId) ?? base.files[0]!;
  const review = step.review.kind === "ready" ? step.review.data : null;
  const banners = bannersOf(file, base.readiness);
  const blocked = applyBlock(t, locale, base.readiness, step.errorRows);

  return (
    <div className="imp imp-review">
      {head}
      {title}

      {base.files.length > 1 ? (
        <div className="imp-review-file">
          <Select
            label={t("importReview.file.label")}
            value={file.fileId}
            options={base.files.map((f) => ({
              value: f.fileId,
              label:
                f.rowCount === null
                  ? f.name
                  : t("importReview.file.option", { name: f.name, rows: rowsText(t, locale, f.rowCount) }),
            }))}
            onChange={step.selectFile}
          />
        </div>
      ) : (
        <p className="imp-review-file-name">
          <Icon name="documents" size={16} /> <b>{file.name}</b>
        </p>
      )}

      <Banners file={file} banners={banners} deciding={step.deciding} answer={step.answer} />

      {step.decisionFailure ? (
        <p className="imp-banner imp-banner-error" role="alert">
          <Icon name="warning" size={16} />
          <span>
            {step.decisionFailure.network
              ? t("importReview.error.decisionNetwork")
              : step.decisionFailure.code === "BATCH_STATE_CONFLICT"
                ? t("importReview.error.conflict")
                : t("importReview.error.decision")}{" "}
            {codeOf(step.decisionFailure)
              ? t("import.refused.code", { code: codeOf(step.decisionFailure)! })
              : null}
          </span>
        </p>
      ) : null}

      {/* The body is a grid: the original of the file (IMP-08 FR 4, part 2 of row 137) takes the first column. */}
      <div className="imp-review-body">
        <Panel step={step} file={file} review={review} />
      </div>

      <footer className="imp-footer">
        <Button label={t("importReview.back")} href={hrefFor(importPath(batchId))} />
        <span className="imp-spacer" />
        {blocked === null ? (
          <Button
            label={t("importReview.apply")}
            variant="primary"
            href={hrefFor(importPath(batchId, "result"))}
            onClick={(e) => {
              // A modified or middle click opens the result in another tab or window: that is not a click here.
              if (e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) armApply(batchId);
            }}
          />
        ) : (
          <Button label={t("importReview.apply")} variant="primary" disabled disabledReason={blocked} />
        )}
      </footer>
    </div>
  );
}

/** Why «Застосувати» waits (IMP-05 FR 11: the API's own explanation), or `null` when the batch is ready. */
function applyBlock(
  t: Translate,
  locale: Locale,
  readiness: Readiness,
  errorRows: number | null,
): string | null {
  const first = readiness.refusals[0];
  if (first) return first.message[locale === "uk" ? "uk" : "en"];
  // The apply refuses the batch for a row with an error in any of its files, not only the one on screen.
  if (errorRows === null) return t("importReview.apply.loading");
  if (errorRows > 0) return t("importReview.apply.errors");
  return null;
}

// ——— The banners of the batch (IMP-08 FR 9, IMP-05 FR 2, 3, 6, 8, 9) ———

const FLAG_TEXT = {
  "checksum-mismatch": {
    title: "importReview.flag.checksum-mismatch.title",
    text: "importReview.flag.checksum-mismatch.text",
  },
  "card-sign": { title: "importReview.flag.card-sign.title", text: "importReview.flag.card-sign.text" },
  "formula-cells": {
    title: "importReview.flag.formula-cells.title",
    text: "importReview.flag.formula-cells.text",
  },
  "hidden-sheets": {
    title: "importReview.flag.hidden-sheets.title",
    text: "importReview.flag.hidden-sheets.text",
  },
  "balance-not-checked": {
    title: "importReview.flag.balance-not-checked.title",
    text: "importReview.flag.balance-not-checked.text",
  },
  "no-transactions": {
    title: "importReview.flag.no-transactions.title",
    text: "importReview.flag.no-transactions.text",
  },
  "foreign-account": {
    title: "importReview.flag.no-transactions.title",
    text: "importReview.flag.no-transactions.text",
  },
} as const satisfies Record<FlagBanner["code"], { title: MessageKey; text: MessageKey }>;

function Banners(p: {
  file: ReviewFile;
  banners: readonly Banner[];
  deciding: boolean;
  answer: (d: readonly DecisionInput[]) => Promise<void>;
}) {
  const { t, locale } = useI18n();
  const money = (v: string | null): string => {
    if (v === null) return "";
    const currency = p.file.currency;
    return currency ? formatMoney(locale, v, currency) : formatNumber(locale, v);
  };
  const checked = !p.file.flags.some(
    (f) => f.code === "checksum-mismatch" || f.code === "balance-not-checked",
  );
  const id = p.file.fileId;
  return (
    <>
      {checked ? (
        <p className="imp-banner imp-banner-ok" role="status">
          <Icon name="check" size={16} /> <b>{t("importReview.sums.ok")}</b>
        </p>
      ) : null}
      {p.file.recipeChanged ? (
        <p className="imp-banner imp-banner-warn" role="status">
          <Icon name="warning" size={16} /> {t("importReview.template.text")}
        </p>
      ) : null}
      {p.banners.map((b) => {
        if (b.kind === "date-order")
          return (
            <section key="date-order" className="imp-banner imp-banner-warn" aria-labelledby={`${id}-date`}>
              <p>
                <Badge tone="attention" label={t("importReview.severity.review")} />{" "}
                <b id={`${id}-date`}>{t("importReview.dateOrder.title")}</b>{" "}
                {t("importReview.dateOrder.text")}
              </p>
              <div className="imp-actions">
                <Decide
                  label={t("importReview.dateOrder.dmy")}
                  deciding={p.deciding}
                  onClick={() => void p.answer([{ kind: "date-order", fileId: id, order: "dmy" }])}
                />
                <Decide
                  label={t("importReview.dateOrder.mdy")}
                  deciding={p.deciding}
                  onClick={() => void p.answer([{ kind: "date-order", fileId: id, order: "mdy" }])}
                />
              </div>
            </section>
          );
        if (b.kind === "history") {
          const h = b.history;
          return (
            <section
              key="history"
              className="imp-banner imp-banner-warn"
              aria-label={t("importReview.history.title")}
            >
              <p>
                <Badge tone="attention" label={t("importReview.severity.review")} />{" "}
                <b>{t("importReview.history.title")}</b>{" "}
                {h.status === "gap" ? t("importReview.history.gap") : t("importReview.history.overlap")}
              </p>
              {h.range ? (
                <p className="imp-note">
                  {t("importReview.history.range", {
                    from: dateText(locale, h.range.from) ?? h.range.from,
                    to: dateText(locale, h.range.to) ?? h.range.to,
                  })}
                </p>
              ) : null}
              {h.previousClosing !== null && h.newOpening !== null ? (
                <p className="imp-note">
                  {t("importReview.history.balances", {
                    previous: money(h.previousClosing),
                    opening: money(h.newOpening),
                  })}
                  {h.difference !== null
                    ? ` ${t("importReview.history.difference", { difference: money(h.difference) })}`
                    : ""}
                </p>
              ) : null}
            </section>
          );
        }
        const text = FLAG_TEXT[b.code];
        const tone = b.severity === "block" ? "negative" : "attention";
        const choose = (code: "update" | "keep") =>
          void p.answer([{ kind: "balance", fileId: id, choice: code }]);
        return (
          <section
            key={b.code}
            className={`imp-banner ${b.severity === "block" ? "imp-banner-error" : "imp-banner-warn"}`}
            aria-label={t(text.title)}
          >
            <p>
              <Badge
                tone={tone}
                label={t(
                  b.severity === "block" ? "importReview.severity.block" : "importReview.severity.review",
                )}
              />{" "}
              <b>{t(text.title)}</b>{" "}
              {t(text.text, {
                difference: money(b.difference),
                positive: b.positive ?? 0,
                negative: b.negative ?? 0,
              })}
            </p>
            {b.open ? (
              <div className="imp-actions">
                {b.code === "checksum-mismatch" ? (
                  <>
                    {b.choices.includes("update") ? (
                      <Decide
                        label={t("importReview.flag.checksum-mismatch.update")}
                        deciding={p.deciding}
                        onClick={() => choose("update")}
                      />
                    ) : null}
                    {b.choices.includes("keep") ? (
                      <Decide
                        label={t("importReview.flag.checksum-mismatch.keep")}
                        deciding={p.deciding}
                        onClick={() => choose("keep")}
                      />
                    ) : null}
                  </>
                ) : (
                  <>
                    <Decide
                      label={t("importReview.flag.confirm")}
                      deciding={p.deciding}
                      onClick={() => void p.answer([{ kind: "flag", fileId: id, code: b.code }])}
                    />
                    {b.code === "card-sign" ? (
                      <Decide
                        label={t("importReview.flag.card-sign.flip")}
                        deciding={p.deciding}
                        onClick={() =>
                          void p.answer([{ kind: "group", fileId: id, group: "review", action: "flip-sign" }])
                        }
                      />
                    ) : null}
                  </>
                )}
              </div>
            ) : (
              <p className="imp-note ws-muted">
                <Icon name="check" size={16} /> {t("importReview.flag.done")}
              </p>
            )}
          </section>
        );
      })}
    </>
  );
}

// ——— The panel «Як ми прочитали» ———

type Step = ReturnType<typeof useReviewStep>;

function Panel({ step, file, review }: { step: Step; file: ReviewFile; review: FileReview | null }) {
  const { t, locale } = useI18n();
  const [selected, setSelected] = useState<number | null>(null);
  const ids = useId();
  const duplicates = step.duplicates.kind === "ready" ? step.duplicates.data : null;
  const dupRows = new Map((duplicates?.items ?? []).map((d) => [d.row, d]));
  const views = rowViews(locale, step.listing.items, step.values, dupRows);
  const open =
    selected !== null && views.some((v) => v.row.row === selected)
      ? selected
      : step.tab === "questions"
        ? (views[0]?.row.row ?? null)
        : null;

  const questions = review ? questionCount(review) : 0;
  const listSize = review ? listTotal(review, step.tab, step.filter) : 0;
  const counts = review?.counts;

  return (
    <section className="imp-panel" aria-labelledby={`${ids}-title`}>
      <div className="imp-panel-head">
        <h3 id={`${ids}-title`} className="imp-panel-title">
          {t("importReview.panel")}
        </h3>
      </div>

      {step.review.kind === "loading" ? (
        <Skeleton variant="row" lines={1} />
      ) : step.review.kind === "error" ? (
        <ErrorState
          placement="block"
          text={t("importReview.error.review")}
          code={codeOf(step.review.failure)}
          onRetry={step.retryReview}
        />
      ) : counts ? (
        <ul className="imp-counters" aria-label={t("importReview.counters.label")}>
          <li>
            <span className="imp-counter-n">{formatNumber(locale, String(counts.rows))}</span>{" "}
            <span>{t("importReview.counter.parsed")}</span>
          </li>
          <li>
            <span className="imp-counter-n">
              {formatNumber(
                locale,
                String(counts.states["needs-review"] + counts.states["needs-clarification"]),
              )}
            </span>{" "}
            <span>{t("importReview.counter.flagged")}</span>
          </li>
          <li>
            <span className="imp-counter-n">{formatNumber(locale, String(counts.states.error))}</span>{" "}
            <span>{t("importReview.counter.rejected")}</span>
          </li>
          {counts.states.excluded > 0 ? (
            <li>
              <span className="imp-counter-n">{formatNumber(locale, String(counts.states.excluded))}</span>{" "}
              <span>{t("importReview.counter.excluded")}</span>
            </li>
          ) : null}
          {counts.changed > 0 ? (
            <li>
              <span className="imp-counter-n">{formatNumber(locale, String(counts.changed))}</span>{" "}
              <span>{t("importReview.counter.changed")}</span>
            </li>
          ) : null}
        </ul>
      ) : null}

      <Segmented
        legend={t("importReview.tabs.label")}
        options={[
          {
            value: "questions",
            label: t("importReview.tab.questions", { count: formatNumber(locale, String(questions)) }),
          },
          { value: "all", label: t("importReview.tab.all") },
        ]}
        value={step.tab}
        onChange={(v) => {
          setSelected(null);
          step.setTab(v as Tab);
        }}
      />

      {step.tab === "all" && counts ? (
        <Select
          label={t("importReview.filter.label")}
          value={step.filter}
          options={[
            {
              value: "all",
              label: t("importReview.filter.all", { count: formatNumber(locale, String(counts.rows)) }),
            },
            ...FILTERS.map((f) => ({
              value: f,
              label: t("importReview.filter.option", {
                label: t(`importReview.filter.${f}` as MessageKey),
                count: formatNumber(locale, String(filterCount(counts, f))),
              }),
            })),
          ]}
          onChange={(v) => {
            setSelected(null);
            step.setFilter(v as ReviewFilter | "all");
          }}
        />
      ) : null}

      {review && review.signGroup.rows > 0 ? <SignGroup file={file} review={review} step={step} /> : null}

      <Duplicates part={step.duplicates} retry={step.retryReview} />

      <RowList step={step} views={views} open={open} onOpen={setSelected} listSize={listSize} />
    </section>
  );
}

function listTotal(review: FileReview, tab: Tab, filter: ReviewFilter | "all"): number {
  if (tab === "questions") return questionCount(review);
  return filter === "all" ? review.counts.rows : filterCount(review.counts, filter);
}

function filterCount(counts: FileReview["counts"], f: ReviewFilter): number {
  if (f === "sign-unconfirmed") return counts.signUnconfirmed;
  if (f === "changed") return counts.changed;
  return counts.states[f];
}

function SignGroup({ file, review, step }: { file: ReviewFile; review: FileReview; step: Step }) {
  const { t, locale } = useI18n();
  const g = review.signGroup;
  const decided = g.action ? GROUP_ACTION[g.action as keyof typeof GROUP_ACTION] : undefined;
  return (
    <section className="imp-group" aria-label={t("importReview.group.title")}>
      <p>
        <Badge tone="attention" label={t("importReview.state.needs-review")} />{" "}
        <b>{t("importReview.group.title")}</b>{" "}
        {t("importReview.group.text", { rows: rowsText(t, locale, g.rows) })}
      </p>
      {decided ? (
        <p className="imp-note ws-muted">
          <Icon name="check" size={16} /> {t(decided)}
        </p>
      ) : null}
      <div className="imp-actions">
        <Decide
          label={t("importReview.group.accept")}
          deciding={step.deciding}
          onClick={() =>
            void step.answer([{ kind: "group", fileId: file.fileId, group: "review", action: "accept" }])
          }
        />
        <Decide
          label={t("importReview.group.flip")}
          deciding={step.deciding}
          onClick={() =>
            void step.answer([{ kind: "group", fileId: file.fileId, group: "review", action: "flip-sign" }])
          }
        />
      </div>
    </section>
  );
}

function Duplicates({ part, retry }: { part: Step["duplicates"]; retry: () => void }) {
  const { t, locale } = useI18n();
  if (part.kind === "loading") return null;
  if (part.kind === "error")
    return (
      <ErrorState
        placement="block"
        text={t("importReview.error.duplicates")}
        code={codeOf(part.failure)}
        onRetry={retry}
      />
    );
  const { items, afterEarlierFile } = part.data;
  const kinds = [...duplicateCounts(items)];
  return (
    <section className="imp-dups" aria-label={t("importReview.dups.title")}>
      <p>
        <b>{t("importReview.dups.title")}</b>{" "}
        {items.length === 0
          ? t("importReview.dups.none")
          : t("importReview.dups.text", {
              rows: rowsText(t, locale, items.length),
              kinds: kinds
                .map(([k, n]) => `${t(DUPLICATE_BADGE[k])}: ${formatNumber(locale, String(n))}`)
                .join(" · "),
            })}
      </p>
      {afterEarlierFile ? <p className="imp-note ws-muted">{t("importReview.dups.afterEarlier")}</p> : null}
    </section>
  );
}

function RowList(p: {
  step: Step;
  views: readonly RowView[];
  open: number | null;
  onOpen: (row: number | null) => void;
  listSize: number;
}) {
  const { t, locale } = useI18n();
  const { listing } = p.step;
  if (listing.status === "loading")
    return (
      <div aria-busy="true">
        <Skeleton variant="row" lines={4} />
      </div>
    );
  if (listing.status === "error" && listing.items.length === 0)
    return (
      <ErrorState
        placement="block"
        text={t("importReview.error.rows")}
        code={listing.failure ? codeOf(listing.failure) : undefined}
        onRetry={p.step.retryList}
      />
    );
  if (listing.items.length === 0)
    return (
      <EmptyState
        placement="area"
        icon="check"
        title={t(
          p.step.tab === "questions"
            ? "importReview.empty.questions.title"
            : "importReview.empty.filter.title",
        )}
        text={t(
          p.step.tab === "questions" ? "importReview.empty.questions.text" : "importReview.empty.filter.text",
        )}
      />
    );
  return (
    <>
      <ul className="imp-rows" aria-label={t("importReview.rows.label")}>
        {p.views.map((v) => (
          <RowItem
            key={v.row.row}
            view={v}
            open={p.open === v.row.row}
            onToggle={() => p.onOpen(p.open === v.row.row ? null : v.row.row)}
            step={p.step}
          />
        ))}
      </ul>
      {listing.status === "error" && listing.failure ? (
        <ErrorState
          placement="block"
          text={t("importReview.error.rows")}
          code={codeOf(listing.failure)}
          onRetry={p.step.retryList}
        />
      ) : null}
      <div className="imp-more">
        <span className="imp-note ws-muted" role="status">
          {t("importReview.shown", {
            shown: formatNumber(locale, String(listing.items.length)),
            total: formatNumber(locale, String(Math.max(p.listSize, listing.items.length))),
          })}
        </span>
        {listing.more && listing.status === "ready" ? (
          <Button label={t("importReview.more")} loading={listing.loadingMore} onClick={p.step.more} />
        ) : null}
      </div>
    </>
  );
}

function RowItem({
  view,
  open,
  onToggle,
  step,
}: {
  view: RowView;
  open: boolean;
  onToggle: () => void;
  step: Step;
}) {
  const { t } = useI18n();
  const { row } = view;
  const detail = useId();
  const badge = STATE_BADGE[row.state];
  return (
    <li className="imp-r" data-state={row.state} data-open={open || undefined}>
      <button
        type="button"
        className="imp-r-line"
        aria-expanded={open}
        aria-controls={detail}
        onClick={onToggle}
      >
        <span className="imp-r-date">{view.date ?? t("importReview.row.n", { row: row.row })}</span>
        <span className="imp-r-text">{view.text ?? ""}</span>
        <span className="imp-r-amount">{view.amount ?? ""}</span>
        <span className="imp-r-marks">
          {badge ? <Badge tone={badge.tone} label={t(badge.key)} /> : null}
          {row.changed ? <Badge tone="info" label={t("importReview.state.changed")} /> : null}
          {view.duplicate ? <Badge tone="attention" label={t(DUPLICATE_BADGE[view.duplicate.kind])} /> : null}
        </span>
      </button>
      <div id={detail} className="imp-r-detail" hidden={!open}>
        {open ? <RowDetail view={view} step={step} /> : null}
      </div>
    </li>
  );
}

const DUPLICATE_TEXT = {
  repeat: "importReview.duplicate.text.repeat",
  duplicate: "importReview.duplicate.text.duplicate",
  "already-imported": "importReview.duplicate.text.already-imported",
  merge: "importReview.duplicate.text.merge",
  "possible-duplicate": "importReview.duplicate.text.possible-duplicate",
  replace: "importReview.duplicate.text.replace",
} as const satisfies Record<Duplicate["kind"], MessageKey>;

function RowDetail({ view, step }: { view: RowView; step: Step }) {
  const { t, locale } = useI18n();
  const { row } = view;
  const file = step.fileId!;
  const send = (d: DecisionInput) => void step.answer([d]);
  const act = (label: MessageKey, action: "accept" | "flip-sign" | "exclude" | "include") => (
    <Decide
      key={action}
      label={t(label)}
      deciding={step.deciding}
      onClick={() => send({ kind: "row", fileId: file, row: row.row, action })}
    />
  );
  const reading = row.reading;
  return (
    <div className="imp-r-body">
      {reading && reading.readings.length > 0 ? (
        <>
          <p>
            <b>{t("importReview.reading.title", { cell: reading.cell })}</b>{" "}
            {t("importReview.reading.text", {
              values: new Intl.ListFormat(locale === "uk" ? "uk-UA" : "en-GB", {
                type: "disjunction",
              }).format(reading.readings.map((r) => formatNumber(locale, r.value))),
            })}
          </p>
          <details className="imp-why">
            <summary>{t("importReview.reading.why")}</summary>
            <ul>
              {reading.evidence.length === 0 ? <li>{t("importReview.reading.noEvidence")}</li> : null}
              {reading.evidence.map((e, i) => (
                <li key={`${e.code}-${i}`}>
                  {EVIDENCE.has(e.code)
                    ? t(`importReview.evidence.${e.code}` as MessageKey, {
                        count: e.count ?? 0,
                        of: e.of ?? 0,
                        example: e.example ?? "",
                        column: e.column ?? 0,
                      })
                    : t("importReview.evidence.other", { code: e.code })}
                </li>
              ))}
            </ul>
          </details>
          <div className="imp-actions">
            {reading.readings.map((r) => (
              <Decide
                key={r.value}
                label={t("importReview.reading.choose", { value: formatNumber(locale, r.value) })}
                variant={reading.chosen === r.value ? "primary" : "secondary"}
                deciding={step.deciding}
                onClick={() =>
                  send({ kind: "reading", fileId: file, row: row.row, value: r.value, applyToFile: false })
                }
              />
            ))}
          </div>
        </>
      ) : null}
      {row.signUnconfirmed && row.sign ? (
        <p>
          <b>{t("importReview.sign.title")}</b>{" "}
          {t("importReview.sign.text", {
            basis: t(
              row.sign.basis in SIGN_BASIS
                ? SIGN_BASIS[row.sign.basis as keyof typeof SIGN_BASIS]
                : "importReview.sign.basis.other",
            ),
          })}
        </p>
      ) : null}
      {row.issue ? (
        <p>
          <b>{t("importReview.issue.title")}</b>{" "}
          {t(row.issue in ISSUE ? ISSUE[row.issue as keyof typeof ISSUE] : "importReview.issue.other")}
        </p>
      ) : null}
      {row.state === "excluded" ? <p>{t("importReview.excluded.text")}</p> : null}
      {row.changed ? <p>{t("importReview.changed.text")}</p> : null}
      {view.duplicate ? (
        <p>{t(DUPLICATE_TEXT[view.duplicate.kind], { count: view.duplicate.transactionIds.length })}</p>
      ) : null}
      <div className="imp-actions">
        {row.state === "needs-review" ? act("importReview.action.accept", "accept") : null}
        {row.sign && row.state !== "excluded" ? act("importReview.action.flip", "flip-sign") : null}
        {row.state === "excluded"
          ? act("importReview.action.include", "include")
          : act("importReview.action.exclude", "exclude")}
      </div>
    </div>
  );
}
