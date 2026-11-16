# Модуль budget

**Створено:** 2026-11-13 · **Оновлено:** 2026-11-16 (BUD-02@PoC a: бюджет, ліміти, «Поза планом», рахунки бюджету, знімок періоду)

Картка модуля (ARC-01). Робота з модулем починається з неї; оновлюйте її в тому ж PR, що й інтерфейс.

## Призначення

Бюджети, періоди, «Можна витратити», методи бюджетування.

Домен каталогу ARC-01: Бюджет. Реліз, з якого модуль у каталозі: PoC.

## Вимоги

BUD-02@PoC a) (хвиля 2, рядок 29 — серверна частина): п. 1 (один бюджет простору у валюті звітності), 4 і 6 (період —
календарний місяць), 5 (перший період — поточний або наступний місяць; пропорційний — рядок 30), 7 і 8 (ліміт діє з
поточного періоду, без перенесення залишку; без ліміту — «Поза планом»), 9 (серверна частина: план і факт доходу,
ліміт, витрачено, залишок, «Поза планом», підсумки), 10 (рахунки бюджету), 11 (знімок завершеного періоду), 12 (що
враховує бюджет), 13 (видалення); AC2, AC3, AC4, AC5, AC16, AC12–AC14 (серверні частини); граничні випадки 4–6.
Далі: майстер — «За моїми витратами», нерегулярний дохід, пропорційний перший період (рядок 30); «Розподіл», план
майбутнього місяця, рядок підсумку, фільтр (рядок 31); UI (рядки 123–125).

Зрізи PoC, що ще називають модуль: BUD-03@PoC, BUD-06@PoC, BUD-16@PoC, BUD-17@PoC, FLW-34@PoC, FLW-35@PoC, FLW-37@PoC,
FLW-38@PoC, JRN-05@PoC, JRN-06@PoC.

## Публічний інтерфейс

`index.ts`:

- `budgetModule` — маршрути (прапорець випуску і ключ функції `budget.period`; простір — лише сесії; читання —
  `household.data.read`, зміни — `household.data.write`; учасник з областю: «бюджет і цілі» закриті політикою видимості
  за замовчуванням — читання й зміни 404, створення 403; ліміту плану немає):
  - `GET /v1/budget` (`getBudget`) → `{ budget }` або `{ budget: null }` (порожній стан): `id`, `currency`,
    `firstPeriod` (YYYY-MM), `incomePlan`, `limits` (`categoryId`, `amount`), `createdOn`, `version`.
  - `POST /v1/budget` (`createBudget`, `Idempotency-Key`) — `firstPeriod` (поточний або наступний місяць, інакше 400
    `firstPeriod: invalid`), `incomePlan` (типово 0), `limits` (до 300). Ліміт — активна категорія витрат простору (400
    `limits.<i>.categoryId`: `not_found`, `not_expense`, `hidden`, `duplicate`), ≥ 0 у валюті бюджету (`limits.<i>.amount`:
    `invalid`, `….currency: currency`). Другий бюджет — 409 `BUDGET_EXISTS`. → 201 бюджет.
  - `PATCH /v1/budget/plan` (`updateBudgetPlan`) — `version`, `incomePlan`, `limits` (`amount` null прибирає ліміт).
    Інша версія — 409 `VERSION_CONFLICT` (`currentVersion`). Зміна діє з поточного періоду; завершені періоди
    спершу отримують знімок. Без змін — нічого. → 200 бюджет.
  - `DELETE /v1/budget` (`deleteBudget`) — з лімітами, вибором рахунків і знімками. → `{ deleted: true }`.
  - `GET /v1/budget/accounts` (`listBudgetAccounts`) → `accounts`: `accountId`, `kind`, `status`, `included` (типово —
    поточні, кредитні картки, готівка).
  - `PUT /v1/budget/accounts/{accountId}` (`setBudgetAccount`) — `{ included }`; рахунок іншого простору — 404.
  - `GET /v1/budget/periods/{period}` (`getBudgetPeriod`) — `mode` (`past`: план зі знімка — записується під час
    першого перегляду — проти живого факту; `current`; `future`: лише план), `incomePlan`, `plannedSavings` (0 до
    рядка 31), `incomeActual`, `groups` (категорії з лімітом за групами в порядку дерева: `limit`, `spent`, `remaining`,
    `mandatory`), `outsidePlan` (`categories` — `categoryId`, null — «Без категорії»; `total`), `totals`,
    `approximate` (`nearestRateCount`, `unavailableCount`). До першого періоду — 404 `BUDGET_PERIOD_BEFORE_START`.
- `createBudgetServices({ categories, accounts, transactions, categorization, fx, audit, clock, newId })` →
  `BudgetServices` — порти маршрутів (`src/api.ts` → `ctx.services`; `main.ts`): `CategoryDirectory.categories`
  (categories), `AccountList` (accounts), `BudgetTransactions` (transactions), `TransactionCategories`
  (categorization), `FxReporting.total` (fx-rates); «сьогодні» — дата за Києвом; валюта — `SPACE_REPORTING_CURRENCY`.
- `createBudgetCategoryUsage(db)` → `CategoryUsage` модуля categories (BUD-01 п. 12): категорії з лімітом (`src/main.ts`).
- `createBudgetWorkerQueue(db, audit)` (`src/wiring.ts`); `createBudgetHandOffRecovery(db, households)` — щоденне
  повернення задач `dead` (`budget.hand-off-recovery`, до очищення черги; WARN `budget.hand_off_requeued`); `HAND_OFF_JOB`.
- `createBudgetErasure(db)` → `eraseHousehold(householdId)` → `{ budgets, snapshots, jobs }` — лише для `data-erasure`
  (крок `budget.records`).
- `DEFAULT_BUDGET_KINDS`.

Що враховує період (п. 12, бізнес-правила): транзакції рахунків бюджету з датою в місяці, і «Очікує»; без прихованих,
злитих дублів і сторін переказу; розділена — частинами (частка «На кілька місяців» — у своєму місяці). Категорія витрат
— витрати мінус повернення; категорія доходу — дохід; службові — ні те, ні те; без категорії: витрата — «Без категорії»
в «Поза планом», надходження не враховується. Суми — у валюті бюджету за курсом дати (найближчий — «приблизно»; без
курсу — поза сумою). Об'єднана категорія рахується в ту, куди її об'єднали.

Порядок однієї зміни: дерево категорій прочитано (пул `categories`) → у транзакції `budget` рядок бюджету під
блокуванням (версія), знімки завершених періодів, рядки й задача `budget.hand-off` → коміт → запис аудиту.

## Передача аудиту (ARC-04 п. 2–4, ADR-0015)

Кожна зміна (`budget.budget`: `create`, `update` — `incomePlan`, `delete`; `budget.limit` з ідентифікатором категорії:
`create`, `update`, `delete` — `categoryId`, `amount`; `budget.account` з ідентифікатором рахунку: `update` — `included`)
пише рядок і задачу `budget.hand-off` в одній транзакції модуля; запис аудиту — після коміту одразу, а якщо не вдалося
(WARN `budget.hand_off_deferred`) — воркером. Ключ — `<сутність>:<дія>:<ідентифікатор>:<зміна>`. Задача `dead` після 8
спроб щодня повертається в чергу. Знімок періоду — не зміна користувача, аудиту не має.

## Залежності

Шар: process. Модулі: accounts, audit, categories, categorization, fx-rates, household, transactions
(`apps/api/module-rules.json`). Платформа: черга задач (ARC-04).

## Події

| Публікує | Версія | Коли |
| --- | --- | --- |
| — | | |

| Споживає | Версія | Навіщо |
| --- | --- | --- |
| — | | |

## Власні таблиці

Схема `budget`; міграції — `adapters/db/migrations/NNNN_slug.sql`. Усі під політикою простору.

| Таблиця | Що |
| --- | --- |
| `budgets` | Бюджет: валюта, `first_period`, `income_plan`, `created_on`, версія; UNIQUE (`household_id`) — один на простір (`0001_budget.sql`) |
| `limits` | Ліміт категорії витрат (непрозорий ідентифікатор категорії `categories`) і його валюта; без рядка — «Поза планом» |
| `budget_accounts` | Рахунок (`accounts`), перемкнений проти типового; ключ — рахунок: не більше одного бюджету на рахунок |
| `period_snapshots` | Знімок завершеного періоду: план доходу, заплановані заощадження, ліміти з «обов'язкова» (jsonb) |
| `idempotency_keys` | Ключі ідемпотентності створення (ARC-07 п. 4; `0002_idempotency_keys.sql`, дослівно) |
| `outbox_events`, `jobs` | Черга модуля (`0003_queue.sql`, таблиці платформи дослівно): задачі `budget.hand-off`; подій модуль не публікує |
