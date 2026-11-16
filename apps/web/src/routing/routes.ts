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
/** UX-09@PoC item 14: the statement import wizard (focus mode). */
export const IMPORT_WIZARD_PATH = "/import";

/** Pages below an L2 page: they open from that page or from «+ Додати», not from the menu. */
export type ChildId =
  | "importHistory"
  | "newTransaction"
  | "newAccount"
  | "newGoal"
  | "accountSettings"
  | "debtsPlan"
  | "debtsStrategy"
  | "debtsProgress"
  | "newRecurring";
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
];
export const childPath = (id: ChildId): string => CHILDREN.find((c) => c.id === id)!.path;

/** S-054 «Налаштування рахунку» (`/money/accounts/:id/settings`); its screen is wave 2 row 113. */
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

export type Route =
  | { kind: "page"; section: SectionDef; page: PageDef }
  | { kind: "child"; section: SectionDef; child: ChildDef }
  | { kind: "settings" }
  | { kind: "importWizard" }
  | { kind: "gallery" }
  | { kind: "auth"; screen: AuthScreen }
  | { kind: "notFound" };

/** ACC-01@PoC screens outside the app shell (focus mode, GRID-06): S-001, S-002, S-003 (with the link page), S-004. */
export type AuthScreen = "signUp" | "checkEmail" | "verify" | "signIn";
export const AUTH_PATHS: Readonly<Record<string, AuthScreen>> = {
  "/signup": "signUp",
  "/signup/check-email": "checkEmail",
  "/verify": "verify",
  "/login": "signIn",
};

export const sectionOf = (p: PageDef): SectionDef => SECTIONS.find((s) => s.id === p.sectionId)!;

/** The path a route is shown at: `/` and the bare section paths open their root page. */
export function canonicalPath(path: string): string {
  if (path === "/") return START_PATH;
  const section = SECTIONS.find((s) => s.path === path);
  return section ? rootOf(section).path : path;
}

export function resolveRoute(path: string): Route {
  if (path === GALLERY_TOKENS_PATH) return { kind: "gallery" };
  if (path === SETTINGS_PATH) return { kind: "settings" };
  if (path === IMPORT_WIZARD_PATH) return { kind: "importWizard" };
  const auth = AUTH_PATHS[path];
  if (auth) return { kind: "auth", screen: auth };
  for (const section of SECTIONS) {
    const p = section.pages.find((x) => x.path === path);
    if (p) return { kind: "page", section, page: p };
  }
  const child =
    CHILDREN.find((c) => c.path === path) ??
    (ACCOUNT_SETTINGS_PATH.test(path) ? ACCOUNT_SETTINGS : undefined);
  if (child) return { kind: "child", section: sectionOf(child.parent), child };
  return { kind: "notFound" };
}
