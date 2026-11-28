import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n, useT } from "@willowsum/i18n";
import { Button, ConfirmDialog, ErrorState, Progress, Skeleton } from "@willowsum/ui";
import { isUnavailable, useAuthApi, type Outcome } from "../../auth/api.ts";
import { AppLayout } from "../../pages/AppLayout.tsx";
import { NotFoundPage } from "../../pages/NotFoundPage.tsx";
import { childPath, historyReviewIdOf, TRANSACTIONS } from "../../routing/routes.ts";
import { hrefFor, useHashPath } from "../../routing/useHashPath.ts";
import { loadCategories, type Categories } from "../../transactions/review.ts";
import { useDocumentTitle } from "../../useDocumentTitle.ts";
import { loadAccounts, type AccountRef } from "../api.ts";
import {
  confirmHistoryFile,
  deleteHistoryFile,
  loadDerivation,
  loadHistoryFile,
  rereadHistoryFile,
  startDerivation,
  type Confirmed,
  type Derivation,
  type HistoryView,
  type Reread,
} from "./api.ts";
import { confirmBody, createdCount, hasInvalidName, NO_ANSWERS, type Answers } from "./model.ts";
import {
  AccountsSection,
  FIRST_ROLE,
  QuestionsSection,
  ReadSection,
  SummarySection,
  TransfersSection,
  TreeSection,
} from "./ReviewSections.tsx";
import "./history.css";

/**
 * S-299 «Файл історії · Перевірка розпізнавання» (BUD-21@PoC FR 2, FR 4–6, AC1–AC4, AC6–AC9; canvas
 * PocMoneyHistoryReview, PocMoneyHistoryReviewError; texts PocMoneyHistoryReviewTexts): how the file was read — roles
 * of the columns, examples, the file's categories with what happens to each, the transfer values, the accounts, the
 * summary — and the corrections in one click each. Nothing is created or derived before «Підтвердити і вивести
 * правила»; the corrections live on the screen until then and go in that one request.
 */
const POLL_MS = 1000;

type Load =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly view: HistoryView }
  | { readonly kind: "missing" }
  | { readonly kind: "off" }
  | { readonly kind: "error"; readonly supportId?: string | undefined };

export function HistoryReviewPage() {
  const batchId = historyReviewIdOf(useHashPath()) ?? "";
  return <ReviewPage key={batchId} batchId={batchId} />;
}

function useHistoryFile(batchId: string) {
  const api = useAuthApi();
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const fail = (o: Extract<Outcome<unknown>, { ok: false }>): Load =>
    o.kind === "problem" && o.problem.code === "NOT_FOUND"
      ? isUnavailable(o) && o.problem.detail?.includes("feature")
        ? { kind: "off" }
        : { kind: "missing" }
      : { kind: "error", supportId: o.kind === "problem" ? o.supportId : undefined };
  const reload = useCallback(async () => {
    const o = await loadHistoryFile(api, batchId);
    setLoad(o.ok ? { kind: "ready", view: o.data } : fail(o));
  }, [api, batchId]);
  useEffect(() => {
    let live = true;
    void loadHistoryFile(api, batchId).then((o) => {
      if (live) setLoad(o.ok ? { kind: "ready", view: o.data } : fail(o));
    });
    return () => {
      live = false;
    };
  }, [api, batchId]);
  // The file is read in the background: ask again until it is read (or refused).
  const processing = load.kind === "ready" && load.view.batch.state === "processing";
  useEffect(() => {
    if (!processing) return;
    const id = setTimeout(() => void reload(), POLL_MS);
    return () => clearTimeout(id);
  }, [processing, load, reload]);
  return { load, setLoad, reload, retry: () => (setLoad({ kind: "loading" }), void reload()) };
}

function useRefs() {
  const api = useAuthApi();
  const [categories, setCategories] = useState<Categories | null>(null);
  const [accounts, setAccounts] = useState<readonly AccountRef[]>([]);
  useEffect(() => {
    let live = true;
    void Promise.all([loadCategories(api), loadAccounts(api)]).then(([c, a]) => {
      if (!live) return;
      setCategories(c.kind === "ready" ? c.data : null);
      setAccounts(a);
    });
    return () => {
      live = false;
    };
  }, [api]);
  return { categories, accounts };
}

function ReviewPage({ batchId }: { batchId: string }) {
  const t = useT();
  const title = t("history.review.title");
  useDocumentTitle(title);
  const { load, setLoad, retry } = useHistoryFile(batchId);
  if (load.kind === "missing") return <NotFoundPage />;
  const rules = childPath("rules");
  return (
    <AppLayout sectionId="money" pageId={TRANSACTIONS.id}>
      <div className="hist-page">
        <nav className="ws-breadcrumbs" aria-label={t("shell.breadcrumbs")}>
          <ol>
            <li>{t("shell.nav.money")}</li>
            <li>
              <a href={hrefFor(TRANSACTIONS.path)}>{t(TRANSACTIONS.label)}</a>
            </li>
            <li>
              <a href={hrefFor(rules)}>{t("rules.crumb")}</a>
            </li>
            <li aria-current="page">{t("history.review.crumb")}</li>
          </ol>
        </nav>
        {load.kind === "loading" ? (
          <div aria-busy="true" aria-label={t("history.review.loadingName")}>
            <h1 className="ws-text-heading-2">{title}</h1>
            <div className="ws-card hist-card">
              <Skeleton variant="row" lines={6} />
            </div>
          </div>
        ) : load.kind === "off" ? (
          <p role="status">{t("history.unavailable")}</p>
        ) : load.kind === "error" ? (
          <ErrorState
            placement="block"
            text={t("history.error.load")}
            code={load.supportId}
            onRetry={retry}
          />
        ) : load.kind === "ready" ? (
          <ReviewBody
            batchId={batchId}
            view={load.view}
            title={title}
            onView={(view) => setLoad({ kind: "ready", view })}
            onReload={retry}
          />
        ) : null}
      </div>
    </AppLayout>
  );
}

type DerivationRun = Pick<Derivation["derivation"], "id" | "status" | "count" | "processed">;
type Derived =
  | { readonly kind: "none" }
  | { readonly kind: "run"; readonly run: DerivationRun }
  | { readonly kind: "failed" };

function ReviewBody({
  batchId,
  view,
  title,
  onView,
  onReload,
}: {
  batchId: string;
  view: HistoryView;
  title: string;
  onView: (view: HistoryView) => void;
  onReload: () => void;
}) {
  const { t, locale } = useI18n();
  const api = useAuthApi();
  const { categories, accounts } = useRefs();
  const [answers, setAnswers] = useState<Answers>(NO_ANSWERS);
  const [busy, setBusy] = useState<null | "reread" | "confirm" | "delete">(null);
  const [failure, setFailure] = useState<{ text: string; code?: string | undefined } | null>(null);
  const [asking, setAsking] = useState(false);
  const [derived, setDerived] = useState<Derived>({ kind: "none" });
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  const rec = view.recognition;
  const confirmed = view.confirmed !== null;
  const locked = confirmed || busy !== null || view.batch.state !== "parsed";
  const nameOf = useMemo(() => {
    const byId = categories?.byId;
    return (id: string) => byId?.get(id)?.name ?? null;
  }, [categories]);

  const change = (next: Partial<Answers>) => setAnswers((a) => ({ ...a, ...next }));
  const say = (text: string, code?: string) => setFailure({ text, code });

  const reread = async (body: Reread) => {
    if (busy) return;
    setBusy("reread");
    setFailure(null);
    const o = await rereadHistoryFile(api, batchId, body);
    if (!alive.current) return;
    setBusy(null);
    if (o.ok) {
      // The labels may be different now: the earlier answers of the user are about the earlier read.
      setAnswers((a) => ({ ...NO_ANSWERS, dateAnswered: a.dateAnswered }));
      onView(o.data);
    } else say(t("history.error.reread"), o.kind === "problem" ? o.supportId : undefined);
  };

  const follow = useCallback(
    async (id: string) => {
      for (;;) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        if (!alive.current) return;
        const o = await loadDerivation(api, id);
        if (!alive.current) return;
        if (!o.ok) return setDerived({ kind: "failed" });
        setDerived({ kind: "run", run: o.data.derivation });
        if (o.data.derivation.status !== "running") return;
      }
    },
    [api],
  );

  const confirm = async () => {
    if (!rec || busy) return;
    setBusy("confirm");
    setFailure(null);
    const o = await confirmHistoryFile(api, batchId, confirmBody(view.parseId, rec, answers, accounts));
    if (!alive.current) return;
    setBusy(null);
    if (!o.ok) {
      const code = o.kind === "problem" ? o.problem.code : undefined;
      if (code === "BATCH_STATE_CONFLICT" || code === "HISTORY_NOT_READY") {
        say(t("history.error.stale"));
        onReload();
      } else say(t("history.error.confirm"), o.kind === "problem" ? o.supportId : undefined);
      return;
    }
    const { derivation, ...next } = o.data as Confirmed;
    onView(next);
    if (!derivation) return setDerived({ kind: "failed" });
    setDerived({ kind: "run", run: derivation });
    if (derivation.status === "running") void follow(derivation.id);
  };

  const retryDerivation = async () => {
    setDerived({ kind: "none" });
    const o = await startDerivation(api, batchId);
    if (!alive.current) return;
    if (!o.ok) return setDerived({ kind: "failed" });
    setDerived({ kind: "run", run: o.data.derivation });
    if (o.data.derivation.status === "running") void follow(o.data.derivation.id);
  };

  const remove = async () => {
    setBusy("delete");
    setFailure(null);
    const o = await deleteHistoryFile(api, batchId);
    if (!alive.current) return;
    setBusy(null);
    if (o.ok) window.location.hash = childPath("rules");
    else say(t("history.error.delete"), o.kind === "problem" ? o.supportId : undefined);
  };

  const missing = rec?.missing ?? [];
  const mapping = rec?.mapping ?? null;
  const invalid = mapping ? hasInvalidName(mapping, answers, nameOf) : false;
  const blocked =
    confirmed || !view.canConfirm || invalid
      ? invalid
        ? t("history.tree.invalid", {
            name:
              mapping?.labels.find((l) => l.outcome.action === "create" && l.outcome.name === null)
                ?.category ?? "",
          })
        : missing.length > 0
          ? t("history.error.noCategorisation")
          : t("history.confirm.note", { count: 0 })
      : null;

  const head = (
    <div className="hist-head">
      <h1 className="ws-text-heading-2">{title}</h1>
      {rec ? (
        <p className="ws-muted">
          {t("history.review.intro", { name: view.batch.fileName, count: rec.table.dataRows })}
        </p>
      ) : null}
    </div>
  );

  if (view.batch.state === "processing" || view.parse.state === "pending")
    return (
      <>
        {head}
        <section className="ws-card hist-card" aria-busy="true">
          <p className="hist-strong">{t("history.upload.progress", { name: view.batch.fileName })}</p>
          <Progress label={t("history.upload.progress", { name: view.batch.fileName })} />
          <p className="ws-muted">{t("history.upload.step")}</p>
        </section>
      </>
    );

  if (view.batch.state === "failed" || !rec)
    return (
      <>
        {head}
        <section className="ws-card hist-card" role="alert">
          <p>
            {t("history.error.refused", {
              reason: view.parse.refusal
                ? view.parse.refusal.message[locale === "uk" ? "uk" : "en"]
                : t("history.upload.error.read"),
            })}
          </p>
          <div className="hist-bar">
            <Button label={t("history.leave")} href={hrefFor(childPath("rules"))} />
            <Button label={t("history.delete")} icon="trash" onClick={() => setAsking(true)} />
          </div>
        </section>
        <DeleteDialog
          open={asking}
          busy={busy === "delete"}
          failed={failure?.text}
          onClose={() => setAsking(false)}
          onConfirm={() => void remove()}
        />
      </>
    );

  return (
    <>
      {head}
      {failure ? (
        <p className="hist-failure" role="alert">
          {failure.text}
          {failure.code ? ` ${t("state.error.code", { code: failure.code })}` : ""}
        </p>
      ) : null}
      {busy === "reread" || view.batch.state !== "parsed" ? (
        <p className="ws-muted" role="status">
          {t("history.loading.reread")}
        </p>
      ) : null}

      {missing.length > 0 ? (
        <section className="hist-missing" role="alert">
          {missing.includes("date") ? <p>{t("history.error.noDate")}</p> : null}
          {missing.includes("amount") ? <p>{t("history.error.noAmount")}</p> : null}
          {missing.includes("description") ? <p>{t("history.error.noDescription")}</p> : null}
          {missing.includes("categories") ? <p>{t("history.error.noCategorisation")}</p> : null}
          <Button
            label={t("history.error.markColumn")}
            onClick={() => document.getElementById(`${FIRST_ROLE}-control`)?.focus()}
          />
        </section>
      ) : null}

      <ReadSection rec={rec} locked={locked} onReread={(b) => void reread(b)} />
      <QuestionsSection
        rec={rec}
        answers={answers}
        change={change}
        locked={locked}
        onReread={(b) => void reread(b)}
      />
      <TreeSection
        rec={rec}
        answers={answers}
        change={change}
        locked={locked}
        categories={categories}
        nameOf={nameOf}
      />
      <div className="hist-pair">
        <TransfersSection rec={rec} answers={answers} change={change} locked={locked} />
        <AccountsSection rec={rec} answers={answers} change={change} locked={locked} accounts={accounts} />
      </div>
      <SummarySection rec={rec} />

      <Derivation derived={derived} confirmed={confirmed} onRetry={() => void retryDerivation()} />

      <div className="hist-footer">
        <div className="hist-bar">
          <Button label={t("history.leave")} href={hrefFor(childPath("rules"))} />
          <Button
            label={t("history.delete")}
            icon="trash"
            onClick={() => setAsking(true)}
            {...(busy ? { disabled: true as const, disabledReason: t("history.loading.reread") } : {})}
          />
        </div>
        {confirmed ? null : (
          <>
            <p className="hist-note ws-muted">
              {t("history.confirm.note", { count: mapping ? createdCount(mapping, answers, nameOf) : 0 })}
            </p>
            <Button
              variant="primary"
              label={t("history.confirm")}
              loading={busy === "confirm"}
              onClick={() => void confirm()}
              {...(blocked !== null || busy === "reread" || view.batch.state !== "parsed"
                ? { disabled: true as const, disabledReason: blocked ?? t("history.loading.reread") }
                : {})}
            />
          </>
        )}
      </div>
      <p className="hist-note ws-muted">{t("history.leave.note")}</p>
      <DeleteDialog
        open={asking}
        busy={busy === "delete"}
        failed={failure?.text}
        onClose={() => setAsking(false)}
        onConfirm={() => void remove()}
      />
    </>
  );
}

function DeleteDialog({
  open,
  busy,
  failed,
  onClose,
  onConfirm,
}: {
  open: boolean;
  busy: boolean;
  failed: string | undefined;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const t = useT();
  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      title={t("history.delete.title")}
      text={t("history.delete.text")}
      closeLabel={t("shell.close")}
      cancelLabel={t("dialog.form.cancel")}
      confirmLabel={t("history.delete")}
      busyLabel={t("history.delete.busy")}
      busy={busy}
      error={failed}
      onConfirm={onConfirm}
    />
  );
}

/** FR 10: after the confirmation the derivation runs: «оброблено X з N рядків», then done or «Не вдалося вивести правила». */
function Derivation({
  derived,
  confirmed,
  onRetry,
}: {
  derived: Derived;
  confirmed: boolean;
  onRetry: () => void;
}) {
  const t = useT();
  if (derived.kind === "failed")
    return <ErrorState placement="block" text={t("history.derive.error")} onRetry={onRetry} role="alert" />;
  if (derived.kind === "none")
    return confirmed ? (
      <p role="status" className="hist-done">
        {t("history.derived.confirmed")}
      </p>
    ) : null;
  const run = derived.run;
  if (run.status === "failed")
    return <ErrorState placement="block" text={t("history.derive.error")} onRetry={onRetry} role="alert" />;
  if (run.status === "running")
    return (
      <section className="ws-card hist-card" aria-busy="true">
        <Progress
          label={t("history.loading.deriveName")}
          value={run.processed}
          max={Math.max(run.count, 1)}
          text={t("history.loading.derive", { done: run.processed, total: run.count })}
        />
      </section>
    );
  return (
    <p role="status" className="hist-done">
      {t("history.derived")} <a href={hrefFor(childPath("rules"))}>{t("history.derive.toRules")}</a>
    </p>
  );
}
