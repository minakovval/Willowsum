# Модуль budget

**Створено:** 2026-11-13 · **Оновлено:** 2026-11-19 (BUD-02@PoC c: «Розподіл» — смуга кроку лімітів, профіцит і дефіцит, покриття; рядок підсумку «Категорії»; «Очікувані платежі» місяця; порт `BudgetObligations`; раніше, 2026-11-16, b: майстер — «За моїми витратами», старт посеред періоду, пропорційний перший період; a: бюджет, ліміти, «Поза планом», рахунки бюджету, знімок періоду)

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
BUD-02@PoC b) (рядок 30 — серверна частина майстра): п. 2 і 3 («Створити за моїми витратами»: доступність, середнє за
3 міс. з округленням до 10, план доходу; нижня смуга кроку лімітів — рядок 31), 5 і 14 (старт посеред періоду,
пропорційний перший період); AC1, AC15 (серверні частини); граничні випадки 1–3.
BUD-02@PoC c) (рядок 31 — серверна частина): п. 3 (нижня смуга кроку лімітів «не розподілено N»), 15 (профіцит і
дефіцит «Розподілу», сума обраних варіантів проти N), 16 (майбутній місяць: «Очікувані платежі»), 19 (рядок підсумку з
4 чисел), 20 (фільтр — лише таблиця на клієнті, сервер його не знає); AC6, AC7, AC8, AC9 (серверні частини).
Далі: джерела `BudgetObligations` (регулярні платежі місяця — recurring, мінімальні платежі — debt-payoff) разом із
BUD-03 (рядок 34) — доти «Розподіл», «Ще потрібно на обов'язкові», «Вільний залишок» і «Очікувані платежі» — null;
запис розподілу (внески в цілі, «Заощадження без цілі», додатковий платіж за боргом) і ліміти окремого місяця — з
BUD-17 (рядок 35); «Можна витратити в <місяць> ≈» — BUD-03 (рядок 34); UI (рядки 123–125).

Зрізи PoC, що ще називають модуль: BUD-03@PoC, BUD-06@PoC, BUD-16@PoC, BUD-17@PoC, FLW-34@PoC, FLW-35@PoC, FLW-37@PoC,
FLW-38@PoC, JRN-05@PoC, JRN-06@PoC.

## Публічний інтерфейс

`index.ts`:

- `budgetModule` — маршрути (прапорець випуску і ключ функції `budget.period`; простір — лише сесії; читання —
  `household.data.read`, зміни — `household.data.write`; учасник з областю: «бюджет і цілі» закриті політикою видимості
  за замовчуванням — читання й зміни 404, створення 403; ліміту плану немає):
  - `GET /v1/budget` (`getBudget`) → `{ budget }` або `{ budget: null }` (порожній стан): `id`, `currency`,
    `firstPeriod` (YYYY-MM), `proportional` (`from`, `to`, `days`, `daysInPeriod` або null), `incomePlan`, `limits` (`categoryId`, `amount`), `createdOn`, `version`.
  - `GET /v1/budget/wizard` (`getBudgetWizard`) — лише читання: `today`, `midPeriod` (false першого числа), `starts`
    (`period-start`, `next-period`, `proportional` з `days`/`daysInPeriod`; жоден не типовий), `fromSpending`
    (`available` — ≥ 3 повних місяців категоризованих транзакцій поспіль, `historyMonths`, `incomePlan`,
    `incomeIrregular`, `categories` — `categoryId`, `average` за 3 міс., `limit` — до 10, половина вгору; null — менше 5).
    Рахує, як період (п. 12), рахунки, що ввійшли б у бюджет.
  - `POST /v1/budget/allocation` (`previewBudgetAllocation`) — лише розрахунок, нічого не зберігає: тіло як у
    `createBudget` (`firstPeriod`, `proportional`, `incomePlan`, `limits`) і `chosen` (до 100 сум, обраних на кроці) →
    `period`, `incomePlan` і `limits` (сума; пропорційний — × частку днів), `balance` (`recurringOutsideLimits`,
    `unallocated` — смуга кроку лімітів, `debtMinimums`, `difference`, `kind` — `surplus` / `deficit` / `balanced`,
    `amount` = |difference|; null без `BudgetObligations`), `choice` (`chosen`, `rest` = N − chosen, `status` —
    `short` / `exact` / `over`; дефіцит покрито лише при `exact`; null без `chosen` або `balance`). Помилки — як у
    `createBudget` (`chosen.<i>`: `invalid`, `….currency: currency`).
  - `POST /v1/budget` (`createBudget`, `Idempotency-Key`) — `firstPeriod` (поточний або наступний місяць; першого числа —
    лише поточний; інакше 400 `firstPeriod: invalid`), `proportional` (true — поточний місяць від сьогодні, не першого
    числа; інакше 400 `proportional: invalid`), `incomePlan` (типово 0), `limits` (до 300). Ліміт — активна категорія витрат простору (400
    `limits.<i>.categoryId`: `not_found`, `not_expense`, `hidden`, `duplicate`), ≥ 0 у валюті бюджету (`limits.<i>.amount`:
    `invalid`, `….currency: currency`). Другий бюджет — 409 `BUDGET_EXISTS`. → 201 бюджет.
  - `PATCH /v1/budget/plan` (`updateBudgetPlan`) — `version`, `incomePlan`, `limits` (`amount` null прибирає ліміт).
    Інша версія — 409 `VERSION_CONFLICT` (`currentVersion`). Зміна діє з поточного періоду; завершені періоди
    спершу отримують знімок. Без змін — нічого. → 200 бюджет.
  - `DELETE /v1/budget` (`deleteBudget`) — з лімітами, вибором рахунків і знімками. → `{ deleted: true }`.
  - `GET /v1/budget/accounts` (`listBudgetAccounts`) → `accounts`: `accountId`, `kind`, `status`, `included` (типово —
    поточні, кредитні картки, готівка).
  - `PUT /v1/budget/accounts/{accountId}` (`setBudgetAccount`) — `{ included }`; рахунок іншого простору — 404.
  - `GET /v1/budget/periods/{period}` (`getBudgetPeriod`) — `proportional` (пропорційний перший період: план уже × частку
    днів, витрати — від `from`; інакше null), `mode` (`past`: план зі знімка — записується під час
    першого перегляду — проти живого факту; `current`; `future`: лише план), `incomePlan`, `plannedSavings` (0 до
    рядка 31), `incomeActual`, `groups` (категорії з лімітом за групами в порядку дерева: `limit`, `spent`, `remaining`,
    `mandatory`), `outsidePlan` (`categories` — `categoryId`, null — «Без категорії»; `total`), `totals`,
    `approximate` (`nearestRateCount`, `unavailableCount`), `summary` (рядок підсумку, п. 19; null — майбутній місяць:
`spent` A, `limits` B, `overspend` `{amount, count}` — лише від'ємні залишки, `optionalLimits`, `mandatoryRemaining`,
`unpaidRecurring`, `mandatoryNeeded` D, `free` E = B − A − D; три останні null без `BudgetObligations`),
`expectedPayments` (`categories` — `categoryId`, `amount`; `total`; null без `BudgetObligations`). До першого періоду —
404 `BUDGET_PERIOD_BEFORE_START`.
- `createBudgetServices({ categories, accounts, transactions, categorization, fx, audit, clock, newId, obligations? })` →
  `BudgetServices` — порти маршрутів (`src/api.ts` → `ctx.services`; `main.ts`): `CategoryDirectory.categories`
  (categories), `AccountList` (accounts), `BudgetTransactions` (transactions), `TransactionCategories`
  (categorization), `FxReporting.total` (fx-rates); «сьогодні» — дата за Києвом; валюта — `SPACE_REPORTING_CURRENCY`;
  `obligations` — `BudgetObligations.month(householdId, period, currency, from?)` → `PeriodObligations` (`recurring`:
  `categoryId`, `amount`, `paid`; `debtMinimums`: `accountId`, `amount`; суми у валюті бюджету); процес API його ще не
  під'єднує.
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
| `budgets` | Бюджет: валюта, `first_period`, `income_plan`, `created_on`, версія; UNIQUE (`household_id`) — один на простір (`0001_budget.sql`); `first_day` — день старту пропорційного першого періоду (`0004_proportional_start.sql`) |
| `limits` | Ліміт категорії витрат (непрозорий ідентифікатор категорії `categories`) і його валюта; без рядка — «Поза планом» |
| `budget_accounts` | Рахунок (`accounts`), перемкнений проти типового; ключ — рахунок: не більше одного бюджету на рахунок |
| `period_snapshots` | Знімок завершеного періоду: план доходу, заплановані заощадження, ліміти з «обов'язкова» (jsonb) |
| `idempotency_keys` | Ключі ідемпотентності створення (ARC-07 п. 4; `0002_idempotency_keys.sql`, дослівно) |
| `outbox_events`, `jobs` | Черга модуля (`0003_queue.sql`, таблиці платформи дослівно): задачі `budget.hand-off`; подій модуль не публікує |

Синтетичні дані: `synthetic.ts` (бюджет простору з 3 лімітами, перемкнений рахунок, знімки завершених місяців, виконані задачі передачі).
