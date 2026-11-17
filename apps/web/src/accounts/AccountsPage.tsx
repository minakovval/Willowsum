import { useState } from "react";
import { useT } from "@willowsum/i18n";
import { Button, Icon, MenuButton, Skeleton } from "@willowsum/ui";
import { ACCOUNTS, IMPORT_WIZARD_PATH } from "../routing/routes.ts";
import { hrefFor } from "../routing/useHashPath.ts";
import { useDocumentTitle } from "../useDocumentTitle.ts";
import { AppLayout } from "../pages/AppLayout.tsx";
import { EmptyState } from "../pages/SectionPage.tsx";
import { AddAccountDialog } from "./AddAccountDialog.tsx";
import { AccountGroup } from "./AccountGroup.tsx";
import { useAccounts, useAccountsSummary, useFavourite, type Account, type AccountsSummary } from "./api.ts";
import { MoneyTogether, RateBanner, Sources } from "./Summary.tsx";
import "./accounts.css";

/**
 * S-050 «Рахунки» (FIN-01@PoC c), GRID-02@PoC FR 1; canvas PocMoneyAccounts, PocMoneyAccountsStale): the header with
 * «Імпортувати виписку» and «Додати рахунок» and no tabs, «Гроші разом» 8 + «Джерела даних» 4, the list toolbar,
 * then the groups «Готівкові» and «Кредитні» on the full 12 columns. No brokerage accounts in «Гроші».
 */
export function AccountsPage() {
  const t = useT();
  const title = t(ACCOUNTS.label);
  useDocumentTitle(title);
  const [showClosed, setShowClosed] = useState(false);
  const [adding, setAdding] = useState(false);
  const accounts = useAccounts(showClosed);
  const summary = useAccountsSummary();
  const favourite = useFavourite(accounts.patch);
  const add = () => setAdding(true);
  const off = accounts.state.kind === "off";
  const none = accounts.state.kind === "ready" && !showClosed && accounts.state.data.length === 0;

  return (
    <AppLayout sectionId="money" pageId={ACCOUNTS.id}>
      <div className="accounts-head">
        <div>
          <h1>{title}</h1>
          <p className="ws-muted">{t("accounts.subtitle")}</p>
        </div>
        <div className="accounts-head-actions">
          <Button label={t("action.importStatement")} icon="upload" href={hrefFor(IMPORT_WIZARD_PATH)} />
          <AddButton primary onClick={add} />
        </div>
      </div>
      {off ? (
        <EmptyState icon={ACCOUNTS.icon} />
      ) : accounts.state.kind === "loading" ? (
        <AccountsLoading />
      ) : accounts.state.kind === "error" ? (
        <AccountsError supportId={accounts.state.supportId} retry={accounts.retry} />
      ) : none ? (
        <div className="accounts-grid">
          {/* FR 22: closed accounts stay reachable through «Показати закриті» even when no account is active. */}
          <Toolbar showClosed={showClosed} onShowClosed={setShowClosed} />
          <AccountsEmpty onAdd={add} />
        </div>
      ) : accounts.state.kind === "ready" ? (
        <div className="accounts-grid">
          {summary.state.kind === "ready" && summary.state.data.moneyTogether.staleRateCount > 0 ? (
            <RateBanner summary={summary.state.data} />
          ) : null}
          <MoneyTogether state={summary.state} retry={summary.retry} />
          <Sources state={summary.state} />
          <Toolbar showClosed={showClosed} onShowClosed={setShowClosed} />
          <Groups
            accounts={accounts.state.data}
            showClosed={showClosed}
            summary={summary.state.kind === "ready" ? summary.state.data : null}
            favourite={favourite}
          />
        </div>
      ) : null}
      <AddAccountDialog open={adding} onClose={() => setAdding(false)} />
    </AppLayout>
  );
}

/**
 * The list toolbar (FIN-01@PoC FR 22, FR 23; GRID-02@PoC FR 9, FR 10): the icon button «Параметри» (sliders) with
 * «Показати закриті». No «Колонки» and no «Змінити порядок»: the columns are fixed. «Фільтри · N» comes with the
 * FilterBar (CMP-32).
 */
function Toolbar({ showClosed, onShowClosed }: { showClosed: boolean; onShowClosed: (v: boolean) => void }) {
  const t = useT();
  return (
    <div className="accounts-toolbar">
      <MenuButton
        menuLabel={t("accounts.options")}
        ariaLabel={t("accounts.options")}
        title={t("accounts.options")}
        placement="down"
        align="end"
        className="ws-icon-button"
        items={[
          {
            id: "closed",
            label: t("accounts.options.showClosed"),
            icon: "eye",
            checked: showClosed,
            onSelect: () => onShowClosed(!showClosed),
          },
        ]}
      >
        <Icon name="options" size={20} inButton />
      </MenuButton>
    </div>
  );
}

function Groups({
  accounts,
  showClosed,
  summary,
  favourite,
}: {
  accounts: readonly Account[];
  showClosed: boolean;
  summary: AccountsSummary | null;
  favourite: ReturnType<typeof useFavourite>;
}) {
  const t = useT();
  const cash = accounts.filter((a) => a.group === "cash");
  const credit = accounts.filter((a) => a.group === "credit");
  const closedNone = showClosed && !accounts.some((a) => a.status === "closed");
  return (
    <>
      {closedNone ? (
        <p className="accounts-note ws-muted" role="status">
          {t("accounts.closed.none")}
        </p>
      ) : null}
      {favourite.failed ? (
        <p className="accounts-note" role="alert">
          {t("accounts.favourite.error")}
        </p>
      ) : null}
      {cash.length > 0 ? (
        <AccountGroup group="cash" accounts={cash} summary={summary} favourite={favourite} />
      ) : null}
      {credit.length > 0 ? (
        <AccountGroup group="credit" accounts={credit} summary={summary} favourite={favourite} />
      ) : null}
    </>
  );
}

/** Loading: the skeleton of the list, as many rows as are expected (CMP-22). */
function AccountsLoading() {
  return (
    <div className="ws-card accounts-loading">
      <Skeleton variant="row" lines={4} />
    </div>
  );
}

/** Error: «✕ Помилка», what failed, «Спробувати ще раз» and «Код: …» (PocStates); saved data is not touched. */
function AccountsError({ supportId, retry }: { supportId: string | undefined; retry: () => void }) {
  const t = useT();
  return (
    <section className="ws-card accounts-error" role="alert">
      <p className="accounts-error-title">{t("accounts.error.title")}</p>
      <p>{t("accounts.error.body")}</p>
      <Button label={t("accounts.error.retry")} onClick={retry} />
      {supportId ? <p className="ws-muted">{t("accounts.error.code", { code: supportId })}</p> : null}
    </section>
  );
}

/** Empty: «Ще немає рахунків» with «Додати рахунок» and «Імпортувати виписку» (FIN-01, GRID-02 EC1). */
function AccountsEmpty({ onAdd }: { onAdd: () => void }) {
  const t = useT();
  return (
    <section className="ws-card accounts-empty" aria-labelledby="accounts-empty-title">
      <Icon name="accounts" size={40} tone="muted" />
      <h2 id="accounts-empty-title" className="ws-text-heading-3">
        {t("accounts.empty.title")}
      </h2>
      <p className="ws-muted">{t("accounts.empty.body")}</p>
      <div className="accounts-head-actions">
        <Button label={t("action.importStatement")} icon="upload" href={hrefFor(IMPORT_WIZARD_PATH)} />
        {/* One primary action per screen (CMP-01 AC1): the header's «Додати рахунок» is the primary one. */}
        <AddButton onClick={onAdd} />
      </div>
    </section>
  );
}

/**
 * «Додати рахунок» with «+» — the markup of the design-system `Button` (CMP-01, 16 px icon in its slot). Written out
 * here because the plan-name lint rule exempts the icon name only on `<Icon name>`, not on `<Button icon>`.
 */
function AddButton({ primary = false, onClick }: { primary?: boolean; onClick: () => void }) {
  const t = useT();
  return (
    <button
      type="button"
      className={`ws-button${primary ? " ws-button-primary" : ""} ws-button-with-icon`}
      onClick={onClick}
    >
      <span className="ws-button-slot" aria-hidden="true">
        <Icon name="plus" size={16} inButton />
      </span>
      <span className="ws-button-label">{t("accounts.add")}</span>
    </button>
  );
}
