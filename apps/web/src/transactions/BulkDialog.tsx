import { useEffect, useMemo, useRef, useState } from "react";
import { newIdempotencyKey } from "@willowsum/api-contract";
import { useI18n } from "@willowsum/i18n";
import { Button, Dialog, Field, SearchSelect, type SearchGroup } from "@willowsum/ui";
import { outcome, useAuthApi } from "../auth/api.ts";
import {
  ACTION_NAME,
  bulkFailure,
  issueText,
  parseTags,
  plural,
  previewBulk,
  reasonsText,
  reasonText,
  setTracked,
  skippedCount,
  startBulk,
  type BulkAction,
  type BulkBody,
  type BulkFailure,
  type BulkPreview,
  type BulkReport,
  type BulkSelection,
} from "./bulk.ts";

type CategoryGroups = {
  id: string;
  name: string;
  kind: string;
  categories: { id: string; name: string; hidden: boolean }[];
}[];

const TITLE = {
  setCategory: "bulk.title.setCategory",
  addTags: "bulk.title.addTags",
  confirmCategory: "bulk.title.confirmCategory",
} as const;
const LABEL = {
  setCategory: "bulk.action.setCategory",
  addTags: "bulk.action.addTags",
  confirmCategory: "bulk.action.confirmCategory",
} as const;

/** The categories a transaction may take: of the space's tree, not service ones, not hidden (BUD-01 FR 6). */
function useCategoryGroups(enabled: boolean): SearchGroup[] | null {
  const api = useAuthApi();
  const [groups, setGroups] = useState<CategoryGroups | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void outcome(api.GET("/v1/categories")).then((o) => {
      if (live) setGroups(o.ok ? (o.data.groups as CategoryGroups) : []);
    });
    return () => {
      live = false;
    };
  }, [api, enabled]);
  return useMemo(
    () =>
      groups
        ?.filter((g) => g.kind !== "service")
        .map((g) => ({
          id: g.id,
          title: g.name,
          options: g.categories.filter((c) => !c.hidden).map((c) => ({ value: c.id, label: c.name })),
        }))
        .filter((g) => g.options.length > 0) ?? null,
    [groups],
  );
}

type Preview =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly data: BulkPreview }
  | { readonly kind: "error"; readonly failure: BulkFailure };

/**
 * S-036 «Дії з вибраними» (DAT-03@PoC FR 2–3, «Стани інтерфейсу» «Підсумок»; canvas PocBulk): the value of the action,
 * then «Що станеться» — how many change, how many are skipped and why, with examples, whether it runs in the background
 * and can be undone — read from the server without writing; «Скасувати» and the main button named after the action.
 * `names` — the names of the rows the list knows, for the examples; a record it does not know is not named (AC5).
 */
export function BulkDialog({
  action,
  count,
  selection,
  names,
  onClose,
  onStarted,
}: {
  action: BulkAction | null;
  count: number;
  selection: BulkSelection;
  names: ReadonlyMap<string, string>;
  onClose: () => void;
  onStarted: (report: BulkReport) => void;
}) {
  const { t, locale } = useI18n();
  const api = useAuthApi();
  const [categoryId, setCategoryId] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<BulkFailure | null>(null);
  const key = useRef<{ body: string; key: string } | null>(null);
  const groups = useCategoryGroups(action === "setCategory");

  const tags = action === "addTags" ? parseTags(tagsText) : null;
  const params =
    action === "setCategory"
      ? categoryId
        ? { categoryId }
        : null
      : action === "addTags"
        ? tags
          ? { tags }
          : null
        : action === "confirmCategory"
          ? {}
          : null;
  const body: BulkBody | null = action && params ? { action: ACTION_NAME[action], selection, params } : null;
  const bodyKey = body ? JSON.stringify(body) : "";

  // «Що станеться» is read again whenever the value changes; nothing is written (FR 3). The answer remembers what it
  // answers: while it is not the current value's, the summary is on its way.
  const [answer, setAnswer] = useState<{ key: string; preview: Preview }>({
    key: "",
    preview: { kind: "idle" },
  });
  useEffect(() => {
    if (!body) return;
    let live = true;
    void previewBulk(api, body).then((o) => {
      if (live)
        setAnswer({
          key: bodyKey,
          preview: o.ok ? { kind: "ready", data: o.data } : { kind: "error", failure: bulkFailure(o) },
        });
    });
    return () => {
      live = false;
    };
    // `bodyKey` carries the body.
  }, [api, bodyKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const preview: Preview = !body
    ? { kind: "idle" }
    : answer.key === bodyKey
      ? answer.preview
      : { kind: "loading" };

  if (action === null) return null;
  const categoryName =
    groups?.flatMap((g) => g.options).find((o) => o.value === categoryId)?.label ?? undefined;

  const start = () => {
    if (!body) return;
    // The same request keeps its key on «Спробувати ще раз» (ARC-07 FR 4); a changed one takes a new key.
    if (key.current?.body !== bodyKey) key.current = { body: bodyKey, key: newIdempotencyKey() };
    setBusy(true);
    setFailure(null);
    void startBulk(api, body, key.current.key).then((o) => {
      setBusy(false);
      if (!o.ok) {
        setFailure(bulkFailure(o));
        return;
      }
      setTracked({ id: o.data.id, label: categoryName, report: o.data });
      onStarted(o.data);
    });
  };

  const shown = failure ?? (preview.kind === "error" ? preview.failure : null);
  const ready = preview.kind === "ready" ? preview.data : null;
  const error = shown ? <BulkError failure={shown} onRetry={failure ? start : undefined} /> : undefined;
  const target = plural(t, locale, "bulk.tx", count);

  return (
    <Dialog
      open
      onClose={onClose}
      title={t(TITLE[action], { target })}
      closeLabel={t("bulk.close")}
      align="start"
      bar="form"
      busy={busy}
      error={error}
      actions={[
        { label: t("bulk.cancel"), onClick: onClose, variant: "secondary" },
        { label: t(LABEL[action]), onClick: start, variant: "primary", disabled: ready === null || busy },
      ]}
    >
      {action === "setCategory" ? (
        <SearchSelect
          label={t("bulk.field.category")}
          required
          value={categoryId}
          onChange={setCategoryId}
          groups={groups ?? []}
          loading={groups === null}
        />
      ) : action === "addTags" ? (
        <Field
          label={t("bulk.field.tags")}
          required
          value={tagsText}
          onChange={setTagsText}
          hint={t("bulk.field.tagsHint")}
          error={tagsText.trim() !== "" && tags === null ? t("bulk.field.tagsError") : undefined}
        />
      ) : null}
      {preview.kind === "loading" ? (
        <p className="bulk-summary ws-muted" role="status">
          {t("bulk.summary.loading")}
        </p>
      ) : ready ? (
        <Summary preview={ready} names={names} />
      ) : null}
    </Dialog>
  );
}

/** «Що станеться»: «Зміниться 10, пропущено 2: без змін», examples by reason, and how the action runs (FR 3). */
function Summary({ preview, names }: { preview: BulkPreview; names: ReadonlyMap<string, string> }) {
  const { t } = useI18n();
  const skipped = skippedCount(preview.skipped);
  const examples = preview.examples
    .map((e) => {
      const name = names.get(e.id);
      if (name === undefined || e.reason === "unavailable") return null;
      const why = e.reason === "invalid" ? issueText(t, e.issue) : reasonText(t, e.reason);
      return `«${name}» — ${why}`;
    })
    .filter((x): x is string => x !== null);
  return (
    <section className="bulk-summary" aria-labelledby="bulk-summary-title" role="status">
      <h3 id="bulk-summary-title" className="bulk-summary-title">
        {t("bulk.summary.title")}
      </h3>
      <p>
        {skipped > 0
          ? t("bulk.summary.changesSkipped", {
              changes: preview.changes,
              skipped,
              reasons: reasonsText(t, preview.skipped),
            })
          : t("bulk.summary.changes", { changes: preview.changes })}
      </p>
      {examples.length > 0 ? <p>{t("bulk.summary.examples", { examples: examples.join("; ") })}</p> : null}
      <p className="ws-muted">
        {t(preview.background ? "bulk.summary.background" : "bulk.summary.foreground")}
        {preview.undoable ? "" : ` ${t("bulk.summary.notUndoable")}`}
      </p>
    </section>
  );
}

/** «Дію не виконано», «Спробувати ще раз» and the code (DAT-03 «Стани інтерфейсу»); the limit (AC10); AC7. */
export function BulkError({
  failure,
  onRetry,
}: {
  failure: BulkFailure;
  onRetry?: (() => void) | undefined;
}) {
  const t = useI18n().t;
  if (failure.kind === "limit")
    return <p className="bulk-error">{t("bulk.error.limit", { limit: failure.limit })}</p>;
  if (failure.kind === "running") return <p className="bulk-error">{t("selection.busy")}</p>;
  return (
    <div className="bulk-error">
      <p>
        <strong>{t("bulk.error.title")}</strong>
      </p>
      {onRetry ? <Button size="sm" label={t("bulk.error.retry")} onClick={onRetry} /> : null}
      {failure.code ? <p className="ws-muted">{t("tx.error.code", { code: failure.code })}</p> : null}
    </div>
  );
}
