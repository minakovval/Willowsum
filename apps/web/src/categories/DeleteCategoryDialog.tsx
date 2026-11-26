import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n, formatMoney, formatNumber, type Locale, type MessageKey, type useT } from "@willowsum/i18n";
import type { paths } from "@willowsum/api-contract";
import { Dialog } from "@willowsum/ui";
import { outcome, useAuthApi, type Outcome } from "../auth/api.ts";
import { failureOf, type ActionFailure, type Category } from "./api.ts";

/**
 * BUD-01@PoC FR 12, FR 13, AC 19, AC 22, AC 23; BUD-02@PoC FR 23, AC 19 (owner, 2026-11-26, Q1): «Видалити категорію…» of
 * «Налаштування → Категорії» (S-196) and of the budget screens (S-121, S-124) — one dialog that asks the server what
 * holds the category (`GET /v1/categories/{id}/usage`) and shows exactly that, never a general «є транзакції»:
 *
 * - held (transactions, regular payments, merged categories): «Категорію не можна видалити: її використовують» with each
 *   reason and its count, «Приховати» and «Об’єднати з іншою…»; category rules are named but do not hold it;
 * - only its limit (and «План» cells) stands in the way: «Ліміт N теж буде видалено» and the delete goes with
 *   `confirmLimit=true`; category rules then move to «Потребує уваги» (BUD-14 FR 10);
 * - nothing: the plain confirmation.
 *
 * The dialog is mounted only while open (a new opening reads the usage afresh, never shows the last one). If the read
 * fails, the tree's `deletable` decides: a deletable category is confirmed plainly (the server still refuses an
 * unconfirmed limit or a held category, and the dialog then reads the usage again), a held one shows no numbers.
 * «Показати транзакції» (BUD-01 AC 20) waits for the category filter of the transactions list (PR body).
 */
type Usage =
  paths["/v1/categories/{categoryId}/usage"]["get"]["responses"]["200"]["content"]["application/json"];
type Read =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly usage: Usage }
  | { readonly kind: "failed" };

const FORMS = ["one", "few", "many", "other"] as const;

/** «12 транзакцій»: the noun in the form the language needs (`<base>.one|few|many|other`), the count grouped. */
function counted(t: ReturnType<typeof useT>, locale: Locale, base: string, count: number): string {
  const rule = new Intl.PluralRules(locale === "uk" ? "uk-UA" : "en").select(count);
  const form = (FORMS as readonly string[]).includes(rule) ? rule : "other";
  return t(`${base}.${form}` as MessageKey, { count: formatNumber(locale, String(count)) });
}

export function DeleteCategoryDialog({
  category,
  onClose,
  onDone,
  onMerge,
}: {
  category: Category | null;
  onClose: () => void;
  /** The category is deleted or hidden: the screen reads its categories again. */
  onDone: () => void;
  onMerge: (category: Category) => void;
}) {
  if (!category) return null;
  return (
    <DeleteForm key={category.id} category={category} onClose={onClose} onDone={onDone} onMerge={onMerge} />
  );
}

function DeleteForm({
  category,
  onClose,
  onDone,
  onMerge,
}: {
  category: Category;
  onClose: () => void;
  onDone: () => void;
  onMerge: (category: Category) => void;
}) {
  const { t, locale } = useI18n();
  const api = useAuthApi();
  const [read, setRead] = useState<Read>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const running = useRef(false);
  const id = category.id;

  useEffect(() => {
    let live = true;
    void outcome(api.GET("/v1/categories/{categoryId}/usage", { params: { path: { categoryId: id } } })).then(
      (o) => {
        if (live) setRead(o.ok ? { kind: "ready", usage: o.data } : { kind: "failed" });
      },
    );
    return () => {
      live = false;
    };
  }, [api, id, attempt]);

  const usage = read.kind === "ready" ? read.usage : null;
  const deletable = usage ? usage.deletable : category.deletable;
  const limit = usage?.budget.limit ?? null;
  const entries = usage !== null && (usage.budget.stored || usage.budget.planCells > 0 || limit !== null);

  /** One request at a time; a refusal that says the usage changed reads it again instead of showing a bare error. */
  const run = useCallback(async (send: () => Promise<Outcome<unknown>>, after: () => void) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setFailure(null);
    const o = await send();
    running.current = false;
    setBusy(false);
    if (o.ok) return after();
    const code = !o.ok && o.kind === "problem" ? o.problem.code : "";
    if (code === "CATEGORY_LIMIT_CONFIRM" || code === "CATEGORY_NOT_EMPTY") {
      setRead({ kind: "loading" });
      setAttempt((n) => n + 1);
    } else setFailure(failureOf(o));
  }, []);

  const remove = () =>
    void run(
      () =>
        outcome(
          api.DELETE("/v1/categories/{categoryId}", {
            params: { path: { categoryId: id }, ...(entries ? { query: { confirmLimit: "true" } } : {}) },
          }),
        ),
      onDone,
    );
  const hide = () =>
    void run(
      () =>
        outcome(
          api.PATCH("/v1/categories/{categoryId}", {
            params: { path: { categoryId: id } },
            body: { hidden: true },
          }),
        ),
      onDone,
    );

  const error = failure ? <p>{t("categories.error.action")}</p> : undefined;
  const title = t("categories.delete.title", { name: category.name });
  const common = { open: true, onClose, title, closeLabel: t("shell.close"), busy, error } as const;
  const cancel = { label: t("categories.form.cancel"), onClick: onClose };

  if (read.kind === "loading")
    return (
      <Dialog
        {...common}
        icon="trash"
        tone="warning"
        align="start"
        text={t("categories.delete.checking")}
        actions={[cancel]}
      />
    );

  const rules = usage?.rules ?? 0;
  if (!deletable) {
    const reasons: string[] = [];
    if (usage) {
      if (usage.transactions > 0)
        reasons.push(counted(t, locale, "categories.delete.reason.transactions", usage.transactions));
      if (usage.recurringPayments > 0)
        reasons.push(counted(t, locale, "categories.delete.reason.recurring", usage.recurringPayments));
      if (usage.mergedCategories > 0)
        reasons.push(counted(t, locale, "categories.delete.reason.merged", usage.mergedCategories));
    }
    const system = category.systemKey !== null || (usage !== null && reasons.length === 0);
    return (
      <Dialog
        {...common}
        icon="trash"
        tone="warning"
        align="start"
        text={system ? t("categories.delete.system") : t("categories.delete.reasons")}
        actions={[
          cancel,
          { label: t("categories.action.hide"), onClick: hide },
          { label: t("categories.action.merge"), variant: "primary", onClick: () => onMerge(category) },
        ]}
      >
        {reasons.length > 0 ? (
          <ul className="cat-reasons">
            {reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        ) : null}
        {rules > 0 ? (
          <p className="cat-delete-note">
            {t("categories.delete.rulesNote", { count: formatNumber(locale, String(rules)) })}
          </p>
        ) : null}
        {system ? null : <p className="cat-delete-note">{t("categories.delete.advice")}</p>}
      </Dialog>
    );
  }

  const effects: string[] = [];
  if (limit)
    effects.push(t("categories.delete.limit", { amount: formatMoney(locale, limit.amount, limit.currency) }));
  else if (entries) effects.push(t("categories.delete.entries"));
  if (rules > 0)
    effects.push(t("categories.delete.rulesAttention", { count: formatNumber(locale, String(rules)) }));
  return (
    <Dialog
      {...common}
      icon="trash"
      tone="danger"
      alert
      text={effects.length > 0 ? effects.join(" ") : t("categories.delete.text")}
      actions={[
        cancel,
        {
          label: t("categories.delete.confirm"),
          variant: "danger",
          busyLabel: t("categories.delete.busy"),
          onClick: remove,
        },
      ]}
    />
  );
}
