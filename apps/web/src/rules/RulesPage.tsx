import { useEffect, useLayoutEffect, useRef, useState, type DragEvent } from "react";
import { useI18n, useT, type MessageKey } from "@willowsum/i18n";
import {
  Badge,
  Button,
  CategoryDisc,
  ConfirmDialog,
  Field,
  Icon,
  IconButton,
  Skeleton,
  Toast,
} from "@willowsum/ui";
import { outcome, useAuthApi, type Outcome } from "../auth/api.ts";
import { AppLayout } from "../pages/AppLayout.tsx";
import { TRANSACTIONS } from "../routing/routes.ts";
import { hrefFor } from "../routing/useHashPath.ts";
import { useDocumentTitle } from "../useDocumentTitle.ts";
import { categoryOf, counted, ruleText, useRules, type Refs, type Rule, type Run } from "./api.ts";
import { HistoryUploadDialog } from "./history/HistoryUploadDialog.tsx";
import { RuleDialog, type Saved } from "./RuleDialog.tsx";
import { RunNotice } from "./RunNotice.tsx";
import "./rules.css";

/**
 * S-197 «Гроші › Транзакції › Правила» (BUD-14@PoC c), FR 4, 8, 10, 11, 15; canvas PocMoneyRules and its «Тексти»
 * board PocMoneyRulesTexts): the rules in priority order — «#», «Умова», «Категорія», «Застосовано», «Увімкнено», the
 * pencil «Змінити правило» (S-198) and «Видалити» — a search, «Нове правило», and the order by the handle or by «Вище» /
 * «Нижче». The server decides everything (it applies the first matching rule, keeps the order, writes the audit); the
 * screen holds no money logic.
 */
export function RulesPage() {
  const t = useT();
  const title = t("rules.title");
  useDocumentTitle(title);
  const state = useRules();
  return (
    <AppLayout sectionId="money" pageId={TRANSACTIONS.id}>
      <div className="rules-page">
        <nav className="ws-breadcrumbs" aria-label={t("shell.breadcrumbs")}>
          <ol>
            <li>{t("shell.nav.money")}</li>
            <li>
              <a href={hrefFor(TRANSACTIONS.path)}>{t(TRANSACTIONS.label)}</a>
            </li>
            <li aria-current="page">{t("rules.crumb")}</li>
          </ol>
        </nav>
        <RulesBody {...state} title={title} />
      </div>
    </AppLayout>
  );
}

type Open =
  | { readonly kind: "none" }
  | { readonly kind: "history" }
  | { readonly kind: "edit"; readonly rule: Rule | null }
  | { readonly kind: "delete"; readonly rule: Rule };

/** NFC, lower case: «кава» finds «Кава з собою». */
const fold = (s: string) => s.normalize("NFC").toLocaleLowerCase("uk").trim();

function RulesBody({ rules, refs, reload, title }: ReturnType<typeof useRules> & { title: string }) {
  const { t, locale } = useI18n();
  const api = useAuthApi();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Open>({ kind: "none" });
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ code?: string | undefined } | null>(null);
  const [toast, setToast] = useState<{ key: number; text: string } | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [duplicate, setDuplicate] = useState<string | null>(null);
  const [runError, setRunError] = useState<MessageKey | null>(null);
  const dragged = useRef<string | null>(null);
  // WCAG 2.4.3: after «Вище» / «Нижче» the table is read again and React may re-insert the focused row, which drops
  // the focus to the page; the same button of the same rule gets it back (the other one at the first or last place).
  const refocus = useRef<{ id: string; dir: "up" | "down" } | null>(null);

  const list = rules.kind === "ready" ? rules.data : [];
  const say = (text: string) => setToast((prev) => ({ key: (prev?.key ?? 0) + 1, text }));

  /** One change at a time; a failure leaves the table as it was and says so. */
  const act = async (send: () => Promise<Outcome<unknown>>, done?: () => void) => {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    const o = await send();
    setBusy(false);
    if (o.ok) {
      done?.();
      reload();
    } else {
      refocus.current = null;
      setFailure({ code: o.kind === "problem" ? o.supportId : undefined });
    }
  };

  const move = (rule: Rule, position: number, keepFocus = false) => {
    if (position < 1 || position > list.length || position === rule.position) return;
    refocus.current = keepFocus ? { id: rule.id, dir: position < rule.position ? "up" : "down" } : null;
    void act(() =>
      outcome(
        api.POST("/v1/category-rules/{ruleId}/move", {
          params: { path: { ruleId: rule.id } },
          body: { position },
        }),
      ),
    );
  };
  useLayoutEffect(() => {
    const want = refocus.current;
    if (!want) return;
    refocus.current = null;
    const row = document.getElementById(`rule-${want.id}`);
    const named = (key: "rules.up" | "rules.down") =>
      row?.querySelector<HTMLElement>(`button[aria-label="${t(key)}"]`) ?? null;
    const [first, other] =
      want.dir === "up" ? (["rules.up", "rules.down"] as const) : (["rules.down", "rules.up"] as const);
    const button = named(first);
    (button?.getAttribute("aria-disabled") === "true" ? named(other) : button)?.focus();
  }, [rules, t]);

  // BUD-14@PoC FR 7, AC6, AC15: «Відмінити» stays for 7 days, so the newest run that still runs or can be undone is
  // read when the page opens (the server's 20 newest), not only the run this page started.
  useEffect(() => {
    let live = true;
    void outcome(api.GET("/v1/category-rule-runs")).then((o) => {
      if (!live || !o.ok) return;
      const latest = [...o.data.items]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .find(
          (r) =>
            r.status === "running" ||
            r.status === "undoing" ||
            (r.status === "completed" && r.undo.available),
        );
      if (latest) setRun((current) => current ?? latest);
    });
    return () => {
      live = false;
    };
  }, [api]);

  const toggle = (rule: Rule, enabled: boolean) =>
    void act(() =>
      outcome(
        api.PATCH("/v1/category-rules/{ruleId}", {
          params: { path: { ruleId: rule.id } },
          body: { enabled },
        }),
      ),
    );
  const remove = (rule: Rule) =>
    void act(
      () => outcome(api.DELETE("/v1/category-rules/{ruleId}", { params: { path: { ruleId: rule.id } } })),
      () => {
        setOpen({ kind: "none" });
        say(t("rules.deleted"));
      },
    );

  const saved = ({ duplicateOf, run: started, runError: refused }: Saved) => {
    setRunError(refused);
    setOpen({ kind: "none" });
    setDuplicate(duplicateOf);
    setRun(started);
    say(t("rules.saved"));
    reload();
  };

  const q = fold(query);
  const shown = list.filter((r) => {
    if (q === "") return true;
    const category = categoryOf(refs, r.categoryId)?.name ?? "";
    return [ruleText(t, locale, r, refs.accounts), category, ...r.tags].some((s) => fold(s).includes(q));
  });
  const existing = duplicate ? list.find((r) => r.id === duplicate) : undefined;

  return (
    <>
      <div className="rules-head">
        <div className="rules-head-text">
          <h1>{title}</h1>
          <p className="ws-muted">{t("rules.subtitle")}</p>
        </div>
        {rules.kind === "off" ? null : (
          <div
            className="rules-head-actions"
            role="group"
            aria-label={title}
            aria-describedby="rules-history-hint"
          >
            <Button
              icon="upload"
              label={t("history.action.upload")}
              onClick={() => setOpen({ kind: "history" })}
            />
            <Button
              variant="primary"
              label={t("rules.new")}
              onClick={() => setOpen({ kind: "edit", rule: null })}
            />
            <span id="rules-history-hint" className="ws-visually-hidden">
              {t("history.action.uploadHint")}
            </span>
          </div>
        )}
      </div>

      {rules.kind === "loading" ? (
        <div className="ws-card" aria-busy="true">
          <Skeleton variant="row" lines={6} />
        </div>
      ) : rules.kind === "off" ? null : rules.kind === "error" ? (
        <section className="ws-card rules-state" role="alert">
          <p>{t("rules.load.error")}</p>
          <Button label={t("rules.retry")} onClick={reload} />
          {rules.supportId ? <p className="ws-muted">{t("rules.code", { code: rules.supportId })}</p> : null}
        </section>
      ) : list.length === 0 ? (
        <section className="ws-card rules-state">
          <p>{t("rules.empty")}</p>
          <Button
            variant="primary"
            label={t("rules.new")}
            onClick={() => setOpen({ kind: "edit", rule: null })}
          />
        </section>
      ) : (
        <>
          <div className="rules-toolbar">
            <Field
              label={t("rules.search")}
              labelHidden
              size="search"
              type="search"
              placeholder={t("rules.search")}
              prefix={<Icon name="search" size={16} />}
              value={query}
              onChange={setQuery}
              className="rules-search"
            />
            <span className="ws-muted">{counted(t, locale, "rules.count", list.length)}</span>
          </div>

          <div className="rules-notices">
            {failure ? (
              <p className="rules-failure" role="alert">
                {t("rules.error.action")}
                {failure.code ? ` ${t("rules.code", { code: failure.code })}` : ""}
              </p>
            ) : null}
            {runError ? (
              <p className="rules-failure" role="alert">
                {t(runError)}
              </p>
            ) : null}
            {existing ? (
              <p className="rules-duplicate" role="status">
                <Badge tone="attention" label={t("rules.duplicate", { position: existing.position })} />
                <button
                  type="button"
                  className="rules-link"
                  onClick={() => document.getElementById(`rule-${existing.id}`)?.focus()}
                >
                  {t("rules.duplicate.show", { position: existing.position })}
                </button>
              </p>
            ) : null}
            {run ? (
              <RunNotice run={run} onChange={setRun} onReload={reload} onDismiss={() => setRun(null)} />
            ) : null}
          </div>

          {shown.length === 0 ? (
            <section className="ws-card rules-state">
              <p>{t("rules.noResults")}</p>
            </section>
          ) : (
            <div className="ws-card rules-card">
              <table className="rules-table">
                <caption className="ws-visually-hidden">{title}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t("rules.col.order")}</th>
                    <th scope="col">{t("rules.col.condition")}</th>
                    <th scope="col">{t("rules.col.category")}</th>
                    <th scope="col">{t("rules.col.applied")}</th>
                    <th scope="col" colSpan={2}>
                      <span className="ws-visually-hidden">{t("rules.enabled")}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((rule) => (
                    <RuleRow
                      key={rule.id}
                      rule={rule}
                      refs={refs}
                      last={list.length}
                      busy={busy}
                      onToggle={(on) => toggle(rule, on)}
                      onMove={(position) => move(rule, position, true)}
                      onEdit={() => setOpen({ kind: "edit", rule })}
                      onDelete={() => setOpen({ kind: "delete", rule })}
                      onDragStart={() => (dragged.current = rule.id)}
                      onDrop={() => {
                        const from = list.find((r) => r.id === dragged.current);
                        dragged.current = null;
                        if (from) move(from, rule.position);
                      }}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="rules-note ws-muted">
            <Icon name="info" size={16} />
            <span>{t("rules.note")}</span>
          </p>
        </>
      )}

      {open.kind === "history" ? <HistoryUploadDialog onClose={() => setOpen({ kind: "none" })} /> : null}
      {open.kind === "edit" ? (
        <RuleDialog rule={open.rule} refs={refs} onClose={() => setOpen({ kind: "none" })} onSaved={saved} />
      ) : null}
      <ConfirmDialog
        open={open.kind === "delete"}
        onClose={() => setOpen({ kind: "none" })}
        title={t("rules.deleteTitle")}
        text={
          open.kind === "delete"
            ? t("rules.deleteText", { rule: ruleText(t, locale, open.rule, refs.accounts) })
            : ""
        }
        closeLabel={t("shell.close")}
        cancelLabel={t("dialog.form.cancel")}
        confirmLabel={t("rules.delete")}
        busyLabel={t("rules.deleting")}
        busy={busy}
        error={failure ? t("rules.error.action") : undefined}
        onConfirm={() => open.kind === "delete" && remove(open.rule)}
      />
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

function RuleRow({
  rule,
  refs,
  last,
  busy,
  onToggle,
  onMove,
  onEdit,
  onDelete,
  onDragStart,
  onDrop,
}: {
  rule: Rule;
  refs: Refs;
  last: number;
  busy: boolean;
  onToggle: (enabled: boolean) => void;
  onMove: (position: number) => void;
  onEdit: () => void;
  onDelete: () => void;
  onDragStart: () => void;
  onDrop: () => void;
}) {
  const { t, locale } = useI18n();
  const category = categoryOf(refs, rule.categoryId);
  const text = ruleText(t, locale, rule, refs.accounts);
  const gone = rule.accountIds.filter((id) => !refs.accounts.some((a) => a.id === id)).length;
  const accounts = rule.accountIds
    .map((id) => refs.accounts.find((a) => a.id === id)?.label ?? t("rules.accounts.gone"))
    .join(", ");
  const notes = [
    ...rule.tags.map((tag) => t("rules.tag", { tag })),
    ...(rule.accountIds.length > 0 && gone < rule.accountIds.length
      ? [t("rules.accountsOnly", { accounts })]
      : []),
    ...(rule.enabled ? [] : [t("rules.disabled")]),
  ];
  return (
    <tr
      id={`rule-${rule.id}`}
      tabIndex={-1}
      className="rules-row"
      data-attention={rule.needsAttention ? "" : undefined}
      onDragOver={(e: DragEvent) => e.preventDefault()}
      onDrop={(e: DragEvent) => {
        e.preventDefault();
        onDrop();
      }}
    >
      <td className="rules-order">
        <span
          className="rules-handle"
          draggable
          title={t("rules.drag")}
          aria-hidden="true"
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = "move";
            onDragStart();
          }}
        >
          <Icon name="list" size={16} />
        </span>
        <span className="rules-position">{rule.position}</span>
      </td>
      <td className="rules-condition">
        <div className="rules-condition-body">
          <span className="rules-text">{text}</span>
          {rule.needsAttention ? (
            <span className="rules-attention">
              <Badge tone="attention" label={t("rules.attention")} />
              <span>
                {t(
                  rule.needsAttention === "category_deleted"
                    ? "rules.attention.category"
                    : "rules.attention.account",
                )}
              </span>
            </span>
          ) : null}
          {notes.length > 0 ? <span className="rules-notes ws-muted">{notes.join(" · ")}</span> : null}
        </div>
      </td>
      <td className="rules-category">
        {category ? (
          <span className="rules-category-chip">
            <CategoryDisc color={category.color} icon={category.icon} iconTone={category.iconTone} />
            {category.name}
          </span>
        ) : (
          <span className="ws-muted">—</span>
        )}
      </td>
      <td className="rules-applied">{counted(t, locale, "rules.applied", rule.appliedCount)}</td>
      <td className="rules-switch">
        <label className="ws-switch">
          <input
            type="checkbox"
            role="switch"
            aria-label={`${t("rules.enabled")}: ${text}`}
            checked={rule.enabled}
            disabled={busy}
            onChange={(e) => onToggle(e.target.checked)}
          />
          <span className="ws-switch-track" aria-hidden="true" />
        </label>
      </td>
      <td className="rules-actions">
        <IconButton
          icon="chevron-up"
          label={t("rules.up")}
          aria-disabled={rule.position === 1 || busy}
          onClick={() => onMove(rule.position - 1)}
        />
        <IconButton
          icon="chevron-down"
          label={t("rules.down")}
          aria-disabled={rule.position === last || busy}
          onClick={() => onMove(rule.position + 1)}
        />
        <IconButton icon="edit" label={t("rules.edit")} onClick={onEdit} />
        <IconButton icon="trash" label={t("rules.delete")} onClick={onDelete} />
      </td>
    </tr>
  );
}
