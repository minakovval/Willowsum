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
        /** «Видалити» a transaction entered by hand: its postings are reversed, the balance is as before (FR 16); a hidden copy whose pair it was is shown again (FR 35) */
        delete: operations["deleteTransaction"];
        options?: never;
        head?: never;
        /** «Зберегти» of the edit form: the fields sent change; the account, amount or date correct the journal event; a hidden copy whose pair this ends is shown again (FIN-03 FR 35) */
        patch: operations["updateTransaction"];
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
            code: "VALIDATION_FAILED" | "MALFORMED_REQUEST" | "INVALID_CURSOR" | "UNAUTHENTICATED" | "SESSION_ENDED" | "INVALID_CREDENTIALS" | "CAPTCHA_REQUIRED" | "PLAN_LIMIT_REACHED" | "FORBIDDEN" | "ORIGIN_NOT_ALLOWED" | "NOT_FOUND" | "RESET_LINK_INVALID" | "NOT_ME_LINK_INVALID" | "PASSWORD_RESET_REQUIRED" | "STEP_UP_PASSWORD_INVALID" | "STEP_UP_REQUIRED" | "IDEMPOTENCY_KEY_REUSED" | "IDEMPOTENCY_REQUEST_IN_PROGRESS" | "VERSION_CONFLICT" | "ACCOUNT_DUPLICATE" | "ACCOUNT_CLOSED" | "ACCOUNT_NOT_CLOSED" | "ACCOUNT_BALANCE_NOT_ZERO" | "ACCOUNT_ACTIVITY_AFTER_CLOSE" | "ACCOUNT_KIND_OTHER_GROUP" | "ACCOUNT_HAS_TRANSACTIONS" | "ACCOUNT_MAIN_CURRENCY" | "ACCOUNT_CURRENCY_HAS_TRANSACTIONS" | "CATEGORY_NAME_TAKEN" | "CATEGORY_KINDS_DIFFER" | "CATEGORY_SERVICE_FIXED" | "CATEGORY_SYSTEM_FIXED" | "CATEGORY_NOT_EMPTY" | "GOAL_ACCOUNT_TAKEN" | "GOAL_ENVELOPES_OVER_BALANCE" | "GOAL_OWN_ACCOUNT" | "GOAL_SPEND_OVER_COLLECTED" | "DEBT_NOT_DECREASING" | "DEBT_OVER_LIMIT" | "BULK_ACTION_RUNNING" | "BULK_UNDO_UNAVAILABLE" | "BULK_ACTION_NOT_INTERRUPTED" | "TRANSACTION_IN_TRANSFER" | "TRANSACTION_MERGED" | "TRANSACTION_HAS_DUPLICATES" | "TRANSACTION_SPLIT" | "MERCHANT_MERGED" | "TRANSACTION_NOT_HIDEABLE" | "PAYLOAD_TOO_LARGE" | "UNSUPPORTED_MEDIA_TYPE" | "LIMIT_REACHED" | "RATE_LIMITED" | "SIGN_IN_LOCKED" | "INTERNAL" | "MODULE_UNAVAILABLE" | "SERVICE_UNAVAILABLE";
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
            /** @description The account is closed (ACCOUNT_CLOSED); The balance on the closing date is not zero (ACCOUNT_BALANCE_NOT_ZERO); The account has movements after the closing date (ACCOUNT_ACTIVITY_AFTER_CLOSE) */
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
            /** @description The account is closed (ACCOUNT_CLOSED); The account has movements after the closing date (ACCOUNT_ACTIVITY_AFTER_CLOSE) */
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
                        features: ("accounts.manual" | "household.core" | "household.space-settings" | "identity.sign-in" | "identity.profile" | "transactions.manual" | "transactions.states" | "transactions.transfers" | "transactions.duplicates" | "transactions.attributes" | "categories.tree" | "data.bulk_actions" | "transactions.merchants" | "goals.savings" | "debts.payoff")[];
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
                            recordedAt: string;
                            /** @enum {string} */
                            source: "manual";
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
                        recordedAt: string;
                        /** @enum {string} */
                        source: "manual";
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
                        recordedAt: string;
                        /** @enum {string} */
                        source: "manual";
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
                        recordedAt: string;
                        /** @enum {string} */
                        source: "manual";
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
                        categoryId: string | null;
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
                        categoryId: string | null;
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
                        recordedAt: string;
                        /** @enum {string} */
                        source: "manual";
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
                        recordedAt: string;
                        /** @enum {string} */
                        source: "manual";
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
                        recordedAt: string;
                        /** @enum {string} */
                        source: "manual";
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
                        recordedAt: string;
                        /** @enum {string} */
                        source: "manual";
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
                        recordedAt: string;
                        /** @enum {string} */
                        source: "manual";
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
                        recordedAt: string;
                        /** @enum {string} */
                        source: "manual";
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
                        recordedAt: string;
                        /** @enum {string} */
                        source: "manual";
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
                        recordedAt: string;
                        /** @enum {string} */
                        source: "manual";
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
                        recordedAt: string;
                        /** @enum {string} */
                        source: "manual";
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
