import { useState } from "react";
import { useI18n, type MessageKey } from "@willowsum/i18n";
import { Button, ConfirmDialog, merchantInitials, PageTabs, Skeleton, Toast } from "@willowsum/ui";
import { outcome, useAuthApi } from "../../auth/api.ts";
import { AppLayout } from "../../pages/AppLayout.tsx";
import { LoadError } from "../../recurring/LoadError.tsx";
import { useLoad } from "../../recurring/data.ts";
import { counted, money } from "../../accounts/format.ts";
import { maskedNumber } from "../../accounts/format.ts";
import { BUDGET, childPath, rootOf, sectionOf } from "../../routing/routes.ts";
import { hrefFor } from "../../routing/useHashPath.ts";
import { useDocumentTitle } from "../../useDocumentTitle.ts";
import "./budget.css";
import { loadSettings, type Account, type SettingsRow } from "./settings.ts";

type Tab = "accounts" | "general";

const KIND: Record<string, MessageKey> = {
  current: "accounts.kind.current",
  savings: "accounts.kind.savings",
  deposit: "accounts.kind.deposit",
  cash: "accounts.kind.cash",
  "credit-card": "accounts.kind.creditCard",
  loan: "accounts.kind.loan",
};

/**
 * BUD-02@PoC f) FR 17, AC13, AC14, AC15 (wave 2, row 125): S-128 «Налаштування бюджету · Рахунки бюджету» and S-288
 * «Загальне». «Рахунки бюджету» switches an account in or out of the budget (a draft until «Зберегти зміни»; each
 * changed account is one `PUT /v1/budget/accounts/{id}`); «Загальне» holds only «Видалити бюджет» behind a
 * confirmation (`DELETE /v1/budget`). The page has no «Режим без бюджету», «Новий старт», method or period (FR 17).
 * The balances and the switches are the API's; the screen computes no money.
 */
export function BudgetSettingsPage({ tab }: { tab: Tab }) {
  const { t } = useI18n();
  const title = t("planning.budget.settings.title");
  useDocumentTitle(title);
  const api = useAuthApi();
  const { result, reload } = useLoad(loadSettings);
  const data = result.state === "ready" ? result.data : null;
  const section = sectionOf(BUDGET);
  const [draft, setDraft] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [busy, setBusy] = useState(false);
  // The accounts «Зберегти зміни» did not save (the failed one and those after it), by name.
  const [unsaved, setUnsaved] = useState<readonly string[]>([]);
  const [toast, setToast] = useState<{ key: number; text: string } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [deleteFailed, setDeleteFailed] = useState(false);

  const rows = data?.kind === "ready" ? data.rows : [];
  const changed = rows.filter((r) => draft.has(r.account.id) && draft.get(r.account.id) !== r.included);
  const valueOf = (r: SettingsRow) => draft.get(r.account.id) ?? r.included;

  const toggle = (r: SettingsRow, on: boolean) => {
    setUnsaved([]);
    setDraft((prev) => {
      const next = new Map(prev);
      if (on === r.included) next.delete(r.account.id);
      else next.set(r.account.id, on);
      return next;
    });
  };

  const save = async () => {
    setBusy(true);
    setUnsaved([]);
    // One PUT per account, in order; the first failure stops, so the failed and the unsent ones stay in the draft.
    const kept = new Map(draft);
    let failedAt = -1;
    for (const [i, r] of changed.entries()) {
      const o = await outcome(
        api.PUT("/v1/budget/accounts/{accountId}", {
          params: { path: { accountId: r.account.id } },
          body: { included: draft.get(r.account.id) === true },
        }),
      );
      if (!o.ok) {
        failedAt = i;
        break;
      }
      kept.delete(r.account.id);
    }
    setBusy(false);
    setDraft(kept);
    reload();
    if (failedAt >= 0) setUnsaved(changed.slice(failedAt).map((r) => r.account.name));
    else setToast((p) => ({ key: (p?.key ?? 0) + 1, text: t("planning.budget.settings.saved") }));
  };

  const remove = async () => {
    setBusy(true);
    setDeleteFailed(false);
    const o = await outcome(api.DELETE("/v1/budget"));
    setBusy(false);
    if (o.ok) {
      setConfirm(false);
      window.location.hash = BUDGET.path;
    } else setDeleteFailed(true);
  };

  // A disabled button says why, beside it (CMP-01).
  const idle =
    changed.length === 0 || busy
      ? ({ disabled: true, disabledReason: t("planning.budget.settings.noChanges") } as const)
      : ({} as const);

  const tabs = [
    {
      id: "accounts",
      label: t("planning.budget.settings.tab.accounts"),
      href: hrefFor(childPath("budgetAccounts")),
    },
    {
      id: "general",
      label: t("planning.budget.settings.tab.general"),
      href: hrefFor(childPath("budgetGeneral")),
    },
  ];

  return (
    <AppLayout sectionId={section.id} pageId={BUDGET.id}>
      <nav className="ws-breadcrumbs" aria-label={t("shell.breadcrumbs")}>
        <ol>
          <li>
            <a href={hrefFor(rootOf(section).path)}>{t(section.label)}</a>
          </li>
          <li>
            <a href={hrefFor(BUDGET.path)}>{t(BUDGET.label)}</a>
          </li>
          <li aria-current="page">{title}</li>
        </ol>
      </nav>
      <div className="app-page-head bud-head">
        <div className="bud-settings-title">
          <h1>{title}</h1>
          {data?.kind === "ready" ? (
            <span className="ws-muted">
              {t("planning.budget.settings.subtitle", { currency: data.currency })}
            </span>
          ) : null}
        </div>
        {tab === "accounts" && data?.kind === "ready" ? (
          <div className="bud-settings-actions">
            <Button
              label={t("dialog.form.cancel")}
              variant="secondary"
              onClick={() => {
                setUnsaved([]);
                setDraft(new Map());
              }}
            />
            <Button
              label={t("planning.budget.settings.save")}
              variant="primary"
              {...idle}
              loading={busy}
              onClick={() => void save()}
            />
          </div>
        ) : null}
      </div>
      <PageTabs label={title} panelId="bud-settings" selected={tab} tabs={tabs}>
        {result.state === "error" ? (
          <LoadError failure={result.failure} onRetry={reload} />
        ) : !data ? (
          <section className="ws-card bud-card" aria-busy="true" aria-label={title}>
            <Skeleton variant="row" lines={5} />
          </section>
        ) : data.kind === "none" ? (
          <section className="ws-card bud-card">
            <p role="status">{t("planning.budget.settings.noBudget")}</p>
            <p>
              <a className="app-quiet-link" href={hrefFor(BUDGET.path)}>
                {t("planning.budget.settings.toBudget")}
              </a>
            </p>
          </section>
        ) : tab === "accounts" ? (
          <>
            {unsaved.length > 0 ? (
              <p role="alert" className="bud-note">
                {t("planning.budget.settings.saveError")}.{" "}
                {t("planning.budget.settings.notSaved", { names: unsaved.join(", ") })}
              </p>
            ) : null}
            <AccountsCard rows={rows} valueOf={valueOf} onToggle={toggle} busy={busy} />
          </>
        ) : (
          <section className="ws-card bud-card bud-danger" aria-labelledby="bud-danger-title">
            <div className="bud-danger-row">
              <div className="bud-danger-text">
                <h2 id="bud-danger-title" className="ws-text-heading-3 bud-card-title">
                  {t("planning.budget.settings.delete")}
                </h2>
                <p className="ws-muted">{t("planning.budget.settings.delete.text")}</p>
              </div>
              <Button
                label={t("planning.budget.settings.delete.open")}
                variant="danger"
                onClick={() => {
                  setDeleteFailed(false);
                  setConfirm(true);
                }}
              />
            </div>
          </section>
        )}
      </PageTabs>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title={t("planning.budget.settings.delete")}
        text={t("planning.budget.settings.delete.text")}
        closeLabel={t("shell.close")}
        cancelLabel={t("dialog.form.cancel")}
        confirmLabel={t("planning.budget.settings.delete")}
        busyLabel={t("planning.budget.settings.deleting")}
        busy={busy}
        error={deleteFailed ? t("planning.budget.settings.delete.error") : undefined}
        onConfirm={() => void remove()}
      />
      {toast ? (
        <Toast
          key={toast.key}
          text={toast.text}
          closeLabel={t("shell.close")}
          onDismiss={() => setToast(null)}
        />
      ) : null}
    </AppLayout>
  );
}

function AccountsCard({
  rows,
  valueOf,
  onToggle,
  busy,
}: {
  rows: readonly SettingsRow[];
  valueOf: (r: SettingsRow) => boolean;
  onToggle: (r: SettingsRow, on: boolean) => void;
  busy: boolean;
}) {
  const { t } = useI18n();
  const inBudget = rows.filter((r) => r.included);
  const outside = rows.filter((r) => !r.included);
  return (
    <section className="ws-card bud-card bud-accounts" aria-labelledby="bud-accounts-title">
      <div>
        <h2 id="bud-accounts-title" className="bud-caps">
          {t("planning.budget.settings.accounts.title")}
        </h2>
        <p className="ws-muted">{t("planning.budget.settings.accounts.hint")}</p>
      </div>
      {rows.length === 0 ? (
        <p role="status">{t("planning.budget.settings.accounts.empty")}</p>
      ) : (
        <table className="bud-accounts-table">
          <thead>
            <tr className="bud-caps">
              <th scope="col">{t("planning.budget.settings.col.account")}</th>
              <th scope="col" className="bud-num">
                {t("planning.budget.settings.col.balance")}
              </th>
              <th scope="col">{t("planning.budget.settings.col.included")}</th>
            </tr>
          </thead>
          <AccountGroup
            name={t("planning.budget.settings.in")}
            rows={inBudget}
            {...{ valueOf, onToggle, busy }}
          />
          <AccountGroup
            name={t("planning.budget.settings.out")}
            rows={outside}
            {...{ valueOf, onToggle, busy }}
          />
        </table>
      )}
    </section>
  );
}

function AccountGroup({
  name,
  rows,
  valueOf,
  onToggle,
  busy,
}: {
  name: string;
  rows: readonly SettingsRow[];
  valueOf: (r: SettingsRow) => boolean;
  onToggle: (r: SettingsRow, on: boolean) => void;
  busy: boolean;
}) {
  if (rows.length === 0) return null;
  return (
    <tbody>
      <tr className="bud-group-row">
        <th scope="rowgroup" colSpan={3}>
          <b>{name}</b> <span className="ws-muted">{rows.length}</span>
        </th>
      </tr>
      {rows.map((r) => (
        <AccountRow
          key={r.account.id}
          row={r}
          on={valueOf(r)}
          onToggle={(on) => onToggle(r, on)}
          busy={busy}
        />
      ))}
    </tbody>
  );
}

function kindLine(
  t: ReturnType<typeof useI18n>["t"],
  locale: ReturnType<typeof useI18n>["locale"],
  a: Account,
) {
  const kind = t(KIND[a.kind] ?? "accounts.kind.current");
  const where =
    a.currencies.length > 1
      ? counted(t, locale, "accounts.currencyCount", a.currencies.length)
      : (a.currencies[0]?.currency ?? "");
  return where ? `${kind} · ${where}` : kind;
}

function AccountRow({
  row,
  on,
  onToggle,
  busy,
}: {
  row: SettingsRow;
  on: boolean;
  onToggle: (on: boolean) => void;
  busy: boolean;
}) {
  const { t, locale } = useI18n();
  const a = row.account;
  const mask = a.number ? maskedNumber(a.number.last4) : null;
  const total = a.inProfileCurrency.total;
  return (
    <tr>
      <td>
        <span className="bud-account-cell">
          <span className="bud-tile" aria-hidden="true">
            {merchantInitials(a.institution?.name ?? a.name)}
          </span>
          <span className="bud-account-stack">
            <span>
              <strong>{a.name}</strong>
              {mask ? <span className="ws-muted"> {mask}</span> : null}
            </span>
            <span className="ws-muted">{kindLine(t, locale, a)}</span>
          </span>
        </span>
      </td>
      <td className="bud-num">{total ? money(locale, total) : "—"}</td>
      <td>
        <label className="ws-switch">
          <input
            type="checkbox"
            role="switch"
            aria-label={t("planning.budget.settings.switch", { name: a.name })}
            checked={on}
            disabled={busy}
            onChange={(e) => onToggle(e.target.checked)}
          />
          <span className="ws-switch-track" aria-hidden="true" />
        </label>
      </td>
    </tr>
  );
}
