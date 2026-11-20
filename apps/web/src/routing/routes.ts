import type { MessageKey } from "@willowsum/i18n";
import type { IconName } from "@willowsum/ui";

export type SectionId = "money" | "planning";

/** An L2 page (UX-09@PoC item 2). */
export interface PageDef {
  id: string;
  sectionId: SectionId;
  path: string;
  label: MessageKey;
  icon: IconName;
}

/** An L1 section; its first page is the root (UX-09@PoC items 1–2). */
export interface SectionDef {
  id: SectionId;
  path: string;
  label: MessageKey;
  icon: IconName;
  pages: readonly PageDef[];
}

const page = (sectionId: SectionId, id: string, icon: IconName, label: MessageKey): PageDef => ({
  id,
  sectionId,
  path: `/${sectionId}/${id}`,
  label,
  icon,
});

/**
 * UX-09@PoC, CMP-69@PoC: L1 «Гроші» (root «Транзакції») and «Планування» (root «Бюджет»). No
 * «Головна», «Активи» or «Ще». «Борги» is always visible (its page shows the empty state).
 * «Чи можу я дозволити» (BUD-04, S-142) and the bank connection screens (S-060…S-062) are PoC v2:
 * not registered here (the `shell.nav.afford` text and the `afford` icon are kept for PoC v2).
 */
export const SECTIONS: readonly SectionDef[] = [
  {
    id: "money",
    path: "/money",
    label: "shell.nav.money",
    icon: "money",
    pages: [
      page("money", "transactions", "transactions", "shell.nav.transactions"),
      page("money", "accounts", "accounts", "shell.nav.accounts"),
    ],
  },
  {
    id: "planning",
    path: "/planning",
    label: "shell.nav.planning",
    icon: "planning",
    pages: [
      page("planning", "budget", "budget", "shell.nav.budget"),
      page("planning", "goals", "goals", "shell.nav.goals"),
      page("planning", "recurring", "recurring", "shell.nav.recurring"),
      page("planning", "debts", "debts", "shell.nav.debts"),
    ],
  },
];

export const rootOf = (section: SectionDef): PageDef => section.pages[0]!;

const findPage = (sectionId: SectionId, id: string): PageDef =>
  SECTIONS.find((s) => s.id === sectionId)!.pages.find((p) => p.id === id)!;

export const TRANSACTIONS = findPage("money", "transactions");
export const ACCOUNTS = findPage("money", "accounts");
export const BUDGET = findPage("planning", "budget");
export const GOALS = findPage("planning", "goals");
export const DEBTS = findPage("planning", "debts");
export const RECURRING = findPage("planning", "recurring");

/** UX-09@PoC item 5, CMP-71@PoC: the start page, the brand-mark link and «На Бюджет». */
export const START_PATH = BUDGET.path;
/** UX-09@PoC item 18: opened from the profile menu. */
export const SETTINGS_PATH = "/settings";
/** ACC-05@PoC FR 1: «Налаштування → Профіль» (S-187). */
export const PROFILE_PATH = "/settings/profile";
/** ACC-08@PoC FR 5, ACC-06@PoC FR 1: «Налаштування → Простір» (S-200). */
export const SPACE_SETTINGS_PATH = "/settings/household";
/** BUD-01@PoC c): «Налаштування → Категорії» (S-196). */
export const CATEGORIES_SETTINGS_PATH = "/settings/categories";
/** UX-09@PoC item 14: the statement import wizard (focus mode). */
export const IMPORT_WIZARD_PATH = "/import";

/** Pages below an L2 page: they open from that page or from «+ Додати», not from the menu. */
export type ChildId =
  | "importHistory"
  | "review"
  | "pairs"
  | "rules"
  | "transaction"
  | "transactionHistory"
  | "newTransaction"
  | "newAccount"
  | "newGoal"
  | "account"
  | "accountSettings"
  | "debtsPlan"
  | "debtsStrategy"
  | "debtsProgress"
  | "newRecurring"
  | "budgetAccounts"
  | "budgetGeneral"
  | "budgetNew"
  | "budgetCompare"
  | "budgetPlan"
  | "budgetTrend"
  | "budgetFlow";
export interface ChildDef {
  id: ChildId;
  parent: PageDef;
  path: string;
  title: MessageKey;
}
export const CHILDREN: readonly ChildDef[] = [
  {
    id: "importHistory",
    parent: TRANSACTIONS,
    path: `${TRANSACTIONS.path}/import`,
    title: "page.importHistory",
  },
  // FIN-03@PoC FR 21: the tabs «До розбору · N» (S-058, wave 2 row 121) and «Пари · N» (S-059, row 139) of «Транзакції».
  { id: "review", parent: TRANSACTIONS, path: `${TRANSACTIONS.path}/review`, title: "tx.tab.review" },
  { id: "pairs", parent: TRANSACTIONS, path: `${TRANSACTIONS.path}/pairs`, title: "tx.tab.pairs" },
  // BUD-14@PoC FR 4: «Гроші › Транзакції › Правила» (S-197), from «…» of «Транзакції» → «Правила категорій».
  { id: "rules", parent: TRANSACTIONS, path: `${TRANSACTIONS.path}/rules`, title: "rules.title" },
  {
    id: "newTransaction",
    parent: TRANSACTIONS,
    path: `${TRANSACTIONS.path}/new`,
    title: "page.newTransaction",
  },
  { id: "newAccount", parent: ACCOUNTS, path: `${ACCOUNTS.path}/new`, title: "page.newAccount" },
  { id: "newGoal", parent: GOALS, path: `${GOALS.path}/new`, title: "page.newGoal" },
  // BUD-19@PoC FR 11: the tabs «План погашення» (S-144), «Стратегія» (S-145), «Прогрес» (S-146) of «Борги».
  { id: "debtsPlan", parent: DEBTS, path: `${DEBTS.path}/plan`, title: "debts.tab.plan" },
  { id: "debtsStrategy", parent: DEBTS, path: `${DEBTS.path}/strategy`, title: "debts.tab.strategy" },
  { id: "debtsProgress", parent: DEBTS, path: `${DEBTS.path}/progress`, title: "debts.tab.progress" },
  // BUD-07@PoC FR 6: «Додати вручну» on S-141.
  { id: "newRecurring", parent: RECURRING, path: `${RECURRING.path}/new`, title: "page.newRecurring" },
  // BUD-02@PoC f) FR 17: «Налаштування бюджету» (S-128 «Рахунки бюджету», S-288 «Загальне»), the gear of «Бюджет».
  {
    id: "budgetAccounts",
    parent: BUDGET,
    path: `${BUDGET.path}/settings/accounts`,
    title: "planning.budget.settings.title",
  },
  {
    id: "budgetGeneral",
    parent: BUDGET,
    path: `${BUDGET.path}/settings/general`,
    title: "planning.budget.settings.title",
  },
  // BUD-02@PoC e) (row 124): the wizard «Новий бюджет» (S-122 … S-124), from the empty state of «Бюджет».
  { id: "budgetNew", parent: BUDGET, path: `${BUDGET.path}/new`, title: "planning.budget.wizard.title" },
  // BUD-06@PoC b) (row 132): the tab «Порівняння» of «Бюджет» (S-132, S-290).
  { id: "budgetCompare", parent: BUDGET, path: `${BUDGET.path}/compare`, title: "planning.compare.title" },
  // BUD-17@PoC b) (row 127): the tab «План» of «Бюджет» (S-126).
  { id: "budgetPlan", parent: BUDGET, path: `${BUDGET.path}/plan`, title: "planning.tab.plan" },
  // BUD-16@PoC b) (row 133): the tab «Тренд» of «Бюджет» (S-133).
  { id: "budgetTrend", parent: BUDGET, path: `${BUDGET.path}/trend`, title: "trend.title" },
  // BUD-08@PoC b) (row 134): the tab «Грошовий потік» of «Бюджет» (S-134, `/planning/budget/money-flow`).
  { id: "budgetFlow", parent: BUDGET, path: `${BUDGET.path}/money-flow`, title: "flow.title" },
];
export const childPath = (id: ChildId): string => CHILDREN.find((c) => c.id === id)!.path;

/** S-053 «Картка рахунку» (`/money/accounts/:id`, FIN-12@PoC c), GRID-02@PoC FR 2): a row of S-050 opens it. */
const ACCOUNT: ChildDef = {
  id: "account",
  parent: ACCOUNTS,
  path: `${ACCOUNTS.path}/:id`,
  title: "page.account",
};
const ACCOUNT_PATH = /^\/money\/accounts\/([0-9a-fA-F-]{36})$/;
/** S-053 of one account. */
export const accountPath = (accountId: string): string =>
  ACCOUNT.path.replace(":id", encodeURIComponent(accountId));
/** The account of an S-053 path, or `null` for any other path. */
export const accountIdOf = (path: string): string | null => ACCOUNT_PATH.exec(path)?.[1] ?? null;

/** S-047 «Деталь транзакції» (`/money/transactions/:id`): a row of S-046 opens it (FIN-03@PoC d), wave 2 row 116). */
const TRANSACTION: ChildDef = {
  id: "transaction",
  parent: TRANSACTIONS,
  path: `${TRANSACTIONS.path}/:id`,
  title: "page.transaction",
};
const TRANSACTION_PATH = /^\/money\/transactions\/([0-9a-fA-F-]{36})$/;
/** S-047 of one transaction. */
export const transactionPath = (transactionId: string): string =>
  TRANSACTION.path.replace(":id", encodeURIComponent(transactionId));
/** The transaction of an S-047 path, or `null` for any other path. */
export const transactionIdOf = (path: string): string | null => TRANSACTION_PATH.exec(path)?.[1] ?? null;

/** «Історія змін» of S-047 (`/money/transactions/:id/history`): a page, as CMP-21@PoC asks for much content. */
const TRANSACTION_HISTORY: ChildDef = {
  id: "transactionHistory",
  parent: TRANSACTIONS,
  path: `${TRANSACTION.path}/history`,
  title: "txDetail.menu.history",
};
const TRANSACTION_HISTORY_PATH = /^\/money\/transactions\/([0-9a-fA-F-]{36})\/history$/;
/** «Історія змін» of one transaction. */
export const transactionHistoryPath = (transactionId: string): string =>
  `${transactionPath(transactionId)}/history`;
/** The transaction of a history path, or `null` for any other path. */
export const transactionHistoryIdOf = (path: string): string | null =>
  TRANSACTION_HISTORY_PATH.exec(path)?.[1] ?? null;

/** S-054 «Налаштування рахунку» (`/money/accounts/:id/settings`); its screen is the dependent part of wave 2 row 113. */
const ACCOUNT_SETTINGS: ChildDef = {
  id: "accountSettings",
  parent: ACCOUNTS,
  path: `${ACCOUNTS.path}/:id/settings`,
  title: "page.accountSettings",
};
const ACCOUNT_SETTINGS_PATH = /^\/money\/accounts\/[0-9a-fA-F-]{36}\/settings$/;
/** S-054 of one account: «›» of a debt row opens it (BUD-19@PoC FR 11, AC9). */
export const accountSettingsPath = (accountId: string): string =>
  ACCOUNT_SETTINGS.path.replace(":id", encodeURIComponent(accountId));

/** DS-22: the design-system sample page, outside the app navigation. */
export const GALLERY_TOKENS_PATH = "/gallery/tokens";

/**
 * S-029 «Немає доступу» (DAT-05@PoC FR 6): the page that stands in place of a module the user's rights close. The
 * shell opens it by this path until the role and scope of a member reach the web app (ACC-10).
 */
export const NO_ACCESS_PATH = "/no-access";

export type Route =
  | { kind: "page"; section: SectionDef; page: PageDef }
  | { kind: "child"; section: SectionDef; child: ChildDef }
  | { kind: "settings" }
  | { kind: "profile" }
  | { kind: "spaceSettings" }
  | { kind: "categories" }
  | { kind: "importWizard" }
  | { kind: "gallery" }
  | { kind: "noAccess" }
  | { kind: "auth"; screen: AuthScreen }
  | { kind: "notFound" };

/**
 * ACC-01@PoC and ACC-04@PoC screens outside the app shell (focus mode, GRID-06): S-001, S-002, S-003 (with the link
 * page), S-004, S-007 «Відновлення пароля» and S-004b «Це був не я».
 */
export type AuthScreen = "signUp" | "checkEmail" | "verify" | "signIn" | "passwordReset" | "notMe";
export const AUTH_PATHS: Readonly<Record<string, AuthScreen>> = {
  "/signup": "signUp",
  "/signup/check-email": "checkEmail",
  "/verify": "verify",
  "/login": "signIn",
  "/password/reset": "passwordReset",
  "/not-me": "notMe",
};

export const sectionOf = (p: PageDef): SectionDef => SECTIONS.find((s) => s.id === p.sectionId)!;

const LEGACY_PATHS: Readonly<Record<string, string>> = {
  "/planning/budget/accounts": "/planning/budget/settings/accounts",
  "/planning/budget/general": "/planning/budget/settings/general",
};

/** The path a route is shown at: `/` and the bare section paths open their root page. */
export function canonicalPath(path: string): string {
  if (path === "/") return START_PATH;
  // BUD-02@PoC f) FR 17: the first addresses of «Налаштування бюджету» (before the screen map's) still open the page.
  const old = LEGACY_PATHS[path];
  if (old) return old;
  const section = SECTIONS.find((s) => s.path === path);
  return section ? rootOf(section).path : path;
}

export function resolveRoute(path: string): Route {
  if (path === GALLERY_TOKENS_PATH) return { kind: "gallery" };
  if (path === NO_ACCESS_PATH) return { kind: "noAccess" };
  if (path === SETTINGS_PATH) return { kind: "settings" };
  if (path === PROFILE_PATH) return { kind: "profile" };
  if (path === SPACE_SETTINGS_PATH) return { kind: "spaceSettings" };
  if (path === CATEGORIES_SETTINGS_PATH) return { kind: "categories" };
  if (path === IMPORT_WIZARD_PATH) return { kind: "importWizard" };
  const auth = AUTH_PATHS[path];
  if (auth) return { kind: "auth", screen: auth };
  for (const section of SECTIONS) {
    const p = section.pages.find((x) => x.path === path);
    if (p) return { kind: "page", section, page: p };
  }
  const child =
    CHILDREN.find((c) => c.path === path) ??
    (ACCOUNT_SETTINGS_PATH.test(path) ? ACCOUNT_SETTINGS : undefined) ??
    (ACCOUNT_PATH.test(path) ? ACCOUNT : undefined) ??
    (TRANSACTION_PATH.test(path) ? TRANSACTION : undefined) ??
    (TRANSACTION_HISTORY_PATH.test(path) ? TRANSACTION_HISTORY : undefined);
  if (child) return { kind: "child", section: sectionOf(child.parent), child };
  return { kind: "notFound" };
}
