import { useEffect, useRef } from "react";
import { I18nProvider } from "@willowsum/i18n";
import { HideAmountsProvider, MAIN_ID, ThemeProvider } from "@willowsum/ui";
import { CheckEmailPage } from "./auth/CheckEmailPage.tsx";
import { NotMePage } from "./auth/NotMePage.tsx";
import { PasswordResetPage } from "./auth/PasswordResetPage.tsx";
import { SessionKeeper } from "./auth/session.ts";
import { SignInPage } from "./auth/SignInPage.tsx";
import { SignUpPage } from "./auth/SignUpPage.tsx";
import { VerifyPage } from "./auth/VerifyPage.tsx";
import { AccountCardPage } from "./accounts/AccountCardPage.tsx";
import { AccountsPage } from "./accounts/AccountsPage.tsx";
import { CategoriesPage } from "./categories/CategoriesPage.tsx";
import { RulesPage } from "./rules/RulesPage.tsx";
import { DebtsScreen, type DebtsTab } from "./debts/DebtsScreen.tsx";
import { GalleryTokensPage } from "./pages/GalleryTokensPage.tsx";
import { ImportWizardPage } from "./pages/ImportWizardPage.tsx";
import { NoAccessPage } from "./pages/NoAccessPage.tsx";
import { NotFoundPage } from "./pages/NotFoundPage.tsx";
import { ChildPage, SectionPage } from "./pages/SectionPage.tsx";
import { NewRecurringPaymentPage } from "./recurring/NewRecurringPaymentPage.tsx";
import { RecurringPage } from "./recurring/RecurringPage.tsx";
import { ProfilePage } from "./settings/ProfilePage.tsx";
import { SettingsPage } from "./settings/SettingsPage.tsx";
import { SpaceSettingsPage } from "./space/SpaceSettingsPage.tsx";
import { TransactionDetailPage } from "./transactions/TransactionDetailPage.tsx";
import { TransactionHistoryPage } from "./transactions/TransactionHistoryPage.tsx";
import { BudgetPage } from "./planning/BudgetPage.tsx";
import { ComparePage } from "./planning/compare/ComparePage.tsx";
import { BudgetPlanPage } from "./planning/plan/BudgetPlanPage.tsx";
import { BudgetWizardPage } from "./planning/budget/WizardPage.tsx";
import { FlowPage } from "./planning/flow/FlowPage.tsx";
import { TrendPage } from "./planning/trend/TrendPage.tsx";
import { BudgetSettingsPage } from "./planning/budget/SettingsPage.tsx";
import { GoalsPage } from "./planning/GoalsPage.tsx";
import { TransactionsPage } from "./transactions/TransactionsPage.tsx";
import {
  ACCOUNTS,
  canonicalPath,
  BUDGET,
  DEBTS,
  GOALS,
  RECURRING,
  resolveRoute,
  TRANSACTIONS,
  type AuthScreen,
  type ChildId,
  type Route,
} from "./routing/routes.ts";
import { initialLocale } from "./i18n/languages.ts";
import { recordVisit, rememberPage } from "./routing/session.ts";
import { hrefFor, useHashPath } from "./routing/useHashPath.ts";

function Router() {
  const requested = useHashPath();
  // UX-09@PoC item 5: `/` opens «Планування → Бюджет»; a bare section path opens its root.
  const path = canonicalPath(requested);
  const route = resolveRoute(path);
  const first = useRef(true);

  useEffect(() => {
    if (requested !== path) window.location.replace(hrefFor(path));
  }, [requested, path]);

  useEffect(() => {
    recordVisit(path);
    const shown = resolveRoute(path);
    if (shown.kind === "page") rememberPage(shown.section.id, shown.page.path);
    if (shown.kind === "child") rememberPage(shown.section.id, shown.child.parent.path);
    // DS-14 item 8, GRID-00 item 11: after moving to another page, focus goes to the main area.
    if (first.current) {
      first.current = false;
      return;
    }
    document.getElementById(MAIN_ID)?.focus();
    window.scrollTo(0, 0);
  }, [path]);

  // The design-system gallery demonstrates «Приховати суми» (kept for MVP); the PoC app has no such
  // mode (UX-09@PoC), so its pages always show amounts, whatever the gallery stored on this device.
  if (route.kind === "gallery")
    return (
      <HideAmountsProvider>
        <GalleryTokensPage />
      </HideAmountsProvider>
    );
  return (
    <HideAmountsProvider initialHidden={false}>
      {/* ACC-04@PoC: the app's own pages keep the session; sign-in, sign-up and «Не знайдено» do not. */}
      {route.kind !== "auth" && route.kind !== "notFound" && <SessionKeeper />}
      {appPage(route)}
    </HideAmountsProvider>
  );
}

function appPage(route: Exclude<Route, { kind: "gallery" }>) {
  switch (route.kind) {
    case "page":
      if (route.page.id === DEBTS.id) return <DebtsScreen tab="list" />;
      // GRID-04@PoC FR 1, FR 3: the grids of S-121 «Бюджет» and S-136 «Цілі».
      if (route.page.id === BUDGET.id) return <BudgetPage />;
      if (route.page.id === GOALS.id) return <GoalsPage />;
      // FIN-01@PoC c), GRID-02@PoC FR 1: S-050 «Рахунки».
      if (route.page.id === ACCOUNTS.id) return <AccountsPage />;
      // BUD-07@PoC c): S-141 «Регулярні платежі».
      if (route.page.id === RECURRING.id) return <RecurringPage />;
      // FIN-03@PoC c), DAT-01@PoC: S-046 «Транзакції».
      if (route.page.id === TRANSACTIONS.id) return <TransactionsPage />;
      return <SectionPage section={route.section} page={route.page} />;
    case "child": {
      const tab = DEBT_TABS[route.child.id];
      if (tab) return <DebtsScreen tab={tab} />;
      // FIN-12@PoC c), GRID-02@PoC FR 2: S-053 «Картка рахунку».
      if (route.child.id === "account") return <AccountCardPage />;
      // FIN-01@PoC c2): S-052 «Новий рахунок» over S-050 «Рахунки».
      if (route.child.id === "newAccount") return <AccountsPage creating />;
      // BUD-02@PoC f): S-128 «Рахунки бюджету» and S-288 «Загальне».
      if (route.child.id === "budgetAccounts" || route.child.id === "budgetGeneral")
        return <BudgetSettingsPage tab={route.child.id === "budgetAccounts" ? "accounts" : "general"} />;
      // BUD-06@PoC b): S-132 «Порівняння» and S-290 «Рік: план і факт».
      if (route.child.id === "budgetCompare") return <ComparePage />;
      // BUD-17@PoC b): S-126 «Бюджет → План».
      if (route.child.id === "budgetPlan") return <BudgetPlanPage />;
      // BUD-02@PoC e): the wizard «Новий бюджет» in focus mode.
      if (route.child.id === "budgetNew") return <BudgetWizardPage />;
      // BUD-16@PoC b): S-133 «Тренд».
      if (route.child.id === "budgetTrend") return <TrendPage />;
      // BUD-08@PoC b): S-134 «Грошовий потік».
      if (route.child.id === "budgetFlow") return <FlowPage />;
      if (route.child.id === "newRecurring") return <NewRecurringPaymentPage child={route.child} />;
      // FIN-03@PoC d): S-047 «Деталь транзакції».
      if (route.child.id === "transaction") return <TransactionDetailPage />;
      if (route.child.id === "transactionHistory") return <TransactionHistoryPage />;
      // BUD-14@PoC c): S-197 «Правила категорій» (S-198 opens over it).
      if (route.child.id === "rules") return <RulesPage />;
      // FIN-03@PoC d): `/money/transactions/new` is «Транзакції» with «Нова транзакція» open over it (S-048).
      if (route.child.id === "newTransaction") return <TransactionsPage newTransaction />;
      // FIN-03@PoC FR 21: the tabs «До розбору» (BUD-12@PoC b), S-058) and «Пари» (a later row: the empty state until then).
      if (route.child.id === "review" || route.child.id === "pairs")
        return <TransactionsPage tab={route.child.id} />;
      return <ChildPage section={route.section} child={route.child} />;
    }
    case "settings":
      return <SettingsPage />;
    case "profile":
      return <ProfilePage />;
    case "spaceSettings":
      return <SpaceSettingsPage />;
    // BUD-01@PoC c): S-196 «Категорії».
    case "categories":
      return <CategoriesPage />;
    case "importWizard":
      return <ImportWizardPage batchId={route.batchId} step={route.step} />;
    case "auth":
      return authPage(route.screen);
    case "noAccess":
      return <NoAccessPage />;
    case "notFound":
      return <NotFoundPage />;
  }
}

/** BUD-19@PoC FR 11: the tabs of «Борги» below the page. */
const DEBT_TABS: Partial<Record<ChildId, DebtsTab>> = {
  debtsPlan: "plan",
  debtsStrategy: "strategy",
  debtsProgress: "progress",
};

function authPage(screen: AuthScreen) {
  switch (screen) {
    case "signUp":
      return <SignUpPage />;
    case "checkEmail":
      return <CheckEmailPage />;
    case "verify":
      return <VerifyPage />;
    case "signIn":
      return <SignInPage />;
    case "passwordReset":
      return <PasswordResetPage />;
    case "notMe":
      return <NotMePage />;
  }
}

export function App() {
  return (
    <I18nProvider initialLocale={initialLocale(window.location.search, import.meta.env.MODE)}>
      <ThemeProvider>
        <Router />
      </ThemeProvider>
    </I18nProvider>
  );
}
