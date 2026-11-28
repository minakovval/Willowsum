import { useMemo, useState } from "react";
import { useI18n, useT } from "@willowsum/i18n";
import { Button, ConfirmDialog, EmptyState, ErrorState, Progress, Skeleton, Toast } from "@willowsum/ui";
import { useAuthApi } from "../../auth/api.ts";
import { AppLayout } from "../../pages/AppLayout.tsx";
import { childPath, TRANSACTIONS } from "../../routing/routes.ts";
import { hrefFor } from "../../routing/useHashPath.ts";
import { useDocumentTitle } from "../../useDocumentTitle.ts";
import { deleteHistoryFile } from "../history/api.ts";
import { HistoryUploadDialog } from "../history/HistoryUploadDialog.tsx";
import type { Condition, RuleBody } from "../api.ts";
import { RuleDialog } from "../RuleDialog.tsx";
import { AcceptDialog, AcceptNotice, type Done } from "./AcceptDialog.tsx";
import {
  conditionsOf,
  GROUPS,
  groupOf,
  itemOf,
  rejectSuggestion,
  restartDerivation,
  selectedByDefault,
  useSuggestions,
  type DerivationRun,
  type GroupId,
  type Page,
  type Suggestion,
} from "./api.ts";
import { Group, SuggestionRow } from "./SuggestionRows.tsx";
import "./suggestions.css";

/**
 * S-301 «Гроші › Транзакції › Правила › Пропозиції» (BUD-21@PoC i), FR 21–23, AC20, AC21, AC24–AC26; BUD-14 FR 16;
 * canvas PocMoneySuggestions, PocMoneySuggestionsStates and the «Тексти» board PocMoneySuggestionsTexts): the check on
 * the user's history, the groups «Впевнені», «Суперечливі» and «Переказ» with the evidence and exceptions of each
 * suggestion, the pencil (S-198 changes only the suggestion), «Відхилити», «Видалити файл» and the bar «Прийняти вибране».
 * A suggestion is not a rule: nothing is created before the acceptance (S-302). The server decides what is selected,
 * matched and in conflict; the page holds the user's choices and sends them in one request.
 */
export function SuggestionsPage() {
  const t = useT();
  useDocumentTitle(t("suggestions.title"));
  return (
    <AppLayout sectionId="money" pageId={TRANSACTIONS.id}>
      <div className="sug-page">
        <nav className="ws-breadcrumbs" aria-label={t("shell.breadcrumbs")}>
          <ol>
            <li>{t("shell.nav.money")}</li>
            <li>
              <a href={hrefFor(TRANSACTIONS.path)}>{t(TRANSACTIONS.label)}</a>
            </li>
            <li>
              <a href={hrefFor(childPath("rules"))}>{t("rules.crumb")}</a>
            </li>
            <li aria-current="page">{t("suggestions.crumb")}</li>
          </ol>
        </nav>
        <Body />
      </div>
    </AppLayout>
  );
}

type Open =
  | { readonly kind: "none" }
  | { readonly kind: "upload" }
  | { readonly kind: "delete" }
  | { readonly kind: "accept" }
  | { readonly kind: "edit"; readonly ordinal: number };

function Body() {
  const t = useT();
  const api = useAuthApi();
  const { page, refs, reload, retry } = useSuggestions();
  const [open, setOpen] = useState<Open>({ kind: "none" });
  const [done, setDone] = useState<Done | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState(false);
  const [deleteError, setDeleteError] = useState<string | undefined>();
  const [toast, setToast] = useState<{ key: number; text: string } | null>(null);
  // The user's own choices by ordinal; a suggestion without one follows the server's default (FR 21).
  const [touched, setTouched] = useState<ReadonlyMap<number, boolean>>(new Map());
  const [edits, setEdits] = useState<ReadonlyMap<number, RuleBody>>(new Map());

  const view = page.kind === "ready" ? page.view : null;
  const suggestions = useMemo(() => view?.suggestions ?? [], [view]);
  const say = (text: string) => setToast((p) => ({ key: (p?.key ?? 0) + 1, text }));
  const checked = (s: Suggestion) => touched.get(s.ordinal) ?? selectedByDefault(s);
  /** A suggestion whose category is gone cannot be accepted until the pencil gives it another one. */
  const canSelect = (s: Suggestion) => !s.categoryDeleted || edits.has(s.ordinal);
  const isSelected = (s: Suggestion) => canSelect(s) && checked(s);
  const selected = suggestions.filter(isSelected);

  const groups = useMemo(() => {
    const by: Record<GroupId, Suggestion[]> = { confident: [], conflicting: [], transfer: [] };
    for (const s of suggestions) by[groupOf(s)].push(s);
    return by;
  }, [suggestions]);

  const choose = (rows: readonly Suggestion[], on: boolean) =>
    setTouched((m) => {
      const next = new Map(m);
      for (const s of rows) if (canSelect(s)) next.set(s.ordinal, on);
      return next;
    });

  const reject = async (rows: readonly Suggestion[]) => {
    if (busy || !view) return;
    setBusy(true);
    setFailure(false);
    let ok = true;
    for (const s of rows) {
      const o = await rejectSuggestion(api, view.derivation.id, s.ordinal);
      if (!o.ok) {
        ok = false;
        break;
      }
    }
    setBusy(false);
    if (ok) say(t("suggestions.rejected"));
    else setFailure(true);
    reload();
  };

  const remove = async (run: DerivationRun) => {
    if (busy) return;
    setBusy(true);
    setDeleteError(undefined);
    const o = await deleteHistoryFile(api, run.batchId);
    setBusy(false);
    if (!o.ok) return setDeleteError(t("rules.error.action"));
    setOpen({ kind: "none" });
    setTouched(new Map());
    setEdits(new Map());
    reload();
  };

  const header = (
    <div className="sug-head">
      <div className="sug-head-text">
        <h1>{t("suggestions.title")}</h1>
        {page.kind === "ready" ? (
          <p className="ws-muted">
            {page.fileName ? t("suggestions.intro", { name: page.fileName }) : t("suggestions.introNoName")}
          </p>
        ) : null}
      </div>
      {page.kind === "off" || page.kind === "loading" ? null : (
        <div className="sug-head-actions" role="group" aria-label={t("suggestions.title")}>
          {page.kind === "ready" ? (
            <Button
              icon="trash"
              label={t("history.delete")}
              onClick={() => {
                setDeleteError(undefined);
                setOpen({ kind: "delete" });
              }}
            />
          ) : null}
          <Button
            icon="upload"
            label={t("history.action.upload")}
            onClick={() => setOpen({ kind: "upload" })}
          />
        </div>
      )}
    </div>
  );

  let content;
  if (page.kind === "loading")
    content = (
      <div className="ws-card" aria-busy="true">
        <Skeleton variant="row" lines={6} />
      </div>
    );
  else if (page.kind === "off") content = <p className="ws-muted">{t("history.unavailable")}</p>;
  else if (page.kind === "error")
    content = (
      <ErrorState placement="block" text={t("suggestions.error")} code={page.supportId} onRetry={retry} />
    );
  else if (page.kind === "none")
    content = (
      <EmptyState
        placement="block"
        title={t("suggestions.empty.title")}
        text={t("suggestions.empty.text")}
        primary={{ label: t("history.action.upload"), onClick: () => setOpen({ kind: "upload" }) }}
      />
    );
  else if (page.run.status === "running")
    content = (
      <section className="ws-card sug-progress" aria-busy="true">
        <Progress
          label={t("history.loading.deriveName")}
          value={page.run.processed}
          max={Math.max(page.run.count, 1)}
          text={t("history.loading.derive", { done: page.run.processed, total: page.run.count })}
        />
        <Skeleton variant="row" lines={4} />
      </section>
    );
  else if (page.run.status === "failed" || !page.view)
    content = (
      <ErrorState
        placement="block"
        text={t("suggestions.error")}
        onRetry={() => {
          if (page.kind !== "ready") return;
          void restartDerivation(api, page.run.batchId).then(retry);
        }}
      />
    );
  else
    content = (
      <>
        <Check view={page.view} />
        {suggestions.length === 0 ? (
          <EmptyState
            placement="block"
            title={t("suggestions.empty.title")}
            text={t(
              page.view.check?.status === "too_short" ? "suggestions.empty.short" : "suggestions.empty.text",
            )}
            {...(page.view.check?.status === "too_short"
              ? {}
              : {
                  primary: { label: t("history.action.upload"), onClick: () => setOpen({ kind: "upload" }) },
                })}
          />
        ) : (
          GROUPS.filter((g) => groups[g].length > 0).map((g) => (
            <Group
              key={g}
              id={g}
              rows={groups[g]}
              isSelected={isSelected}
              canSelect={canSelect}
              onSelectAll={(on) => choose(groups[g], on)}
            >
              {groups[g].map((s) => (
                <SuggestionRow
                  key={s.ordinal}
                  s={s}
                  refs={refs}
                  checked={isSelected(s)}
                  disabled={!canSelect(s)}
                  edited={edits.get(s.ordinal)}
                  busy={busy}
                  onToggle={(on) => choose([s], on)}
                  onEdit={() => setOpen({ kind: "edit", ordinal: s.ordinal })}
                  onReject={() => void reject([s])}
                />
              ))}
            </Group>
          ))
        )}
      </>
    );

  const editing = open.kind === "edit" ? suggestions.find((s) => s.ordinal === open.ordinal) : undefined;
  const none =
    selected.length === 0 ? ({ disabled: true, disabledReason: t("suggestions.bar.none") } as const) : {};
  const tagsOf = (s: Suggestion) => edits.get(s.ordinal)?.tags ?? s.tags;
  return (
    <>
      {header}
      {failure ? (
        <p className="rules-failure" role="alert">
          {t("rules.error.action")}
        </p>
      ) : null}
      {done ? (
        <AcceptNotice done={done} onChange={setDone} onDismiss={() => setDone(null)} onReload={reload} />
      ) : null}
      {content}
      {view && suggestions.length > 0 ? (
        <div className="sug-bar" role="region" aria-label={t("suggestions.bar")}>
          <strong>{t("suggestions.bar.selected", { count: selected.length })}</strong>
          <div className="sug-bar-actions">
            <Button label={t("suggestions.bar.reject")} {...none} onClick={() => void reject(selected)} />
            <Button
              variant="primary"
              label={t("suggestions.bar.accept")}
              {...none}
              onClick={() => setOpen({ kind: "accept" })}
            />
          </div>
        </div>
      ) : null}

      {open.kind === "upload" ? <HistoryUploadDialog onClose={() => setOpen({ kind: "none" })} /> : null}
      <ConfirmDialog
        open={open.kind === "delete"}
        onClose={() => setOpen({ kind: "none" })}
        title={t("history.delete.title")}
        text={t("history.delete.text")}
        closeLabel={t("shell.close")}
        cancelLabel={t("dialog.form.cancel")}
        confirmLabel={t("history.delete")}
        busyLabel={t("history.delete.busy")}
        busy={busy}
        error={deleteError}
        onConfirm={() => page.kind === "ready" && void remove(page.run)}
      />
      {open.kind === "accept" && view ? (
        <AcceptDialog
          derivationId={view.derivation.id}
          items={selected.map((s) => itemOf(s.ordinal, edits.get(s.ordinal)))}
          tags={selected.flatMap(tagsOf)}
          conflicting={selected.filter((s) => s.conflict !== null).length}
          transferRules={selected.filter((s) => s.action === "transfer").length}
          onClose={() => {
            setOpen({ kind: "none" });
            reload();
          }}
          onDone={(result) => {
            setOpen({ kind: "none" });
            setDone(result);
            setTouched(new Map());
            setEdits(new Map());
            reload();
          }}
        />
      ) : null}
      {editing ? (
        <RuleDialog
          rule={null}
          refs={refs}
          suggestion={{
            conditions:
              (edits.get(editing.ordinal)?.conditions as Condition[] | undefined) ?? conditionsOf(editing),
            categoryId: edits.get(editing.ordinal)?.categoryId ?? editing.categoryId,
            tags: tagsOf(editing),
          }}
          onClose={() => setOpen({ kind: "none" })}
          onSuggestion={(body) => {
            // FR 21: the changed suggestion becomes selected; no rule is created.
            setEdits((m) => new Map(m).set(editing.ordinal, body));
            setTouched((m) => new Map(m).set(editing.ordinal, true));
            setOpen({ kind: "none" });
          }}
        />
      ) : null}
      {toast ? (
        <Toast
          key={toast.key}
          text={toast.text}
          closeLabel={t("shell.close")}
          onDismiss={() => setToast(null)}
        />
      ) : null}
    </>
  );
}

/** FR 18, FR 19, AC20, AC21: the check on the user's history, and the warning that the file's descriptions differ from the bank's. */
function Check({ view }: { view: NonNullable<Extract<Page, { kind: "ready" }>["view"]> }) {
  const { t } = useI18n();
  const { check, existing } = view;
  const percent = (part: number, whole: number) => (whole > 0 ? Math.round((part * 100) / whole) : 0);
  // `check.rows` of a ready check is the latest 20 % of the file's rows by date (the ones it was tested on); the rest
  // of the derivation's rows is what the rules were derived from.
  const last = check?.rows ?? 0;
  const first = Math.max(0, view.derivation.count - last);
  return (
    <>
      {check ? (
        <section className="ws-card sug-check-card" aria-labelledby="sug-check-title">
          <h2 id="sug-check-title">{t("suggestions.check.title")}</h2>
          {check.status === "ready" && check.covered !== null && check.agreeing !== null ? (
            <>
              <div className="sug-check-numbers">
                <p>
                  <strong>
                    {t("suggestions.check.coverage", { percent: percent(check.covered, check.rows) })}
                  </strong>
                  <span className="ws-muted">{t("suggestions.check.coverage.hint", { last })}</span>
                </p>
                <p>
                  <strong>
                    {t("suggestions.check.match", { percent: percent(check.agreeing, check.covered) })}
                  </strong>
                  <span className="ws-muted">{t("suggestions.check.match.hint")}</span>
                </p>
              </div>
              <p className="ws-muted">{t("suggestions.check.basis", { first, last })}</p>
            </>
          ) : (
            <p className="ws-muted">
              {t("suggestions.check.short", { minimum: check.minimum, count: check.rows })}
            </p>
          )}
        </section>
      ) : null}
      {existing?.descriptionsDiffer ? (
        <p className="sug-warning" role="status">
          <span aria-hidden="true">! </span>
          {t("suggestions.warning.descriptions", { matched: existing.matched, total: existing.imported })}
        </p>
      ) : null}
    </>
  );
}
