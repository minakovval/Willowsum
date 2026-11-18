import { useId, useState, type ReactElement, type ReactNode } from "react";
import { formatLocaleOf, useI18n, useT, type Locale, type MessageKey } from "@willowsum/i18n";
import {
  Badge,
  Button,
  Icon,
  isIconName,
  MenuButton,
  Skeleton,
  Tooltip,
  TransactionRow,
} from "@willowsum/ui";
import {
  ACCOUNTS,
  accountIdOf,
  accountSettingsPath,
  IMPORT_WIZARD_PATH,
  RECURRING,
  rootOf,
  SECTIONS,
} from "../routing/routes.ts";
import { hrefFor, useHashPath } from "../routing/useHashPath.ts";
import { useDocumentTitle } from "../useDocumentTitle.ts";
import { AppLayout } from "../pages/AppLayout.tsx";
import { NotFoundPage } from "../pages/NotFoundPage.tsx";
import {
  CARD_ROWS,
  useAccount,
  useAccountRecurring,
  useAccountTransactions,
  type AccountDetail,
  type Block,
  type RecurringPayment,
} from "./card.ts";
import { maskedNumber, money, negated, shortDate } from "./format.ts";
import { CloseAccountDialog } from "./CloseAccountDialog.tsx";
import { UpdateBalanceDialog } from "./UpdateBalanceDialog.tsx";
import { kyivToday } from "../recurring/data.ts";
import { filteredTransactionsPath } from "../transactions/filters.ts";
import "./accounts.css";
import "./account-card.css";

const KIND_KEYS: Readonly<Record<string, MessageKey>> = {
  current: "accounts.kind.current",
  savings: "accounts.kind.savings",
  deposit: "accounts.kind.deposit",
  cash: "accounts.kind.cash",
  "credit-card": "accounts.kind.creditCard",
  loan: "accounts.kind.loan",
};
const SOURCE_KEYS: Readonly<Record<string, MessageKey>> = {
  manual: "accounts.source.manual",
  import: "accounts.source.import",
};

type PluralBase = "accountCard.tx.all" | "accountCard.recurring.caption";
const FORMS = ["one", "few", "many", "other"] as const;
function counted(t: ReturnType<typeof useT>, locale: Locale, base: PluralBase, count: number): string {
  const rule = new Intl.PluralRules(formatLocaleOf(locale)).select(count);
  const form = (FORMS as readonly string[]).includes(rule) ? rule : "other";
  return t(`${base}.${form}` as MessageKey, { count });
}

/** «на 2 листопада» (uk), «on 2 November» (en): the day of the balance without the year. */
function balanceDay(locale: Locale, isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Intl.DateTimeFormat(formatLocaleOf(locale), {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)));
}

/**
 * S-053 «Картка рахунку» (FIN-12@PoC c), GRID-02@PoC FR 2, FR 15, FR 19; canvas PocMoneyAccount): breadcrumbs
 * «Гроші › Рахунки › <назва>», the heading with the gear «Налаштування рахунку» and «Імпортувати виписку», then on
 * the 12 columns: «Баланс» 8 + «Інформація» 4, «Транзакції» 8 + «Регулярні платежі» 4. An account of another space
 * is «Не знайдено» without its name (FIN-12@PoC AC6). A closed account is read only: no import (FR 8).
 */
export function AccountCardPage({ today = kyivToday() }: { today?: string }) {
  const accountId = accountIdOf(useHashPath()) ?? "";
  // A change made in a dialog (FIN-12@PoC d) reads the whole card again: balance, transactions, the «…» menu.
  const [round, setRound] = useState(0);
  // Another account is a fresh page: nothing of the previous one stays on screen while the new one loads.
  return (
    <AccountCard
      key={`${accountId}#${round}`}
      accountId={accountId}
      today={today}
      reload={() => setRound((n) => n + 1)}
    />
  );
}

function AccountCard({ accountId, today, reload }: { accountId: string; today: string; reload: () => void }) {
  const account = useAccount(accountId);
  if (account.state.kind === "missing") return <NotFoundPage />;
  return (
    <Card accountId={accountId} account={account.state} retry={account.retry} today={today} reload={reload} />
  );
}

/** Which dialog of the «…» menu is open (S-055, S-055a). */
type Open = "none" | "balance" | "close";

function Card({
  accountId,
  account,
  retry,
  today,
  reload,
}: {
  accountId: string;
  account: Exclude<Block<AccountDetail>, { kind: "missing" }>;
  retry: () => void;
  today: string;
  reload: () => void;
}) {
  const [open, setOpen] = useState<Open>("none");
  const t = useT();
  const ready = account.kind === "ready" ? account.data : null;
  const title = ready?.name ?? t("page.account");
  useDocumentTitle(title);
  return (
    <AppLayout sectionId="money" pageId={ACCOUNTS.id}>
      <Crumbs current={title} />
      {account.kind === "loading" ? (
        <CardLoading />
      ) : account.kind === "error" ? (
        <>
          <h1>{title}</h1>
          <BlockError body={t("accountCard.error.body")} supportId={account.supportId} retry={retry} />
        </>
      ) : (
        <>
          <Head account={account.data} onOpen={setOpen} />
          {open === "balance" ? (
            <UpdateBalanceDialog
              account={account.data}
              today={today}
              onCancel={() => setOpen("none")}
              onUpdated={reload}
              onGone={reload}
            />
          ) : null}
          {open === "close" ? (
            <CloseAccountDialog
              account={account.data}
              today={today}
              onCancel={() => setOpen("none")}
              // Canvas PocMoneyCloseAcc: the closed account leaves the active list, which the page goes back to.
              onClosed={() => window.location.assign(hrefFor(ACCOUNTS.path))}
              onGone={reload}
            />
          ) : null}
          <div className="acard-grid">
            <BalanceCard account={account.data} />
            <InfoCard account={account.data} />
            <TransactionsCard accountId={accountId} />
            <RecurringCard accountId={accountId} />
          </div>
        </>
      )}
    </AppLayout>
  );
}

/** UX-09@PoC item 8: «Гроші › Рахунки › <назва рахунку>». */
function Crumbs({ current }: { current: string }) {
  const t = useT();
  const money = SECTIONS.find((s) => s.id === "money")!;
  return (
    <nav className="ws-breadcrumbs" aria-label={t("shell.breadcrumbs")}>
      <ol>
        <li>
          <a href={hrefFor(rootOf(money).path)}>{t(money.label)}</a>
        </li>
        <li>
          <a href={hrefFor(ACCOUNTS.path)}>{t(ACCOUNTS.label)}</a>
        </li>
        <li aria-current="page">{current}</li>
      </ol>
    </nav>
  );
}

/**
 * The heading (GRID-02@PoC FR 15): the name with «Закритий» when closed, under it the institution, the masked number
 * and the currencies; the gear «Налаштування рахунку» (an icon link: tooltip and accessible name, no text label) and
 * «Імпортувати виписку».
 */
function Head({ account: a, onOpen }: { account: AccountDetail; onOpen: (dialog: Open) => void }) {
  const t = useT();
  const mask = a.number ? maskedNumber(a.number.last4) : null;
  const under = [a.institution?.name, mask, a.currencies.map((c) => c.currency).join(", ")]
    .filter(Boolean)
    .join(" · ");
  const closed = a.status === "closed";
  return (
    <div className="accounts-head">
      <div>
        <h1 className="acard-title">
          <span>{a.name}</span>
          {closed ? <Badge label={t("accounts.closed")} /> : null}
        </h1>
        {under ? <p className="ws-muted">{under}</p> : null}
      </div>
      <div className="accounts-head-actions">
        {/* FIN-12@PoC FR 8, FR 15: a closed account is read only — no «Оновити залишок», nothing to close. */}
        {closed ? null : <MoreMenu onOpen={onOpen} />}
        <IconLink
          icon="settings"
          label={t("accountCard.settings")}
          href={hrefFor(accountSettingsPath(a.id))}
        />
        {/* FIN-12@PoC FR 8: a closed account takes no new transactions. */}
        {closed ? null : (
          <Button
            label={t("action.importStatement")}
            icon="upload"
            variant="primary"
            href={hrefFor(IMPORT_WIZARD_PATH)}
          />
        )}
      </div>
    </div>
  );
}

/**
 * «…» «Ще дії» (GRID-02@PoC FR 15, AC9; CMP-61 «Кнопка «…»»; canvas PocMoneyAccount): «Оновити залишок» (S-055a) and
 * «Закрити рахунок» (S-055), the dangerous one last after a separator. «Об'єднати з іншим рахунком» comes with its dialog
 * and API (PR body): the menu shows no item that does nothing.
 */
function MoreMenu({ onOpen }: { onOpen: (dialog: Open) => void }) {
  const t = useT();
  return (
    <MenuButton
      menuLabel={t("accountCard.more")}
      ariaLabel={t("accountCard.more")}
      title={t("accountCard.more")}
      placement="down"
      align="end"
      className="ws-icon-button"
      items={[
        {
          id: "balance",
          label: t("accountCard.menu.balance"),
          icon: "edit",
          onSelect: () => onOpen("balance"),
        },
        {
          id: "close",
          label: t("accountCard.menu.close"),
          icon: "lock",
          danger: true,
          onSelect: () => onOpen("close"),
        },
      ]}
    >
      <Icon name="more" size={20} inButton />
    </MenuButton>
  );
}

/**
 * An icon-only link of the design-system icon button (CMP-33): the 44 × 44 target, a 20 px decorative icon, the tooltip
 * on hover and focus; `name` is the accessible name when it differs from the tooltip (it starts with it, WCAG 2.5.3).
 */
function IconLink({
  icon,
  label,
  name,
  href,
}: {
  icon: "settings" | "edit" | "chevron-right";
  label: string;
  name?: string;
  href: string;
}): ReactElement {
  return (
    <Tooltip text={label}>
      <a className="ws-icon-button" href={href} aria-label={name ?? label}>
        <Icon name={icon} size={20} inButton />
      </a>
    </Tooltip>
  );
}

/**
 * «Баланс» (8 columns): the balance of the day the API counted it for, in the account's currency; a multi-currency
 * account lists each currency under the main one. The balance chart with «1М · 3М · 1Р · Усе» (GRID-02@PoC FR 16,
 * CHT-01) is not here yet: it needs the chart component and a balance history the API does not give (PR body).
 */
function BalanceCard({ account: a }: { account: AccountDetail }) {
  const { t, locale } = useI18n();
  const titleId = useId();
  const [main, ...rest] = a.currencies;
  const day = a.currencies
    .map((c) => c.balanceDate)
    .sort()
    .at(-1);
  return (
    <section className="ws-card acard-balance" aria-labelledby={titleId}>
      <h2 id={titleId} className="ws-label">
        {t("accountCard.balance.title")}
      </h2>
      {day ? (
        <p className="accounts-caption ws-muted">
          {t("accountCard.balance.on", { date: balanceDay(locale, day) })}
        </p>
      ) : null}
      {main ? <p className="accounts-total">{money(locale, main.balance)}</p> : null}
      {rest.length > 0 ? (
        <ul className="acard-currencies">
          {rest.map((c) => (
            <li key={c.currency} className="accounts-strong">
              {money(locale, c.balance)}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/**
 * «Інформація» (4 columns, GRID-02@PoC FR 19): the pencil «Редагувати» in the heading opens the account settings (S-054);
 * no text link «Змінити». Rows: type, institution, number (masked, DS-04 FR 13), currency, source.
 */
function InfoCard({ account: a }: { account: AccountDetail }) {
  const t = useT();
  const titleId = useId();
  const mask = a.number ? maskedNumber(a.number.last4) : null;
  const rows: [MessageKey, string][] = [
    ["accountCard.info.type", t(KIND_KEYS[a.kind] ?? "accounts.kind.current")],
    ...(a.institution ? [["accountCard.info.institution", a.institution.name] as [MessageKey, string]] : []),
    ...(mask ? [["accountCard.info.number", mask] as [MessageKey, string]] : []),
    ["accountCard.info.currency", a.currencies.map((c) => c.currency).join(", ")],
    ["accountCard.info.source", t(SOURCE_KEYS[a.source] ?? "accounts.source.manual")],
  ];
  return (
    <section className="ws-card acard-info" aria-labelledby={titleId}>
      <header className="acard-card-head">
        <h2 id={titleId} className="ws-label">
          {t("accountCard.info.title")}
        </h2>
        <IconLink
          icon="edit"
          label={t("accountCard.info.edit")}
          name={t("accountCard.info.editName")}
          href={hrefFor(accountSettingsPath(a.id))}
        />
      </header>
      <dl className="acard-facts">
        {rows.map(([key, value]) => (
          <div key={key}>
            <dt className="ws-muted">{t(key)}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/**
 * «Транзакції» (8 columns, GRID-02@PoC FR 17): the newest transactions of the account as rows of the transactions list
 * (CMP-28), «N з M», and «Усі N транзакцій рахунку» under them.
 */
function TransactionsCard({ accountId }: { accountId: string }) {
  const { t, locale } = useI18n();
  const titleId = useId();
  const { state, retry } = useAccountTransactions(accountId);
  return (
    <section className="ws-card acard-tx" aria-labelledby={titleId}>
      <header className="acard-card-head">
        <div>
          <h2 id={titleId} className="ws-label">
            {t("accountCard.tx.title")}
          </h2>
          {state.kind === "ready" && state.data.count > 0 ? (
            <p className="accounts-caption ws-muted">
              {t("accountCard.tx.caption", { shown: state.data.rows.length, count: state.data.count })}
            </p>
          ) : null}
        </div>
      </header>
      {state.kind === "loading" ? (
        <Skeleton variant="row" lines={CARD_ROWS} />
      ) : state.kind !== "ready" ? (
        <BlockError
          body={t("accounts.card.error")}
          supportId={state.kind === "error" ? state.supportId : undefined}
          retry={retry}
        />
      ) : state.data.rows.length === 0 ? (
        <p className="ws-muted acard-empty">{t("accountCard.tx.empty")}</p>
      ) : (
        <>
          <div className="acard-rows">
            {state.data.rows.map(({ item, category }) => (
              <TransactionRow
                key={item.id}
                merchant={item.counterparty ?? t("accountCard.tx.noCounterparty")}
                date={item.date}
                category={
                  category
                    ? { name: category.name, icon: isIconName(category.icon) ? category.icon : undefined }
                    : null
                }
                amount={{ value: item.amount.amount, currency: item.amount.currency }}
                pending={item.status === "pending"}
                transfer={item.transfer !== null}
                split={item.split !== null}
                tags={item.tags.map((tag) => tag.name)}
                note={item.note !== null && item.note !== ""}
              />
            ))}
          </div>
          {state.data.count > state.data.rows.length ? (
            <p className="acard-all">
              <Button
                variant="quiet"
                label={counted(t, locale, "accountCard.tx.all", state.data.count)}
                href={hrefFor(filteredTransactionsPath({ account: accountId }))}
              />
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

/**
 * «Регулярні платежі» (4 columns): the expenses charged to this account with their next date and expected amount;
 * «›» opens «Регулярні платежі». The block «Цілі» (GRID-02@PoC FR 18) waits for the owner (PR body).
 */
function RecurringCard({ accountId }: { accountId: string }) {
  const { t, locale } = useI18n();
  const titleId = useId();
  const { state, retry } = useAccountRecurring(accountId);
  return (
    <section className="ws-card acard-recurring" aria-labelledby={titleId}>
      <header className="acard-card-head">
        <div>
          <h2 id={titleId} className="ws-label">
            {t("accountCard.recurring.title")}
          </h2>
          {state.kind === "ready" && state.data.length > 0 ? (
            <p className="accounts-caption ws-muted">
              {counted(t, locale, "accountCard.recurring.caption", state.data.length)}
            </p>
          ) : null}
        </div>
        <IconLink
          icon="chevron-right"
          label={t("accountCard.recurring.open")}
          href={hrefFor(RECURRING.path)}
        />
      </header>
      {state.kind === "loading" ? (
        <Skeleton variant="text" lines={3} />
      ) : state.kind !== "ready" ? (
        <BlockError
          body={t("accounts.card.error")}
          supportId={state.kind === "error" ? state.supportId : undefined}
          retry={retry}
        />
      ) : state.data.length === 0 ? (
        <p className="ws-muted acard-empty">{t("accountCard.recurring.empty")}</p>
      ) : (
        <ul className="acard-facts acard-payments">
          {state.data.map((p) => (
            <PaymentLine key={p.id} payment={p} />
          ))}
        </ul>
      )}
    </section>
  );
}

function PaymentLine({ payment: p }: { payment: RecurringPayment }) {
  const { t, locale } = useI18n();
  const amount = money(locale, negated(p.expectedAmount));
  return (
    <li>
      <span className="ws-muted">
        {t("accountCard.recurring.row", { name: p.name, date: shortDate(locale, p.nextDate ?? "") })}
      </span>
      <span className="accounts-strong">{p.variable ? t("accounts.approx", { amount }) : amount}</span>
    </li>
  );
}

/** «✕ Помилка», what failed, «Спробувати ще раз» and «Код: …» (canvas «PoC · Стани»); saved data is not touched. */
function BlockError({
  body,
  supportId,
  retry,
}: {
  body: string;
  supportId: string | undefined;
  retry: () => void;
}): ReactNode {
  const t = useT();
  return (
    <div className="accounts-error acard-error" role="alert">
      <p className="accounts-error-title">{t("accounts.error.title")}</p>
      <p>{body}</p>
      <Button label={t("accounts.error.retry")} onClick={retry} />
      {supportId ? <p className="ws-muted">{t("accounts.error.code", { code: supportId })}</p> : null}
    </div>
  );
}

/** Loading: the heading and the four cards in the shape of their content (CMP-22). */
function CardLoading() {
  return (
    <div className="acard-grid">
      <div className="ws-card acard-balance">
        <Skeleton variant="block" />
      </div>
      <div className="ws-card acard-info">
        <Skeleton variant="text" lines={5} />
      </div>
      <div className="ws-card acard-tx">
        <Skeleton variant="row" lines={CARD_ROWS} />
      </div>
      <div className="ws-card acard-recurring">
        <Skeleton variant="text" lines={3} />
      </div>
    </div>
  );
}
