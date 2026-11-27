# Модуль plan-catalog

**Створено:** 2026-11-06 · **Оновлено:** 2026-11-27 (BUD-21 a: `categorization.history-rules`); 2026-11-17 (BUD-12 a: `transactions.review`; FIN-03 п. 27: `transactions.history`; FIN-03 FR 30, FR 31: `categorization.suggestions`)

Картка модуля (ARC-01). Робота з модулем починається з неї; оновлюйте її в тому ж PR, що й інтерфейс.

## Призначення

Каталог функцій, матриця планів, версії матриці, перевірка впливу змін.

## Вимоги

ARC-07@PoC (перевірка плану на кожному маршруті), П-21, П-24 (механізм прав плану з PoC, у PoC усе ввімкнено).
Матрицю планів, версії і перевірку впливу змін додадуть вимоги SUB і ADM.

## Публічний інтерфейс

`index.ts`:

- `planCatalogModule` — опис модуля.
- `createEntitlements(source)` → `Entitlements` з `isEnabled(householdId, featureKey)`; джерело `all-enabled`
  (конфігурація `WS_PLAN_ENTITLEMENTS`, типово `all-enabled`) вмикає кожну функцію; ключ поза каталогом — помилка.
- `FEATURES` (ключ → що він вмикає), `FEATURE_KEYS`, `ENTITLEMENT_SOURCES`; типи `FeatureKey`, `EntitlementSource`.

Ключі функцій: `household.core` — робота з власним простором через API; `household.space-settings` — налаштування
простору (ACC-08@PoC: назва і перейменування); `identity.profile` — профіль і зміна пароля зі step-up (ACC-05@PoC; маршрути
без простору, тож план їх не обмежує). Ключі `household.space-settings` і `identity.profile` поки лише двійники прапорців випуску: маршрут налаштувань простору і
маршрути профілю їх як право не перевіряють (перевірка з'явиться разом із планами). `accounts.manual` — ручні рахунки (FIN-01@PoC: створення з початковим
залишком, кредитні картки й кредити, перевірка дубля); маршрути `/v1/accounts` перевіряють його як право; ліміту немає в
жодному плані (FIN-01 «Ліміти плану»). `transactions.manual` — ручні транзакції (FIN-03@PoC a: створення, зміна і
видалення через журнал, список з підсумками); маршрути `/v1/transactions` перевіряють його як право; ліміту немає. `categories.tree` — дерево категорій (BUD-01@PoC a: системне
дерево, власні групи й категорії, перейменування, приховування, об'єднання); маршрути `/v1/categories` і `/v1/category-groups`
перевіряють його як право; ліміту немає в жодному плані (BUD-01 «Ліміти плану»). `transactions.states` — «Очікує» і
приховані транзакції (FIN-03@PoC b; маршрути `/v1/transactions/{id}/hide`, `/show`), `transactions.attributes` — атрибути
транзакцій, поки розділення (BUD-13@PoC «Ліміти плану»: ключ «атрибути транзакцій»; `/v1/transactions/{id}/split`),
`transactions.transfers` — перекази між власними рахунками (FIN-03@PoC b; `/v1/transactions/{id}/transfer`,
`/v1/transfer-proposals`), `transactions.duplicates` — дублі транзакцій (FIN-03@PoC b; `/v1/duplicate-proposals`,
`/v1/transactions/{id}/merge`, `/not-duplicate`), ліміту немає; `data.bulk_actions` — масові дії зі списків (DAT-03@PoC a: підсумок, до 500
записів, фон, «Відмінити» 24 год); маршрути `/v1/bulk-actions` перевіряють його як право; ліміту немає (DAT-03 «Ліміти
плану»); `transactions.review` — розбір транзакцій (BUD-12@PoC a: «До розбору», `/v1/transaction-review`,
`/v1/transactions/{id}/review/*`, «Підтвердити категорії»); ліміту немає (BUD-12 «Ліміти плану»). `transactions.history` — «Історія змін» транзакції (FIN-03@PoC п. 27, `/v1/transactions/{id}/history`); ліміту немає. `categorization.suggestions` —
підказки категорії форми «Нова транзакція» (FIN-03@PoC FR 30, FR 31: `/v1/category-suggestions`); ліміту немає. `categorization.history-rules` — файл історії з розбором (BUD-21@PoC a: `/v1/import/history-files`); ліміту в PoC немає. Нові ключі додає вимога, що вводить
функцію; назв планів і лімітів у коді немає (AGENTS.md «Plans»). Відмова плану — 402 `PLAN_LIMIT_REACHED`.

## Залежності

Шар: platform. Модулі: — (`apps/api/module-rules.json`).

## Події

| Публікує | Версія | Коли |
| -------- | ------ | ---- |
| —        |        |      |

| Споживає | Версія | Навіщо |
| -------- | ------ | ------ |
| —        |        |        |

## Власні таблиці

Схема `plan_catalog`; міграції — `adapters/db/migrations/NNNN_slug.sql`. Таблиць поки немає.
