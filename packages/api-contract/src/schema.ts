// Generated from openapi.json by scripts/generate.ts (ARC-07). Do not edit: run
// `pnpm contract:write` from the repository root.

export type paths = {
    "/v1/accounts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** The space's money accounts with today's balances, in the order they were added */
        get: operations["listAccounts"];
        put?: never;
        /** Create a money account with its opening balance («Новий рахунок») */
        post: operations["createAccount"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/accounts/{accountId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** One money account with today's balances; another space's account is not found */
        get: operations["getAccount"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** «Налаштування» → «Основне»: rename the account or change its kind within its group (FIN-12 FR 4–6) */
        patch: operations["updateAccount"];
        trace?: never;
    };
    "/v1/accounts/{accountId}/balance": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** «Оновити залишок»: one adjustment of the difference against «Коригування», dated today (FIN-12 FR 14) */
        post: operations["updateBalanceOfAccount"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/accounts/{accountId}/balance-adjustments/{adjustmentId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Deletes the adjustment of «Оновити залишок»: its reversal brings the previous balance back (FIN-04 FR 11) */
        delete: operations["deleteBalanceAdjustment"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/accounts/{accountId}/close": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** «Закрити рахунок»: with a zero balance on the closing date, after a transfer or a write-off (FIN-12 FR 7) */
        post: operations["closeAccount"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/accounts/{accountId}/closing": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** The closing dialog: the account's balance on the closing date per currency (FIN-12 FR 7) */
        get: operations["getAccountClosing"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/accounts/{accountId}/details": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** «Налаштування» → «Реквізити»: institution, IBAN or number (sealed, shown masked), note, card expiry, rate; a loan's rate and payment and a card's limit from today (FIN-12 FR 4, AC10) */
        patch: operations["updateAccountDetails"];
        trace?: never;
    };
    "/v1/accounts/{accountId}/display": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** «Обране»: set or clear the star of the account, a display flag — also on a closed account (FIN-01 FR 20, FIN-12 FR 8) */
        patch: operations["updateAccountDisplay"];
        trace?: never;
    };
    "/v1/accounts/{accountId}/reopen": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** «Відкрити знову»: a closed account is active again (FIN-12 FR 9) */
        post: operations["reopenAccount"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/accounts/{accountId}/wallets": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** «+ додати ще валюту» in «Основне»: a currency (wallet) of a current account with its opening balance and date (IMP-02 FR 15) */
        post: operations["addAccountWallet"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/accounts/{accountId}/wallets/{code}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Removes a currency (wallet) without transactions from an account; the main currency and one with transactions stay (IMP-02 FR 15) */
        delete: operations["removeAccountWallet"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/accounts/banks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Banks of the built-in NBU directory whose name contains the text (all of them for an empty text) */
        get: operations["searchBanks"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/accounts/duplicate-check": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** The existing account a new one would duplicate (same institution, number or IBAN and currency), or null */
        post: operations["findDuplicateAccount"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/accounts/summary": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** «Гроші разом» with the breakdown by currency, the «Кредитні» header and «Джерела даних» (active accounts) */
        get: operations["getAccountsSummary"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/budget": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** The space's budget, or null — the empty state «Створити за моїми витратами» / «Почати з нуля» */
        get: operations["getBudget"];
        put?: never;
        /** Create the space's one budget: first period, income plan and limits (FR 1, FR 2, FR 5; edge case 6) */
        post: operations["createBudget"];
        /** «Видалити бюджет» with its limits and snapshots, after the page's confirmation (FR 13, AC13) */
        delete: operations["deleteBudget"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/budget/accounts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** «Рахунки бюджету»: the space's accounts with their switches (FR 10, AC2) */
        get: operations["listBudgetAccounts"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/budget/accounts/{accountId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** Switch an account in or out of the budget; it stays in net worth and the list (FR 10, AC2) */
        put: operations["setBudgetAccount"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/budget/allocation": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** The wizard's «Розподіл»: the bar of the limits step and the surplus or deficit of the plan not saved yet (FR 3, FR 15; AC6, AC7) */
        post: operations["previewBudgetAllocation"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/budget/compare": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** «Порівняння»: spending and income by category against a base and against the plan (BUD-06 FR 1–FR 6; facts only) */
        get: operations["getBudgetCompare"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/budget/compare/year": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** «Рік: план і факт»: categories × 12 months, the fact and «± до плану» (BUD-06 FR 11; facts only) */
        get: operations["getBudgetCompareYear"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/budget/periods/{period}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** A budget period: limits, spent, «Поза планом», income; a finished one from its snapshot (FR 9, FR 11, FR 16) */
        get: operations["getBudgetPeriod"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/budget/periods/{period}/spendable": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** «Можна витратити» of the current period: the sum, the daily limit, the overspend, the five rows and the breakdown (BUD-03 FR 2–10, FR 14, FR 15) */
        get: operations["getBudgetSpendable"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/budget/plan": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Set, change or remove limits and change the income plan — from the current period on (FR 7, FR 8, AC4) */
        patch: operations["updateBudgetPlan"];
        trace?: never;
    };
    "/v1/budget/plan-grid": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** «План»: income, limits, goals and savings, debt payments and «Не розподілено» for 12 months (FR 1, AC1, AC6) */
        get: operations["getBudgetPlanGrid"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/budget/plan-grid/cells": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** Change one cell of «План» for its month only, saved at once; a past month is read only (FR 2, FR 3, AC2–AC4) */
        put: operations["setBudgetPlanCell"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/budget/trend": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** The trend: the plan line (the sum of the month's limits), spending and income per month (BUD-16 FR 4; facts only, FR 5) */
        get: operations["getBudgetTrend"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/budget/wizard": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** The budget wizard: the start choices and the proposal «Створити за моїми витратами» (FR 2, FR 3, FR 14; AC1, AC15) */
        get: operations["getBudgetWizard"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/bulk-actions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Runs a bulk action: up to 50 records at once, more in the background with «Оброблено X з N»; one at a time per account */
        post: operations["startBulkAction"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/bulk-actions/{actionId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** The report of the caller's bulk action: progress, counts with reasons, «Відмінити» and the time left */
        get: operations["getBulkAction"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/bulk-actions/{actionId}/resume": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** «Продовжити» an interrupted bulk action: the records not done yet, in the background */
        post: operations["resumeBulkAction"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/bulk-actions/{actionId}/undo": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** «Відмінити» within 24 hours: previous values back on the records nobody changed since; the others «не відновлено» */
        post: operations["undoBulkAction"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/bulk-actions/preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** The summary before a bulk action (FR 3): how many records change, how many are skipped and why; writes nothing */
        post: operations["previewBulkAction"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/cashflow": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Income, spending, net flow and savings rate of a month or of each month of a period (BUD-08 FR 1, FR 3, FR 11) */
        get: operations["getCashflow"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/categories": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** «Налаштування → Категорії»: the space's tree — groups in order, each with its categories (hidden too) */
        get: operations["listCategories"];
        put?: never;
        /** «Додати» a custom category to a group of income or expenses (FR 2) */
        post: operations["createCategory"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/categories/{categoryId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** One category of the space; another space's or one out of use is not found */
        get: operations["getCategory"];
        put?: never;
        post?: never;
        /** «Видалити» an empty custom category: it leaves the tree and its name is free again (FR 12); in use or system — refused */
        delete: operations["deleteCategory"];
        options?: never;
        head?: never;
        /** «Перейменувати», «Приховати» or show again, icon and colour, «обов'язкова»: the fields sent change (FR 2, 3, 10, 11) */
        patch: operations["updateCategory"];
        trace?: never;
    };
    "/v1/categories/{categoryId}/merge": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** «Об'єднати» with a category of the same type: its transactions, rules and limit go to the target (FR 8) */
        post: operations["mergeCategory"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/category-groups": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** «Додати» a custom group of type «дохід» or «витрата» (FR 2) */
        post: operations["createCategoryGroup"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/category-groups/{groupId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** «Перейменувати» a group; a system group shows its new name (FR 2, FR 3) */
        patch: operations["renameCategoryGroup"];
        trace?: never;
    };
    "/v1/category-rule-runs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** The space's runs of «Застосувати до N наявних…», newest first (at most 20), for «Відмінити» (BUD-14 FR 7) */
        get: operations["listCategoryRuleRuns"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/category-rule-runs/{runId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** A run of a rule: «Оброблено X з N», «Пропущено: ручні зміни», «Відмінити» (BUD-14 FR 7) */
        get: operations["getCategoryRuleRun"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/category-rule-runs/{runId}/undo": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** «Відмінити» a run for 7 days: only values the run changed and nobody changed since come back (BUD-14 FR 7, AC6, EC5) */
        post: operations["undoCategoryRuleRun"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/category-rules": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** «Правила категорій»: the space's rules in priority order, «Потребує уваги», «Застосовано: N» (BUD-14 FR 4) */
        get: operations["listCategoryRules"];
        put?: never;
        /** «Зберегти правило» of «Нове правило»: the lowest priority; applies to new transactions only (BUD-14 FR 4, FR 7) */
        post: operations["createCategoryRule"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/category-rules/{ruleId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** «Видалити» after the confirmation: the rule goes, the others keep their order; transactions keep their category and tags without «за правилом №…» (BUD-14 FR 15, AC17) */
        delete: operations["deleteCategoryRule"];
        options?: never;
        head?: never;
        /** «Змінити правило» and «Увімкнено»: new transactions follow the change, past ones keep their categories (BUD-14 FR 4, FR 7) */
        patch: operations["updateCategoryRule"];
        trace?: never;
    };
    "/v1/category-rules/{ruleId}/apply": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** «Застосувати до N наявних транзакцій, що підходять»: one operation — up to 500 at once, the rest in the background; manual categories skipped (BUD-14 FR 7, FR 9) */
        post: operations["applyCategoryRule"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/category-rules/{ruleId}/move": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** «#» drag, «Вище» / «Нижче»: the rule takes the position, 1 — the highest priority; past categories stay (BUD-14 FR 4, AC14) */
        post: operations["moveCategoryRule"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/category-rules/matches": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** «Показати» and «Застосувати до N наявних транзакцій, що підходять»: the existing transactions the conditions match; nothing changes (BUD-14 FR 7) */
        post: operations["matchCategoryRule"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/category-suggestions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** «Нова транзакція» step 2: the category for the counterparty, «Часто для <мерчанта>» or «Нещодавні», and each known merchant's category (FIN-03 FR 30, FR 31) */
        get: operations["getCategorySuggestions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/debts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** «Борги»: the credit cards and loans with the base calculation, the progress and the saved plan */
        get: operations["listDebts"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/debts/{accountId}/plan": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** «Зберегти план»: the scenario's assumptions and result, one plan per debt (FR 5, AC6) */
        put: operations["saveDebtPlan"];
        post?: never;
        /** Deletes the debt's saved plan; «Плану немає» after it */
        delete: operations["deleteDebtPlan"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/debts/{accountId}/scenario": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** A scenario of one debt next to its base (FR 2, FR 4); nothing is written */
        post: operations["calculateDebtScenario"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/debts/strategy": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** «Стратегія»: Avalanche and Snowball for «Усього на борги / міс.» at once (FR 6, AC3); nothing is written */
        post: operations["compareDebtStrategies"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/duplicate-proposals": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** «Можливий дубль»: two transactions on one account with the same amount and currency within 3 days; never merged or hidden by the system */
        get: operations["listDuplicateProposals"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/email-confirmations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Confirm the email address with the token of a confirmation link */
        post: operations["confirmEmail"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/email-confirmations/resend": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** A new confirmation link instead of an expired one («Надіслати ще раз» on «Посилання недійсне») */
        post: operations["resendConfirmationEmail"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/goals": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** «Цілі»: the space's goals with collected, progress, the required monthly contribution and the pace */
        get: operations["listGoals"];
        put?: never;
        /** «Створити ціль» with one part «де лежать гроші» (FR 2, FR 3) */
        post: operations["createGoal"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/goals/{goalId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** The card of one goal; another space's goal is not found */
        get: operations["getGoal"];
        put?: never;
        post?: never;
        /** «Видалити» a goal: its envelope is freed, its history stays in the audit log (FR 13, edge case 4) */
        delete: operations["deleteGoal"];
        options?: never;
        head?: never;
        /** «Змінити ціль»: the fields sent change, the part too; the currency stays (FR 2, FR 3) */
        patch: operations["updateGoal"];
        trace?: never;
    };
    "/v1/goals/{goalId}/close": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** «Закрити ціль» / «Закрити без витрати»: also when not collected; it leaves the list, no archive (FR 9, FR 12, FR 13) */
        post: operations["closeGoal"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/goals/{goalId}/contributions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** «Внести»: a manual mark of a contribution, over the target too; no money moves (FR 6) */
        post: operations["contributeToGoal"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/goals/{goalId}/spendable": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** «Витратити»: a page of the outgoing transactions the goal may spend — in its currency, on its part's account, not spent from a goal yet (FR 8) */
        get: operations["listGoalSpendable"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/goals/{goalId}/spends": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** «Витратити»: outgoing transactions written off from the goal — no longer in «Можна витратити», «з цілі» (FR 8) */
        post: operations["spendFromGoal"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/goals/{goalId}/spends/{spendId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** «Скасувати витрату»: the spend is cancelled, the transaction stays; its amount goes back to the goal (FR 8) */
        delete: operations["cancelGoalSpend"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/goals/emergency-average": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** «Подушка безпеки»: the space's average monthly expenses over the last 6 full months, without transfers (FR 10, AC 3) */
        get: operations["getGoalEmergencyAverage"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/import/batches": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** The space's import batches, newest first (the history of imports, FR 9) */
        get: operations["listImportBatches"];
        put?: never;
        /** Creates an import batch (FR 1): «завантажено», its name optional; files are uploaded to it next */
        post: operations["createImportBatch"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/import/batches/{batchId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** An import batch with its files: accepted ones with format and size, rejected ones with the reason */
        get: operations["getImportBatch"];
        put?: never;
        post?: never;
        /** «Видалити» (FR 12, EC4): a batch with its originals; an applied one is rolled back first (409), then it may be deleted */
        delete: operations["deleteImportBatch"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/import/batches/{batchId}/apply": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** «Застосувати» (IMP-01 FR 11): the batch's rows become transactions in one write under the locks of its accounts, each duplicate left out; applying it again returns the stored result and writes nothing (IMP-04 FR 7) */
        post: operations["applyImportBatch"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/import/batches/{batchId}/cancel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** «Скасувати» (FR 12): the batch closes without writing anything; from any state before «застосовано» */
        post: operations["cancelImportBatch"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/import/batches/{batchId}/decisions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** The batch's decisions (IMP-05 FR 10), a page at a time by slot */
        get: operations["listImportDecisions"];
        put?: never;
        /** Decisions on a parsed batch (IMP-05 FR 10): rows, groups, readings, flags, the account and the balance choice; all or none; each replaces the one before until the batch is applied */
        post: operations["decideImportBatch"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/import/batches/{batchId}/files": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Uploads files to a batch (FR 3, FR 6, FR 7, FR 13): each is checked by content and stored as the original, or rejected on its own; all rejected — the first reason */
        post: operations["uploadImportFiles"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/import/batches/{batchId}/files/{fileId}/link": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** A short signed link to an accepted file's original (FR 7): valid for at most 15 minutes, this space only */
        post: operations["linkImportOriginal"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/import/batches/{batchId}/files/{fileId}/rows": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** A parsed file's rows (IMP-02 FR 3–5, IMP-06): each as an event with its legs in exact decimals, a page at a time in the order of the file */
        get: operations["listImportFileRows"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/import/batches/{batchId}/parse": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** The parse of each accepted file (FR 5, FR 9, FR 15; IMP-19 FR 4 progress): its state or refusal, recipe, account, engine version, row count, checks and history gap */
        get: operations["getImportBatchParse"];
        put?: never;
        /** «Розібрати» (FR 5, FR 21): every accepted file is parsed in the background with its chosen or matched recipe and its account; the batch is «в обробці» until the last file is done */
        post: operations["parseImportBatch"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/import/batches/{batchId}/readiness": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Whether the batch may be applied (IMP-05 FR 11): each refusal with its explanation — «Підтвердіть рахунок», «Потрібні уточнення», «Потрібен перегляд рядків», «Не підтверджені позначки»; ready with no decision when everything agrees */
        get: operations["getImportBatchReadiness"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/import/originals/{token}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Opens a signed link (FR 7): the original bytes, only as a download with `nosniff`; another space's — not found */
        get: operations["openImportOriginal"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/import/recipes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** The space's parsing recipes, newest first, without their rules */
        get: operations["listImportRecipes"];
        put?: never;
        /** Saves a parsing recipe (FR 1, FR 2, FR 3, FR 14): checked whole; an invalid one is 422 RECIPE_INVALID with each error's code and path */
        post: operations["createImportRecipe"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/import/recipes/{recipeId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** A parsing recipe with its rules; the account binding's value only masked */
        get: operations["getImportRecipe"];
        put?: never;
        post?: never;
        /** Deletes a parsing recipe with its sealed account value */
        delete: operations["deleteImportRecipe"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/me/features": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** The functions that are on for the current space */
        get: operations["getMyFeatures"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/me/permissions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** My role and permissions in the current space */
        get: operations["getMyPermissions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/merchants": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** «Об'єднати з…»: the space's merchants that joined none, by name, with their transaction counts (BUD-14 FR 3) */
        get: operations["listMerchants"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/merchants/{merchantId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** «Перейменувати мерчанта»: the space's name of a merchant; the original descriptions stay (BUD-14 FR 3) */
        patch: operations["renameMerchant"];
        trace?: never;
    };
    "/v1/merchants/{merchantId}/merge": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** «Об'єднати з…»: the merchant of the body joins this one, whose name all their transactions show (BUD-14 FR 3, AC1) */
        post: operations["mergeMerchants"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/merchants/{merchantId}/unmerge": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** «Роз'єднати»: a merchant that joined another is its own again with its transactions (BUD-14 FR 3, AC16) */
        post: operations["unmergeMerchant"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/meta": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** API version */
        get: operations["getMeta"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/not-me-links/check": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** What the «Це був не я» page shows before the confirmation */
        post: operations["checkNotMeLink"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/not-me-links/confirm": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** «Це був не я»: end every session and require a new password */
        post: operations["confirmNotMe"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/password-resets": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Ask for a password reset link by email («Відновлення пароля») */
        post: operations["requestPasswordReset"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/password-resets/check": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Whether a password reset link can still be used (before the new-password form is shown) */
        post: operations["checkPasswordReset"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/password-resets/complete": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Set a new password with a password reset link */
        post: operations["completePasswordReset"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/profile": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** The profile of the signed-in account («Профіль») */
        get: operations["getProfile"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Save the profile («Зберегти»): the name */
        patch: operations["updateProfile"];
        trace?: never;
    };
    "/v1/profile/password": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Change the password in the profile (after step-up) */
        post: operations["changePassword"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/recurring/payments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** The space's regular payments, by name (BUD-07 FR 4, FR 6) */
        get: operations["listRecurringPayments"];
        put?: never;
        /** «Додати вручну»: a regular payment of the space (BUD-07 FR 6) */
        post: operations["createRecurringPayment"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/recurring/payments/{paymentId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** One regular payment; another space's is not found */
        get: operations["getRecurringPayment"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/recurring/payments/{paymentId}/charges": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** A regular payment's charges with their statuses, newest first, through the next one (BUD-07 FR 8–12, FR 20, FR 21) */
        get: operations["listRecurringCharges"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/recurring/payments/{paymentId}/charges/{dueOn}/settle": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** «Зарахувати за <місяць>»: a transaction no charge took pays an overdue or skipped charge — «Сплачено із запізненням» (BUD-07 FR 20, AC14) */
        post: operations["settleRecurringCharge"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/recurring/payments/{paymentId}/charges/{dueOn}/skip": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** «Позначити пропущеним»: an overdue charge becomes «Пропущено» and is no longer matched by itself (BUD-07 FR 21, AC16) */
        post: operations["skipRecurringCharge"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/recurring/payments/{paymentId}/keep": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** «Залишити»: a payment «Можливо, скасований» stays; its misses are counted anew from today (BUD-07 FR 10, AC4) */
        post: operations["keepRecurringPayment"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/recurring/proposals": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Proposals of regular payments: series of one merchant's charges at a frequency with a fixed (± 10 %) or variable amount, from the last 430 days, still charging (BUD-07 FR 1–4) */
        get: operations["listRecurringProposals"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/recurring/proposals/confirm": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Confirm a proposal as a regular payment, with any field edited (BUD-07 FR 4); its merchant gets no more proposals */
        post: operations["confirmRecurringProposal"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/recurring/proposals/reject": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** «Не регулярний»: the series is not proposed again (BUD-07 FR 4) */
        post: operations["rejectRecurringProposal"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/recurring/statuses": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** The status of each regular payment: «Можливо, скасований», the expected amount now and its change, the latest and the next charge (BUD-07 FR 8–12) */
        get: operations["listRecurringStatuses"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/registrations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Sign up with name, email and password */
        post: operations["signUp"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/registrations/change-email": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Leave the «check your email» screen to sign up with another address («Змінити email») */
        post: operations["changeRegistrationEmail"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/registrations/resend": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Send the letter of a sign-up again («Надіслати ще раз») */
        post: operations["resendRegistrationEmail"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/session": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** The signed-in account of this browser */
        get: operations["getSession"];
        put?: never;
        post?: never;
        /** Sign out of this browser */
        delete: operations["signOut"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/session/refresh": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** A user action in this browser: extend the session and rotate its token */
        post: operations["refreshSession"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/session/step-up": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Step-up: confirm a sensitive action with the current password */
        post: operations["confirmStepUp"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/sessions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Sign in with email and password */
        post: operations["signIn"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/space": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** The current space: its name (shown in the profile), data region and reporting currency */
        get: operations["getSpace"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Rename the current space (Owner) */
        patch: operations["renameSpace"];
        trace?: never;
    };
    "/v1/transaction-review": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** The counter of «До розбору»: on «Транзакції» in the side menu (none when 0) and on the tab «До розбору · N» (BUD-12 FR 2, AC9) */
        get: operations["getTransactionReviewCount"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/transaction-review/merchant-groups": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** «До розбору» in the mode «Мерчанти»: the queue grouped by merchant — count, sum per currency and suggested category, the largest group first (BUD-12 FR 14, FR 15) */
        get: operations["listTransactionReviewGroups"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/transaction-review/merchant-groups/{groupId}/transactions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** The ids of a merchant group's transactions in «До розбору», page by page — the selection of «Підтвердити» of the group and of «Змінити категорію» (BUD-12 FR 14, FR 16) */
        get: operations["listTransactionReviewGroupIds"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/transaction-tags": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** The space's tags by name with how many transactions carry each; none — «Тегів ще немає» (BUD-13 FR 2) */
        get: operations["listTransactionTags"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/transaction-tags/{tagId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** «Видалити тег» after the confirmation: the tag is taken off every transaction (BUD-13 FR 2, AC6) */
        delete: operations["deleteTransactionTag"];
        options?: never;
        head?: never;
        /** «Перейменувати» a tag; onto the name of another tag of the space (without regard to case) the two are merged and that one is returned (BUD-13 FR 2) */
        patch: operations["renameTransactionTag"];
        trace?: never;
    };
    "/v1/transactions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** «Транзакції»: one numbered page, the count, and the totals of income, expenses and their difference in the profile currency */
        get: operations["listTransactions"];
        put?: never;
        /** «Нова транзакція»: a transaction entered by hand, one journal event; the balance is recounted at once */
        post: operations["createTransaction"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/transactions/{transactionId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** One transaction; another space's transaction is not found */
        get: operations["getTransaction"];
        put?: never;
        post?: never;
        /** «Видалити» a transaction entered by hand: its postings are reversed, the balance is as before (FR 16); a hidden copy whose pair it was is shown again (FR 35). An imported one is hidden instead, its journal entry kept (FR 16, AC9; IMP-04 FR 9) */
        delete: operations["deleteTransaction"];
        options?: never;
        head?: never;
        /** «Зберегти» of the edit form: the fields sent change; the account, amount or date correct the journal event; a hidden copy whose pair this ends is shown again (FIN-03 FR 35) */
        patch: operations["updateTransaction"];
        trace?: never;
    };
    "/v1/transactions/{transactionId}/attributes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** «Зберегти» of «Нотатка» and «Теги» in the details: the fields sent change; a tag not in the space yet is created (BUD-13 FR 1, FR 2) */
        patch: operations["setTransactionAttributes"];
        trace?: never;
    };
    "/v1/transactions/{transactionId}/category": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** The category of a transaction and its source (BUD-01 FR 4); «Без категорії» — no category, source «none» */
        get: operations["getTransactionCategory"];
        /** «Категорія» in «Деталі транзакції»: the user's category of this one transaction — «вручну»; null — «Без категорії» (BUD-01 FR 5, AC8) */
        put: operations["setTransactionCategory"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/transactions/{transactionId}/hide": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** «Приховати транзакцію»: out of the list, the budget and the reports; a manual copy leaves the balance (its journal entry is reversed), «Показати» posts it again (FIN-03 FR 16, FR 17); only a «Можливий дубль», never a transfer (FR 18) */
        post: operations["hideTransaction"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/transactions/{transactionId}/history": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** «Історія змін» in the details: what the audit log recorded about the transaction and its category, oldest first; free text masked (FIN-03 FR 20, FR 27) */
        get: operations["getTransactionHistory"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/transactions/{transactionId}/merchant": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** «Деталі транзакції»: the merchant of a transaction cleaned from its description, «Оригінальний опис» and «Канал» (BUD-14 FR 1, FR 2) */
        get: operations["getTransactionMerchant"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/transactions/{transactionId}/merge": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** «Об'єднати» a «Можливий дубль» / «Об'єднати з іншою»: the duplicate is merged into this transaction, which keeps its fields; the operation counts once (FIN-03 FR 11, FR 12, FR 27) */
        post: operations["mergeDuplicate"];
        /** «Роз'єднати»: a merged duplicate comes back with its own fields (on the transaction that stays: every one merged into it; FIN-03 edge case 4) */
        delete: operations["unmergeDuplicate"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/transactions/{transactionId}/not-duplicate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** «Не дубль»: the «Можливий дубль» mark is taken off the pair and never put on it again (FIN-03 FR 12); a side hidden as a duplicate with no other pair left is shown again (FR 35) */
        post: operations["dismissDuplicate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/transactions/{transactionId}/review/confirm": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** «Підтвердити» on a card of «До розбору»: the category is confirmed (who and when — in the audit log) and the transaction leaves the queue; a confirmed one — nothing (BUD-12 FR 4, FR 7) */
        post: operations["confirmTransactionReview"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/transactions/{transactionId}/review/reopen": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** «Відмінити» of a confirmation: the transaction is back in «До розбору» with its previous state; one in the queue — nothing (BUD-12 FR 6) */
        post: operations["reopenTransactionReview"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/transactions/{transactionId}/show": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** A hidden transaction is shown again (FIN-03 FR 16); a merged duplicate only by «Роз'єднати» */
        post: operations["showTransaction"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/transactions/{transactionId}/split": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** «Розділити»: the budget's view of the amount by categories or by months; no new transaction, the journal and the balance unchanged */
        post: operations["splitTransaction"];
        /** «Об'єднати назад»: the transaction is whole again (BUD-13 FR 8) */
        delete: operations["unsplitTransaction"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/transactions/{transactionId}/transfer": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** «Позначити як переказ» / «Підтвердити» a pair: two transactions on two accounts as one transfer — neither income nor expense (FIN-03 FR 6, FR 7, FR 27) */
        post: operations["markTransfer"];
        /** The transfer mark removed: both transactions are income and expense again (FIN-03 FR 9) */
        delete: operations["unmarkTransfer"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/transactions/selection-summary": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** «Вибрано N · Сума ±X €» of the selection panel: the exact sum in the profile currency at the official rate of each transaction's date (BUD-13 FR 9) */
        post: operations["summarizeTransactionSelection"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/transactions/transfers": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** «Переказ між рахунками»: a transfer between two own accounts in one action — the debit, the credit and one journal event (FIN-03 FR 1, FR 28) */
        post: operations["createTransfer"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/transfer-proposals": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** «Пари · N»: pairs of a debit and a credit on two own accounts within 3 days that look like one transfer; the system never marks them itself */
        get: operations["listTransferProposals"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
};
export type webhooks = Record<string, never>;
export type components = {
    schemas: {
        /** @description RFC 9457 problem details with a machine-readable code (ARC-07 FR 4). */
        Problem: {
            /** @description VERSION_CONFLICT: the fields changed since the client's version — the readable fields of the base values it sent whose stored value now differs (field names only; fields left out of the base are not reported) */
            changedFields?: string[];
            /**
             * @description Machine-readable code; new codes may be added
             * @enum {string}
             */
            code: "VALIDATION_FAILED" | "MALFORMED_REQUEST" | "INVALID_CURSOR" | "UNAUTHENTICATED" | "SESSION_ENDED" | "INVALID_CREDENTIALS" | "CAPTCHA_REQUIRED" | "PLAN_LIMIT_REACHED" | "FORBIDDEN" | "ORIGIN_NOT_ALLOWED" | "NOT_FOUND" | "RESET_LINK_INVALID" | "NOT_ME_LINK_INVALID" | "PASSWORD_RESET_REQUIRED" | "STEP_UP_PASSWORD_INVALID" | "STEP_UP_REQUIRED" | "IDEMPOTENCY_KEY_REUSED" | "IDEMPOTENCY_REQUEST_IN_PROGRESS" | "VERSION_CONFLICT" | "ACCOUNT_DUPLICATE" | "ACCOUNT_CLOSED" | "ACCOUNT_NOT_CLOSED" | "ACCOUNT_BALANCE_NOT_ZERO" | "ACCOUNT_ACTIVITY_AFTER_CLOSE" | "ACCOUNT_POSTINGS_PENDING" | "ACCOUNT_KIND_OTHER_GROUP" | "ACCOUNT_HAS_TRANSACTIONS" | "ACCOUNT_MAIN_CURRENCY" | "ACCOUNT_CURRENCY_HAS_TRANSACTIONS" | "CATEGORY_NAME_TAKEN" | "CATEGORY_KINDS_DIFFER" | "CATEGORY_SERVICE_FIXED" | "CATEGORY_SYSTEM_FIXED" | "CATEGORY_NOT_EMPTY" | "RECURRING_PROPOSAL_GONE" | "RECURRING_CHARGE_STATE" | "RECURRING_TRANSACTION_TAKEN" | "GOAL_ACCOUNT_TAKEN" | "GOAL_ENVELOPES_OVER_BALANCE" | "GOAL_OWN_ACCOUNT" | "GOAL_SPEND_OVER_COLLECTED" | "BUDGET_EXISTS" | "BUDGET_PERIOD_BEFORE_START" | "DEBT_NOT_DECREASING" | "DEBT_OVER_LIMIT" | "BULK_ACTION_RUNNING" | "BULK_UNDO_UNAVAILABLE" | "RULE_RUN_RUNNING" | "RULE_RUN_UNDO_EXPIRED" | "RULE_RUN_UNDONE" | "RULE_NEEDS_ATTENTION" | "BULK_ACTION_NOT_INTERRUPTED" | "TRANSACTION_IN_TRANSFER" | "TRANSACTION_MERGED" | "TRANSACTION_HAS_DUPLICATES" | "TRANSACTION_SPLIT" | "MERCHANT_MERGED" | "TRANSACTION_NOT_HIDEABLE" | "TRANSACTION_NOT_IN_REVIEW" | "PAYLOAD_TOO_LARGE" | "FILE_REJECTED" | "FILE_TOO_LARGE" | "BATCH_STATE_CONFLICT" | "READING_TOO_PRECISE" | "IMPORT_DECISION_INVALID" | "IMPORT_PARSE_INVALID" | "IMPORT_NOT_READY" | "IMPORT_ROWS_REFUSED" | "IMPORT_PLAN_TOO_LARGE" | "IMPORT_APPLY_UNSUPPORTED" | "RECIPE_INVALID" | "UNSUPPORTED_MEDIA_TYPE" | "LIMIT_REACHED" | "RATE_LIMITED" | "SIGN_IN_LOCKED" | "INTERNAL" | "MODULE_UNAVAILABLE" | "SERVICE_UNAVAILABLE";
            /** @description VERSION_CONFLICT of confirming a transaction in review: the category it has now (null: none), so the card can show it without a reload */
            currentCategoryId?: string | null;
            /** @description VERSION_CONFLICT: the current version of the record */
            currentVersion?: number;
            detail?: string;
            errors?: {
                /** @enum {string} */
                in: "path" | "query" | "header" | "body";
                issue: string;
                path: string;
            }[];
            /** @description GOAL_ENVELOPES_OVER_BALANCE: by how much the envelopes would exceed the account's balance */
            excess?: {
                amount: string;
                currency: string;
            };
            /** @description LIMIT_REACHED: the limit that was reached */
            limit?: number;
            /** @description RECIPE_INVALID: the recipe's errors with their codes and paths */
            recipeErrors?: {
                /** @description The error's code */
                code: string;
                /** @description The field's path in the recipe, e.g. columns[3].role; "" — the whole recipe */
                path: string;
                /** @description UNSAFE_PATTERN: the rule of the safe dialect it breaks */
                reason?: string;
            }[];
            /** @description FILE_REJECTED, FILE_TOO_LARGE: the first file's reason and the ceiling it exceeded */
            rejection?: {
                ceiling?: {
                    limit: number;
                    name: string;
                };
                /** @description The reason's code */
                code: string;
            };
            /**
             * @description SESSION_ENDED: idle (15 min without a user action), expired (12 h after sign-in), signed-out (this browser signed out), ended-elsewhere (a password reset, a password change in the profile on another device, «Це був не я» or a reused token ended it)
             * @enum {string}
             */
            sessionEndReason?: "idle" | "expired" | "signed-out" | "ended-elsewhere";
            status: number;
            /** @description Support code: the trace id the server drew for this request (32 hex digits); clients show it as the error code */
            supportId?: string;
            title: string;
            type: string;
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
};
export type $defs = Record<string, never>;
export interface operations {
    listAccounts: {
        parameters: {
            query?: {
                /** @description Opaque cursor from `nextCursor` of the previous page. */
                cursor?: string;
                group?: "cash" | "credit";
                includeClosed?: "true" | "false";
                /** @description Items per page, 1–100. */
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of accounts */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: {
                            closedOn: string | null;
                            creditCard: {
                                available: {
                                    amount: string;
                                    currency: string;
                                } | null;
                                creditLimit: {
                                    amount: string;
                                    currency: string;
                                } | null;
                                debt: {
                                    amount: string;
                                    currency: string;
                                };
                                gracePeriodDays: number | null;
                            } | null;
                            currencies: {
                                amount: {
                                    amount: string;
                                    currency: string;
                                };
                                approximate: boolean;
                                currency: string;
                                equivalent: {
                                    amount: string;
                                    currency: string;
                                } | null;
                                rateDate: string | null;
                                restricted: boolean;
                            }[];
                            favourite: boolean;
                            /** @enum {string} */
                            group: "cash" | "credit";
                            /** Format: uuid */
                            id: string;
                            inProfileCurrency: {
                                approximate: boolean;
                                total: {
                                    amount: string;
                                    currency: string;
                                } | null;
                                unavailableCount: number;
                            };
                            institution: {
                                country: string;
                                name: string;
                            } | null;
                            /** @enum {string} */
                            kind: "current" | "savings" | "deposit" | "cash" | "credit-card" | "loan";
                            loan: {
                                annualRate: string | null;
                                debt: {
                                    amount: string;
                                    currency: string;
                                };
                                monthlyPayment: {
                                    amount: string;
                                    currency: string;
                                } | null;
                                termsMissing: boolean;
                            } | null;
                            name: string;
                            number: {
                                last4: string;
                                masked: string;
                            } | null;
                            /** @enum {string} */
                            source: "manual" | "import";
                            /** @enum {string} */
                            status: "active" | "closed";
                            updatedOn: string;
                        }[];
                        /** @description Cursor of the next page; null on the last page. */
                        nextCursor: string | null;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    createAccount: {
        parameters: {
            query?: never;
            header?: {
                /** @description Repeating a create with the same key and the same request returns the first response (kept 24 h); the same key with another request is 409. */
                "Idempotency-Key"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    annualRate?: string | null;
                    balance: {
                        /** @description A plain decimal, e.g. 1200.50; at most the currency's minor units */
                        amount: string;
                        /** @description ISO 4217 code */
                        currency: string;
                    };
                    /** @description YYYY-MM-DD */
                    balanceDate: string;
                    creditLimit?: string | null;
                    depositMaturesOn?: string | null;
                    depositOpenedOn?: string | null;
                    extraCurrencies?: {
                        /** @description A plain decimal, e.g. 1200.50; at most the currency's minor units */
                        amount: string;
                        /** @description ISO 4217 code */
                        currency: string;
                        /** @description YYYY-MM-DD */
                        date: string;
                    }[] | null;
                    gracePeriodDays?: number | null;
                    institution?: {
                        /** @description ISO 3166-1 alpha-2 */
                        country: string;
                        name: string;
                    } | null;
                    /** @enum {string} */
                    kind: "current" | "savings" | "deposit" | "cash" | "credit-card" | "loan";
                    monthlyPayment?: string | null;
                    name: string;
                    note?: string | null;
                    number?: string | null;
                };
            };
        };
        responses: {
            /** @description The new account with its balances */
            201: {
                headers: {
                    /** @description true when this is the stored response of an earlier request with the same key */
                    "Idempotent-Replayed"?: "true";
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        adjustments: {
                            amount: {
                                amount: string;
                                currency: string;
                            };
                            currency: string;
                            date: string;
                            /** Format: uuid */
                            id: string;
                            permanent: boolean;
                        }[];
                        closedOn: string | null;
                        creditCard: {
                            annualRate: string | null;
                            available: {
                                amount: string;
                                currency: string;
                            } | null;
                            cardExpiry: string | null;
                            creditLimit: {
                                amount: string;
                                currency: string;
                            } | null;
                            debt: {
                                amount: string;
                                currency: string;
                            };
                            gracePeriodDays: number | null;
                        } | null;
                        currencies: {
                            balance: {
                                amount: string;
                                currency: string;
                            };
                            balanceDate: string;
                            currency: string;
                        }[];
                        deposit: {
                            accrual: {
                                accrued: {
                                    amount: string;
                                    currency: string;
                                };
                                days: number;
                                daysToMaturity: number;
                                matured: boolean;
                            } | null;
                            annualRate: string | null;
                            maturesOn: string | null;
                            openedOn: string | null;
                        } | null;
                        favourite: boolean;
                        /** @enum {string} */
                        group: "cash" | "credit";
                        /** Format: uuid */
                        id: string;
                        institution: {
                            country: string;
                            name: string;
                        } | null;
                        /** @enum {string} */
                        kind: "current" | "savings" | "deposit" | "cash" | "credit-card" | "loan";
                        loan: {
                            annualRate: string | null;
                            debt: {
                                amount: string;
                                currency: string;
                            };
                            monthlyPayment: {
                                amount: string;
                                currency: string;
                            } | null;
                            termsMissing: boolean;
                        } | null;
                        name: string;
                        note: string | null;
                        number: {
                            last4: string;
                            masked: string;
                        } | null;
                        openedOn: string;
                        owners: {
                            /** Format: uuid */
                            ownerAccountId: string;
                            /** @description Percent, a decimal string */
                            share: string;
                            validFrom: string;
                            validTo: string | null;
                        }[];
                        savings: {
                            annualRate: string | null;
                        } | null;
                        /** @enum {string} */
                        source: "manual" | "import";
                        /** @enum {string} */
                        status: "active" | "closed";
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN), or the request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The idempotency key was used for another request, or that request is still running; An account with this institution, number and currency already exists (ACCOUNT_DUPLICATE) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    getAccount: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                accountId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The account */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        adjustments: {
                            amount: {
                                amount: string;
                                currency: string;
                            };
                            currency: string;
                            date: string;
                            /** Format: uuid */
                            id: string;
                            permanent: boolean;
                        }[];
                        closedOn: string | null;
                        creditCard: {
                            annualRate: string | null;
                            available: {
                                amount: string;
                                currency: string;
                            } | null;
                            cardExpiry: string | null;
                            creditLimit: {
                                amount: string;
                                currency: string;
                            } | null;
                            debt: {
                                amount: string;
                                currency: string;
                            };
                            gracePeriodDays: number | null;
                        } | null;
                        currencies: {
                            balance: {
                                amount: string;
                                currency: string;
                            };
                            balanceDate: string;
                            currency: string;
                        }[];
                        deposit: {
                            accrual: {
                                accrued: {
                                    amount: string;
                                    currency: string;
                                };
                                days: number;
                                daysToMaturity: number;
                                matured: boolean;
                            } | null;
                            annualRate: string | null;
                            maturesOn: string | null;
                            openedOn: string | null;
                        } | null;
                        favourite: boolean;
                        /** @enum {string} */
                        group: "cash" | "credit";
                        /** Format: uuid */
                        id: string;
                        institution: {
                            country: string;
                            name: string;
                        } | null;
                        /** @enum {string} */
                        kind: "current" | "savings" | "deposit" | "cash" | "credit-card" | "loan";
                        loan: {
                            annualRate: string | null;
                            debt: {
                                amount: string;
                                currency: string;
                            };
                            monthlyPayment: {
                                amount: string;
                                currency: string;
                            } | null;
                            termsMissing: boolean;
                        } | null;
                        name: string;
                        note: string | null;
                        number: {
                            last4: string;
                            masked: string;
                        } | null;
                        openedOn: string;
                        owners: {
                            /** Format: uuid */
                            ownerAccountId: string;
                            /** @description Percent, a decimal string */
                            share: string;
                            validFrom: string;
                            validTo: string | null;
                        }[];
                        savings: {
                            annualRate: string | null;
                        } | null;
                        /** @enum {string} */
                        source: "manual" | "import";
                        /** @enum {string} */
                        status: "active" | "closed";
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    updateAccount: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                accountId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @enum {string} */
                    kind?: "current" | "savings" | "deposit" | "cash" | "credit-card" | "loan";
                    name?: string;
                };
            };
        };
        responses: {
            /** @description The account after the change */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        adjustments: {
                            amount: {
                                amount: string;
                                currency: string;
                            };
                            currency: string;
                            date: string;
                            /** Format: uuid */
                            id: string;
                            permanent: boolean;
                        }[];
                        closedOn: string | null;
                        creditCard: {
                            annualRate: string | null;
                            available: {
                                amount: string;
                                currency: string;
                            } | null;
                            cardExpiry: string | null;
                            creditLimit: {
                                amount: string;
                                currency: string;
                            } | null;
                            debt: {
                                amount: string;
                                currency: string;
                            };
                            gracePeriodDays: number | null;
                        } | null;
                        currencies: {
                            balance: {
                                amount: string;
                                currency: string;
                            };
                            balanceDate: string;
                            currency: string;
                        }[];
                        deposit: {
                            accrual: {
                                accrued: {
                                    amount: string;
                                    currency: string;
                                };
                                days: number;
                                daysToMaturity: number;
                                matured: boolean;
                            } | null;
                            annualRate: string | null;
                            maturesOn: string | null;
                            openedOn: string | null;
                        } | null;
                        favourite: boolean;
                        /** @enum {string} */
                        group: "cash" | "credit";
                        /** Format: uuid */
                        id: string;
                        institution: {
                            country: string;
                            name: string;
                        } | null;
                        /** @enum {string} */
                        kind: "current" | "savings" | "deposit" | "cash" | "credit-card" | "loan";
                        loan: {
                            annualRate: string | null;
                            debt: {
                                amount: string;
                                currency: string;
                            };
                            monthlyPayment: {
                                amount: string;
                                currency: string;
                            } | null;
                            termsMissing: boolean;
                        } | null;
                        name: string;
                        note: string | null;
                        number: {
                            last4: string;
                            masked: string;
                        } | null;
                        openedOn: string;
                        owners: {
                            /** Format: uuid */
                            ownerAccountId: string;
                            /** @description Percent, a decimal string */
                            share: string;
                            validFrom: string;
                            validTo: string | null;
                        }[];
                        savings: {
                            annualRate: string | null;
                        } | null;
                        /** @enum {string} */
                        source: "manual" | "import";
                        /** @enum {string} */
                        status: "active" | "closed";
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN), or the request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The account is closed (ACCOUNT_CLOSED); The kind can change only within its group (ACCOUNT_KIND_OTHER_GROUP); The account has transactions; its kind cannot change (ACCOUNT_HAS_TRANSACTIONS) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    updateBalanceOfAccount: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                accountId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    balance: {
                        /** @description A plain decimal, e.g. 1200.50; at most the currency's minor units */
                        amount: string;
                        /** @description ISO 4217 code */
                        currency: string;
                    };
                };
            };
        };
        responses: {
            /** @description The adjustment in effect and today's balance; `changed` false — the difference was zero */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        adjustment: {
                            amount: {
                                amount: string;
                                currency: string;
                            };
                            date: string;
                            /** Format: uuid */
                            id: string;
                            permanent: boolean;
                        } | null;
                        balance: {
                            amount: string;
                            currency: string;
                        };
                        changed: boolean;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN), or the request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The account is closed (ACCOUNT_CLOSED); Some of the account's transactions are still being posted; try again later (ACCOUNT_POSTINGS_PENDING) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    deleteBalanceAdjustment: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                accountId: string;
                adjustmentId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Today's balance of the adjustment's currency */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        balance: {
                            amount: string;
                            currency: string;
                        };
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN), or the request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The account is closed (ACCOUNT_CLOSED) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    closeAccount: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                accountId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description YYYY-MM-DD */
                    closedOn: string;
                    settlement?: {
                        /** @constant */
                        kind: "transfer";
                        /** Format: uuid */
                        toAccountId: string;
                    } | {
                        /** @constant */
                        kind: "adjustment";
                    };
                };
            };
        };
        responses: {
            /** @description The closed account */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        adjustments: {
                            amount: {
                                amount: string;
                                currency: string;
                            };
                            currency: string;
                            date: string;
                            /** Format: uuid */
                            id: string;
                            permanent: boolean;
                        }[];
                        closedOn: string | null;
                        creditCard: {
                            annualRate: string | null;
                            available: {
                                amount: string;
                                currency: string;
                            } | null;
                            cardExpiry: string | null;
                            creditLimit: {
                                amount: string;
                                currency: string;
                            } | null;
                            debt: {
                                amount: string;
                                currency: string;
                            };
                            gracePeriodDays: number | null;
                        } | null;
                        currencies: {
                            balance: {
                                amount: string;
                                currency: string;
                            };
                            balanceDate: string;
                            currency: string;
                        }[];
                        deposit: {
                            accrual: {
                                accrued: {
                                    amount: string;
                                    currency: string;
                                };
                                days: number;
                                daysToMaturity: number;
                                matured: boolean;
                            } | null;
                            annualRate: string | null;
                            maturesOn: string | null;
                            openedOn: string | null;
                        } | null;
                        favourite: boolean;
                        /** @enum {string} */
                        group: "cash" | "credit";
                        /** Format: uuid */
                        id: string;
                        institution: {
                            country: string;
                            name: string;
                        } | null;
                        /** @enum {string} */
                        kind: "current" | "savings" | "deposit" | "cash" | "credit-card" | "loan";
                        loan: {
                            annualRate: string | null;
                            debt: {
                                amount: string;
                                currency: string;
                            };
                            monthlyPayment: {
                                amount: string;
                                currency: string;
                            } | null;
                            termsMissing: boolean;
                        } | null;
                        name: string;
                        note: string | null;
                        number: {
                            last4: string;
                            masked: string;
                        } | null;
                        openedOn: string;
                        owners: {
                            /** Format: uuid */
                            ownerAccountId: string;
                            /** @description Percent, a decimal string */
                            share: string;
                            validFrom: string;
                            validTo: string | null;
                        }[];
                        savings: {
                            annualRate: string | null;
                        } | null;
                        /** @enum {string} */
                        source: "manual" | "import";
                        /** @enum {string} */
                        status: "active" | "closed";
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN), or the request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The account is closed (ACCOUNT_CLOSED); The balance on the closing date is not zero (ACCOUNT_BALANCE_NOT_ZERO); The account has movements after the closing date (ACCOUNT_ACTIVITY_AFTER_CLOSE); Some of the account's transactions are still being posted; try again later (ACCOUNT_POSTINGS_PENDING) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    getAccountClosing: {
        parameters: {
            query: {
                /** @description YYYY-MM-DD */
                closedOn: string;
            };
            header?: never;
            path: {
                accountId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The balances on the closing date; `zero` — the account can close without a choice */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        closedOn: string;
                        currencies: {
                            balance: {
                                amount: string;
                                currency: string;
                            };
                            currency: string;
                        }[];
                        zero: boolean;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The account is closed (ACCOUNT_CLOSED); The account has movements after the closing date (ACCOUNT_ACTIVITY_AFTER_CLOSE); Some of the account's transactions are still being posted; try again later (ACCOUNT_POSTINGS_PENDING) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    updateAccountDetails: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                accountId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    annualRate?: string | null;
                    cardExpiry?: string | null;
                    creditLimit?: string | null;
                    institution?: {
                        /** @description ISO 3166-1 alpha-2 */
                        country: string;
                        name: string;
                    } | null;
                    monthlyPayment?: string | null;
                    note?: string | null;
                    number?: string | null;
                };
            };
        };
        responses: {
            /** @description The account after the change */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        adjustments: {
                            amount: {
                                amount: string;
                                currency: string;
                            };
                            currency: string;
                            date: string;
                            /** Format: uuid */
                            id: string;
                            permanent: boolean;
                        }[];
                        closedOn: string | null;
                        creditCard: {
                            annualRate: string | null;
                            available: {
                                amount: string;
                                currency: string;
                            } | null;
                            cardExpiry: string | null;
                            creditLimit: {
                                amount: string;
                                currency: string;
                            } | null;
                            debt: {
                                amount: string;
                                currency: string;
                            };
                            gracePeriodDays: number | null;
                        } | null;
                        currencies: {
                            balance: {
                                amount: string;
                                currency: string;
                            };
                            balanceDate: string;
                            currency: string;
                        }[];
                        deposit: {
                            accrual: {
                                accrued: {
                                    amount: string;
                                    currency: string;
                                };
                                days: number;
                                daysToMaturity: number;
                                matured: boolean;
                            } | null;
                            annualRate: string | null;
                            maturesOn: string | null;
                            openedOn: string | null;
                        } | null;
                        favourite: boolean;
                        /** @enum {string} */
                        group: "cash" | "credit";
                        /** Format: uuid */
                        id: string;
                        institution: {
                            country: string;
                            name: string;
                        } | null;
                        /** @enum {string} */
                        kind: "current" | "savings" | "deposit" | "cash" | "credit-card" | "loan";
                        loan: {
                            annualRate: string | null;
                            debt: {
                                amount: string;
                                currency: string;
                            };
                            monthlyPayment: {
                                amount: string;
                                currency: string;
                            } | null;
                            termsMissing: boolean;
                        } | null;
                        name: string;
                        note: string | null;
                        number: {
                            last4: string;
                            masked: string;
                        } | null;
                        openedOn: string;
                        owners: {
                            /** Format: uuid */
                            ownerAccountId: string;
                            /** @description Percent, a decimal string */
                            share: string;
                            validFrom: string;
                            validTo: string | null;
                        }[];
                        savings: {
                            annualRate: string | null;
                        } | null;
                        /** @enum {string} */
                        source: "manual" | "import";
                        /** @enum {string} */
                        status: "active" | "closed";
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN), or the request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The account is closed (ACCOUNT_CLOSED); An account with this institution, number and currency already exists (ACCOUNT_DUPLICATE) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    updateAccountDisplay: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                accountId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    favourite: boolean;
                };
            };
        };
        responses: {
            /** @description The account after the change */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        adjustments: {
                            amount: {
                                amount: string;
                                currency: string;
                            };
                            currency: string;
                            date: string;
                            /** Format: uuid */
                            id: string;
                            permanent: boolean;
                        }[];
                        closedOn: string | null;
                        creditCard: {
                            annualRate: string | null;
                            available: {
                                amount: string;
                                currency: string;
                            } | null;
                            cardExpiry: string | null;
                            creditLimit: {
                                amount: string;
                                currency: string;
                            } | null;
                            debt: {
                                amount: string;
                                currency: string;
                            };
                            gracePeriodDays: number | null;
                        } | null;
                        currencies: {
                            balance: {
                                amount: string;
                                currency: string;
                            };
                            balanceDate: string;
                            currency: string;
                        }[];
                        deposit: {
                            accrual: {
                                accrued: {
                                    amount: string;
                                    currency: string;
                                };
                                days: number;
                                daysToMaturity: number;
                                matured: boolean;
                            } | null;
                            annualRate: string | null;
                            maturesOn: string | null;
                            openedOn: string | null;
                        } | null;
                        favourite: boolean;
                        /** @enum {string} */
                        group: "cash" | "credit";
                        /** Format: uuid */
                        id: string;
                        institution: {
                            country: string;
                            name: string;
                        } | null;
                        /** @enum {string} */
                        kind: "current" | "savings" | "deposit" | "cash" | "credit-card" | "loan";
                        loan: {
                            annualRate: string | null;
                            debt: {
                                amount: string;
                                currency: string;
                            };
                            monthlyPayment: {
                                amount: string;
                                currency: string;
                            } | null;
                            termsMissing: boolean;
                        } | null;
                        name: string;
                        note: string | null;
                        number: {
                            last4: string;
                            masked: string;
                        } | null;
                        openedOn: string;
                        owners: {
                            /** Format: uuid */
                            ownerAccountId: string;
                            /** @description Percent, a decimal string */
                            share: string;
                            validFrom: string;
                            validTo: string | null;
                        }[];
                        savings: {
                            annualRate: string | null;
                        } | null;
                        /** @enum {string} */
                        source: "manual" | "import";
                        /** @enum {string} */
                        status: "active" | "closed";
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN), or the request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    reopenAccount: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                accountId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The account, active again */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        adjustments: {
                            amount: {
                                amount: string;
                                currency: string;
                            };
                            currency: string;
                            date: string;
                            /** Format: uuid */
                            id: string;
                            permanent: boolean;
                        }[];
                        closedOn: string | null;
                        creditCard: {
                            annualRate: string | null;
                            available: {
                                amount: string;
                                currency: string;
                            } | null;
                            cardExpiry: string | null;
                            creditLimit: {
                                amount: string;
                                currency: string;
                            } | null;
                            debt: {
                                amount: string;
                                currency: string;
                            };
                            gracePeriodDays: number | null;
                        } | null;
                        currencies: {
                            balance: {
                                amount: string;
                                currency: string;
                            };
                            balanceDate: string;
                            currency: string;
                        }[];
                        deposit: {
                            accrual: {
                                accrued: {
                                    amount: string;
                                    currency: string;
                                };
                                days: number;
                                daysToMaturity: number;
                                matured: boolean;
                            } | null;
                            annualRate: string | null;
                            maturesOn: string | null;
                            openedOn: string | null;
                        } | null;
                        favourite: boolean;
                        /** @enum {string} */
                        group: "cash" | "credit";
                        /** Format: uuid */
                        id: string;
                        institution: {
                            country: string;
                            name: string;
                        } | null;
                        /** @enum {string} */
                        kind: "current" | "savings" | "deposit" | "cash" | "credit-card" | "loan";
                        loan: {
                            annualRate: string | null;
                            debt: {
                                amount: string;
                                currency: string;
                            };
                            monthlyPayment: {
                                amount: string;
                                currency: string;
                            } | null;
                            termsMissing: boolean;
                        } | null;
                        name: string;
                        note: string | null;
                        number: {
                            last4: string;
                            masked: string;
                        } | null;
                        openedOn: string;
                        owners: {
                            /** Format: uuid */
                            ownerAccountId: string;
                            /** @description Percent, a decimal string */
                            share: string;
                            validFrom: string;
                            validTo: string | null;
                        }[];
                        savings: {
                            annualRate: string | null;
                        } | null;
                        /** @enum {string} */
                        source: "manual" | "import";
                        /** @enum {string} */
                        status: "active" | "closed";
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN), or the request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The account is not closed (ACCOUNT_NOT_CLOSED) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    addAccountWallet: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                accountId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    balance: {
                        /** @description A plain decimal, e.g. 1200.50; at most the currency's minor units */
                        amount: string;
                        /** @description ISO 4217 code */
                        currency: string;
                    };
                    /** @description YYYY-MM-DD */
                    balanceDate: string;
                };
            };
        };
        responses: {
            /** @description The account with the currency added */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        adjustments: {
                            amount: {
                                amount: string;
                                currency: string;
                            };
                            currency: string;
                            date: string;
                            /** Format: uuid */
                            id: string;
                            permanent: boolean;
                        }[];
                        closedOn: string | null;
                        creditCard: {
                            annualRate: string | null;
                            available: {
                                amount: string;
                                currency: string;
                            } | null;
                            cardExpiry: string | null;
                            creditLimit: {
                                amount: string;
                                currency: string;
                            } | null;
                            debt: {
                                amount: string;
                                currency: string;
                            };
                            gracePeriodDays: number | null;
                        } | null;
                        currencies: {
                            balance: {
                                amount: string;
                                currency: string;
                            };
                            balanceDate: string;
                            currency: string;
                        }[];
                        deposit: {
                            accrual: {
                                accrued: {
                                    amount: string;
                                    currency: string;
                                };
                                days: number;
                                daysToMaturity: number;
                                matured: boolean;
                            } | null;
                            annualRate: string | null;
                            maturesOn: string | null;
                            openedOn: string | null;
                        } | null;
                        favourite: boolean;
                        /** @enum {string} */
                        group: "cash" | "credit";
                        /** Format: uuid */
                        id: string;
                        institution: {
                            country: string;
                            name: string;
                        } | null;
                        /** @enum {string} */
                        kind: "current" | "savings" | "deposit" | "cash" | "credit-card" | "loan";
                        loan: {
                            annualRate: string | null;
                            debt: {
                                amount: string;
                                currency: string;
                            };
                            monthlyPayment: {
                                amount: string;
                                currency: string;
                            } | null;
                            termsMissing: boolean;
                        } | null;
                        name: string;
                        note: string | null;
                        number: {
                            last4: string;
                            masked: string;
                        } | null;
                        openedOn: string;
                        owners: {
                            /** Format: uuid */
                            ownerAccountId: string;
                            /** @description Percent, a decimal string */
                            share: string;
                            validFrom: string;
                            validTo: string | null;
                        }[];
                        savings: {
                            annualRate: string | null;
                        } | null;
                        /** @enum {string} */
                        source: "manual" | "import";
                        /** @enum {string} */
                        status: "active" | "closed";
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN), or the request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The account is closed (ACCOUNT_CLOSED); An account with this institution, number and currency already exists (ACCOUNT_DUPLICATE) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    removeAccountWallet: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                accountId: string;
                /** @description ISO 4217 code */
                code: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The account without the currency */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        adjustments: {
                            amount: {
                                amount: string;
                                currency: string;
                            };
                            currency: string;
                            date: string;
                            /** Format: uuid */
                            id: string;
                            permanent: boolean;
                        }[];
                        closedOn: string | null;
                        creditCard: {
                            annualRate: string | null;
                            available: {
                                amount: string;
                                currency: string;
                            } | null;
                            cardExpiry: string | null;
                            creditLimit: {
                                amount: string;
                                currency: string;
                            } | null;
                            debt: {
                                amount: string;
                                currency: string;
                            };
                            gracePeriodDays: number | null;
                        } | null;
                        currencies: {
                            balance: {
                                amount: string;
                                currency: string;
                            };
                            balanceDate: string;
                            currency: string;
                        }[];
                        deposit: {
                            accrual: {
                                accrued: {
                                    amount: string;
                                    currency: string;
                                };
                                days: number;
                                daysToMaturity: number;
                                matured: boolean;
                            } | null;
                            annualRate: string | null;
                            maturesOn: string | null;
                            openedOn: string | null;
                        } | null;
                        favourite: boolean;
                        /** @enum {string} */
                        group: "cash" | "credit";
                        /** Format: uuid */
                        id: string;
                        institution: {
                            country: string;
                            name: string;
                        } | null;
                        /** @enum {string} */
                        kind: "current" | "savings" | "deposit" | "cash" | "credit-card" | "loan";
                        loan: {
                            annualRate: string | null;
                            debt: {
                                amount: string;
                                currency: string;
                            };
                            monthlyPayment: {
                                amount: string;
                                currency: string;
                            } | null;
                            termsMissing: boolean;
                        } | null;
                        name: string;
                        note: string | null;
                        number: {
                            last4: string;
                            masked: string;
                        } | null;
                        openedOn: string;
                        owners: {
                            /** Format: uuid */
                            ownerAccountId: string;
                            /** @description Percent, a decimal string */
                            share: string;
                            validFrom: string;
                            validTo: string | null;
                        }[];
                        savings: {
                            annualRate: string | null;
                        } | null;
                        /** @enum {string} */
                        source: "manual" | "import";
                        /** @enum {string} */
                        status: "active" | "closed";
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN), or the request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The account is closed (ACCOUNT_CLOSED); The account's main currency cannot be removed (ACCOUNT_MAIN_CURRENCY); The currency has transactions on this account; it cannot be removed (ACCOUNT_CURRENCY_HAS_TRANSACTIONS) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    searchBanks: {
        parameters: {
            query?: {
                /** @description Opaque cursor from `nextCursor` of the previous page. */
                cursor?: string;
                /** @description Items per page, 1–100. */
                limit?: number;
                q?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of banks, names starting with the text first, then by name; the directory's source and date */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: {
                            code: string;
                            country: string;
                            name: string;
                        }[];
                        /** @description Cursor of the next page; null on the last page. */
                        nextCursor: string | null;
                        source: {
                            asOf: string;
                            attribution: string;
                            url: string;
                        };
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    findDuplicateAccount: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    currencies: string[];
                    institution?: {
                        /** @description ISO 3166-1 alpha-2 */
                        country: string;
                        name: string;
                    } | null;
                    number: string;
                };
            };
        };
        responses: {
            /** @description «Такий рахунок уже є: <установа> ••<4 символи>» with the account to open, or null */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        duplicate: {
                            /** Format: uuid */
                            accountId: string;
                            institution: string;
                            maskedNumber: string;
                        } | null;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN), or the request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    getAccountsSummary: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Totals in the profile currency at the dated NBU rate (fx-rates); amounts unrounded */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        cash: {
                            approximate: boolean;
                            total: {
                                amount: string;
                                currency: string;
                            } | null;
                            unavailableCount: number;
                        };
                        credit: {
                            cardDebt: {
                                approximate: boolean;
                                total: {
                                    amount: string;
                                    currency: string;
                                } | null;
                                unavailableCount: number;
                            };
                            loanDebt: {
                                approximate: boolean;
                                total: {
                                    amount: string;
                                    currency: string;
                                } | null;
                                unavailableCount: number;
                            };
                        };
                        currency: string;
                        moneyTogether: {
                            approximate: boolean;
                            breakdown: {
                                amount: {
                                    amount: string;
                                    currency: string;
                                };
                                approximate: boolean;
                                currency: string;
                                equivalent: {
                                    amount: string;
                                    currency: string;
                                } | null;
                                percent: number | null;
                                rateDate: string | null;
                                restricted: boolean;
                            }[];
                            rate: {
                                date: string;
                                source: string;
                            } | null;
                            staleRateCount: number;
                            total: {
                                amount: string;
                                currency: string;
                            } | null;
                            unavailableCount: number;
                        };
                        sources: {
                            import: number;
                            manual: number;
                        };
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    getBudget: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The budget or null */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        budget: {
                            createdOn: string;
                            currency: string;
                            firstPeriod: string;
                            /** Format: uuid */
                            id: string;
                            incomePlan: {
                                amount: string;
                                currency: string;
                            };
                            limits: {
                                amount: {
                                    amount: string;
                                    currency: string;
                                };
                                /** Format: uuid */
                                categoryId: string;
                            }[];
                            proportional: {
                                days: number;
                                daysInPeriod: number;
                                from: string;
                                to: string;
                            } | null;
                            version: number;
                        } | null;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    createBudget: {
        parameters: {
            query?: never;
            header?: {
                /** @description Repeating a create with the same key and the same request returns the first response (kept 24 h); the same key with another request is 409. */
                "Idempotency-Key"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description A calendar month, YYYY-MM */
                    firstPeriod: string;
                    incomePlan?: {
                        /** @description A plain non-negative decimal, at most 15 integer digits and the currency's minor units */
                        amount: string;
                        /** @description The budget's currency (the space's reporting currency) */
                        currency: string;
                    };
                    limits?: {
                        amount: {
                            /** @description A plain non-negative decimal, at most 15 integer digits and the currency's minor units */
                            amount: string;
                            /** @description The budget's currency (the space's reporting currency) */
                            currency: string;
                        };
                        /** Format: uuid */
                        categoryId: string;
                    }[];
                    proportional?: boolean;
                };
            };
        };
        responses: {
            /** @description The new budget */
            201: {
                headers: {
                    /** @description true when this is the stored response of an earlier request with the same key */
                    "Idempotent-Replayed"?: "true";
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        createdOn: string;
                        currency: string;
                        firstPeriod: string;
                        /** Format: uuid */
                        id: string;
                        incomePlan: {
                            amount: string;
                            currency: string;
                        };
                        limits: {
                            amount: {
                                amount: string;
                                currency: string;
                            };
                            /** Format: uuid */
                            categoryId: string;
                        }[];
                        proportional: {
                            days: number;
                            daysInPeriod: number;
                            from: string;
                            to: string;
                        } | null;
                        version: number;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN), or the request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The idempotency key was used for another request, or that request is still running; The space already has a budget (BUDGET_EXISTS) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    deleteBudget: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Deleted */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        deleted: true;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN), or the request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    listBudgetAccounts: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The accounts in the order of «Рахунки» */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        accounts: {
                            /** Format: uuid */
                            accountId: string;
                            included: boolean;
                            kind: string;
                            /** @enum {string} */
                            status: "active" | "closed";
                        }[];
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    setBudgetAccount: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                accountId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    included: boolean;
                };
            };
        };
        responses: {
            /** @description The account's line */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uuid */
                        accountId: string;
                        included: boolean;
                        kind: string;
                        /** @enum {string} */
                        status: "active" | "closed";
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN), or the request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    previewBudgetAllocation: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description The amounts chosen on the step: goals, extra debt payments, «Заощадження без цілі», or the deficit options «З цілі», «Із заощаджень», «У борг». «Зменшити ліміти» is sent as lower `limits` only (it changes N), never also here */
                    chosen?: {
                        /** @description A plain non-negative decimal, at most 15 integer digits and the currency's minor units */
                        amount: string;
                        /** @description The budget's currency (the space's reporting currency) */
                        currency: string;
                    }[];
                    /** @description A calendar month, YYYY-MM */
                    firstPeriod: string;
                    incomePlan?: {
                        /** @description A plain non-negative decimal, at most 15 integer digits and the currency's minor units */
                        amount: string;
                        /** @description The budget's currency (the space's reporting currency) */
                        currency: string;
                    };
                    limits?: {
                        amount: {
                            /** @description A plain non-negative decimal, at most 15 integer digits and the currency's minor units */
                            amount: string;
                            /** @description The budget's currency (the space's reporting currency) */
                            currency: string;
                        };
                        /** Format: uuid */
                        categoryId: string;
                    }[];
                    proportional?: boolean;
                };
            };
        };
        responses: {
            /** @description The figures; nothing is saved and nothing is moved */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Null — the month's regular payments and loans' monthly payments are not known (an amount without any rate or over 15 integer digits): no difference, no «не розподілено»; never show income − limits instead */
                        balance: {
                            amount: {
                                amount: string;
                                currency: string;
                            };
                            debtMinimums: {
                                amount: string;
                                currency: string;
                            };
                            difference: {
                                amount: string;
                                currency: string;
                            };
                            /** @enum {string} */
                            kind: "surplus" | "deficit" | "balanced";
                            recurringOutsideLimits: {
                                amount: string;
                                currency: string;
                            };
                            unallocated: {
                                amount: string;
                                currency: string;
                            };
                        } | null;
                        /** @description Null — no `chosen` in the request, or `balance` is null; a deficit counts as covered only when status is `exact` */
                        choice: {
                            chosen: {
                                amount: string;
                                currency: string;
                            };
                            rest: {
                                amount: string;
                                currency: string;
                            };
                            /** @enum {string} */
                            status: "short" | "exact" | "over";
                        } | null;
                        incomePlan: {
                            amount: string;
                            currency: string;
                        };
                        limits: {
                            amount: string;
                            currency: string;
                        };
                        period: string;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN), or the request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    getBudgetCompare: {
        parameters: {
            query: {
                /** @description Default — previous (month, quarter) or last-year (year, ytd); year and ytd take last-year only */
                base?: "previous" | "last-year" | "avg3" | "avg6" | "avg12";
                /** @description «Повний попередній період»: the base whole, not cut at the same date */
                full?: "true" | "false";
                /** @description month — YYYY-MM; quarter — YYYY-Qn; year — YYYY; ytd — YYYY, this year by default; a past year — 1 January to the same date */
                period?: string;
                type: "month" | "quarter" | "ytd" | "year";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The table of categories */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        approximate: {
                            nearestRateCount: number;
                            unavailableCount: number;
                        };
                        base: {
                            available: boolean;
                            /** @enum {string} */
                            base: "previous" | "last-year" | "avg3" | "avg6" | "avg12";
                            full: boolean;
                            months: number | null;
                            window: {
                                from: string;
                                to: string;
                            } | null;
                        };
                        bases: {
                            available: boolean;
                            /** @enum {string} */
                            base: "previous" | "last-year" | "avg3" | "avg6" | "avg12";
                            months: number | null;
                            /** @description Why not available: no_history — no data in the base's dates («імпортуйте старі виписки», FR 5); no_finished_periods — no whole finished period for an average */
                            reason: ("no_history" | "no_finished_periods") | null;
                        }[];
                        currency: string;
                        expenses: {
                            categories: {
                                /** @description Null — the base is not available */
                                base: {
                                    amount: string;
                                    currency: string;
                                } | null;
                                categoryId: string | null;
                                current: {
                                    amount: string;
                                    currency: string;
                                };
                                difference: {
                                    amount: {
                                        amount: string;
                                        currency: string;
                                    };
                                    /**
                                     * @description «▲» / «▼»; none — «без змін» (blue «—»)
                                     * @enum {string}
                                     */
                                    direction: "up" | "down" | "none";
                                    /** @description Of the value compared with, unsigned, one decimal; null — it is 0 (the difference in € only, AC7) */
                                    percent: string | null;
                                    /**
                                     * @description Better or worse, not the direction: less spending and more income — gain; -soft — up to 10 % inclusive; none — «без змін»
                                     * @enum {string}
                                     */
                                    tone: "gain" | "gain-soft" | "loss" | "loss-soft" | "none";
                                } | null;
                                /** @description The limits of the period's months by their snapshots; null — «Поза планом» («–») or before the budget */
                                plan: {
                                    amount: string;
                                    currency: string;
                                } | null;
                                planDifference: {
                                    amount: {
                                        amount: string;
                                        currency: string;
                                    };
                                    /**
                                     * @description «▲» / «▼»; none — «без змін» (blue «—»)
                                     * @enum {string}
                                     */
                                    direction: "up" | "down" | "none";
                                    /** @description Of the value compared with, unsigned, one decimal; null — it is 0 (the difference in € only, AC7) */
                                    percent: string | null;
                                    /**
                                     * @description Better or worse, not the direction: less spending and more income — gain; -soft — up to 10 % inclusive; none — «без змін»
                                     * @enum {string}
                                     */
                                    tone: "gain" | "gain-soft" | "loss" | "loss-soft" | "none";
                                } | null;
                                /** @description How many transactions (split parts) made the amounts; an average's — rounded to whole ones */
                                transactions: {
                                    base: number | null;
                                    current: number;
                                };
                            }[];
                            overall: {
                                /** @description Null — the base is not available */
                                base: {
                                    amount: string;
                                    currency: string;
                                } | null;
                                categoryId: string | null;
                                current: {
                                    amount: string;
                                    currency: string;
                                };
                                difference: {
                                    amount: {
                                        amount: string;
                                        currency: string;
                                    };
                                    /**
                                     * @description «▲» / «▼»; none — «без змін» (blue «—»)
                                     * @enum {string}
                                     */
                                    direction: "up" | "down" | "none";
                                    /** @description Of the value compared with, unsigned, one decimal; null — it is 0 (the difference in € only, AC7) */
                                    percent: string | null;
                                    /**
                                     * @description Better or worse, not the direction: less spending and more income — gain; -soft — up to 10 % inclusive; none — «без змін»
                                     * @enum {string}
                                     */
                                    tone: "gain" | "gain-soft" | "loss" | "loss-soft" | "none";
                                } | null;
                                /** @description The limits of the period's months by their snapshots; null — «Поза планом» («–») or before the budget */
                                plan: {
                                    amount: string;
                                    currency: string;
                                } | null;
                                planDifference: {
                                    amount: {
                                        amount: string;
                                        currency: string;
                                    };
                                    /**
                                     * @description «▲» / «▼»; none — «без змін» (blue «—»)
                                     * @enum {string}
                                     */
                                    direction: "up" | "down" | "none";
                                    /** @description Of the value compared with, unsigned, one decimal; null — it is 0 (the difference in € only, AC7) */
                                    percent: string | null;
                                    /**
                                     * @description Better or worse, not the direction: less spending and more income — gain; -soft — up to 10 % inclusive; none — «без змін»
                                     * @enum {string}
                                     */
                                    tone: "gain" | "gain-soft" | "loss" | "loss-soft" | "none";
                                } | null;
                                /** @description How many transactions (split parts) made the amounts; an average's — rounded to whole ones */
                                transactions: {
                                    base: number | null;
                                    current: number;
                                };
                            };
                        };
                        finished: boolean;
                        finishedPeriods: number;
                        income: {
                            categories: {
                                /** @description Null — the base is not available */
                                base: {
                                    amount: string;
                                    currency: string;
                                } | null;
                                categoryId: string | null;
                                current: {
                                    amount: string;
                                    currency: string;
                                };
                                difference: {
                                    amount: {
                                        amount: string;
                                        currency: string;
                                    };
                                    /**
                                     * @description «▲» / «▼»; none — «без змін» (blue «—»)
                                     * @enum {string}
                                     */
                                    direction: "up" | "down" | "none";
                                    /** @description Of the value compared with, unsigned, one decimal; null — it is 0 (the difference in € only, AC7) */
                                    percent: string | null;
                                    /**
                                     * @description Better or worse, not the direction: less spending and more income — gain; -soft — up to 10 % inclusive; none — «без змін»
                                     * @enum {string}
                                     */
                                    tone: "gain" | "gain-soft" | "loss" | "loss-soft" | "none";
                                } | null;
                                /** @description The limits of the period's months by their snapshots; null — «Поза планом» («–») or before the budget */
                                plan: {
                                    amount: string;
                                    currency: string;
                                } | null;
                                planDifference: {
                                    amount: {
                                        amount: string;
                                        currency: string;
                                    };
                                    /**
                                     * @description «▲» / «▼»; none — «без змін» (blue «—»)
                                     * @enum {string}
                                     */
                                    direction: "up" | "down" | "none";
                                    /** @description Of the value compared with, unsigned, one decimal; null — it is 0 (the difference in € only, AC7) */
                                    percent: string | null;
                                    /**
                                     * @description Better or worse, not the direction: less spending and more income — gain; -soft — up to 10 % inclusive; none — «без змін»
                                     * @enum {string}
                                     */
                                    tone: "gain" | "gain-soft" | "loss" | "loss-soft" | "none";
                                } | null;
                                /** @description How many transactions (split parts) made the amounts; an average's — rounded to whole ones */
                                transactions: {
                                    base: number | null;
                                    current: number;
                                };
                            }[];
                            overall: {
                                /** @description Null — the base is not available */
                                base: {
                                    amount: string;
                                    currency: string;
                                } | null;
                                categoryId: string | null;
                                current: {
                                    amount: string;
                                    currency: string;
                                };
                                difference: {
                                    amount: {
                                        amount: string;
                                        currency: string;
                                    };
                                    /**
                                     * @description «▲» / «▼»; none — «без змін» (blue «—»)
                                     * @enum {string}
                                     */
                                    direction: "up" | "down" | "none";
                                    /** @description Of the value compared with, unsigned, one decimal; null — it is 0 (the difference in € only, AC7) */
                                    percent: string | null;
                                    /**
                                     * @description Better or worse, not the direction: less spending and more income — gain; -soft — up to 10 % inclusive; none — «без змін»
                                     * @enum {string}
                                     */
                                    tone: "gain" | "gain-soft" | "loss" | "loss-soft" | "none";
                                } | null;
                                /** @description The limits of the period's months by their snapshots; null — «Поза планом» («–») or before the budget */
                                plan: {
                                    amount: string;
                                    currency: string;
                                } | null;
                                planDifference: {
                                    amount: {
                                        amount: string;
                                        currency: string;
                                    };
                                    /**
                                     * @description «▲» / «▼»; none — «без змін» (blue «—»)
                                     * @enum {string}
                                     */
                                    direction: "up" | "down" | "none";
                                    /** @description Of the value compared with, unsigned, one decimal; null — it is 0 (the difference in € only, AC7) */
                                    percent: string | null;
                                    /**
                                     * @description Better or worse, not the direction: less spending and more income — gain; -soft — up to 10 % inclusive; none — «без змін»
                                     * @enum {string}
                                     */
                                    tone: "gain" | "gain-soft" | "loss" | "loss-soft" | "none";
                                } | null;
                                /** @description How many transactions (split parts) made the amounts; an average's — rounded to whole ones */
                                transactions: {
                                    base: number | null;
                                    current: number;
                                };
                            };
                        };
                        /** @description Today is in the period: the window and the base are cut at the same date. False for a past year's ytd, although its window and base are cut at the same date too (`full` applies) */
                        inProgress: boolean;
                        largest: {
                            categoryId: string | null;
                            difference: {
                                amount: string;
                                currency: string;
                            };
                            transactions: {
                                base: number | null;
                                current: number;
                            };
                        }[];
                        /** @enum {string} */
                        type: "month" | "quarter" | "ytd" | "year";
                        /** @description What the table counts: the period, up to today while it lasts; ytd of a past year — 1 January to the same date of that year */
                        window: {
                            from: string;
                            to: string;
                        };
                        year: string;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    getBudgetCompareYear: {
        parameters: {
            query: {
                /** @description A calendar year, YYYY (the compare answer's `year`) */
                year: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The year */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        approximate: {
                            nearestRateCount: number;
                            unavailableCount: number;
                        };
                        currency: string;
                        expenses: {
                            cells: {
                                /** @description «± до плану»; null without a fact or a plan */
                                difference: {
                                    amount: {
                                        amount: string;
                                        currency: string;
                                    };
                                    /**
                                     * @description «▲» / «▼»; none — «без змін» (blue «—»)
                                     * @enum {string}
                                     */
                                    direction: "up" | "down" | "none";
                                    /** @description Of the value compared with, unsigned, one decimal; null — it is 0 (the difference in € only, AC7) */
                                    percent: string | null;
                                    /**
                                     * @description Better or worse, not the direction: less spending and more income — gain; -soft — up to 10 % inclusive; none — «без змін»
                                     * @enum {string}
                                     */
                                    tone: "gain" | "gain-soft" | "loss" | "loss-soft" | "none";
                                } | null;
                                /** @description Null — a future month: the plan only (grey) */
                                fact: {
                                    amount: string;
                                    currency: string;
                                } | null;
                                /** @description The month's plan; null — before the budget or no limit («–») */
                                plan: {
                                    amount: string;
                                    currency: string;
                                } | null;
                            }[];
                            difference: {
                                amount: {
                                    amount: string;
                                    currency: string;
                                };
                                /**
                                 * @description «▲» / «▼»; none — «без змін» (blue «—»)
                                 * @enum {string}
                                 */
                                direction: "up" | "down" | "none";
                                /** @description Of the value compared with, unsigned, one decimal; null — it is 0 (the difference in € only, AC7) */
                                percent: string | null;
                                /**
                                 * @description Better or worse, not the direction: less spending and more income — gain; -soft — up to 10 % inclusive; none — «без змін»
                                 * @enum {string}
                                 */
                                tone: "gain" | "gain-soft" | "loss" | "loss-soft" | "none";
                            } | null;
                            plan: {
                                amount: string;
                                currency: string;
                            } | null;
                            total: {
                                amount: string;
                                currency: string;
                            };
                        };
                        groups: {
                            categories: {
                                categoryId: string | null;
                                cells: {
                                    /** @description «± до плану»; null without a fact or a plan */
                                    difference: {
                                        amount: {
                                            amount: string;
                                            currency: string;
                                        };
                                        /**
                                         * @description «▲» / «▼»; none — «без змін» (blue «—»)
                                         * @enum {string}
                                         */
                                        direction: "up" | "down" | "none";
                                        /** @description Of the value compared with, unsigned, one decimal; null — it is 0 (the difference in € only, AC7) */
                                        percent: string | null;
                                        /**
                                         * @description Better or worse, not the direction: less spending and more income — gain; -soft — up to 10 % inclusive; none — «без змін»
                                         * @enum {string}
                                         */
                                        tone: "gain" | "gain-soft" | "loss" | "loss-soft" | "none";
                                    } | null;
                                    /** @description Null — a future month: the plan only (grey) */
                                    fact: {
                                        amount: string;
                                        currency: string;
                                    } | null;
                                    /** @description The month's plan; null — before the budget or no limit («–») */
                                    plan: {
                                        amount: string;
                                        currency: string;
                                    } | null;
                                }[];
                                difference: {
                                    amount: {
                                        amount: string;
                                        currency: string;
                                    };
                                    /**
                                     * @description «▲» / «▼»; none — «без змін» (blue «—»)
                                     * @enum {string}
                                     */
                                    direction: "up" | "down" | "none";
                                    /** @description Of the value compared with, unsigned, one decimal; null — it is 0 (the difference in € only, AC7) */
                                    percent: string | null;
                                    /**
                                     * @description Better or worse, not the direction: less spending and more income — gain; -soft — up to 10 % inclusive; none — «без змін»
                                     * @enum {string}
                                     */
                                    tone: "gain" | "gain-soft" | "loss" | "loss-soft" | "none";
                                } | null;
                                plan: {
                                    amount: string;
                                    currency: string;
                                } | null;
                                total: {
                                    amount: string;
                                    currency: string;
                                };
                            }[];
                            cells: {
                                /** @description «± до плану»; null without a fact or a plan */
                                difference: {
                                    amount: {
                                        amount: string;
                                        currency: string;
                                    };
                                    /**
                                     * @description «▲» / «▼»; none — «без змін» (blue «—»)
                                     * @enum {string}
                                     */
                                    direction: "up" | "down" | "none";
                                    /** @description Of the value compared with, unsigned, one decimal; null — it is 0 (the difference in € only, AC7) */
                                    percent: string | null;
                                    /**
                                     * @description Better or worse, not the direction: less spending and more income — gain; -soft — up to 10 % inclusive; none — «без змін»
                                     * @enum {string}
                                     */
                                    tone: "gain" | "gain-soft" | "loss" | "loss-soft" | "none";
                                } | null;
                                /** @description Null — a future month: the plan only (grey) */
                                fact: {
                                    amount: string;
                                    currency: string;
                                } | null;
                                /** @description The month's plan; null — before the budget or no limit («–») */
                                plan: {
                                    amount: string;
                                    currency: string;
                                } | null;
                            }[];
                            difference: {
                                amount: {
                                    amount: string;
                                    currency: string;
                                };
                                /**
                                 * @description «▲» / «▼»; none — «без змін» (blue «—»)
                                 * @enum {string}
                                 */
                                direction: "up" | "down" | "none";
                                /** @description Of the value compared with, unsigned, one decimal; null — it is 0 (the difference in € only, AC7) */
                                percent: string | null;
                                /**
                                 * @description Better or worse, not the direction: less spending and more income — gain; -soft — up to 10 % inclusive; none — «без змін»
                                 * @enum {string}
                                 */
                                tone: "gain" | "gain-soft" | "loss" | "loss-soft" | "none";
                            } | null;
                            groupId: string | null;
                            plan: {
                                amount: string;
                                currency: string;
                            } | null;
                            total: {
                                amount: string;
                                currency: string;
                            };
                        }[];
                        income: {
                            cells: {
                                /** @description «± до плану»; null without a fact or a plan */
                                difference: {
                                    amount: {
                                        amount: string;
                                        currency: string;
                                    };
                                    /**
                                     * @description «▲» / «▼»; none — «без змін» (blue «—»)
                                     * @enum {string}
                                     */
                                    direction: "up" | "down" | "none";
                                    /** @description Of the value compared with, unsigned, one decimal; null — it is 0 (the difference in € only, AC7) */
                                    percent: string | null;
                                    /**
                                     * @description Better or worse, not the direction: less spending and more income — gain; -soft — up to 10 % inclusive; none — «без змін»
                                     * @enum {string}
                                     */
                                    tone: "gain" | "gain-soft" | "loss" | "loss-soft" | "none";
                                } | null;
                                /** @description Null — a future month: the plan only (grey) */
                                fact: {
                                    amount: string;
                                    currency: string;
                                } | null;
                                /** @description The month's plan; null — before the budget or no limit («–») */
                                plan: {
                                    amount: string;
                                    currency: string;
                                } | null;
                            }[];
                            difference: {
                                amount: {
                                    amount: string;
                                    currency: string;
                                };
                                /**
                                 * @description «▲» / «▼»; none — «без змін» (blue «—»)
                                 * @enum {string}
                                 */
                                direction: "up" | "down" | "none";
                                /** @description Of the value compared with, unsigned, one decimal; null — it is 0 (the difference in € only, AC7) */
                                percent: string | null;
                                /**
                                 * @description Better or worse, not the direction: less spending and more income — gain; -soft — up to 10 % inclusive; none — «без змін»
                                 * @enum {string}
                                 */
                                tone: "gain" | "gain-soft" | "loss" | "loss-soft" | "none";
                            } | null;
                            plan: {
                                amount: string;
                                currency: string;
                            } | null;
                            total: {
                                amount: string;
                                currency: string;
                            };
                        };
                        months: {
                            /** @enum {string} */
                            mode: "past" | "current" | "future";
                            period: string;
                        }[];
                        year: string;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    getBudgetPeriod: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description A calendar month, YYYY-MM */
                period: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The period */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        approximate: {
                            nearestRateCount: number;
                            unavailableCount: number;
                        };
                        currency: string;
                        /** @description FR 16 «Очікувані платежі». Null — a past month, or the month's obligations are not known (an amount without any rate or over 15 integer digits): show «—», never an empty list or 0 */
                        expectedPayments: {
                            categories: {
                                amount: {
                                    amount: string;
                                    currency: string;
                                };
                                categoryId: string | null;
                            }[];
                            total: {
                                amount: string;
                                currency: string;
                            };
                        } | null;
                        groups: {
                            categories: {
                                /** Format: uuid */
                                categoryId: string;
                                groupId: string | null;
                                limit: {
                                    amount: string;
                                    currency: string;
                                };
                                mandatory: boolean;
                                remaining: {
                                    amount: string;
                                    currency: string;
                                } | null;
                                spent: {
                                    amount: string;
                                    currency: string;
                                } | null;
                            }[];
                            groupId: string | null;
                        }[];
                        incomeActual: {
                            amount: string;
                            currency: string;
                        } | null;
                        incomePlan: {
                            amount: string;
                            currency: string;
                        };
                        /** @enum {string} */
                        mode: "past" | "current" | "future";
                        outsidePlan: {
                            categories: {
                                categoryId: string | null;
                                spent: {
                                    amount: string;
                                    currency: string;
                                };
                            }[];
                            total: {
                                amount: string;
                                currency: string;
                            } | null;
                        };
                        period: string;
                        plannedSavings: {
                            amount: string;
                            currency: string;
                        };
                        proportional: {
                            days: number;
                            daysInPeriod: number;
                            from: string;
                            to: string;
                        } | null;
                        /** @description FR 19: the totals row. Null — a future month (plan only, no fact) */
                        summary: {
                            /** @description E «Вільний залишок» = limits − spent − D, negative with «−». Null with D: show «—», never 0 */
                            free: {
                                amount: string;
                                currency: string;
                            } | null;
                            limits: {
                                amount: string;
                                currency: string;
                            };
                            /** @description D «Ще потрібно на обов'язкові» = Σ over mandatory categories of max(0, limit − spent − their unpaid payments) + their unpaid payments (only the mandatory categories' own; BUD-02 FR 19). Null with unpaidRecurring: show «—», never 0 or mandatoryRemaining */
                            mandatoryNeeded: {
                                amount: string;
                                currency: string;
                            } | null;
                            /** @description Σ max(0, limit − spent) of the mandatory categories, without regular payments. Not «Ще потрібно на обов'язкові»: never show it as D */
                            mandatoryRemaining: {
                                amount: string;
                                currency: string;
                            };
                            optionalLimits: {
                                amount: string;
                                currency: string;
                            };
                            overspend: {
                                amount: {
                                    amount: string;
                                    currency: string;
                                };
                                count: number;
                            };
                            spent: {
                                amount: string;
                                currency: string;
                            };
                            /** @description Every unpaid regular payment of the month and every unpaid monthly payment of a loan (BUD-03 FR 5). Null — a past month, or the month's obligations are not known (an amount without any rate or over 15 integer digits): show «—», never 0 */
                            unpaidRecurring: {
                                amount: string;
                                currency: string;
                            } | null;
                        } | null;
                        totals: {
                            limits: {
                                amount: string;
                                currency: string;
                            };
                            remaining: {
                                amount: string;
                                currency: string;
                            } | null;
                            spent: {
                                amount: string;
                                currency: string;
                            } | null;
                        };
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space; The budget did not exist yet in this period (BUDGET_PERIOD_BEFORE_START) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    getBudgetSpendable: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The current calendar month, YYYY-MM (another month — 400 `period: not_current`) */
                period: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description «Можна витратити» */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        approximate: {
                            nearestRateCount: number;
                            obligations: boolean;
                            unavailableCount: number;
                        };
                        currency: string;
                        daysLeft: number;
                        figures: {
                            amount: {
                                amount: string;
                                currency: string;
                            };
                            daily: {
                                amount: string;
                                currency: string;
                            };
                            goals: {
                                items: {
                                    amount: {
                                        amount: string;
                                        currency: string;
                                    };
                                    contributed: {
                                        amount: string;
                                        currency: string;
                                    };
                                    /** Format: uuid */
                                    goalId: string;
                                    planned: {
                                        amount: string;
                                        currency: string;
                                    };
                                }[];
                                total: {
                                    amount: string;
                                    currency: string;
                                };
                            };
                            income: {
                                actual: {
                                    amount: string;
                                    currency: string;
                                };
                                expected: {
                                    amount: string;
                                    currency: string;
                                };
                                pending: boolean;
                                plan: {
                                    amount: string;
                                    currency: string;
                                };
                                stillExpected: {
                                    amount: string;
                                    currency: string;
                                };
                                value: {
                                    amount: string;
                                    currency: string;
                                };
                            };
                            mandatory: {
                                categories: {
                                    amount: {
                                        amount: string;
                                        currency: string;
                                    };
                                    /** Format: uuid */
                                    categoryId: string;
                                }[];
                                total: {
                                    amount: string;
                                    currency: string;
                                };
                            };
                            mini: {
                                amount: {
                                    amount: string;
                                    currency: string;
                                };
                                /** @enum {string} */
                                row: "income" | "spent" | "regular" | "goals" | "mandatory";
                            }[];
                            overspend: {
                                amount: {
                                    amount: string;
                                    currency: string;
                                };
                                base: {
                                    amount: string;
                                    currency: string;
                                };
                            } | null;
                            plannedExpenses: {
                                items: {
                                    /** Format: uuid */
                                    accountId: string;
                                    amount: {
                                        amount: string;
                                        currency: string;
                                    };
                                }[];
                                total: {
                                    amount: string;
                                    currency: string;
                                };
                            };
                            regularPayments: {
                                items: ({
                                    amount: {
                                        amount: string;
                                        currency: string;
                                    };
                                    categoryId: string | null;
                                    dueOn: string | null;
                                    /** @constant */
                                    kind: "recurring";
                                    overdueDays: number | null;
                                    paymentId: string | null;
                                } | {
                                    /** Format: uuid */
                                    accountId: string;
                                    amount: {
                                        amount: string;
                                        currency: string;
                                    };
                                    /** @constant */
                                    kind: "loan";
                                })[];
                                total: {
                                    amount: string;
                                    currency: string;
                                };
                            };
                            spent: {
                                limited: {
                                    amount: string;
                                    currency: string;
                                };
                                outsidePlan: {
                                    amount: string;
                                    currency: string;
                                };
                                total: {
                                    amount: string;
                                    currency: string;
                                };
                            };
                        } | null;
                        period: string;
                        unavailable: ("obligations" | "incomes" | "goals" | "plannedExpenses")[];
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space; The budget did not exist yet in this period (BUDGET_PERIOD_BEFORE_START) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    updateBudgetPlan: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    incomePlan?: {
                        /** @description A plain non-negative decimal, at most 15 integer digits and the currency's minor units */
                        amount: string;
                        /** @description The budget's currency (the space's reporting currency) */
                        currency: string;
                    };
                    limits?: {
                        amount: {
                            /** @description A plain non-negative decimal, at most 15 integer digits and the currency's minor units */
                            amount: string;
                            /** @description The budget's currency (the space's reporting currency) */
                            currency: string;
                        } | null;
                        /** Format: uuid */
                        categoryId: string;
                    }[];
                    version: number;
                };
            };
        };
        responses: {
            /** @description The budget after the change */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        createdOn: string;
                        currency: string;
                        firstPeriod: string;
                        /** Format: uuid */
                        id: string;
                        incomePlan: {
                            amount: string;
                            currency: string;
                        };
                        limits: {
                            amount: {
                                amount: string;
                                currency: string;
                            };
                            /** Format: uuid */
                            categoryId: string;
                        }[];
                        proportional: {
                            days: number;
                            daysInPeriod: number;
                            from: string;
                            to: string;
                        } | null;
                        version: number;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN), or the request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The record was changed by someone else; reload it and try again (VERSION_CONFLICT) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    getBudgetPlanGrid: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The grid */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        currency: string;
                        debts: {
                            rows: {
                                /** Format: uuid */
                                accountId: string;
                                cells: {
                                    extra: {
                                        amount: string;
                                        currency: string;
                                    } | null;
                                    minimum: {
                                        amount: string;
                                        currency: string;
                                    } | null;
                                }[];
                            }[];
                            totals: ({
                                amount: string;
                                currency: string;
                            } | null)[];
                        };
                        expenses: {
                            groups: {
                                categories: {
                                    /** Format: uuid */
                                    categoryId: string;
                                    cells: {
                                        amount: {
                                            amount: string;
                                            currency: string;
                                        } | null;
                                        own: boolean;
                                        version: number;
                                    }[];
                                }[];
                                /** Format: uuid */
                                groupId: string;
                            }[];
                            totals: ({
                                amount: string;
                                currency: string;
                            } | null)[];
                        };
                        goals: {
                            rows: {
                                cells: {
                                    amount: {
                                        amount: string;
                                        currency: string;
                                    } | null;
                                    own: boolean;
                                    required: {
                                        amount: string;
                                        currency: string;
                                    } | null;
                                    version: number;
                                }[];
                                /** Format: uuid */
                                goalId: string;
                            }[];
                            savings: {
                                amount: {
                                    amount: string;
                                    currency: string;
                                } | null;
                                own: boolean;
                                version: number;
                            }[];
                            totals: ({
                                amount: string;
                                currency: string;
                            } | null)[];
                        };
                        income: {
                            other: ({
                                amount: string;
                                currency: string;
                            } | null)[];
                            plan: {
                                amount: {
                                    amount: string;
                                    currency: string;
                                } | null;
                                own: boolean;
                                version: number;
                            }[];
                            rows: {
                                cells: {
                                    amount: {
                                        amount: string;
                                        currency: string;
                                    } | null;
                                    expected: boolean;
                                    own: boolean;
                                    version: number;
                                }[];
                                /** Format: uuid */
                                paymentId: string;
                            }[];
                            totals: ({
                                amount: string;
                                currency: string;
                            } | null)[];
                        };
                        months: {
                            inBudget: boolean;
                            /** @enum {string} */
                            mode: "current" | "future";
                            period: string;
                        }[];
                        unallocated: ({
                            amount: {
                                amount: string;
                                currency: string;
                            };
                            /** @enum {string} */
                            kind: "unallocated" | "deficit";
                        } | null)[];
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    setBudgetPlanCell: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    amount: {
                        amount: string;
                        currency: string;
                    } | null;
                    /** @enum {string} */
                    kind: "income" | "limit" | "goal" | "savings";
                    lineId: string | null;
                    /** @description A calendar month, YYYY-MM */
                    period: string;
                    version: number;
                };
            };
        };
        responses: {
            /** @description The cell after the change */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        amount: {
                            amount: string;
                            currency: string;
                        } | null;
                        version: number;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN), or the request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space; The budget did not exist yet in this period (BUDGET_PERIOD_BEFORE_START) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The record was changed by someone else; reload it and try again (VERSION_CONFLICT) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    getBudgetTrend: {
        parameters: {
            query: {
                /** @description An expense category of the space: its limit and spending */
                categoryId?: string;
                /** @description A calendar month, YYYY-MM */
                from: string;
                /** @description A calendar month, YYYY-MM; at most 120 months from `from` */
                to: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The months */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        approximate: {
                            nearestRateCount: number;
                            unavailableCount: number;
                        };
                        currency: string;
                        months: {
                            /** @description The month's income. Null — a future month */
                            income: {
                                amount: string;
                                currency: string;
                            } | null;
                            /** @enum {string} */
                            mode: "past" | "current" | "future";
                            period: string;
                            /** @description «План місяця» = the sum of the month's limits (a finished month — its snapshot's); with `categoryId` — that category's limit. Null — a month before the budget, or the category had no limit that month: no plan line */
                            plan: {
                                amount: string;
                                currency: string;
                            } | null;
                            /** @description The month's spending: every expense category, «Поза планом» and «Без категорії» (with `categoryId` — that category's). Null — a future month */
                            spent: {
                                amount: string;
                                currency: string;
                            } | null;
                        }[];
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    getBudgetWizard: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The wizard's figures; nothing is saved */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        fromSpending: {
                            available: boolean;
                            categories: {
                                average: {
                                    amount: string;
                                    currency: string;
                                };
                                /** Format: uuid */
                                categoryId: string;
                                limit: {
                                    amount: string;
                                    currency: string;
                                } | null;
                            }[];
                            historyMonths: number;
                            incomeIrregular: boolean;
                            incomePlan: {
                                amount: string;
                                currency: string;
                            } | null;
                        };
                        midPeriod: boolean;
                        starts: {
                            days: number | null;
                            daysInPeriod: number | null;
                            firstPeriod: string;
                            from: string;
                            /** @enum {string} */
                            start: "period-start" | "next-period" | "proportional";
                            to: string;
                        }[];
                        today: string;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    startBulkAction: {
        parameters: {
            query?: never;
            header?: {
                /** @description Repeating a create with the same key and the same request returns the first response (kept 24 h); the same key with another request is 409. */
                "Idempotency-Key"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    action: string;
                    params?: unknown;
                    selection: {
                        ids: string[];
                        /** @constant */
                        kind: "ids";
                    } | {
                        /** @default [] */
                        excluded?: string[];
                        filter: string[];
                        /** @constant */
                        kind: "filter";
                    };
                };
            };
        };
        responses: {
            /** @description The action's report */
            201: {
                headers: {
                    /** @description true when this is the stored response of an earlier request with the same key */
                    "Idempotent-Replayed"?: "true";
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        action: string;
                        background: boolean;
                        changed: number;
                        count: number;
                        createdAt: string;
                        endedAt: string | null;
                        /** Format: uuid */
                        id: string;
                        processed: number;
                        skipped: {
                            conflict: number;
                            invalid: number;
                            unavailable: number;
                            unchanged: number;
                        };
                        skippedRecords: {
                            /** Format: uuid */
                            id: string;
                            issue: string | null;
                            /** @enum {string} */
                            reason: "unavailable" | "unchanged" | "conflict" | "invalid";
                        }[];
                        /** @enum {string} */
                        status: "running" | "interrupted" | "completed" | "undone";
                        undo: {
                            available: boolean;
                            notRestored: number;
                            restored: number;
                            until: string | null;
                        };
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN), or the request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The idempotency key was used for another request, or that request is still running; Another bulk action is still running (BULK_ACTION_RUNNING) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A limit of the service was reached (LIMIT_REACHED) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    getBulkAction: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                actionId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The action's report */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        action: string;
                        background: boolean;
                        changed: number;
                        count: number;
                        createdAt: string;
                        endedAt: string | null;
                        /** Format: uuid */
                        id: string;
                        processed: number;
                        skipped: {
                            conflict: number;
                            invalid: number;
                            unavailable: number;
                            unchanged: number;
                        };
                        skippedRecords: {
                            /** Format: uuid */
                            id: string;
                            issue: string | null;
                            /** @enum {string} */
                            reason: "unavailable" | "unchanged" | "conflict" | "invalid";
                        }[];
                        /** @enum {string} */
                        status: "running" | "interrupted" | "completed" | "undone";
                        undo: {
                            available: boolean;
                            notRestored: number;
                            restored: number;
                            until: string | null;
                        };
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    resumeBulkAction: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                actionId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The action's report */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        action: string;
                        background: boolean;
                        changed: number;
                        count: number;
                        createdAt: string;
                        endedAt: string | null;
                        /** Format: uuid */
                        id: string;
                        processed: number;
                        skipped: {
                            conflict: number;
                            invalid: number;
                            unavailable: number;
                            unchanged: number;
                        };
                        skippedRecords: {
                            /** Format: uuid */
                            id: string;
                            issue: string | null;
                            /** @enum {string} */
                            reason: "unavailable" | "unchanged" | "conflict" | "invalid";
                        }[];
                        /** @enum {string} */
                        status: "running" | "interrupted" | "completed" | "undone";
                        undo: {
                            available: boolean;
                            notRestored: number;
                            restored: number;
                            until: string | null;
                        };
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN), or the request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Another bulk action is still running (BULK_ACTION_RUNNING); This bulk action is not interrupted (BULK_ACTION_NOT_INTERRUPTED) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    undoBulkAction: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                actionId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The action's report */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        action: string;
                        background: boolean;
                        changed: number;
                        count: number;
                        createdAt: string;
                        endedAt: string | null;
                        /** Format: uuid */
                        id: string;
                        processed: number;
                        skipped: {
                            conflict: number;
                            invalid: number;
                            unavailable: number;
                            unchanged: number;
                        };
                        skippedRecords: {
                            /** Format: uuid */
                            id: string;
                            issue: string | null;
                            /** @enum {string} */
                            reason: "unavailable" | "unchanged" | "conflict" | "invalid";
                        }[];
                        /** @enum {string} */
                        status: "running" | "interrupted" | "completed" | "undone";
                        undo: {
                            available: boolean;
                            notRestored: number;
                            restored: number;
                            until: string | null;
                        };
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN), or the request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description This bulk action can no longer be undone (BULK_UNDO_UNAVAILABLE) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    previewBulkAction: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    action: string;
                    params?: unknown;
                    selection: {
                        ids: string[];
                        /** @constant */
                        kind: "ids";
                    } | {
                        /** @default [] */
                        excluded?: string[];
                        filter: string[];
                        /** @constant */
                        kind: "filter";
                    };
                };
            };
        };
        responses: {
            /** @description The summary */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        action: string;
                        background: boolean;
                        changes: number;
                        count: number;
                        examples: {
                            /** Format: uuid */
                            id: string;
                            issue: string | null;
                            /** @enum {string} */
                            reason: "unavailable" | "unchanged" | "conflict" | "invalid";
                        }[];
                        skipped: {
                            conflict: number;
                            invalid: number;
                            unavailable: number;
                            unchanged: number;
                        };
                        undoable: boolean;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN), or the request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A limit of the service was reached (LIMIT_REACHED) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    getCashflow: {
        parameters: {
            query: {
                /** @description month — YYYY-MM; quarter — YYYY-Qn; ytd and year — YYYY */
                period: string;
                /** @description The period type; «Власний» is not offered (FR 1) */
                type: "month" | "quarter" | "ytd" | "year";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The period's cash flow */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        approximate: {
                            nearestRateCount: number;
                            unavailableCount: number;
                        };
                        currency: string;
                        empty: boolean;
                        months: {
                            expenses: {
                                amount: string;
                                currency: string;
                            };
                            income: {
                                amount: string;
                                currency: string;
                            };
                            month: string;
                            netFlow: {
                                amount: string;
                                currency: string;
                            };
                            savingsRate: string | null;
                            uncategorizedInflows: {
                                amount: {
                                    amount: string;
                                    currency: string;
                                };
                                count: number;
                            };
                        }[];
                        period: string;
                        totals: {
                            averageMonthlyRate: string | null;
                            expenses: {
                                amount: string;
                                currency: string;
                            };
                            highest: string | null;
                            income: {
                                amount: string;
                                currency: string;
                            };
                            lowest: string | null;
                            netFlow: {
                                amount: string;
                                currency: string;
                            };
                            savingsRate: string | null;
                        };
                        /** @enum {string} */
                        type: "month" | "quarter" | "ytd" | "year";
                        unpairedTransfers: number;
                        /** @enum {string} */
                        view: "month" | "monthly";
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    listCategories: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The tree; the system tree is always there (FR 1) */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        groups: {
                            categories: {
                                /** @description #RRGGBB of the circle */
                                color: string;
                                deletable: boolean;
                                essential: boolean | null;
                                /** Format: uuid */
                                groupId: string;
                                hidden: boolean;
                                icon: string;
                                /** @enum {string} */
                                iconTone: "white" | "ink";
                                /** Format: uuid */
                                id: string;
                                /** @enum {string} */
                                kind: "expense" | "income" | "service";
                                name: string;
                                renamed: boolean;
                                systemKey: string | null;
                            }[];
                            /** Format: uuid */
                            id: string;
                            /** @enum {string} */
                            kind: "expense" | "income" | "service";
                            name: string;
                            renamed: boolean;
                            systemKey: string | null;
                            tone: string;
                        }[];
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    createCategory: {
        parameters: {
            query?: never;
            header?: {
                /** @description Repeating a create with the same key and the same request returns the first response (kept 24 h); the same key with another request is 409. */
                "Idempotency-Key"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    color?: string;
                    essential?: boolean;
                    /** Format: uuid */
                    groupId: string;
                    icon?: string;
                    name: string;
                };
            };
        };
        responses: {
            /** @description The new category */
            201: {
                headers: {
                    /** @description true when this is the stored response of an earlier request with the same key */
                    "Idempotent-Replayed"?: "true";
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description #RRGGBB of the circle */
                        color: string;
                        deletable: boolean;
                        essential: boolean | null;
                        /** Format: uuid */
                        groupId: string;
                        hidden: boolean;
                        icon: string;
                        /** @enum {string} */
                        iconTone: "white" | "ink";
                        /** Format: uuid */
                        id: string;
                        /** @enum {string} */
                        kind: "expense" | "income" | "service";
                        name: string;
                        renamed: boolean;
                        systemKey: string | null;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN), or the request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The idempotency key was used for another request, or that request is still running; A category with this name already exists (CATEGORY_NAME_TAKEN) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    getCategory: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                categoryId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The category */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description #RRGGBB of the circle */
                        color: string;
                        deletable: boolean;
                        essential: boolean | null;
                        /** Format: uuid */
                        groupId: string;
                        hidden: boolean;
                        icon: string;
                        /** @enum {string} */
                        iconTone: "white" | "ink";
                        /** Format: uuid */
                        id: string;
                        /** @enum {string} */
                        kind: "expense" | "income" | "service";
                        name: string;
                        renamed: boolean;
                        systemKey: string | null;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    deleteCategory: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                categoryId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Deleted; the action is in the space's audit log */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        deleted: true;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN), or the request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A category with transactions, rules or limits cannot be deleted — hide or merge it (CATEGORY_NOT_EMPTY); A system category cannot be deleted; it can be hidden (CATEGORY_SYSTEM_FIXED) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    updateCategory: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                categoryId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    color?: string;
                    essential?: boolean;
                    hidden?: boolean;
                    icon?: string;
                    name?: string;
                };
            };
        };
        responses: {
            /** @description The category after the change */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description #RRGGBB of the circle */
                        color: string;
                        deletable: boolean;
                        essential: boolean | null;
                        /** Format: uuid */
                        groupId: string;
                        hidden: boolean;
                        icon: string;
                        /** @enum {string} */
                        iconTone: "white" | "ink";
                        /** Format: uuid */
                        id: string;
                        /** @enum {string} */
                        kind: "expense" | "income" | "service";
                        name: string;
                        renamed: boolean;
                        systemKey: string | null;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN), or the request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A category with this name already exists (CATEGORY_NAME_TAKEN); A service category cannot be hidden or merged (CATEGORY_SERVICE_FIXED) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    mergeCategory: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                categoryId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** Format: uuid */
                    targetId: string;
                };
            };
        };
        responses: {
            /** @description Merged: a system category is hidden (it may be shown again), a custom one is out of use; the records follow */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uuid */
                        sourceId: string;
                        /** @enum {string} */
                        sourceState: "hidden" | "retired";
                        /** Format: uuid */
                        targetId: string;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN), or the request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Categories of different types cannot be merged (CATEGORY_KINDS_DIFFER); A service category cannot be hidden or merged (CATEGORY_SERVICE_FIXED) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    createCategoryGroup: {
        parameters: {
            query?: never;
            header?: {
                /** @description Repeating a create with the same key and the same request returns the first response (kept 24 h); the same key with another request is 409. */
                "Idempotency-Key"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @enum {string} */
                    kind: "expense" | "income";
                    name: string;
                };
            };
        };
        responses: {
            /** @description The new group, without categories */
            201: {
                headers: {
                    /** @description true when this is the stored response of an earlier request with the same key */
                    "Idempotent-Replayed"?: "true";
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        categories: {
                            /** @description #RRGGBB of the circle */
                            color: string;
                            deletable: boolean;
                            essential: boolean | null;
                            /** Format: uuid */
                            groupId: string;
                            hidden: boolean;
                            icon: string;
                            /** @enum {string} */
                            iconTone: "white" | "ink";
                            /** Format: uuid */
                            id: string;
                            /** @enum {string} */
                            kind: "expense" | "income" | "service";
                            name: string;
                            renamed: boolean;
                            systemKey: string | null;
                        }[];
                        /** Format: uuid */
                        id: string;
                        /** @enum {string} */
                        kind: "expense" | "income" | "service";
                        name: string;
                        renamed: boolean;
                        systemKey: string | null;
                        tone: string;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN), or the request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The idempotency key was used for another request, or that request is still running; A category with this name already exists (CATEGORY_NAME_TAKEN) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    renameCategoryGroup: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                groupId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name: string;
                };
            };
        };
        responses: {
            /** @description The group with its categories */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        categories: {
                            /** @description #RRGGBB of the circle */
                            color: string;
                            deletable: boolean;
                            essential: boolean | null;
                            /** Format: uuid */
                            groupId: string;
                            hidden: boolean;
                            icon: string;
                            /** @enum {string} */
                            iconTone: "white" | "ink";
                            /** Format: uuid */
                            id: string;
                            /** @enum {string} */
                            kind: "expense" | "income" | "service";
                            name: string;
                            renamed: boolean;
                            systemKey: string | null;
                        }[];
                        /** Format: uuid */
                        id: string;
                        /** @enum {string} */
                        kind: "expense" | "income" | "service";
                        name: string;
                        renamed: boolean;
                        systemKey: string | null;
                        tone: string;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN), or the request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A category with this name already exists (CATEGORY_NAME_TAKEN) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    listCategoryRuleRuns: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The runs */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: {
                            background: boolean;
                            changed: number;
                            count: number;
                            /** Format: date-time */
                            createdAt: string;
                            endedAt: string | null;
                            /** Format: uuid */
                            id: string;
                            processed: number;
                            /** Format: uuid */
                            ruleId: string;
                            skipped: {
                                manual: number;
                                unavailable: number;
                                unchanged: number;
                            };
                            /** @enum {string} */
                            status: "running" | "completed" | "undoing" | "undone";
                            truncated: boolean;
                            undo: {
                                available: boolean;
                                notRestored: number;
                                restored: number;
                                until: string | null;
                            };
                        }[];
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    getCategoryRuleRun: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                runId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The run */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        background: boolean;
                        changed: number;
                        count: number;
                        /** Format: date-time */
                        createdAt: string;
                        endedAt: string | null;
                        /** Format: uuid */
                        id: string;
                        processed: number;
                        /** Format: uuid */
                        ruleId: string;
                        skipped: {
                            manual: number;
                            unavailable: number;
                            unchanged: number;
                        };
                        /** @enum {string} */
                        status: "running" | "completed" | "undoing" | "undone";
                        truncated: boolean;
                        undo: {
                            available: boolean;
                            notRestored: number;
                            restored: number;
                            until: string | null;
                        };
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    undoCategoryRuleRun: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                runId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": Record<string, never>;
            };
        };
        responses: {
            /** @description The run */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        background: boolean;
                        changed: number;
                        count: number;
                        /** Format: date-time */
                        createdAt: string;
                        endedAt: string | null;
                        /** Format: uuid */
                        id: string;
                        processed: number;
                        /** Format: uuid */
                        ruleId: string;
                        skipped: {
                            manual: number;
                            unavailable: number;
                            unchanged: number;
                        };
                        /** @enum {string} */
                        status: "running" | "completed" | "undoing" | "undone";
                        truncated: boolean;
                        undo: {
                            available: boolean;
                            notRestored: number;
                            restored: number;
                            until: string | null;
                        };
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN), or the request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Another run of a category rule is still running (RULE_RUN_RUNNING); The time to undo this run is over (RULE_RUN_UNDO_EXPIRED); This run was undone already (RULE_RUN_UNDONE) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    listCategoryRules: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The rules, the highest priority first */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: {
                            accountIds: string[];
                            appliedCount: number;
                            /** Format: uuid */
                            categoryId: string;
                            conditions: ({
                                /** @constant */
                                field: "merchant";
                                /** @enum {string} */
                                operator: "equals" | "contains";
                                value: string;
                            } | {
                                /** @constant */
                                field: "description";
                                /** @enum {string} */
                                operator: "equals" | "contains";
                                value: string;
                            } | {
                                /** @constant */
                                field: "amount";
                                /** @enum {string} */
                                operator: "equals" | "greater" | "less";
                                value: {
                                    amount: string;
                                    currency: string;
                                };
                            } | {
                                /** @constant */
                                field: "account";
                                /** @constant */
                                operator: "equals";
                                /** Format: uuid */
                                value: string;
                            })[];
                            enabled: boolean;
                            /** Format: uuid */
                            id: string;
                            needsAttention: ("category_deleted" | "account_deleted") | null;
                            position: number;
                            tags: string[];
                        }[];
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    createCategoryRule: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @default [] */
                    accountIds?: string[];
                    /** Format: uuid */
                    categoryId: string;
                    conditions: ({
                        /** @constant */
                        field: "merchant";
                        /** @enum {string} */
                        operator: "equals" | "contains";
                        value: string;
                    } | {
                        /** @constant */
                        field: "description";
                        /** @enum {string} */
                        operator: "equals" | "contains";
                        value: string;
                    } | {
                        /** @constant */
                        field: "amount";
                        /** @enum {string} */
                        operator: "equals" | "greater" | "less";
                        value: {
                            amount: string;
                            currency: string;
                        };
                    } | {
                        /** @constant */
                        field: "account";
                        /** @constant */
                        operator: "equals";
                        /** Format: uuid */
                        value: string;
                    })[];
                    /** @default true */
                    enabled?: boolean;
                    tags?: string[];
                };
            };
        };
        responses: {
            /** @description The rule */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        accountIds: string[];
                        appliedCount: number;
                        /** Format: uuid */
                        categoryId: string;
                        conditions: ({
                            /** @constant */
                            field: "merchant";
                            /** @enum {string} */
                            operator: "equals" | "contains";
                            value: string;
                        } | {
                            /** @constant */
                            field: "description";
                            /** @enum {string} */
                            operator: "equals" | "contains";
                            value: string;
                        } | {
                            /** @constant */
                            field: "amount";
                            /** @enum {string} */
                            operator: "equals" | "greater" | "less";
                            value: {
                                amount: string;
                                currency: string;
                            };
                        } | {
                            /** @constant */
                            field: "account";
                            /** @constant */
                            operator: "equals";
                            /** Format: uuid */
                            value: string;
                        })[];
                        duplicateOf: string | null;
                        enabled: boolean;
                        /** Format: uuid */
                        id: string;
                        needsAttention: ("category_deleted" | "account_deleted") | null;
                        position: number;
                        tags: string[];
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN), or the request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A limit of the service was reached (LIMIT_REACHED) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    deleteCategoryRule: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                ruleId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Deleted */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        deleted: true;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN), or the request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    updateCategoryRule: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                ruleId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    accountIds?: string[];
                    /** Format: uuid */
                    categoryId?: string;
                    conditions?: ({
                        /** @constant */
                        field: "merchant";
                        /** @enum {string} */
                        operator: "equals" | "contains";
                        value: string;
                    } | {
                        /** @constant */
                        field: "description";
                        /** @enum {string} */
                        operator: "equals" | "contains";
                        value: string;
                    } | {
                        /** @constant */
                        field: "amount";
                        /** @enum {string} */
                        operator: "equals" | "greater" | "less";
                        value: {
                            amount: string;
                            currency: string;
                        };
                    } | {
                        /** @constant */
                        field: "account";
                        /** @constant */
                        operator: "equals";
                        /** Format: uuid */
                        value: string;
                    })[];
                    enabled?: boolean;
                    tags?: string[];
                };
            };
        };
        responses: {
            /** @description The rule */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        accountIds: string[];
                        appliedCount: number;
                        /** Format: uuid */
                        categoryId: string;
                        conditions: ({
                            /** @constant */
                            field: "merchant";
                            /** @enum {string} */
                            operator: "equals" | "contains";
                            value: string;
                        } | {
                            /** @constant */
                            field: "description";
                            /** @enum {string} */
                            operator: "equals" | "contains";
                            value: string;
                        } | {
                            /** @constant */
                            field: "amount";
                            /** @enum {string} */
                            operator: "equals" | "greater" | "less";
                            value: {
                                amount: string;
                                currency: string;
                            };
                        } | {
                            /** @constant */
                            field: "account";
                            /** @constant */
                            operator: "equals";
                            /** Format: uuid */
                            value: string;
                        })[];
                        duplicateOf: string | null;
                        enabled: boolean;
                        /** Format: uuid */
                        id: string;
                        needsAttention: ("category_deleted" | "account_deleted") | null;
                        position: number;
                        tags: string[];
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN), or the request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    applyCategoryRule: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                ruleId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": Record<string, never>;
            };
        };
        responses: {
            /** @description The run */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        background: boolean;
                        changed: number;
                        count: number;
                        /** Format: date-time */
                        createdAt: string;
                        endedAt: string | null;
                        /** Format: uuid */
                        id: string;
                        processed: number;
                        /** Format: uuid */
                        ruleId: string;
                        skipped: {
                            manual: number;
                            unavailable: number;
                            unchanged: number;
                        };
                        /** @enum {string} */
                        status: "running" | "completed" | "undoing" | "undone";
                        truncated: boolean;
                        undo: {
                            available: boolean;
                            notRestored: number;
                            restored: number;
                            until: string | null;
                        };
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN), or the request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Another run of a category rule is still running (RULE_RUN_RUNNING); The rule needs attention: edit it first (RULE_NEEDS_ATTENTION) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    moveCategoryRule: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                ruleId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    position: number;
                };
            };
        };
        responses: {
            /** @description The rules in their new order */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: {
                            accountIds: string[];
                            appliedCount: number;
                            /** Format: uuid */
                            categoryId: string;
                            conditions: ({
                                /** @constant */
                                field: "merchant";
                                /** @enum {string} */
                                operator: "equals" | "contains";
                                value: string;
                            } | {
                                /** @constant */
                                field: "description";
                                /** @enum {string} */
                                operator: "equals" | "contains";
                                value: string;
                            } | {
                                /** @constant */
                                field: "amount";
                                /** @enum {string} */
                                operator: "equals" | "greater" | "less";
                                value: {
                                    amount: string;
                                    currency: string;
                                };
                            } | {
                                /** @constant */
                                field: "account";
                                /** @constant */
                                operator: "equals";
                                /** Format: uuid */
                                value: string;
                            })[];
                            enabled: boolean;
                            /** Format: uuid */
                            id: string;
                            needsAttention: ("category_deleted" | "account_deleted") | null;
                            position: number;
                            tags: string[];
                        }[];
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN), or the request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    matchCategoryRule: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @default [] */
                    accountIds?: string[];
                    conditions: ({
                        /** @constant */
                        field: "merchant";
                        /** @enum {string} */
                        operator: "equals" | "contains";
                        value: string;
                    } | {
                        /** @constant */
                        field: "description";
                        /** @enum {string} */
                        operator: "equals" | "contains";
                        value: string;
                    } | {
                        /** @constant */
                        field: "amount";
                        /** @enum {string} */
                        operator: "equals" | "greater" | "less";
                        value: {
                            amount: string;
                            currency: string;
                        };
                    } | {
                        /** @constant */
                        field: "account";
                        /** @constant */
                        operator: "equals";
                        /** Format: uuid */
                        value: string;
                    })[];
                };
            };
        };
        responses: {
            /** @description The matching transactions */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        count: number;
                        items: {
                            /** Format: uuid */
                            accountId: string;
                            amount: {
                                amount: string;
                                currency: string;
                            };
                            counterparty: string | null;
                            date: string;
                            /** Format: uuid */
                            transactionId: string;
                        }[];
                        totals: {
                            amount: string;
                            currency: string;
                        }[];
                        truncated: boolean;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN), or the request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    getCategorySuggestions: {
        parameters: {
            query?: {
                accountId?: string;
                amount?: string;
                counterparty?: string;
                currency?: string;
                type?: "expense" | "income";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The hints */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        merchant: string | null;
                        merchants: {
                            name: string;
                            suggestion: {
                                /** Format: uuid */
                                categoryId: string;
                                rule: {
                                    /** Format: uuid */
                                    id: string;
                                    position: number;
                                } | null;
                                /** @enum {string} */
                                source: "rule" | "merchant";
                            };
                        }[];
                        suggestion: {
                            /** Format: uuid */
                            categoryId: string;
                            rule: {
                                /** Format: uuid */
                                id: string;
                                position: number;
                            } | null;
                            /** @enum {string} */
                            source: "rule" | "merchant";
                        } | null;
                        top: {
                            categoryIds: string[];
                            /** @enum {string} */
                            kind: "frequent" | "recent";
                            merchant: string | null;
                        };
                        truncated: boolean;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    listDebts: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The debts, in the order they were added; empty — «Боргів не додано» */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        debts: {
                            /** Format: uuid */
                            accountId: string;
                            annualRate: string | null;
                            balance: {
                                amount: string;
                                currency: string;
                            };
                            base: {
                                cappedOneOffs: string[];
                                months: number | null;
                                payoffMonth: string | null;
                                schedule: {
                                    balance: {
                                        amount: string;
                                        currency: string;
                                    };
                                    month: string;
                                }[];
                                /** @enum {string} */
                                status: "paid" | "not-decreasing" | "over-limit";
                                totalInterest: {
                                    amount: string;
                                    currency: string;
                                } | null;
                            } | null;
                            /** @enum {string} */
                            kind: "credit-card" | "loan";
                            monthlyPayment: {
                                amount: string;
                                currency: string;
                            } | null;
                            name: string;
                            plan: {
                                addToPlannedExpenses: boolean;
                                annualRate: string;
                                balance: {
                                    amount: string;
                                    currency: string;
                                };
                                extraMonthly: {
                                    amount: string;
                                    currency: string;
                                };
                                /** Format: uuid */
                                id: string;
                                monthlyPayment: {
                                    amount: string;
                                    currency: string;
                                };
                                months: number;
                                oneOffs: {
                                    amount: {
                                        amount: string;
                                        currency: string;
                                    };
                                    month: string;
                                }[];
                                payoffMonth: string;
                                startMonth: string;
                                totalInterest: {
                                    amount: string;
                                    currency: string;
                                };
                                version: number;
                            } | null;
                            progress: {
                                paidPercent: number;
                                plan: {
                                    amount: {
                                        amount: string;
                                        currency: string;
                                    } | null;
                                    /** @enum {string} */
                                    status: "ahead" | "on-track" | "behind" | "none";
                                };
                                remainingMonths: number | null;
                            };
                            termsMissing: boolean;
                        }[];
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    saveDebtPlan: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                accountId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    addToPlannedExpenses?: boolean;
                    /** @description Overrides the rate, percent a year, 0–100 */
                    annualRate?: string;
                    /** @description Overrides the debt; a plain non-negative decimal */
                    balance?: string;
                    /** @description «Додатковий платіж / міс.» */
                    extraMonthly?: string;
                    /** @description Overrides the regular payment, > 0 */
                    monthlyPayment?: string;
                    /** @description «Додати разовий платіж»: each after the regular payment of its month (later than now) */
                    oneOffs?: {
                        /** @description > 0 */
                        amount: string;
                        /** @description YYYY-MM */
                        month: string;
                    }[];
                };
            };
        };
        responses: {
            /** @description The saved plan */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        addToPlannedExpenses: boolean;
                        annualRate: string;
                        balance: {
                            amount: string;
                            currency: string;
                        };
                        extraMonthly: {
                            amount: string;
                            currency: string;
                        };
                        /** Format: uuid */
                        id: string;
                        monthlyPayment: {
                            amount: string;
                            currency: string;
                        };
                        months: number;
                        oneOffs: {
                            amount: {
                                amount: string;
                                currency: string;
                            };
                            month: string;
                        }[];
                        payoffMonth: string;
                        startMonth: string;
                        totalInterest: {
                            amount: string;
                            currency: string;
                        };
                        version: number;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN), or the request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Under these terms the debt does not decrease (DEBT_NOT_DECREASING); The calculation exceeds 100 years — increase the payment (DEBT_OVER_LIMIT) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    deleteDebtPlan: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                accountId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Deleted */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        deleted: true;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN), or the request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    calculateDebtScenario: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                accountId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description Overrides the rate, percent a year, 0–100 */
                    annualRate?: string;
                    /** @description Overrides the debt; a plain non-negative decimal */
                    balance?: string;
                    /** @description «Додатковий платіж / міс.» */
                    extraMonthly?: string;
                    /** @description Overrides the regular payment, > 0 */
                    monthlyPayment?: string;
                    /** @description «Додати разовий платіж»: each after the regular payment of its month (later than now) */
                    oneOffs?: {
                        /** @description > 0 */
                        amount: string;
                        /** @description YYYY-MM */
                        month: string;
                    }[];
                };
            };
        };
        responses: {
            /** @description The base and the scenario */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        base: {
                            cappedOneOffs: string[];
                            months: number | null;
                            payoffMonth: string | null;
                            schedule: {
                                balance: {
                                    amount: string;
                                    currency: string;
                                };
                                month: string;
                            }[];
                            /** @enum {string} */
                            status: "paid" | "not-decreasing" | "over-limit";
                            totalInterest: {
                                amount: string;
                                currency: string;
                            } | null;
                        };
                        saving: {
                            interest: {
                                amount: string;
                                currency: string;
                            };
                            months: number;
                        } | null;
                        scenario: {
                            cappedOneOffs: string[];
                            months: number | null;
                            payoffMonth: string | null;
                            schedule: {
                                balance: {
                                    amount: string;
                                    currency: string;
                                };
                                month: string;
                            }[];
                            /** @enum {string} */
                            status: "paid" | "not-decreasing" | "over-limit";
                            totalInterest: {
                                amount: string;
                                currency: string;
                            } | null;
                        };
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN), or the request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    compareDebtStrategies: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    debts?: {
                        /** Format: uuid */
                        accountId: string;
                        /** @description 0–100 */
                        annualRate?: string;
                        /** @description > 0 */
                        minimumPayment?: string;
                    }[];
                    total: {
                        /** @description «Усього на борги / міс.» */
                        amount: string;
                        currency: string;
                    };
                };
            };
        };
        responses: {
            /** @description Both strategies; the difference is shown neutrally, with no «recommended» mark */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        avalanche: {
                            debts: {
                                /** Format: uuid */
                                accountId: string;
                                months: number;
                                payoffMonth: string;
                            }[];
                            months: number | null;
                            payoffMonth: string | null;
                            /** @enum {string} */
                            status: "paid" | "not-decreasing" | "over-limit";
                            totalInterest: {
                                amount: string;
                                currency: string;
                            } | null;
                        };
                        excluded: {
                            /** Format: uuid */
                            accountId: string;
                            /** @enum {string} */
                            reason: "terms-missing" | "currency" | "paid-off";
                        }[];
                        included: string[];
                        snowball: {
                            debts: {
                                /** Format: uuid */
                                accountId: string;
                                months: number;
                                payoffMonth: string;
                            }[];
                            months: number | null;
                            payoffMonth: string | null;
                            /** @enum {string} */
                            status: "paid" | "not-decreasing" | "over-limit";
                            totalInterest: {
                                amount: string;
                                currency: string;
                            } | null;
                        };
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN), or the request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    listDuplicateProposals: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The pairs, newest first; «Об'єднати» is POST /v1/transactions/{first}/merge with the second as the duplicate, «Не дубль» POST /v1/transactions/{first}/not-duplicate */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        count: number;
                        items: {
                            first: {
                                /** Format: uuid */
                                accountId: string;
                                amount: {
                                    amount: string;
                                    currency: string;
                                };
                                date: string;
                                /** Format: uuid */
                                transactionId: string;
                            };
                            second: {
                                /** Format: uuid */
                                accountId: string;
                                amount: {
                                    amount: string;
                                    currency: string;
                                };
                                date: string;
                                /** Format: uuid */
                                transactionId: string;
                            };
                        }[];
                        more: boolean;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    confirmEmail: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    token: string;
                };
            };
        };
        responses: {
            /** @description confirmed; expired (screen «Посилання недійсне» with «Надіслати ще раз»); already-used (sign-in page); invalid. Never a session */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        result: "confirmed" | "expired" | "already-used" | "invalid";
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the function is off */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 60 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    resendConfirmationEmail: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    token: string;
                };
            };
        };
        responses: {
            /** @description A new link is on its way and the old ones no longer work; 429 with Retry-After as for any resend */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        resendAfterS: number;
                        /** @constant */
                        status: "sent";
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the function is off */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 60 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    listGoals: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The goals, oldest first */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        goals: {
                            achieved: boolean;
                            canContribute: boolean;
                            collected: {
                                amount: string;
                                currency: string;
                            };
                            contributedThisMonth: {
                                amount: string;
                                currency: string;
                            };
                            contributions: {
                                amount: {
                                    amount: string;
                                    currency: string;
                                };
                                date: string;
                                /** Format: uuid */
                                id: string;
                            }[];
                            createdOn: string;
                            emergencyMonths: number | null;
                            forecastDate: string | null;
                            /** Format: uuid */
                            id: string;
                            name: string;
                            overdue: boolean;
                            overTarget: {
                                amount: string;
                                currency: string;
                            } | null;
                            pace: {
                                amount: string;
                                currency: string;
                            } | null;
                            part: {
                                accountId: string | null;
                                freeBalance: {
                                    amount: string;
                                    currency: string;
                                } | null;
                                /** @enum {string} */
                                kind: "account" | "envelope" | "marks";
                                startAmount: {
                                    amount: string;
                                    currency: string;
                                };
                            };
                            progressPercent: string;
                            requiredMonthly: {
                                amount: string;
                                currency: string;
                            } | null;
                            spends: {
                                /** Format: uuid */
                                accountId: string;
                                amount: {
                                    amount: string;
                                    currency: string;
                                };
                                date: string;
                                /** Format: uuid */
                                id: string;
                                /** Format: uuid */
                                transactionId: string;
                            }[];
                            target: {
                                amount: string;
                                currency: string;
                            };
                            targetDate: string | null;
                            /** @enum {string} */
                            template: "travel" | "purchase" | "emergency" | "custom";
                            version: number;
                        }[];
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    createGoal: {
        parameters: {
            query?: never;
            header?: {
                /** @description Repeating a create with the same key and the same request returns the first response (kept 24 h); the same key with another request is 409. */
                "Idempotency-Key"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    emergencyMonths?: number | null;
                    name: string;
                    part?: {
                        accountId?: string | null;
                        /** @enum {string} */
                        kind: "account" | "envelope" | "marks";
                        startAmount?: string;
                    };
                    target: {
                        /** @description A plain non-negative decimal, at most the currency's minor units */
                        amount: string;
                        /** @description ISO 4217 code */
                        currency: string;
                    };
                    targetDate?: string | null;
                    /** @enum {string} */
                    template: "travel" | "purchase" | "emergency" | "custom";
                };
            };
        };
        responses: {
            /** @description The new goal */
            201: {
                headers: {
                    /** @description true when this is the stored response of an earlier request with the same key */
                    "Idempotent-Replayed"?: "true";
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        achieved: boolean;
                        canContribute: boolean;
                        collected: {
                            amount: string;
                            currency: string;
                        };
                        contributedThisMonth: {
                            amount: string;
                            currency: string;
                        };
                        contributions: {
                            amount: {
                                amount: string;
                                currency: string;
                            };
                            date: string;
                            /** Format: uuid */
                            id: string;
                        }[];
                        createdOn: string;
                        emergencyMonths: number | null;
                        forecastDate: string | null;
                        /** Format: uuid */
                        id: string;
                        name: string;
                        overdue: boolean;
                        overTarget: {
                            amount: string;
                            currency: string;
                        } | null;
                        pace: {
                            amount: string;
                            currency: string;
                        } | null;
                        part: {
                            accountId: string | null;
                            freeBalance: {
                                amount: string;
                                currency: string;
                            } | null;
                            /** @enum {string} */
                            kind: "account" | "envelope" | "marks";
                            startAmount: {
                                amount: string;
                                currency: string;
                            };
                        };
                        progressPercent: string;
                        requiredMonthly: {
                            amount: string;
                            currency: string;
                        } | null;
                        spends: {
                            /** Format: uuid */
                            accountId: string;
                            amount: {
                                amount: string;
                                currency: string;
                            };
                            date: string;
                            /** Format: uuid */
                            id: string;
                            /** Format: uuid */
                            transactionId: string;
                        }[];
                        target: {
                            amount: string;
                            currency: string;
                        };
                        targetDate: string | null;
                        /** @enum {string} */
                        template: "travel" | "purchase" | "emergency" | "custom";
                        version: number;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN), or the request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The idempotency key was used for another request, or that request is still running; The account is another goal's own account, or has envelopes (GOAL_ACCOUNT_TAKEN); The envelopes of the account exceed its balance (GOAL_ENVELOPES_OVER_BALANCE) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    getGoal: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                goalId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The goal */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        achieved: boolean;
                        canContribute: boolean;
                        collected: {
                            amount: string;
                            currency: string;
                        };
                        contributedThisMonth: {
                            amount: string;
                            currency: string;
                        };
                        contributions: {
                            amount: {
                                amount: string;
                                currency: string;
                            };
                            date: string;
                            /** Format: uuid */
                            id: string;
                        }[];
                        createdOn: string;
                        emergencyMonths: number | null;
                        forecastDate: string | null;
                        /** Format: uuid */
                        id: string;
                        name: string;
                        overdue: boolean;
                        overTarget: {
                            amount: string;
                            currency: string;
                        } | null;
                        pace: {
                            amount: string;
                            currency: string;
                        } | null;
                        part: {
                            accountId: string | null;
                            freeBalance: {
                                amount: string;
                                currency: string;
                            } | null;
                            /** @enum {string} */
                            kind: "account" | "envelope" | "marks";
                            startAmount: {
                                amount: string;
                                currency: string;
                            };
                        };
                        progressPercent: string;
                        requiredMonthly: {
                            amount: string;
                            currency: string;
                        } | null;
                        spends: {
                            /** Format: uuid */
                            accountId: string;
                            amount: {
                                amount: string;
                                currency: string;
                            };
                            date: string;
                            /** Format: uuid */
                            id: string;
                            /** Format: uuid */
                            transactionId: string;
                        }[];
                        target: {
                            amount: string;
                            currency: string;
                        };
                        targetDate: string | null;
                        /** @enum {string} */
                        template: "travel" | "purchase" | "emergency" | "custom";
                        version: number;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    deleteGoal: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                goalId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Deleted */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        deleted: true;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN), or the request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    updateGoal: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                goalId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    emergencyMonths?: number | null;
                    name?: string;
                    part?: {
                        accountId?: string | null;
                        /** @enum {string} */
                        kind: "account" | "envelope" | "marks";
                        startAmount?: string;
                    };
                    target?: {
                        /** @description A plain non-negative decimal, at most the currency's minor units */
                        amount: string;
                        /** @description ISO 4217 code */
                        currency: string;
                    };
                    targetDate?: string | null;
                    /** @enum {string} */
                    template?: "travel" | "purchase" | "emergency" | "custom";
                };
            };
        };
        responses: {
            /** @description The goal after the change */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        achieved: boolean;
                        canContribute: boolean;
                        collected: {
                            amount: string;
                            currency: string;
                        };
                        contributedThisMonth: {
                            amount: string;
                            currency: string;
                        };
                        contributions: {
                            amount: {
                                amount: string;
                                currency: string;
                            };
                            date: string;
                            /** Format: uuid */
                            id: string;
                        }[];
                        createdOn: string;
                        emergencyMonths: number | null;
                        forecastDate: string | null;
                        /** Format: uuid */
                        id: string;
                        name: string;
                        overdue: boolean;
                        overTarget: {
                            amount: string;
                            currency: string;
                        } | null;
                        pace: {
                            amount: string;
                            currency: string;
                        } | null;
                        part: {
                            accountId: string | null;
                            freeBalance: {
                                amount: string;
                                currency: string;
                            } | null;
                            /** @enum {string} */
                            kind: "account" | "envelope" | "marks";
                            startAmount: {
                                amount: string;
                                currency: string;
                            };
                        };
                        progressPercent: string;
                        requiredMonthly: {
                            amount: string;
                            currency: string;
                        } | null;
                        spends: {
                            /** Format: uuid */
                            accountId: string;
                            amount: {
                                amount: string;
                                currency: string;
                            };
                            date: string;
                            /** Format: uuid */
                            id: string;
                            /** Format: uuid */
                            transactionId: string;
                        }[];
                        target: {
                            amount: string;
                            currency: string;
                        };
                        targetDate: string | null;
                        /** @enum {string} */
                        template: "travel" | "purchase" | "emergency" | "custom";
                        version: number;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN), or the request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The account is another goal's own account, or has envelopes (GOAL_ACCOUNT_TAKEN); The envelopes of the account exceed its balance (GOAL_ENVELOPES_OVER_BALANCE); The record was changed by someone else; reload it and try again (VERSION_CONFLICT) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    closeGoal: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                goalId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Closed */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        closed: true;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN), or the request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    contributeToGoal: {
        parameters: {
            query?: never;
            header?: {
                /** @description Repeating a create with the same key and the same request returns the first response (kept 24 h); the same key with another request is 409. */
                "Idempotency-Key"?: string;
            };
            path: {
                goalId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    amount: {
                        /** @description A plain non-negative decimal, at most the currency's minor units */
                        amount: string;
                        /** @description ISO 4217 code */
                        currency: string;
                    };
                    /** @description YYYY-MM-DD */
                    date?: string;
                };
            };
        };
        responses: {
            /** @description The goal with the contribution */
            201: {
                headers: {
                    /** @description true when this is the stored response of an earlier request with the same key */
                    "Idempotent-Replayed"?: "true";
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        achieved: boolean;
                        canContribute: boolean;
                        collected: {
                            amount: string;
                            currency: string;
                        };
                        contributedThisMonth: {
                            amount: string;
                            currency: string;
                        };
                        contributions: {
                            amount: {
                                amount: string;
                                currency: string;
                            };
                            date: string;
                            /** Format: uuid */
                            id: string;
                        }[];
                        createdOn: string;
                        emergencyMonths: number | null;
                        forecastDate: string | null;
                        /** Format: uuid */
                        id: string;
                        name: string;
                        overdue: boolean;
                        overTarget: {
                            amount: string;
                            currency: string;
                        } | null;
                        pace: {
                            amount: string;
                            currency: string;
                        } | null;
                        part: {
                            accountId: string | null;
                            freeBalance: {
                                amount: string;
                                currency: string;
                            } | null;
                            /** @enum {string} */
                            kind: "account" | "envelope" | "marks";
                            startAmount: {
                                amount: string;
                                currency: string;
                            };
                        };
                        progressPercent: string;
                        requiredMonthly: {
                            amount: string;
                            currency: string;
                        } | null;
                        spends: {
                            /** Format: uuid */
                            accountId: string;
                            amount: {
                                amount: string;
                                currency: string;
                            };
                            date: string;
                            /** Format: uuid */
                            id: string;
                            /** Format: uuid */
                            transactionId: string;
                        }[];
                        target: {
                            amount: string;
                            currency: string;
                        };
                        targetDate: string | null;
                        /** @enum {string} */
                        template: "travel" | "purchase" | "emergency" | "custom";
                        version: number;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN), or the request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The idempotency key was used for another request, or that request is still running; Add a transfer to the goal's account instead (GOAL_OWN_ACCOUNT); The envelopes of the account exceed its balance (GOAL_ENVELOPES_OVER_BALANCE); The record was changed by someone else; reload it and try again (VERSION_CONFLICT) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    listGoalSpendable: {
        parameters: {
            query?: {
                /** @description Opaque cursor from `nextCursor` of the previous page. */
                cursor?: string;
                /** @description Items per page, 1–100. */
                limit?: number;
                /** @description Counterparty or description contains it */
                search?: string;
            };
            header?: never;
            path: {
                goalId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The page, newest first, and how many there are in all («Ще N») */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        count: number;
                        items: {
                            /** Format: uuid */
                            accountId: string;
                            amount: {
                                amount: string;
                                currency: string;
                            };
                            counterparty: string | null;
                            date: string;
                            description: string | null;
                            /** Format: uuid */
                            id: string;
                        }[];
                        /** @description Cursor of the next page; null on the last page. */
                        nextCursor: string | null;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    spendFromGoal: {
        parameters: {
            query?: never;
            header?: {
                /** @description Repeating a create with the same key and the same request returns the first response (kept 24 h); the same key with another request is 409. */
                "Idempotency-Key"?: string;
            };
            path: {
                goalId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    transactions: {
                        /** Format: uuid */
                        accountId: string;
                        /** Format: uuid */
                        transactionId: string;
                    }[];
                };
            };
        };
        responses: {
            /** @description The goal with the spends */
            201: {
                headers: {
                    /** @description true when this is the stored response of an earlier request with the same key */
                    "Idempotent-Replayed"?: "true";
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        achieved: boolean;
                        canContribute: boolean;
                        collected: {
                            amount: string;
                            currency: string;
                        };
                        contributedThisMonth: {
                            amount: string;
                            currency: string;
                        };
                        contributions: {
                            amount: {
                                amount: string;
                                currency: string;
                            };
                            date: string;
                            /** Format: uuid */
                            id: string;
                        }[];
                        createdOn: string;
                        emergencyMonths: number | null;
                        forecastDate: string | null;
                        /** Format: uuid */
                        id: string;
                        name: string;
                        overdue: boolean;
                        overTarget: {
                            amount: string;
                            currency: string;
                        } | null;
                        pace: {
                            amount: string;
                            currency: string;
                        } | null;
                        part: {
                            accountId: string | null;
                            freeBalance: {
                                amount: string;
                                currency: string;
                            } | null;
                            /** @enum {string} */
                            kind: "account" | "envelope" | "marks";
                            startAmount: {
                                amount: string;
                                currency: string;
                            };
                        };
                        progressPercent: string;
                        requiredMonthly: {
                            amount: string;
                            currency: string;
                        } | null;
                        spends: {
                            /** Format: uuid */
                            accountId: string;
                            amount: {
                                amount: string;
                                currency: string;
                            };
                            date: string;
                            /** Format: uuid */
                            id: string;
                            /** Format: uuid */
                            transactionId: string;
                        }[];
                        target: {
                            amount: string;
                            currency: string;
                        };
                        targetDate: string | null;
                        /** @enum {string} */
                        template: "travel" | "purchase" | "emergency" | "custom";
                        version: number;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN), or the request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The idempotency key was used for another request, or that request is still running; The transactions take more than the goal holds (GOAL_SPEND_OVER_COLLECTED); The record was changed by someone else; reload it and try again (VERSION_CONFLICT) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    cancelGoalSpend: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                goalId: string;
                spendId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The goal after the cancel */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        achieved: boolean;
                        canContribute: boolean;
                        collected: {
                            amount: string;
                            currency: string;
                        };
                        contributedThisMonth: {
                            amount: string;
                            currency: string;
                        };
                        contributions: {
                            amount: {
                                amount: string;
                                currency: string;
                            };
                            date: string;
                            /** Format: uuid */
                            id: string;
                        }[];
                        createdOn: string;
                        emergencyMonths: number | null;
                        forecastDate: string | null;
                        /** Format: uuid */
                        id: string;
                        name: string;
                        overdue: boolean;
                        overTarget: {
                            amount: string;
                            currency: string;
                        } | null;
                        pace: {
                            amount: string;
                            currency: string;
                        } | null;
                        part: {
                            accountId: string | null;
                            freeBalance: {
                                amount: string;
                                currency: string;
                            } | null;
                            /** @enum {string} */
                            kind: "account" | "envelope" | "marks";
                            startAmount: {
                                amount: string;
                                currency: string;
                            };
                        };
                        progressPercent: string;
                        requiredMonthly: {
                            amount: string;
                            currency: string;
                        } | null;
                        spends: {
                            /** Format: uuid */
                            accountId: string;
                            amount: {
                                amount: string;
                                currency: string;
                            };
                            date: string;
                            /** Format: uuid */
                            id: string;
                            /** Format: uuid */
                            transactionId: string;
                        }[];
                        target: {
                            amount: string;
                            currency: string;
                        };
                        targetDate: string | null;
                        /** @enum {string} */
                        template: "travel" | "purchase" | "emergency" | "custom";
                        version: number;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN), or the request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    getGoalEmergencyAverage: {
        parameters: {
            query?: {
                /** @description ISO 4217 code of the goal; the space's reporting currency by default */
                currency?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The average, the months it is over and the window */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        approximate: boolean;
                        average: {
                            amount: string;
                            currency: string;
                        } | null;
                        currency: string;
                        from: string;
                        months: number;
                        to: string;
                        unavailableCount: number;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    listImportBatches: {
        parameters: {
            query?: {
                /** @description Opaque cursor from `nextCursor` of the previous page. */
                cursor?: string;
                /** @description Items per page, 1–100. */
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of batches */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: {
                            createdAt: string;
                            files: {
                                accepted: number;
                                rejected: number;
                            };
                            /** Format: uuid */
                            id: string;
                            lastActionAt: string;
                            name: string | null;
                            /** @enum {string} */
                            state: "uploaded" | "processing" | "parsed" | "needs-review" | "failed" | "applied" | "rolled-back" | "cancelled";
                            version: number;
                        }[];
                        /** @description Cursor of the next page; null on the last page. */
                        nextCursor: string | null;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    createImportBatch: {
        parameters: {
            query?: never;
            header?: {
                /** @description Repeating a create with the same key and the same request returns the first response (kept 24 h); the same key with another request is 409. */
                "Idempotency-Key"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name?: string | null;
                };
            };
        };
        responses: {
            /** @description The new batch */
            201: {
                headers: {
                    /** @description true when this is the stored response of an earlier request with the same key */
                    "Idempotent-Replayed"?: "true";
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        createdAt: string;
                        files: {
                            accepted: number;
                            rejected: number;
                        };
                        /** Format: uuid */
                        id: string;
                        lastActionAt: string;
                        name: string | null;
                        /** @enum {string} */
                        state: "uploaded" | "processing" | "parsed" | "needs-review" | "failed" | "applied" | "rolled-back" | "cancelled";
                        version: number;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN), or the request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The idempotency key was used for another request, or that request is still running */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    getImportBatch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                batchId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The batch */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        createdAt: string;
                        fileList: {
                            createdAt: string;
                            fileName: string;
                            format: ("csv" | "tsv" | "xlsx" | "xls") | null;
                            /** Format: uuid */
                            id: string;
                            position: number;
                            rejectionCode: string | null;
                            sizeBytes: number | null;
                            /** @enum {string} */
                            status: "accepted" | "rejected";
                        }[];
                        files: {
                            accepted: number;
                            rejected: number;
                        };
                        /** Format: uuid */
                        id: string;
                        lastActionAt: string;
                        name: string | null;
                        /** @enum {string} */
                        state: "uploaded" | "processing" | "parsed" | "needs-review" | "failed" | "applied" | "rolled-back" | "cancelled";
                        version: number;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    deleteImportBatch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                batchId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Deleted */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        deleted: true;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN), or the request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The batch's state does not allow this (BATCH_STATE_CONFLICT) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    applyImportBatch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                batchId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The batch, «застосовано», and the stored result of its apply */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        appliedAt: string;
                        batch: {
                            createdAt: string;
                            files: {
                                accepted: number;
                                rejected: number;
                            };
                            /** Format: uuid */
                            id: string;
                            lastActionAt: string;
                            name: string | null;
                            /** @enum {string} */
                            state: "uploaded" | "processing" | "parsed" | "needs-review" | "failed" | "applied" | "rolled-back" | "cancelled";
                            version: number;
                        };
                        first: boolean;
                        result: {
                            counts: {
                                [key: string]: number;
                            };
                        };
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN), or the request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The batch's state does not allow this (BATCH_STATE_CONFLICT); The batch is not ready to apply (IMPORT_NOT_READY); The batch needs a step the apply does not take yet (IMPORT_APPLY_UNSUPPORTED); The account is closed (ACCOUNT_CLOSED) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Some rows of the batch cannot be written (IMPORT_ROWS_REFUSED); The batch covers too many transactions of the account at once (IMPORT_PLAN_TOO_LARGE) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    cancelImportBatch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                batchId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The cancelled batch */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        createdAt: string;
                        files: {
                            accepted: number;
                            rejected: number;
                        };
                        /** Format: uuid */
                        id: string;
                        lastActionAt: string;
                        name: string | null;
                        /** @enum {string} */
                        state: "uploaded" | "processing" | "parsed" | "needs-review" | "failed" | "applied" | "rolled-back" | "cancelled";
                        version: number;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN), or the request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The batch's state does not allow this (BATCH_STATE_CONFLICT) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    listImportDecisions: {
        parameters: {
            query?: {
                /** @description Opaque cursor from `nextCursor` of the previous page. */
                cursor?: string;
                /** @description Items per page, 1–100. */
                limit?: number;
            };
            header?: never;
            path: {
                batchId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of the batch's decisions */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        decisions: {
                            decidedAt: string;
                            decision: {
                                /** @enum {string} */
                                action: "accept" | "flip-sign" | "exclude" | "include" | "import-anyway";
                                /** Format: uuid */
                                fileId: string;
                                /** @constant */
                                kind: "row";
                                row: number;
                            } | {
                                applyToFile: boolean;
                                /** Format: uuid */
                                fileId: string;
                                /** @constant */
                                kind: "reading";
                                row: number;
                                value: string;
                            } | {
                                /** Format: uuid */
                                fileId: string;
                                /** @constant */
                                kind: "date-order";
                                /** @enum {string} */
                                order: "dmy" | "mdy";
                            } | {
                                /** @enum {string} */
                                action: "accept" | "exclude" | "flip-sign";
                                fileId: string | null;
                                /** @enum {string} */
                                group: "review" | "clarify";
                                /** @constant */
                                kind: "group";
                            } | {
                                /** @enum {string} */
                                code: "checksum-mismatch" | "foreign-account" | "card-sign" | "formula-cells" | "hidden-sheets" | "balance-not-checked" | "no-transactions";
                                fileId: string | null;
                                /** @constant */
                                kind: "flag";
                            } | {
                                /** Format: uuid */
                                fileId: string;
                                /** @constant */
                                kind: "account";
                            } | {
                                /** @enum {string} */
                                choice: "update" | "keep";
                                /** Format: uuid */
                                fileId: string;
                                /** @constant */
                                kind: "balance";
                            };
                        }[];
                        nextCursor: string | null;
                        version: number;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    decideImportBatch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                batchId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    decisions: ({
                        /** @enum {string} */
                        action: "accept" | "flip-sign" | "exclude" | "include" | "import-anyway";
                        /** Format: uuid */
                        fileId: string;
                        /** @constant */
                        kind: "row";
                        row: number;
                    } | {
                        applyToFile: boolean;
                        /** Format: uuid */
                        fileId: string;
                        /** @constant */
                        kind: "reading";
                        row: number;
                        value: string;
                    } | {
                        /** Format: uuid */
                        fileId: string;
                        /** @constant */
                        kind: "date-order";
                        /** @enum {string} */
                        order: "dmy" | "mdy";
                    } | {
                        /** @enum {string} */
                        action: "accept" | "exclude" | "flip-sign";
                        fileId: string | null;
                        /** @enum {string} */
                        group: "review" | "clarify";
                        /** @constant */
                        kind: "group";
                    } | {
                        /** @enum {string} */
                        code: "checksum-mismatch" | "foreign-account" | "card-sign" | "formula-cells" | "hidden-sheets" | "balance-not-checked" | "no-transactions";
                        fileId: string | null;
                        /** @constant */
                        kind: "flag";
                    } | {
                        /** Format: uuid */
                        fileId: string;
                        /** @constant */
                        kind: "account";
                    } | {
                        /** @enum {string} */
                        choice: "update" | "keep";
                        /** Format: uuid */
                        fileId: string;
                        /** @constant */
                        kind: "balance";
                    })[];
                };
            };
        };
        responses: {
            /** @description This request's decisions as stored (at most 200) */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        decisions: {
                            decidedAt: string;
                            decision: {
                                /** @enum {string} */
                                action: "accept" | "flip-sign" | "exclude" | "include" | "import-anyway";
                                /** Format: uuid */
                                fileId: string;
                                /** @constant */
                                kind: "row";
                                row: number;
                            } | {
                                applyToFile: boolean;
                                /** Format: uuid */
                                fileId: string;
                                /** @constant */
                                kind: "reading";
                                row: number;
                                value: string;
                            } | {
                                /** Format: uuid */
                                fileId: string;
                                /** @constant */
                                kind: "date-order";
                                /** @enum {string} */
                                order: "dmy" | "mdy";
                            } | {
                                /** @enum {string} */
                                action: "accept" | "exclude" | "flip-sign";
                                fileId: string | null;
                                /** @enum {string} */
                                group: "review" | "clarify";
                                /** @constant */
                                kind: "group";
                            } | {
                                /** @enum {string} */
                                code: "checksum-mismatch" | "foreign-account" | "card-sign" | "formula-cells" | "hidden-sheets" | "balance-not-checked" | "no-transactions";
                                fileId: string | null;
                                /** @constant */
                                kind: "flag";
                            } | {
                                /** Format: uuid */
                                fileId: string;
                                /** @constant */
                                kind: "account";
                            } | {
                                /** @enum {string} */
                                choice: "update" | "keep";
                                /** Format: uuid */
                                fileId: string;
                                /** @constant */
                                kind: "balance";
                            };
                        }[];
                        nextCursor: string | null;
                        version: number;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN), or the request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The batch's state does not allow this (BATCH_STATE_CONFLICT) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The reading has more decimals than the currency allows (READING_TOO_PRECISE); The decision does not fit the batch (IMPORT_DECISION_INVALID) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    uploadImportFiles: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                batchId: string;
            };
            cookie?: never;
        };
        /** @description File parts only, at most 50 files and 158334976 bytes in all */
        requestBody: {
            content: {
                "multipart/form-data": {
                    files?: string[];
                };
            };
        };
        responses: {
            /** @description The batch and what became of each file of this upload */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        batch: {
                            createdAt: string;
                            files: {
                                accepted: number;
                                rejected: number;
                            };
                            /** Format: uuid */
                            id: string;
                            lastActionAt: string;
                            name: string | null;
                            /** @enum {string} */
                            state: "uploaded" | "processing" | "parsed" | "needs-review" | "failed" | "applied" | "rolled-back" | "cancelled";
                            version: number;
                        };
                        files: {
                            createdAt: string;
                            fileName: string;
                            format: ("csv" | "tsv" | "xlsx" | "xls") | null;
                            /** Format: uuid */
                            id: string;
                            position: number;
                            rejection: {
                                ceiling?: {
                                    limit: number;
                                    name: string;
                                };
                                code: string;
                                message: {
                                    en: string;
                                    uk: string;
                                };
                            } | null;
                            rejectionCode: string | null;
                            sizeBytes: number | null;
                            /** @enum {string} */
                            status: "accepted" | "rejected";
                        }[];
                        refused: {
                            fileName: string;
                            rejection: {
                                ceiling?: {
                                    limit: number;
                                    name: string;
                                };
                                code: string;
                                message: {
                                    en: string;
                                    uk: string;
                                };
                            };
                        }[];
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN), or the request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The batch's state does not allow this (BATCH_STATE_CONFLICT) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The file is over a technical ceiling (FILE_TOO_LARGE); The request body is too large (PAYLOAD_TOO_LARGE) */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The file was not accepted (FILE_REJECTED) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 30 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    linkImportOriginal: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                batchId: string;
                fileId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The link's token and when it expires */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        expiresAt: string;
                        token: string;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN), or the request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    listImportFileRows: {
        parameters: {
            query?: {
                /** @description Opaque cursor from `nextCursor` of the previous page. */
                cursor?: string;
                /** @description Items per page, 1–100. */
                limit?: number;
            };
            header?: never;
            path: {
                batchId: string;
                fileId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of the file's rows */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: {
                            balance: string | null;
                            counterparty: string | null;
                            currency: string | null;
                            currencyMark: {
                                candidates: string[];
                                text: string;
                            } | null;
                            date: string | null;
                            description: string | null;
                            fee: {
                                amount: string;
                                currency: string | null;
                            } | null;
                            flags: string[];
                            legs: {
                                amount: string;
                                currency: string | null;
                            }[];
                            original: {
                                amount: string;
                                currency: string | null;
                            } | null;
                            rate: string | null;
                            reference: string | null;
                            row: number;
                            valueDate: string | null;
                        }[];
                        /** @description Cursor of the next page; null on the last page. */
                        nextCursor: string | null;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The batch's state does not allow this (BATCH_STATE_CONFLICT) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    getImportBatchParse: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                batchId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The batch and its files' parse */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        batch: {
                            createdAt: string;
                            files: {
                                accepted: number;
                                rejected: number;
                            };
                            /** Format: uuid */
                            id: string;
                            lastActionAt: string;
                            name: string | null;
                            /** @enum {string} */
                            state: "uploaded" | "processing" | "parsed" | "needs-review" | "failed" | "applied" | "rolled-back" | "cancelled";
                            version: number;
                        };
                        files: {
                            accountId: string | null;
                            checks: ({
                                currency: string | null;
                                flags: {
                                    check?: string;
                                    choices?: ("update" | "keep")[];
                                    /** @enum {string} */
                                    code: "checksum-mismatch" | "foreign-account" | "card-sign" | "formula-cells" | "hidden-sheets" | "balance-not-checked" | "no-transactions";
                                    count?: number;
                                    difference?: string;
                                    negative?: number;
                                    positive?: number;
                                    /** @enum {string} */
                                    severity: "block" | "review";
                                }[];
                            } & {
                                [key: string]: unknown;
                            }) | null;
                            engineVersion: string;
                            /** Format: uuid */
                            fileId: string;
                            history: ({
                                /** @enum {string} */
                                status: "continuous" | "gap" | "overlap" | "unknown";
                            } & {
                                [key: string]: unknown;
                            }) | null;
                            position: number;
                            previousFileId: string | null;
                            recipe: {
                                /** @enum {string} */
                                format: "match" | "changed" | "unknown";
                                /** Format: uuid */
                                id: string;
                            } | null;
                            refusal: {
                                ceiling?: {
                                    limit: number;
                                    name: string;
                                };
                                code: string;
                                message: {
                                    en: string;
                                    uk: string;
                                };
                            } | null;
                            rowCount: number | null;
                            /** @enum {string} */
                            state: "pending" | "parsed" | "failed";
                        }[];
                        progress: {
                            failed: number;
                            parsed: number;
                            pending: number;
                        };
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    parseImportBatch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                batchId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    files?: {
                        accountId?: string | null;
                        /** Format: uuid */
                        fileId: string;
                        recipeId?: string | null;
                    }[];
                };
            };
        };
        responses: {
            /** @description The batch, «в обробці» */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        createdAt: string;
                        files: {
                            accepted: number;
                            rejected: number;
                        };
                        /** Format: uuid */
                        id: string;
                        lastActionAt: string;
                        name: string | null;
                        /** @enum {string} */
                        state: "uploaded" | "processing" | "parsed" | "needs-review" | "failed" | "applied" | "rolled-back" | "cancelled";
                        version: number;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN), or the request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The batch's state does not allow this (BATCH_STATE_CONFLICT) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The parse request does not fit the batch (IMPORT_PARSE_INVALID) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    getImportBatchReadiness: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                batchId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The readiness and the balance choice of each file */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        codes: ("confirm-account" | "clarifications" | "review-rows" | "flags")[];
                        files: {
                            balance: ("update" | "keep") | null;
                            /** Format: uuid */
                            fileId: string;
                            history: {
                                currency: string | null;
                                difference: string | null;
                                newOpening: string | null;
                                previousClosing: string | null;
                                range: {
                                    from: string;
                                    to: string;
                                } | null;
                                /** @enum {string} */
                                status: "continuous" | "gap" | "overlap" | "unknown";
                            };
                        }[];
                        ready: boolean;
                        refusals: ({
                            /** @constant */
                            code: "confirm-account";
                            files: {
                                /** Format: uuid */
                                fileId: string;
                                missing: boolean;
                                reasons: {
                                    account: string;
                                    file: string;
                                    /** @enum {string} */
                                    kind: "iban" | "card" | "currency";
                                }[];
                                suggestedAccountId: string | null;
                            }[];
                            message: {
                                en: string;
                                uk: string;
                            };
                        } | {
                            /** @constant */
                            code: "clarifications";
                            files: {
                                count: number;
                                dateOrder: boolean;
                                /** Format: uuid */
                                fileId: string;
                                rows: number[];
                            }[];
                            message: {
                                en: string;
                                uk: string;
                            };
                        } | {
                            /** @constant */
                            code: "review-rows";
                            files: {
                                count: number;
                                /** Format: uuid */
                                fileId: string;
                                rows: number[];
                            }[];
                            message: {
                                en: string;
                                uk: string;
                            };
                        } | {
                            /** @constant */
                            code: "flags";
                            files: {
                                /** Format: uuid */
                                fileId: string;
                                flags: {
                                    check?: string;
                                    choices?: ("update" | "keep")[];
                                    /** @enum {string} */
                                    code: "checksum-mismatch" | "foreign-account" | "card-sign" | "formula-cells" | "hidden-sheets" | "balance-not-checked" | "no-transactions";
                                    count?: number;
                                    difference?: string;
                                    negative?: number;
                                    positive?: number;
                                    /** @enum {string} */
                                    severity: "block" | "review";
                                }[];
                            }[];
                            message: {
                                en: string;
                                uk: string;
                            };
                        })[];
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The batch's state does not allow this (BATCH_STATE_CONFLICT) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    openImportOriginal: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                token: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The original file, as a download */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/octet-stream": string;
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    listImportRecipes: {
        parameters: {
            query?: {
                /** @description Opaque cursor from `nextCursor` of the previous page. */
                cursor?: string;
                /** @description Items per page, 1–100. */
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of recipes */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: {
                            createdAt: string;
                            fingerprint: string | null;
                            /** Format: uuid */
                            id: string;
                            name: string;
                            schemaVersion: number;
                        }[];
                        /** @description Cursor of the next page; null on the last page. */
                        nextCursor: string | null;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    createImportRecipe: {
        parameters: {
            query?: never;
            header?: {
                /** @description Repeating a create with the same key and the same request returns the first response (kept 24 h); the same key with another request is 409. */
                "Idempotency-Key"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    fingerprint?: string | null;
                    name: string;
                    recipe: unknown;
                };
            };
        };
        responses: {
            /** @description The saved recipe */
            201: {
                headers: {
                    /** @description true when this is the stored response of an earlier request with the same key */
                    "Idempotent-Replayed"?: "true";
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        accountValueLast4: string | null;
                        createdAt: string;
                        fingerprint: string | null;
                        /** Format: uuid */
                        id: string;
                        name: string;
                        recipe: {
                            [key: string]: unknown;
                        };
                        schemaVersion: number;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN), or the request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The idempotency key was used for another request, or that request is still running */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The parsing recipe is not valid (RECIPE_INVALID); A limit of the service was reached (LIMIT_REACHED) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    getImportRecipe: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                recipeId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The recipe */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        accountValueLast4: string | null;
                        createdAt: string;
                        fingerprint: string | null;
                        /** Format: uuid */
                        id: string;
                        name: string;
                        recipe: {
                            [key: string]: unknown;
                        };
                        schemaVersion: number;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    deleteImportRecipe: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                recipeId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Deleted */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        deleted: true;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN), or the request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    getMyFeatures: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Keys of the functions that are on for the caller's space; functions that are off are not listed */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        features: ("accounts.manual" | "household.core" | "household.space-settings" | "identity.sign-in" | "identity.profile" | "transactions.manual" | "transactions.states" | "transactions.transfers" | "transactions.duplicates" | "transactions.attributes" | "transactions.review" | "transactions.history" | "categories.tree" | "data.bulk_actions" | "transactions.merchants" | "merchants.review-groups" | "categorization.rules" | "categorization.suggestions" | "recurring.payments" | "goals.savings" | "budget.period" | "budget.trend" | "budget.plan" | "budget.compare" | "budget.spendable" | "budget.cashflow" | "data.import" | "debts.payoff")[];
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    getMyPermissions: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The caller's role, whether a scope restricts them, and the permissions they hold */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        permissions: ("household.data.read" | "household.data.write" | "assets.dispose" | "assets.trash" | "assets.groups.manage" | "locations.exact.read" | "members.manage" | "members.assign-privileged" | "scope.manage" | "billing.manage" | "household.transfer" | "household.rename" | "export.full" | "export.reports" | "audit.read" | "bank.reconciliation.undo" | "support.access.approve" | "session.timeout.manage")[];
                        /** @enum {string} */
                        role: "owner" | "admin" | "editor" | "viewer" | "advisor";
                        scoped: boolean;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    listMerchants: {
        parameters: {
            query?: {
                search?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The space's merchants */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: {
                            /** Format: uuid */
                            id: string;
                            initials: string;
                            intermediary: boolean;
                            mergedInto: string | null;
                            name: string;
                            transactionCount: number;
                        }[];
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    renameMerchant: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                merchantId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name: string;
                };
            };
        };
        responses: {
            /** @description The merchant */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uuid */
                        id: string;
                        initials: string;
                        intermediary: boolean;
                        mergedInto: string | null;
                        name: string;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN), or the request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The merchant is merged into another; unmerge it first (MERCHANT_MERGED) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    mergeMerchants: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                merchantId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** Format: uuid */
                    merchantId: string;
                };
            };
        };
        responses: {
            /** @description The merchant that stays */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uuid */
                        id: string;
                        initials: string;
                        intermediary: boolean;
                        mergedInto: string | null;
                        name: string;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN), or the request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The merchant is merged into another; unmerge it first (MERCHANT_MERGED) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    unmergeMerchant: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                merchantId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The merchant, its own again */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uuid */
                        id: string;
                        initials: string;
                        intermediary: boolean;
                        mergedInto: string | null;
                        name: string;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN), or the request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    getMeta: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The API version */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        apiVersion: "v1";
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 60 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    checkNotMeLink: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    token: string;
                };
            };
        };
        responses: {
            /** @description valid: the sign-in of the new-device letter (time, browser and system, masked client address) and the account's email; the page asks to confirm. 410 NOT_ME_LINK_INVALID: «Посилання недійсне» (used, older than 7 days or unknown). Changes nothing */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        address: string;
                        device: {
                            /** @enum {string} */
                            browser: "chrome" | "edge" | "firefox" | "safari" | "opera" | "other";
                            /** @enum {string} */
                            os: "windows" | "macos" | "ios" | "android" | "linux" | "chromeos" | "other";
                        };
                        email: string;
                        /** Format: date-time */
                        signedInAt: string;
                        /** @constant */
                        status: "valid";
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the function is off */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description This link is no longer valid (NOT_ME_LINK_INVALID) */
            410: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 60 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    confirmNotMe: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    token: string;
                };
            };
        };
        responses: {
            /** @description Every session of the account has ended (this browser's cookie is removed too), every sign-in is refused until the password is changed, and a password reset link is on its way to the account's email. 410 NOT_ME_LINK_INVALID when the link was used, is older than 7 days or unknown */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        status: "secured";
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the function is off */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description This link is no longer valid (NOT_ME_LINK_INVALID) */
            410: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 60 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    requestPasswordReset: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    email: string;
                };
            };
        };
        responses: {
            /** @description Always «if the account exists, we sent a letter» (ACC-01 FR 10, NFR-15 FR 1): the same answer and time for an address with and without an account. An account gets a link valid 60 min that revokes its earlier links, at most one letter per 60 s and 5 per hour */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        status: "requested";
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the function is off */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 60 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    checkPasswordReset: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    token: string;
                };
            };
        };
        responses: {
            /** @description valid: the form for the new password may be shown. 410 RESET_LINK_INVALID: «Посилання недійсне» (used, replaced, older than 60 min or unknown). Changes nothing */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        status: "valid";
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the function is off */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description This password reset link is no longer valid (RESET_LINK_INVALID) */
            410: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 60 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    completePasswordReset: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    password: string;
                    token: string;
                };
            };
        };
        responses: {
            /** @description The password is changed, every session of the account has ended (this browser's cookie is removed too; no new session), the address counts as confirmed and a security notice is on its way. 410 RESET_LINK_INVALID when the link can no longer be used */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        status: "password-changed";
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the function is off */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description This password reset link is no longer valid (RESET_LINK_INVALID) */
            410: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 60 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    getProfile: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Name, email (read only), the format and time zone taken from the browser at sign-up (ACC-05 FR 1, 3). Read at every load, never cached (FR 2). Reading does not extend the session */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        email: string;
                        locale: string | null;
                        name: string;
                        timeZone: string | null;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Sign-in is required (UNAUTHENTICATED); The session has ended; sign in again (SESSION_ENDED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the function is off */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 60 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    updateProfile: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name: string;
                };
            };
        };
        responses: {
            /** @description The saved profile. Other tabs and devices show it at their next load or focus (ACC-05 FR 2). 400 VALIDATION_FAILED for an email or any other field: the email cannot be changed in this release */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        email: string;
                        locale: string | null;
                        name: string;
                        timeZone: string | null;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Sign-in is required (UNAUTHENTICATED); The session has ended; sign in again (SESSION_ENDED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the function is off */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 60 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    changePassword: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    password: string;
                    stepUpToken: string;
                };
            };
        };
        responses: {
            /** @description The password is changed, every other session of the account has ended (this one goes on), earlier reset links no longer work and a security letter is on its way (ACC-05 FR 5, ACC-04 FR 6). 403 STEP_UP_REQUIRED when the confirmation is missing, used, older than 5 min, or of another session or action */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        status: "password-changed";
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Sign-in is required (UNAUTHENTICATED); The session has ended; sign in again (SESSION_ENDED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request comes from a page of another site (ORIGIN_NOT_ALLOWED); Confirm this action with your current password (STEP_UP_REQUIRED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the function is off */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 60 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    listRecurringPayments: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The payments by name */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: {
                            accountId: string | null;
                            anchorDate: string;
                            categoryId: string | null;
                            createdOn: string;
                            endDate: string | null;
                            expectedAmount: {
                                amount: string;
                                currency: string;
                            };
                            /** @enum {string} */
                            frequency: "week" | "two-weeks" | "month" | "quarter" | "year";
                            /** Format: uuid */
                            id: string;
                            merchantId: string | null;
                            name: string;
                            nextDate: string | null;
                            /** @enum {string} */
                            source: "proposal" | "manual";
                            subscription: boolean;
                            /** @enum {string} */
                            type: "expense" | "income";
                            variable: boolean;
                            version: number;
                        }[];
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    createRecurringPayment: {
        parameters: {
            query?: never;
            header?: {
                /** @description Repeating a create with the same key and the same request returns the first response (kept 24 h); the same key with another request is 409. */
                "Idempotency-Key"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    accountId?: string | null;
                    amount: {
                        /** @description A plain positive decimal, at most the currency's minor units */
                        amount: string;
                        /** @description ISO 4217 code */
                        currency: string;
                    };
                    /** @description YYYY-MM-DD */
                    anchorDate: string;
                    categoryId?: string | null;
                    endDate?: string | null;
                    /** @enum {string} */
                    frequency: "week" | "two-weeks" | "month" | "quarter" | "year";
                    name: string;
                    subscription?: boolean;
                    /** @enum {string} */
                    type: "expense" | "income";
                    variable?: boolean;
                };
            };
        };
        responses: {
            /** @description The new regular payment */
            201: {
                headers: {
                    /** @description true when this is the stored response of an earlier request with the same key */
                    "Idempotent-Replayed"?: "true";
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        accountId: string | null;
                        anchorDate: string;
                        categoryId: string | null;
                        createdOn: string;
                        endDate: string | null;
                        expectedAmount: {
                            amount: string;
                            currency: string;
                        };
                        /** @enum {string} */
                        frequency: "week" | "two-weeks" | "month" | "quarter" | "year";
                        /** Format: uuid */
                        id: string;
                        merchantId: string | null;
                        name: string;
                        nextDate: string | null;
                        /** @enum {string} */
                        source: "proposal" | "manual";
                        subscription: boolean;
                        /** @enum {string} */
                        type: "expense" | "income";
                        variable: boolean;
                        version: number;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN), or the request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The idempotency key was used for another request, or that request is still running */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    getRecurringPayment: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                paymentId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The payment */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        accountId: string | null;
                        anchorDate: string;
                        categoryId: string | null;
                        createdOn: string;
                        endDate: string | null;
                        expectedAmount: {
                            amount: string;
                            currency: string;
                        };
                        /** @enum {string} */
                        frequency: "week" | "two-weeks" | "month" | "quarter" | "year";
                        /** Format: uuid */
                        id: string;
                        merchantId: string | null;
                        name: string;
                        nextDate: string | null;
                        /** @enum {string} */
                        source: "proposal" | "manual";
                        subscription: boolean;
                        /** @enum {string} */
                        type: "expense" | "income";
                        variable: boolean;
                        version: number;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    listRecurringCharges: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                paymentId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The payment's status and its charges within the last 430 days, newest first */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        amountChange: {
                            from: {
                                amount: string;
                                currency: string;
                            };
                            on: string;
                            to: {
                                amount: string;
                                currency: string;
                            };
                            /** Format: uuid */
                            transactionId: string;
                        } | null;
                        approximate: boolean;
                        expectedAmount: {
                            amount: string;
                            currency: string;
                        };
                        items: {
                            amount: {
                                amount: string;
                                currency: string;
                            } | null;
                            amountChange: {
                                from: {
                                    amount: string;
                                    currency: string;
                                };
                                on: string;
                                to: {
                                    amount: string;
                                    currency: string;
                                };
                                /** Format: uuid */
                                transactionId: string;
                            } | null;
                            approximate: boolean;
                            dueOn: string;
                            expectedAmount: {
                                amount: string;
                                currency: string;
                            };
                            markedOn: string | null;
                            overdueDays: number | null;
                            paidOn: string | null;
                            /** @enum {string} */
                            status: "paid" | "paid-late" | "expected" | "overdue" | "skipped";
                            transactionId: string | null;
                        }[];
                        lastCharge: {
                            amount: {
                                amount: string;
                                currency: string;
                            } | null;
                            amountChange: {
                                from: {
                                    amount: string;
                                    currency: string;
                                };
                                on: string;
                                to: {
                                    amount: string;
                                    currency: string;
                                };
                                /** Format: uuid */
                                transactionId: string;
                            } | null;
                            approximate: boolean;
                            dueOn: string;
                            expectedAmount: {
                                amount: string;
                                currency: string;
                            };
                            markedOn: string | null;
                            overdueDays: number | null;
                            paidOn: string | null;
                            /** @enum {string} */
                            status: "paid" | "paid-late" | "expected" | "overdue" | "skipped";
                            transactionId: string | null;
                        } | null;
                        missesInRow: number;
                        nextCharge: {
                            amount: {
                                amount: string;
                                currency: string;
                            } | null;
                            amountChange: {
                                from: {
                                    amount: string;
                                    currency: string;
                                };
                                on: string;
                                to: {
                                    amount: string;
                                    currency: string;
                                };
                                /** Format: uuid */
                                transactionId: string;
                            } | null;
                            approximate: boolean;
                            dueOn: string;
                            expectedAmount: {
                                amount: string;
                                currency: string;
                            };
                            markedOn: string | null;
                            overdueDays: number | null;
                            paidOn: string | null;
                            /** @enum {string} */
                            status: "paid" | "paid-late" | "expected" | "overdue" | "skipped";
                            transactionId: string | null;
                        } | null;
                        /** Format: uuid */
                        paymentId: string;
                        /** @enum {string} */
                        state: "active" | "possibly-cancelled";
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    settleRecurringCharge: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description YYYY-MM-DD */
                dueOn: string;
                paymentId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** Format: uuid */
                    transactionId: string;
                };
            };
        };
        responses: {
            /** @description The charge, «Сплачено із запізненням» */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        amount: {
                            amount: string;
                            currency: string;
                        } | null;
                        amountChange: {
                            from: {
                                amount: string;
                                currency: string;
                            };
                            on: string;
                            to: {
                                amount: string;
                                currency: string;
                            };
                            /** Format: uuid */
                            transactionId: string;
                        } | null;
                        approximate: boolean;
                        dueOn: string;
                        expectedAmount: {
                            amount: string;
                            currency: string;
                        };
                        markedOn: string | null;
                        overdueDays: number | null;
                        paidOn: string | null;
                        /** @enum {string} */
                        status: "paid" | "paid-late" | "expected" | "overdue" | "skipped";
                        transactionId: string | null;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN), or the request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The charge or the payment is not in the status this action needs; read it again (RECURRING_CHARGE_STATE); The transaction already pays a charge, or cannot pay this one (RECURRING_TRANSACTION_TAKEN) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    skipRecurringCharge: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description YYYY-MM-DD */
                dueOn: string;
                paymentId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The charge, «Пропущено» */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        amount: {
                            amount: string;
                            currency: string;
                        } | null;
                        amountChange: {
                            from: {
                                amount: string;
                                currency: string;
                            };
                            on: string;
                            to: {
                                amount: string;
                                currency: string;
                            };
                            /** Format: uuid */
                            transactionId: string;
                        } | null;
                        approximate: boolean;
                        dueOn: string;
                        expectedAmount: {
                            amount: string;
                            currency: string;
                        };
                        markedOn: string | null;
                        overdueDays: number | null;
                        paidOn: string | null;
                        /** @enum {string} */
                        status: "paid" | "paid-late" | "expected" | "overdue" | "skipped";
                        transactionId: string | null;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN), or the request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The charge or the payment is not in the status this action needs; read it again (RECURRING_CHARGE_STATE) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    keepRecurringPayment: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                paymentId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The payment */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        accountId: string | null;
                        anchorDate: string;
                        categoryId: string | null;
                        createdOn: string;
                        endDate: string | null;
                        expectedAmount: {
                            amount: string;
                            currency: string;
                        };
                        /** @enum {string} */
                        frequency: "week" | "two-weeks" | "month" | "quarter" | "year";
                        /** Format: uuid */
                        id: string;
                        merchantId: string | null;
                        name: string;
                        nextDate: string | null;
                        /** @enum {string} */
                        source: "proposal" | "manual";
                        subscription: boolean;
                        /** @enum {string} */
                        type: "expense" | "income";
                        variable: boolean;
                        version: number;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN), or the request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The charge or the payment is not in the status this action needs; read it again (RECURRING_CHARGE_STATE) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    listRecurringProposals: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The proposals by next date; analysed anew on every read, without the merchants that are payments and the rejected series */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: {
                            /** Format: uuid */
                            accountId: string;
                            anchorDate: string;
                            expectedAmount: {
                                amount: string;
                                currency: string;
                            };
                            /** @enum {string} */
                            frequency: "week" | "two-weeks" | "month" | "quarter" | "year";
                            key: string;
                            lastDate: string;
                            merchant: {
                                /** Format: uuid */
                                id: string;
                                name: string;
                            };
                            nextDate: string;
                            transactionIds: string[];
                            /** @enum {string} */
                            type: "expense" | "income";
                            variable: boolean;
                        }[];
                        more: boolean;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    confirmRecurringProposal: {
        parameters: {
            query?: never;
            header?: {
                /** @description Repeating a create with the same key and the same request returns the first response (kept 24 h); the same key with another request is 409. */
                "Idempotency-Key"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    accountId?: string | null;
                    amount?: {
                        /** @description A plain positive decimal, at most the currency's minor units */
                        amount: string;
                        /** @description ISO 4217 code */
                        currency: string;
                    };
                    /** @description YYYY-MM-DD */
                    anchorDate?: string;
                    categoryId?: string | null;
                    endDate?: string | null;
                    /** @enum {string} */
                    frequency?: "week" | "two-weeks" | "month" | "quarter" | "year";
                    key: string;
                    name?: string;
                    subscription?: boolean;
                    /** @enum {string} */
                    type?: "expense" | "income";
                    variable?: boolean;
                };
            };
        };
        responses: {
            /** @description The new regular payment */
            201: {
                headers: {
                    /** @description true when this is the stored response of an earlier request with the same key */
                    "Idempotent-Replayed"?: "true";
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        accountId: string | null;
                        anchorDate: string;
                        categoryId: string | null;
                        createdOn: string;
                        endDate: string | null;
                        expectedAmount: {
                            amount: string;
                            currency: string;
                        };
                        /** @enum {string} */
                        frequency: "week" | "two-weeks" | "month" | "quarter" | "year";
                        /** Format: uuid */
                        id: string;
                        merchantId: string | null;
                        name: string;
                        nextDate: string | null;
                        /** @enum {string} */
                        source: "proposal" | "manual";
                        subscription: boolean;
                        /** @enum {string} */
                        type: "expense" | "income";
                        variable: boolean;
                        version: number;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN), or the request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The idempotency key was used for another request, or that request is still running; The proposal is no longer offered; read the proposals again (RECURRING_PROPOSAL_GONE) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    rejectRecurringProposal: {
        parameters: {
            query?: never;
            header?: {
                /** @description Repeating a create with the same key and the same request returns the first response (kept 24 h); the same key with another request is 409. */
                "Idempotency-Key"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    key: string;
                };
            };
        };
        responses: {
            /** @description The rejected series */
            201: {
                headers: {
                    /** @description true when this is the stored response of an earlier request with the same key */
                    "Idempotent-Replayed"?: "true";
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        createdOn: string;
                        expectedAmount: {
                            amount: string;
                            currency: string;
                        };
                        /** @enum {string} */
                        frequency: "week" | "two-weeks" | "month" | "quarter" | "year";
                        /** Format: uuid */
                        id: string;
                        /** Format: uuid */
                        merchantId: string;
                        transactionIds: string[];
                        /** @enum {string} */
                        type: "expense" | "income";
                        variable: boolean;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN), or the request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The idempotency key was used for another request, or that request is still running; The proposal is no longer offered; read the proposals again (RECURRING_PROPOSAL_GONE) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    listRecurringStatuses: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description One status per payment, in the payments' order; the charges matched anew on every read to the last 430 days of transactions */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: {
                            amountChange: {
                                from: {
                                    amount: string;
                                    currency: string;
                                };
                                on: string;
                                to: {
                                    amount: string;
                                    currency: string;
                                };
                                /** Format: uuid */
                                transactionId: string;
                            } | null;
                            approximate: boolean;
                            expectedAmount: {
                                amount: string;
                                currency: string;
                            };
                            lastCharge: {
                                amount: {
                                    amount: string;
                                    currency: string;
                                } | null;
                                amountChange: {
                                    from: {
                                        amount: string;
                                        currency: string;
                                    };
                                    on: string;
                                    to: {
                                        amount: string;
                                        currency: string;
                                    };
                                    /** Format: uuid */
                                    transactionId: string;
                                } | null;
                                approximate: boolean;
                                dueOn: string;
                                expectedAmount: {
                                    amount: string;
                                    currency: string;
                                };
                                markedOn: string | null;
                                overdueDays: number | null;
                                paidOn: string | null;
                                /** @enum {string} */
                                status: "paid" | "paid-late" | "expected" | "overdue" | "skipped";
                                transactionId: string | null;
                            } | null;
                            missesInRow: number;
                            nextCharge: {
                                amount: {
                                    amount: string;
                                    currency: string;
                                } | null;
                                amountChange: {
                                    from: {
                                        amount: string;
                                        currency: string;
                                    };
                                    on: string;
                                    to: {
                                        amount: string;
                                        currency: string;
                                    };
                                    /** Format: uuid */
                                    transactionId: string;
                                } | null;
                                approximate: boolean;
                                dueOn: string;
                                expectedAmount: {
                                    amount: string;
                                    currency: string;
                                };
                                markedOn: string | null;
                                overdueDays: number | null;
                                paidOn: string | null;
                                /** @enum {string} */
                                status: "paid" | "paid-late" | "expected" | "overdue" | "skipped";
                                transactionId: string | null;
                            } | null;
                            /** Format: uuid */
                            paymentId: string;
                            /** @enum {string} */
                            state: "active" | "possibly-cancelled";
                        }[];
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    signUp: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    captchaToken?: string;
                    email: string;
                    locale?: string;
                    name: string;
                    password: string;
                    timeZone?: string;
                };
            };
        };
        responses: {
            /** @description Always «check your email», whether the address already has an account or not (ACC-01 FR 8); no session is created */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        registrationToken: string;
                        resendAfterS: number;
                        /** @constant */
                        status: "check-email";
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR); Complete the CAPTCHA and try again (CAPTCHA_REQUIRED) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the function is off */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 60 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    changeRegistrationEmail: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    registrationToken: string;
                };
            };
        };
        responses: {
            /** @description This sign-up's token and its confirmation link no longer work; an existing account is never changed. The client returns to the filled-in sign-up form */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        status: "closed";
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the function is off */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 60 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    resendRegistrationEmail: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    registrationToken: string;
                };
            };
        };
        responses: {
            /** @description The letter is on its way; the same for a new and a taken address. 429 with Retry-After within 60 s of the last letter or after 5 in an hour */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        resendAfterS: number;
                        /** @constant */
                        status: "sent";
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the function is off */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 60 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    getSession: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The account of the session. Reading does not extend the session (only POST /v1/session/refresh does). 401 SESSION_ENDED with sessionEndReason when this browser's session has ended (its cookie is removed); 401 UNAUTHENTICATED without a session */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        email: string;
                        name: string;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Sign-in is required (UNAUTHENTICATED); The session has ended; sign in again (SESSION_ENDED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the function is off */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 60 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    signOut: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The session has ended and its cookie is removed (also when there was none) */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        status: "signed-out";
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the function is off */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 60 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    refreshSession: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The client sends it for user actions only (click, input, navigation; ACC-04 business rules), never for background requests. The 15 min idle deadline moves for every tab of the browser and the session cookie gets a new token (NFR-01 FR 12); the 12 h end never moves. A token replaced less than 30 s ago (another tab's request on its way) extends the session without a new token; one replaced earlier ends the session (401 SESSION_ENDED, ended-elsewhere) */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        expiresInS: number;
                        idleTimeoutS: number;
                        /** @constant */
                        status: "active";
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Sign-in is required (UNAUTHENTICATED); The session has ended; sign in again (SESSION_ENDED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the function is off */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 60 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    confirmStepUp: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @enum {string} */
                    action: "password-change";
                    password: string;
                };
            };
        };
        responses: {
            /** @description A one-time confirmation of this session for the action, valid 5 min; no code by email (NFR-01 FR 13). 403 STEP_UP_PASSWORD_INVALID: «Пароль неправильний», counted with the failed sign-ins (5 in 15 min). 429 SIGN_IN_LOCKED with Retry-After: sign-in is locked — when this attempt reached the limit, this session has ended (its cookie is removed), the next sign-in needs a CAPTCHA and a security letter is on its way */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        expiresInS: number;
                        stepUpToken: string;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Sign-in is required (UNAUTHENTICATED); The session has ended; sign in again (SESSION_ENDED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request comes from a page of another site (ORIGIN_NOT_ALLOWED); The password is wrong (STEP_UP_PASSWORD_INVALID) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the function is off */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 60 per minute for this route); Sign-in is temporarily locked; try again later (SIGN_IN_LOCKED) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    signIn: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    captchaToken?: string;
                    email: string;
                    password: string;
                };
            };
        };
        responses: {
            /** @description signed-in: the session cookie is set; a device (user agent) not in the account's sign-in history gets a security letter with «Це був не я» (not on the account's first sign-in). email-not-confirmed: no session; «Надіслати лист ще раз» uses registrationToken. 403 PASSWORD_RESET_REQUIRED: the right password, but «Це був не я» requires a new one first */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        registrationToken?: string;
                        resendAfterS?: number;
                        /** @enum {string} */
                        status: "signed-in" | "email-not-confirmed";
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR); Complete the CAPTCHA and try again (CAPTCHA_REQUIRED) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Wrong email or password (INVALID_CREDENTIALS) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request comes from a page of another site (ORIGIN_NOT_ALLOWED); Change your password with the link in your email first (PASSWORD_RESET_REQUIRED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the function is off */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 60 per minute for this route); Sign-in is temporarily locked; try again later (SIGN_IN_LOCKED) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    getSpace: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The caller's space */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        dataRegion: "eu";
                        name: string;
                        /** @enum {string} */
                        reportingCurrency: "EUR";
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    renameSpace: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name: string;
                };
            };
        };
        responses: {
            /** @description The space with its new name */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        dataRegion: "eu";
                        name: string;
                        /** @enum {string} */
                        reportingCurrency: "EUR";
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN), or the request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    getTransactionReviewCount: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description How many transactions of the space are in the queue (shown ones) */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        count: number;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    listTransactionReviewGroups: {
        parameters: {
            query?: {
                /** @description Page number, from 1. */
                page?: string;
                /** @description Records per page: 25, 50, 100. */
                pageSize?: "25" | "50" | "100";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description One page of the groups */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        count: number;
                        items: {
                            count: number;
                            counterparty: string | null;
                            id: string;
                            merchant: {
                                /** Format: uuid */
                                id: string;
                                initials: string;
                                intermediary: boolean;
                                name: string;
                            } | null;
                            mixedCategories: boolean;
                            /** Format: date */
                            oldest: string;
                            suggestedCategoryId: string | null;
                            totals: {
                                amount: string;
                                currency: string;
                            }[];
                        }[];
                        page: number;
                        pageSize: number;
                        transactionCount: number;
                        truncated: boolean;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    listTransactionReviewGroupIds: {
        parameters: {
            query?: {
                /** @description Opaque cursor from `nextCursor` of the previous page. */
                cursor?: string;
                /** @description Items per page, 1–100. */
                limit?: number;
            };
            header?: never;
            path: {
                groupId: string | "none";
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The ids of the group's transactions, by id */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: string[];
                        /** @description Cursor of the next page; null on the last page. */
                        nextCursor: string | null;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    listTransactionTags: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The tags */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: {
                            count: number;
                            /** Format: uuid */
                            id: string;
                            name: string;
                        }[];
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    deleteTransactionTag: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                tagId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Deleted, with how many transactions it was taken off */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        deleted: true;
                        removed: number;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN), or the request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    renameTransactionTag: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                tagId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name: string;
                };
            };
        };
        responses: {
            /** @description The tag after the change */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        count: number;
                        /** Format: uuid */
                        id: string;
                        name: string;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN), or the request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    listTransactions: {
        parameters: {
            query?: {
                /** @description Filter `<field>.<operator>:<value>` (repeatable); fields and operators from the list's whitelist */
                filter?: string | string[];
                /** @description Page number, from 1. */
                page?: string;
                /** @description Records per page: 25, 50, 100. */
                pageSize?: "25" | "50" | "100";
                /** @description Sort keys `field` or `-field` (descending), separated by commas; from the list's whitelist */
                sort?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description «Рядків на сторінці N · from–to з count»; totals at the official rate of each transaction's date (DAT-01 FR 12) */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        count: number;
                        from: number;
                        items: {
                            /** Format: uuid */
                            accountId: string;
                            amount: {
                                amount: string;
                                currency: string;
                            };
                            counterparty: string | null;
                            date: string;
                            description: string | null;
                            hidden: boolean;
                            /** Format: uuid */
                            id: string;
                            mergedDuplicates: string[];
                            mergedInto: string | null;
                            note: string | null;
                            recordedAt: string;
                            review: ("queued" | "confirmed") | null;
                            /** @enum {string} */
                            source: "manual" | "imported";
                            split: {
                                /** @enum {string} */
                                mode: "categories" | "months";
                                needsReview: boolean;
                                parts: {
                                    amount: {
                                        amount: string;
                                        currency: string;
                                    };
                                    /** Format: uuid */
                                    categoryId: string;
                                    month: string | null;
                                }[];
                            } | null;
                            /** @enum {string} */
                            status: "posted" | "pending";
                            tags: {
                                /** Format: uuid */
                                id: string;
                                name: string;
                            }[];
                            transfer: {
                                /** Format: uuid */
                                counterpartId: string;
                                date: string;
                                fee: {
                                    amount: string;
                                    currency: string;
                                } | null;
                                /** Format: uuid */
                                id: string;
                                rate: {
                                    date: string;
                                    rate: string;
                                    source: string;
                                } | null;
                                /** @enum {string} */
                                side: "outflow" | "inflow";
                            } | null;
                            /** @enum {string} */
                            type: "income" | "expense";
                            version: number;
                        }[];
                        page: number;
                        pageSize: number;
                        summary: {
                            currency: string;
                            difference: {
                                approximate: boolean;
                                converted: boolean;
                                nearestRateCount: number;
                                noRateCount: number;
                                partial: boolean;
                                total: {
                                    amount: string;
                                    currency: string;
                                } | null;
                            };
                            expense: {
                                approximate: boolean;
                                converted: boolean;
                                nearestRateCount: number;
                                noRateCount: number;
                                partial: boolean;
                                total: {
                                    amount: string;
                                    currency: string;
                                } | null;
                            };
                            income: {
                                approximate: boolean;
                                converted: boolean;
                                nearestRateCount: number;
                                noRateCount: number;
                                partial: boolean;
                                total: {
                                    amount: string;
                                    currency: string;
                                } | null;
                            };
                        };
                        to: number;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    createTransaction: {
        parameters: {
            query?: never;
            header?: {
                /** @description Repeating a create with the same key and the same request returns the first response (kept 24 h); the same key with another request is 409. */
                "Idempotency-Key"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** Format: uuid */
                    accountId: string;
                    amount: {
                        /** @description A signed plain decimal, e.g. -45.50 */
                        amount: string;
                        /** @description ISO 4217 code; the account's (subaccount's) currency */
                        currency: string;
                    };
                    counterparty?: string | null;
                    /** @description YYYY-MM-DD; never after today */
                    date: string;
                    description?: string | null;
                    /** @enum {string} */
                    status?: "posted" | "pending";
                };
            };
        };
        responses: {
            /** @description The new transaction */
            201: {
                headers: {
                    /** @description true when this is the stored response of an earlier request with the same key */
                    "Idempotent-Replayed"?: "true";
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uuid */
                        accountId: string;
                        amount: {
                            amount: string;
                            currency: string;
                        };
                        counterparty: string | null;
                        date: string;
                        description: string | null;
                        hidden: boolean;
                        /** Format: uuid */
                        id: string;
                        mergedDuplicates: string[];
                        mergedInto: string | null;
                        note: string | null;
                        recordedAt: string;
                        review: ("queued" | "confirmed") | null;
                        /** @enum {string} */
                        source: "manual" | "imported";
                        split: {
                            /** @enum {string} */
                            mode: "categories" | "months";
                            needsReview: boolean;
                            parts: {
                                amount: {
                                    amount: string;
                                    currency: string;
                                };
                                /** Format: uuid */
                                categoryId: string;
                                month: string | null;
                            }[];
                        } | null;
                        /** @enum {string} */
                        status: "posted" | "pending";
                        tags: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                        }[];
                        transfer: {
                            /** Format: uuid */
                            counterpartId: string;
                            date: string;
                            fee: {
                                amount: string;
                                currency: string;
                            } | null;
                            /** Format: uuid */
                            id: string;
                            rate: {
                                date: string;
                                rate: string;
                                source: string;
                            } | null;
                            /** @enum {string} */
                            side: "outflow" | "inflow";
                        } | null;
                        /** @enum {string} */
                        type: "income" | "expense";
                        version: number;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN), or the request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The idempotency key was used for another request, or that request is still running; The account is closed (ACCOUNT_CLOSED) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    getTransaction: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                transactionId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The transaction */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uuid */
                        accountId: string;
                        amount: {
                            amount: string;
                            currency: string;
                        };
                        counterparty: string | null;
                        date: string;
                        description: string | null;
                        hidden: boolean;
                        /** Format: uuid */
                        id: string;
                        mergedDuplicates: string[];
                        mergedInto: string | null;
                        note: string | null;
                        recordedAt: string;
                        review: ("queued" | "confirmed") | null;
                        /** @enum {string} */
                        source: "manual" | "imported";
                        split: {
                            /** @enum {string} */
                            mode: "categories" | "months";
                            needsReview: boolean;
                            parts: {
                                amount: {
                                    amount: string;
                                    currency: string;
                                };
                                /** Format: uuid */
                                categoryId: string;
                                month: string | null;
                            }[];
                        } | null;
                        /** @enum {string} */
                        status: "posted" | "pending";
                        tags: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                        }[];
                        transfer: {
                            /** Format: uuid */
                            counterpartId: string;
                            date: string;
                            fee: {
                                amount: string;
                                currency: string;
                            } | null;
                            /** Format: uuid */
                            id: string;
                            rate: {
                                date: string;
                                rate: string;
                                source: string;
                            } | null;
                            /** @enum {string} */
                            side: "outflow" | "inflow";
                        } | null;
                        /** @enum {string} */
                        type: "income" | "expense";
                        version: number;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    deleteTransaction: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                transactionId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Deleted */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        deleted: true;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN), or the request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The account is closed (ACCOUNT_CLOSED); The transaction is a side of a transfer; remove the mark first (TRANSACTION_IN_TRANSFER); The transaction is merged with a duplicate; unmerge it first (TRANSACTION_MERGED) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    updateTransaction: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                transactionId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** Format: uuid */
                    accountId?: string;
                    amount?: {
                        /** @description A signed plain decimal, e.g. -45.50 */
                        amount: string;
                        /** @description ISO 4217 code; the account's (subaccount's) currency */
                        currency: string;
                    };
                    counterparty?: string | null;
                    /** @description YYYY-MM-DD; never after today */
                    date?: string;
                    description?: string | null;
                    /** @enum {string} */
                    status?: "posted" | "pending";
                };
            };
        };
        responses: {
            /** @description The transaction after the change */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uuid */
                        accountId: string;
                        amount: {
                            amount: string;
                            currency: string;
                        };
                        counterparty: string | null;
                        date: string;
                        description: string | null;
                        hidden: boolean;
                        /** Format: uuid */
                        id: string;
                        mergedDuplicates: string[];
                        mergedInto: string | null;
                        note: string | null;
                        recordedAt: string;
                        review: ("queued" | "confirmed") | null;
                        /** @enum {string} */
                        source: "manual" | "imported";
                        split: {
                            /** @enum {string} */
                            mode: "categories" | "months";
                            needsReview: boolean;
                            parts: {
                                amount: {
                                    amount: string;
                                    currency: string;
                                };
                                /** Format: uuid */
                                categoryId: string;
                                month: string | null;
                            }[];
                        } | null;
                        /** @enum {string} */
                        status: "posted" | "pending";
                        tags: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                        }[];
                        transfer: {
                            /** Format: uuid */
                            counterpartId: string;
                            date: string;
                            fee: {
                                amount: string;
                                currency: string;
                            } | null;
                            /** Format: uuid */
                            id: string;
                            rate: {
                                date: string;
                                rate: string;
                                source: string;
                            } | null;
                            /** @enum {string} */
                            side: "outflow" | "inflow";
                        } | null;
                        /** @enum {string} */
                        type: "income" | "expense";
                        version: number;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN), or the request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The account is closed (ACCOUNT_CLOSED); The transaction is a side of a transfer; remove the mark first (TRANSACTION_IN_TRANSFER); The transaction is merged with a duplicate; unmerge it first (TRANSACTION_MERGED); Duplicates are merged into this transaction; unmerge them to change its amount or account (TRANSACTION_HAS_DUPLICATES) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    setTransactionAttributes: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                transactionId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    note?: string | null;
                    tags?: string[];
                };
            };
        };
        responses: {
            /** @description The transaction with its attributes */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uuid */
                        accountId: string;
                        amount: {
                            amount: string;
                            currency: string;
                        };
                        counterparty: string | null;
                        date: string;
                        description: string | null;
                        hidden: boolean;
                        /** Format: uuid */
                        id: string;
                        mergedDuplicates: string[];
                        mergedInto: string | null;
                        note: string | null;
                        recordedAt: string;
                        review: ("queued" | "confirmed") | null;
                        /** @enum {string} */
                        source: "manual" | "imported";
                        split: {
                            /** @enum {string} */
                            mode: "categories" | "months";
                            needsReview: boolean;
                            parts: {
                                amount: {
                                    amount: string;
                                    currency: string;
                                };
                                /** Format: uuid */
                                categoryId: string;
                                month: string | null;
                            }[];
                        } | null;
                        /** @enum {string} */
                        status: "posted" | "pending";
                        tags: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                        }[];
                        transfer: {
                            /** Format: uuid */
                            counterpartId: string;
                            date: string;
                            fee: {
                                amount: string;
                                currency: string;
                            } | null;
                            /** Format: uuid */
                            id: string;
                            rate: {
                                date: string;
                                rate: string;
                                source: string;
                            } | null;
                            /** @enum {string} */
                            side: "outflow" | "inflow";
                        } | null;
                        /** @enum {string} */
                        type: "income" | "expense";
                        version: number;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN), or the request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The account is closed (ACCOUNT_CLOSED); The transaction is merged with a duplicate; unmerge it first (TRANSACTION_MERGED) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    getTransactionCategory: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                transactionId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The transaction's category */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        appliedRules?: {
                            /** Format: uuid */
                            id: string;
                            position: number;
                        }[];
                        categoryId: string | null;
                        rule?: {
                            /** Format: uuid */
                            id: string;
                            position: number;
                        };
                        /** @enum {string} */
                        source: "manual" | "rule" | "merchant" | "bank" | "dictionary" | "none";
                        /** Format: uuid */
                        transactionId: string;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    setTransactionCategory: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                transactionId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    categoryId: string | null;
                };
            };
        };
        responses: {
            /** @description The transaction's category */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        appliedRules?: {
                            /** Format: uuid */
                            id: string;
                            position: number;
                        }[];
                        categoryId: string | null;
                        rule?: {
                            /** Format: uuid */
                            id: string;
                            position: number;
                        };
                        /** @enum {string} */
                        source: "manual" | "rule" | "merchant" | "bank" | "dictionary" | "none";
                        /** Format: uuid */
                        transactionId: string;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN), or the request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The transaction is a side of a transfer; remove the mark first (TRANSACTION_IN_TRANSFER); The transaction is merged with a duplicate; unmerge it first (TRANSACTION_MERGED); The transaction is split; change the categories of its parts (TRANSACTION_SPLIT); The record was changed by someone else; reload it and try again (VERSION_CONFLICT) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    hideTransaction: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                transactionId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The transaction */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uuid */
                        accountId: string;
                        amount: {
                            amount: string;
                            currency: string;
                        };
                        counterparty: string | null;
                        date: string;
                        description: string | null;
                        hidden: boolean;
                        /** Format: uuid */
                        id: string;
                        mergedDuplicates: string[];
                        mergedInto: string | null;
                        note: string | null;
                        recordedAt: string;
                        review: ("queued" | "confirmed") | null;
                        /** @enum {string} */
                        source: "manual" | "imported";
                        split: {
                            /** @enum {string} */
                            mode: "categories" | "months";
                            needsReview: boolean;
                            parts: {
                                amount: {
                                    amount: string;
                                    currency: string;
                                };
                                /** Format: uuid */
                                categoryId: string;
                                month: string | null;
                            }[];
                        } | null;
                        /** @enum {string} */
                        status: "posted" | "pending";
                        tags: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                        }[];
                        transfer: {
                            /** Format: uuid */
                            counterpartId: string;
                            date: string;
                            fee: {
                                amount: string;
                                currency: string;
                            } | null;
                            /** Format: uuid */
                            id: string;
                            rate: {
                                date: string;
                                rate: string;
                                source: string;
                            } | null;
                            /** @enum {string} */
                            side: "outflow" | "inflow";
                        } | null;
                        /** @enum {string} */
                        type: "income" | "expense";
                        version: number;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN), or the request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The account is closed (ACCOUNT_CLOSED); The transaction is a side of a transfer; remove the mark first (TRANSACTION_IN_TRANSFER); The transaction is merged with a duplicate; unmerge it first (TRANSACTION_MERGED); Only a duplicate or a technical record can be hidden (TRANSACTION_NOT_HIDEABLE) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    getTransactionHistory: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                transactionId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The transaction's history */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: {
                            /** @enum {string} */
                            action: "create" | "update" | "delete";
                            /** @enum {string} */
                            actor: "you" | "member" | "staff" | "system";
                            changes: {
                                after: string | null;
                                before: string | null;
                                field: string;
                                masked: boolean;
                            }[];
                            channel: string;
                            /** Format: uuid */
                            id: string;
                            occurredAt: string;
                        }[];
                        truncated: boolean;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    getTransactionMerchant: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                transactionId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The transaction's merchant */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        channel: string | null;
                        joinedFrom: {
                            /** Format: uuid */
                            id: string;
                            initials: string;
                            intermediary: boolean;
                            mergedInto: string | null;
                            name: string;
                        } | null;
                        merchant: {
                            /** Format: uuid */
                            id: string;
                            initials: string;
                            intermediary: boolean;
                            mergedInto: string | null;
                            name: string;
                        } | null;
                        originalDescription: string | null;
                        /** Format: uuid */
                        transactionId: string;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    mergeDuplicate: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                transactionId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** Format: uuid */
                    duplicateId: string;
                };
            };
        };
        responses: {
            /** @description The transaction that stays, «Об'єднано» */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uuid */
                        accountId: string;
                        amount: {
                            amount: string;
                            currency: string;
                        };
                        counterparty: string | null;
                        date: string;
                        description: string | null;
                        hidden: boolean;
                        /** Format: uuid */
                        id: string;
                        mergedDuplicates: string[];
                        mergedInto: string | null;
                        note: string | null;
                        recordedAt: string;
                        review: ("queued" | "confirmed") | null;
                        /** @enum {string} */
                        source: "manual" | "imported";
                        split: {
                            /** @enum {string} */
                            mode: "categories" | "months";
                            needsReview: boolean;
                            parts: {
                                amount: {
                                    amount: string;
                                    currency: string;
                                };
                                /** Format: uuid */
                                categoryId: string;
                                month: string | null;
                            }[];
                        } | null;
                        /** @enum {string} */
                        status: "posted" | "pending";
                        tags: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                        }[];
                        transfer: {
                            /** Format: uuid */
                            counterpartId: string;
                            date: string;
                            fee: {
                                amount: string;
                                currency: string;
                            } | null;
                            /** Format: uuid */
                            id: string;
                            rate: {
                                date: string;
                                rate: string;
                                source: string;
                            } | null;
                            /** @enum {string} */
                            side: "outflow" | "inflow";
                        } | null;
                        /** @enum {string} */
                        type: "income" | "expense";
                        version: number;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN), or the request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The account is closed (ACCOUNT_CLOSED) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    unmergeDuplicate: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                transactionId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The transaction, unmerged */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uuid */
                        accountId: string;
                        amount: {
                            amount: string;
                            currency: string;
                        };
                        counterparty: string | null;
                        date: string;
                        description: string | null;
                        hidden: boolean;
                        /** Format: uuid */
                        id: string;
                        mergedDuplicates: string[];
                        mergedInto: string | null;
                        note: string | null;
                        recordedAt: string;
                        review: ("queued" | "confirmed") | null;
                        /** @enum {string} */
                        source: "manual" | "imported";
                        split: {
                            /** @enum {string} */
                            mode: "categories" | "months";
                            needsReview: boolean;
                            parts: {
                                amount: {
                                    amount: string;
                                    currency: string;
                                };
                                /** Format: uuid */
                                categoryId: string;
                                month: string | null;
                            }[];
                        } | null;
                        /** @enum {string} */
                        status: "posted" | "pending";
                        tags: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                        }[];
                        transfer: {
                            /** Format: uuid */
                            counterpartId: string;
                            date: string;
                            fee: {
                                amount: string;
                                currency: string;
                            } | null;
                            /** Format: uuid */
                            id: string;
                            rate: {
                                date: string;
                                rate: string;
                                source: string;
                            } | null;
                            /** @enum {string} */
                            side: "outflow" | "inflow";
                        } | null;
                        /** @enum {string} */
                        type: "income" | "expense";
                        version: number;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN), or the request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The account is closed (ACCOUNT_CLOSED) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    dismissDuplicate: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                transactionId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** Format: uuid */
                    counterpartId: string;
                };
            };
        };
        responses: {
            /** @description The transaction */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uuid */
                        accountId: string;
                        amount: {
                            amount: string;
                            currency: string;
                        };
                        counterparty: string | null;
                        date: string;
                        description: string | null;
                        hidden: boolean;
                        /** Format: uuid */
                        id: string;
                        mergedDuplicates: string[];
                        mergedInto: string | null;
                        note: string | null;
                        recordedAt: string;
                        review: ("queued" | "confirmed") | null;
                        /** @enum {string} */
                        source: "manual" | "imported";
                        split: {
                            /** @enum {string} */
                            mode: "categories" | "months";
                            needsReview: boolean;
                            parts: {
                                amount: {
                                    amount: string;
                                    currency: string;
                                };
                                /** Format: uuid */
                                categoryId: string;
                                month: string | null;
                            }[];
                        } | null;
                        /** @enum {string} */
                        status: "posted" | "pending";
                        tags: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                        }[];
                        transfer: {
                            /** Format: uuid */
                            counterpartId: string;
                            date: string;
                            fee: {
                                amount: string;
                                currency: string;
                            } | null;
                            /** Format: uuid */
                            id: string;
                            rate: {
                                date: string;
                                rate: string;
                                source: string;
                            } | null;
                            /** @enum {string} */
                            side: "outflow" | "inflow";
                        } | null;
                        /** @enum {string} */
                        type: "income" | "expense";
                        version: number;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN), or the request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The account is closed (ACCOUNT_CLOSED) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    confirmTransactionReview: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                transactionId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    categoryId?: string | null;
                    version: number;
                };
            };
        };
        responses: {
            /** @description The transaction after the change */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uuid */
                        accountId: string;
                        amount: {
                            amount: string;
                            currency: string;
                        };
                        counterparty: string | null;
                        date: string;
                        description: string | null;
                        hidden: boolean;
                        /** Format: uuid */
                        id: string;
                        mergedDuplicates: string[];
                        mergedInto: string | null;
                        note: string | null;
                        recordedAt: string;
                        review: ("queued" | "confirmed") | null;
                        /** @enum {string} */
                        source: "manual" | "imported";
                        split: {
                            /** @enum {string} */
                            mode: "categories" | "months";
                            needsReview: boolean;
                            parts: {
                                amount: {
                                    amount: string;
                                    currency: string;
                                };
                                /** Format: uuid */
                                categoryId: string;
                                month: string | null;
                            }[];
                        } | null;
                        /** @enum {string} */
                        status: "posted" | "pending";
                        tags: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                        }[];
                        transfer: {
                            /** Format: uuid */
                            counterpartId: string;
                            date: string;
                            fee: {
                                amount: string;
                                currency: string;
                            } | null;
                            /** Format: uuid */
                            id: string;
                            rate: {
                                date: string;
                                rate: string;
                                source: string;
                            } | null;
                            /** @enum {string} */
                            side: "outflow" | "inflow";
                        } | null;
                        /** @enum {string} */
                        type: "income" | "expense";
                        version: number;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN), or the request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The record was changed by someone else; reload it and try again (VERSION_CONFLICT); The transaction is not in the review queue (TRANSACTION_NOT_IN_REVIEW); The transaction is merged with a duplicate; unmerge it first (TRANSACTION_MERGED) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    reopenTransactionReview: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                transactionId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    categoryId?: string | null;
                    version: number;
                };
            };
        };
        responses: {
            /** @description The transaction after the change */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uuid */
                        accountId: string;
                        amount: {
                            amount: string;
                            currency: string;
                        };
                        counterparty: string | null;
                        date: string;
                        description: string | null;
                        hidden: boolean;
                        /** Format: uuid */
                        id: string;
                        mergedDuplicates: string[];
                        mergedInto: string | null;
                        note: string | null;
                        recordedAt: string;
                        review: ("queued" | "confirmed") | null;
                        /** @enum {string} */
                        source: "manual" | "imported";
                        split: {
                            /** @enum {string} */
                            mode: "categories" | "months";
                            needsReview: boolean;
                            parts: {
                                amount: {
                                    amount: string;
                                    currency: string;
                                };
                                /** Format: uuid */
                                categoryId: string;
                                month: string | null;
                            }[];
                        } | null;
                        /** @enum {string} */
                        status: "posted" | "pending";
                        tags: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                        }[];
                        transfer: {
                            /** Format: uuid */
                            counterpartId: string;
                            date: string;
                            fee: {
                                amount: string;
                                currency: string;
                            } | null;
                            /** Format: uuid */
                            id: string;
                            rate: {
                                date: string;
                                rate: string;
                                source: string;
                            } | null;
                            /** @enum {string} */
                            side: "outflow" | "inflow";
                        } | null;
                        /** @enum {string} */
                        type: "income" | "expense";
                        version: number;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN), or the request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The record was changed by someone else; reload it and try again (VERSION_CONFLICT); The transaction is not in the review queue (TRANSACTION_NOT_IN_REVIEW); The transaction is merged with a duplicate; unmerge it first (TRANSACTION_MERGED) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    showTransaction: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                transactionId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The transaction */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uuid */
                        accountId: string;
                        amount: {
                            amount: string;
                            currency: string;
                        };
                        counterparty: string | null;
                        date: string;
                        description: string | null;
                        hidden: boolean;
                        /** Format: uuid */
                        id: string;
                        mergedDuplicates: string[];
                        mergedInto: string | null;
                        note: string | null;
                        recordedAt: string;
                        review: ("queued" | "confirmed") | null;
                        /** @enum {string} */
                        source: "manual" | "imported";
                        split: {
                            /** @enum {string} */
                            mode: "categories" | "months";
                            needsReview: boolean;
                            parts: {
                                amount: {
                                    amount: string;
                                    currency: string;
                                };
                                /** Format: uuid */
                                categoryId: string;
                                month: string | null;
                            }[];
                        } | null;
                        /** @enum {string} */
                        status: "posted" | "pending";
                        tags: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                        }[];
                        transfer: {
                            /** Format: uuid */
                            counterpartId: string;
                            date: string;
                            fee: {
                                amount: string;
                                currency: string;
                            } | null;
                            /** Format: uuid */
                            id: string;
                            rate: {
                                date: string;
                                rate: string;
                                source: string;
                            } | null;
                            /** @enum {string} */
                            side: "outflow" | "inflow";
                        } | null;
                        /** @enum {string} */
                        type: "income" | "expense";
                        version: number;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN), or the request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The account is closed (ACCOUNT_CLOSED); The transaction is merged with a duplicate; unmerge it first (TRANSACTION_MERGED) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    splitTransaction: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                transactionId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @constant */
                    mode: "categories";
                    parts: {
                        /** @description A signed plain decimal, e.g. -85.00 */
                        amount: string;
                        /** Format: uuid */
                        categoryId: string;
                    }[];
                } | {
                    /** Format: uuid */
                    categoryId: string;
                    /** @constant */
                    mode: "months";
                    months: number;
                    startMonth: string;
                };
            };
        };
        responses: {
            /** @description The transaction with its split */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uuid */
                        accountId: string;
                        amount: {
                            amount: string;
                            currency: string;
                        };
                        counterparty: string | null;
                        date: string;
                        description: string | null;
                        hidden: boolean;
                        /** Format: uuid */
                        id: string;
                        mergedDuplicates: string[];
                        mergedInto: string | null;
                        note: string | null;
                        recordedAt: string;
                        review: ("queued" | "confirmed") | null;
                        /** @enum {string} */
                        source: "manual" | "imported";
                        split: {
                            /** @enum {string} */
                            mode: "categories" | "months";
                            needsReview: boolean;
                            parts: {
                                amount: {
                                    amount: string;
                                    currency: string;
                                };
                                /** Format: uuid */
                                categoryId: string;
                                month: string | null;
                            }[];
                        } | null;
                        /** @enum {string} */
                        status: "posted" | "pending";
                        tags: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                        }[];
                        transfer: {
                            /** Format: uuid */
                            counterpartId: string;
                            date: string;
                            fee: {
                                amount: string;
                                currency: string;
                            } | null;
                            /** Format: uuid */
                            id: string;
                            rate: {
                                date: string;
                                rate: string;
                                source: string;
                            } | null;
                            /** @enum {string} */
                            side: "outflow" | "inflow";
                        } | null;
                        /** @enum {string} */
                        type: "income" | "expense";
                        version: number;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN), or the request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The account is closed (ACCOUNT_CLOSED); The transaction is a side of a transfer; remove the mark first (TRANSACTION_IN_TRANSFER); The transaction is merged with a duplicate; unmerge it first (TRANSACTION_MERGED) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    unsplitTransaction: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                transactionId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The transaction without a split */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uuid */
                        accountId: string;
                        amount: {
                            amount: string;
                            currency: string;
                        };
                        counterparty: string | null;
                        date: string;
                        description: string | null;
                        hidden: boolean;
                        /** Format: uuid */
                        id: string;
                        mergedDuplicates: string[];
                        mergedInto: string | null;
                        note: string | null;
                        recordedAt: string;
                        review: ("queued" | "confirmed") | null;
                        /** @enum {string} */
                        source: "manual" | "imported";
                        split: {
                            /** @enum {string} */
                            mode: "categories" | "months";
                            needsReview: boolean;
                            parts: {
                                amount: {
                                    amount: string;
                                    currency: string;
                                };
                                /** Format: uuid */
                                categoryId: string;
                                month: string | null;
                            }[];
                        } | null;
                        /** @enum {string} */
                        status: "posted" | "pending";
                        tags: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                        }[];
                        transfer: {
                            /** Format: uuid */
                            counterpartId: string;
                            date: string;
                            fee: {
                                amount: string;
                                currency: string;
                            } | null;
                            /** Format: uuid */
                            id: string;
                            rate: {
                                date: string;
                                rate: string;
                                source: string;
                            } | null;
                            /** @enum {string} */
                            side: "outflow" | "inflow";
                        } | null;
                        /** @enum {string} */
                        type: "income" | "expense";
                        version: number;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN), or the request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The account is closed (ACCOUNT_CLOSED); The transaction is merged with a duplicate; unmerge it first (TRANSACTION_MERGED) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    markTransfer: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                transactionId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** Format: uuid */
                    counterpartId: string;
                };
            };
        };
        responses: {
            /** @description The transaction, a side of the transfer */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uuid */
                        accountId: string;
                        amount: {
                            amount: string;
                            currency: string;
                        };
                        counterparty: string | null;
                        date: string;
                        description: string | null;
                        hidden: boolean;
                        /** Format: uuid */
                        id: string;
                        mergedDuplicates: string[];
                        mergedInto: string | null;
                        note: string | null;
                        recordedAt: string;
                        review: ("queued" | "confirmed") | null;
                        /** @enum {string} */
                        source: "manual" | "imported";
                        split: {
                            /** @enum {string} */
                            mode: "categories" | "months";
                            needsReview: boolean;
                            parts: {
                                amount: {
                                    amount: string;
                                    currency: string;
                                };
                                /** Format: uuid */
                                categoryId: string;
                                month: string | null;
                            }[];
                        } | null;
                        /** @enum {string} */
                        status: "posted" | "pending";
                        tags: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                        }[];
                        transfer: {
                            /** Format: uuid */
                            counterpartId: string;
                            date: string;
                            fee: {
                                amount: string;
                                currency: string;
                            } | null;
                            /** Format: uuid */
                            id: string;
                            rate: {
                                date: string;
                                rate: string;
                                source: string;
                            } | null;
                            /** @enum {string} */
                            side: "outflow" | "inflow";
                        } | null;
                        /** @enum {string} */
                        type: "income" | "expense";
                        version: number;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN), or the request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The account is closed (ACCOUNT_CLOSED); The record was changed by someone else; reload it and try again (VERSION_CONFLICT) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    unmarkTransfer: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                transactionId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The transaction, no longer a transfer */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uuid */
                        accountId: string;
                        amount: {
                            amount: string;
                            currency: string;
                        };
                        counterparty: string | null;
                        date: string;
                        description: string | null;
                        hidden: boolean;
                        /** Format: uuid */
                        id: string;
                        mergedDuplicates: string[];
                        mergedInto: string | null;
                        note: string | null;
                        recordedAt: string;
                        review: ("queued" | "confirmed") | null;
                        /** @enum {string} */
                        source: "manual" | "imported";
                        split: {
                            /** @enum {string} */
                            mode: "categories" | "months";
                            needsReview: boolean;
                            parts: {
                                amount: {
                                    amount: string;
                                    currency: string;
                                };
                                /** Format: uuid */
                                categoryId: string;
                                month: string | null;
                            }[];
                        } | null;
                        /** @enum {string} */
                        status: "posted" | "pending";
                        tags: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                        }[];
                        transfer: {
                            /** Format: uuid */
                            counterpartId: string;
                            date: string;
                            fee: {
                                amount: string;
                                currency: string;
                            } | null;
                            /** Format: uuid */
                            id: string;
                            rate: {
                                date: string;
                                rate: string;
                                source: string;
                            } | null;
                            /** @enum {string} */
                            side: "outflow" | "inflow";
                        } | null;
                        /** @enum {string} */
                        type: "income" | "expense";
                        version: number;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN), or the request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The account is closed (ACCOUNT_CLOSED); The record was changed by someone else; reload it and try again (VERSION_CONFLICT) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    summarizeTransactionSelection: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    ids: string[];
                };
            };
        };
        responses: {
            /** @description Transactions outside the caller's space are left out without a word; «приблизно» and «N транзакцій за найближчим курсом» when a rate of the date is missing */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        approximate: boolean;
                        convertedCount: number;
                        count: number;
                        currency: string;
                        nearestRateCount: number;
                        noRateCount: number;
                        sum: {
                            amount: string;
                            currency: string;
                        } | null;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN), or the request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    createTransfer: {
        parameters: {
            query?: never;
            header?: {
                /** @description Repeating a create with the same key and the same request returns the first response (kept 24 h); the same key with another request is 409. */
                "Idempotency-Key"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    amount: {
                        /** @description A positive plain decimal, e.g. 120.50 */
                        amount: string;
                        /** @description ISO 4217 code; the account's (subaccount's) currency */
                        currency: string;
                    };
                    counterparty?: string | null;
                    /** @description YYYY-MM-DD; never after today */
                    date: string;
                    description?: string | null;
                    /** Format: uuid */
                    fromAccountId: string;
                    received?: {
                        /** @description A positive plain decimal, e.g. 120.50 */
                        amount: string;
                        /** @description ISO 4217 code; the account's (subaccount's) currency */
                        currency: string;
                    };
                    /** Format: uuid */
                    toAccountId: string;
                };
            };
        };
        responses: {
            /** @description The transfer's two transactions: the debit and the credit */
            201: {
                headers: {
                    /** @description true when this is the stored response of an earlier request with the same key */
                    "Idempotent-Replayed"?: "true";
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        inflow: {
                            /** Format: uuid */
                            accountId: string;
                            amount: {
                                amount: string;
                                currency: string;
                            };
                            counterparty: string | null;
                            date: string;
                            description: string | null;
                            hidden: boolean;
                            /** Format: uuid */
                            id: string;
                            mergedDuplicates: string[];
                            mergedInto: string | null;
                            note: string | null;
                            recordedAt: string;
                            review: ("queued" | "confirmed") | null;
                            /** @enum {string} */
                            source: "manual" | "imported";
                            split: {
                                /** @enum {string} */
                                mode: "categories" | "months";
                                needsReview: boolean;
                                parts: {
                                    amount: {
                                        amount: string;
                                        currency: string;
                                    };
                                    /** Format: uuid */
                                    categoryId: string;
                                    month: string | null;
                                }[];
                            } | null;
                            /** @enum {string} */
                            status: "posted" | "pending";
                            tags: {
                                /** Format: uuid */
                                id: string;
                                name: string;
                            }[];
                            transfer: {
                                /** Format: uuid */
                                counterpartId: string;
                                date: string;
                                fee: {
                                    amount: string;
                                    currency: string;
                                } | null;
                                /** Format: uuid */
                                id: string;
                                rate: {
                                    date: string;
                                    rate: string;
                                    source: string;
                                } | null;
                                /** @enum {string} */
                                side: "outflow" | "inflow";
                            } | null;
                            /** @enum {string} */
                            type: "income" | "expense";
                            version: number;
                        };
                        outflow: {
                            /** Format: uuid */
                            accountId: string;
                            amount: {
                                amount: string;
                                currency: string;
                            };
                            counterparty: string | null;
                            date: string;
                            description: string | null;
                            hidden: boolean;
                            /** Format: uuid */
                            id: string;
                            mergedDuplicates: string[];
                            mergedInto: string | null;
                            note: string | null;
                            recordedAt: string;
                            review: ("queued" | "confirmed") | null;
                            /** @enum {string} */
                            source: "manual" | "imported";
                            split: {
                                /** @enum {string} */
                                mode: "categories" | "months";
                                needsReview: boolean;
                                parts: {
                                    amount: {
                                        amount: string;
                                        currency: string;
                                    };
                                    /** Format: uuid */
                                    categoryId: string;
                                    month: string | null;
                                }[];
                            } | null;
                            /** @enum {string} */
                            status: "posted" | "pending";
                            tags: {
                                /** Format: uuid */
                                id: string;
                                name: string;
                            }[];
                            transfer: {
                                /** Format: uuid */
                                counterpartId: string;
                                date: string;
                                fee: {
                                    amount: string;
                                    currency: string;
                                } | null;
                                /** Format: uuid */
                                id: string;
                                rate: {
                                    date: string;
                                    rate: string;
                                    source: string;
                                } | null;
                                /** @enum {string} */
                                side: "outflow" | "inflow";
                            } | null;
                            /** @enum {string} */
                            type: "income" | "expense";
                            version: number;
                        };
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN), or the request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The idempotency key was used for another request, or that request is still running; The account is closed (ACCOUNT_CLOSED) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    listTransferProposals: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The proposals, newest first; «Підтвердити» is POST /v1/transactions/{outflow}/transfer with the inflow */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        count: number;
                        items: {
                            converted: {
                                amount: string;
                                currency: string;
                            } | null;
                            date: string;
                            difference: {
                                amount: string;
                                currency: string;
                            } | null;
                            fee: {
                                amount: string;
                                currency: string;
                            } | null;
                            inflow: {
                                /** Format: uuid */
                                accountId: string;
                                amount: {
                                    amount: string;
                                    currency: string;
                                };
                                date: string;
                                /** Format: uuid */
                                transactionId: string;
                            };
                            /** @enum {string} */
                            kind: "same-currency" | "cross-currency";
                            outflow: {
                                /** Format: uuid */
                                accountId: string;
                                amount: {
                                    amount: string;
                                    currency: string;
                                };
                                date: string;
                                /** Format: uuid */
                                transactionId: string;
                            };
                            rate: {
                                date: string;
                                rate: string;
                                source: string;
                            } | null;
                        }[];
                        more: boolean;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
}
