# Модуль budget

**Створено:** 2026-11-13 · **Оновлено:** 2026-11-20 (BUD-03@PoC d: EC5 — списане з цілі не зменшує суму, порт `GoalSpends`; «приблизно» для доходів, цілей і запланованих витрат; транзакція без курсу — `figures: null` з `unavailableCount`); 2026-11-20 (BUD-03@PoC c: «Можна витратити» — `GET /v1/budget/periods/{period}/spendable`, прапорець `budget.spendable`; `BudgetObligations` дає платіж, дату й прострочення списання і `incomeExpected`; `BudgetPlanSources.goals` — `contributed`); 2026-11-19 (BUD-17@PoC b: рішення власника Q2 — власні значення місяців зберігаються при зміні ліміту чи плану доходу; Q3 — «Інші надходження», `income.plan`, `income.other`; раніше BUD-17@PoC a: «План» — `GET /v1/budget/plan-grid`, `PUT /v1/budget/plan-grid/cells`, прапорець `budget.plan`, таблиця `plan_cells`, порт `BudgetPlanSources` над goals і debt-payoff; раніше BUD-06@PoC a: «Порівняння» — `GET /v1/budget/compare`, `GET /v1/budget/compare/year`, прапорець `budget.compare`; BUD-16@PoC a: метод «Ліміти», «План місяця» = сума лімітів, `GET /v1/budget/trend`; раніше #586: «Витрачено» — суми поза межами пропущено, ніколи не 500, `adapters/money-range.ts`; #567 і BUD-03@PoC a: порт `BudgetObligations` під'єднано — адаптер над recurring, accounts, liabilities, transactions; ядро розрахунку «Можна витратити»; раніше BUD-02@PoC c: «Розподіл» — смуга кроку лімітів, профіцит і дефіцит, покриття; рядок підсумку «Категорії»; «Очікувані платежі» місяця; порт `BudgetObligations`; раніше, 2026-11-16, b: майстер — «За моїми витратами», старт посеред періоду, пропорційний перший період; a: бюджет, ліміти, «Поза планом», рахунки бюджету, знімок періоду)

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
#567: джерела `BudgetObligations` під'єднано (`adapters/obligations.ts`, `src/main.ts`): регулярні списання місяця —
recurring (`RecurringMonth`), щомісячний платіж кредиту — accounts і liabilities, сплачений — transactions
(`AccountPayments`); null лише без курсу або понад 15 цифр цілої частини. Минулий місяць порту не питає.
BUD-03@PoC a) (рядок 34, ядро розрахунку): `spendable` (`domain/spendable.ts`) — п. 2–6, 10, 14, 15 (сума, денний
ліміт, перевитрата з основою відтінку, 5 рядків міні-розбивки).
BUD-03@PoC c) (перед рядком 126, серверна частина): маршрут `GET /v1/budget/periods/{period}/spendable` — п. 1–6, 8, 10,
14, 15 (сума, денний ліміт, перевитрата з основою відтінку `over-1`…`over-8`, дохід — план, факт, очікуваний,
«очікується»; 5 рядків картки і повна розбивка: регулярні платежі з платежем, датою і простроченням, кредити, внески в
цілі за «Планом» мінус внесене цього місяця, заплановані витрати плану погашення, обов'язкові категорії); AC1–AC9
(серверні частини), граничні випадки 1, 2, 4. Дата щомісячного платежу кредиту в розбивці, «Витратити з цілі» (граничний
випадок 5) і UI картки (рядок 126) — далі (follow-ups PR).
BUD-16@PoC a) (рядок 32, серверна частина): п. 1 (метод лише «Ліміти» — не зберігається, не обирається), 2 (без
перенесення), 4 («План місяця» = сума лімітів місяця, завершений — зі знімка; без історії методів і позначок зміни),
5 (лише факти); AC1 (серверна частина). UI «Тренду» — рядок 133.
BUD-06@PoC a) (рядок 36, серверна частина): п. 1 (типи періоду без «Власний» (MVP, #606), бази за типом, таблиця категорій: поточна сума, «План»
за знімком і «± до плану», база й різниця однією зміною — сума, відсоток, стрілка, колір «краще / гірше» з кроком 10 % і
«без змін»), 2 і 3 (та сама дата, «Повний попередній період», дні 29–31), 4 (середнє за завершені цілі місяці з даними після
початку історії, «за N міс.»; без «Одноразових витрат» — коли з'явиться позначка, п. 8), 5 (база минулого року лише з
даними там), 6 (сортування за абсолютною різницею, три найбільші зміни з кількістю транзакцій; тексти — на сторінці), 11
(«Рік: план і факт»), бізнес-правила; AC1, AC2, AC5–AC11, AC13–AC15 (серверні частини), граничні випадки 1–3. UI —
рядок 132; п. 8 і AC4 («Одноразова витрата»), п. 9 («з цілі») — далі (follow-ups PR).
BUD-17@PoC a) (рядок 35, серверна частина): п. 1 (сітка поточного й 11 наступних місяців: «Надходження» — «План доходу» (введений
план доходу місяця, типово — BUD-02), регулярні доходи місяця (recurring) і «Інші надходження» = «План доходу» − регулярні
доходи, доки вони менші; план доходу місяця — більше з двох (рішення власника 2026-11-19, Q3); «Витрати» — ліміти активних категорій за групами; «Цілі й
заощадження» — внесок кожної активної цілі, типово потрібний, до місяця її дати, і «Заощадження без цілі»; «Погашення
боргів» — мінімальні платежі `BudgetObligations` і додаткові платежі збережених планів, лише читання; «Не розподілено» /
«Дефіцит»), 2 (клітинка — власне значення місяця, діє лише на нього, і в знімку завершеного місяця; минулий — лише
читання), 3 (версія клітинки, 409 `VERSION_CONFLICT`), 4, 6; AC1–AC7, граничні випадки 1–2 (серверні частини). Зміна
ліміту чи плану доходу через `PATCH /v1/budget/plan` власних значень місяців не змінює (рішення власника 2026-11-19, Q2). UI — рядок 127; п. 5, 7, 8 — UI.
Далі: розбивка «Можна витратити» з внесками в цілі — BUD-03 (рядок 34) читає `plannedSavings` періоду; «Можна витратити в <місяць> ≈» — BUD-03 (рядок 34); UI (рядки 123–125).

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
    `approximate` (`nearestRateCount`, `unavailableCount` — також суми з понад 15 цифрами цілої частини, до чи після перерахунку; сума модулів понад 10^18 — пропущено всі, #586), `summary` (рядок підсумку, п. 19; null — майбутній місяць:
`spent` A, `limits` B, `overspend` `{amount, count}` — лише від'ємні залишки, `optionalLimits`, `mandatoryRemaining`,
`unpaidRecurring` (з несплаченими платежами кредитів), `mandatoryNeeded` D (лише обов'язкові категорії: залишок і їхні несплачені платежі), `free` E = B − A − D; три останні null без `BudgetObligations` або для минулого місяця),
`expectedPayments` (`categories` — `categoryId`, `amount`; `total`; null без `BudgetObligations`). До першого періоду —
404 `BUDGET_PERIOD_BEFORE_START`.
  - `GET /v1/budget/trend` (`getBudgetTrend`; прапорець випуску і ключ функції `budget.trend`) — `from`, `to` (YYYY-MM, до
    120 місяців; 400 `to: invalid`, `from: too_many_months`), `categoryId` (категорія витрат простору; 400 `not_found`,
    `not_expense`) → `currency`, `months` (`period`, `mode`, `plan` — сума лімітів місяця, завершений — зі знімка, з
    фільтром — ліміт категорії, null — до бюджету або без ліміту; `spent` — усі витрати, з «Поза планом» і «Без
    категорії», null — майбутній; `income`), `approximate` за всі місяці. Знімки завершених місяців — як у періоду.
  - `GET /v1/budget/compare` (`getBudgetCompare`; прапорець випуску і ключ функції `budget.compare`, вимагає
    `budget.period`) — `type` (`month`, `quarter`, `ytd`, `year`), `period` (YYYY-MM, YYYY-Qn, YYYY; `ytd` —
    типово цей рік, з 1 січня до сьогодні; минулий рік — до тієї самої дати, рішення власника 2026-11-19; рік від 1900), `base` (`previous`, `last-year`, `avg3`, `avg6`, `avg12`;
    типово `previous`, для `year` і `ytd` — `last-year`; інакше 400 `base: not_for_type`),
    `full` (база повністю). 400 `period`: `invalid`, `future`. Без бюджету — 404. →
    `currency`, `type`, `window` (до сьогодні, поки період триває; `ytd` минулого року — до тієї самої дати), `inProgress` (`false` для `ytd` минулого року, хоча вікно і база обрізані), `finished`, `year` (для «Рік: план і
    факт»), `finishedPeriods` (0 — порожній стан), `bases` (`available`, `reason` — `no_history` / `no_finished_periods`,
    `months` середнього), `base` (`window`, `months`, `full`), `expenses` і `income` (`overall` і `categories`:
    `current`, `plan` — сума `monthPlan` місяців вікна, null — «Поза планом»; `planDifference` — проти факту періоду бюджету (пропорційний перший — від `countsFrom`), `base`,
    `difference` — `amount`, `percent` (1 знак, null проти 0), `direction`, `tone`; `transactions`), `largest` (до 3),
    `approximate` (обидва вікна; суми поза межами — як #586).
  - `GET /v1/budget/compare/year` (`getBudgetCompareYear`, той самий прапорець) — `year` (YYYY) → `months` (12, `mode`),
    `income`, `groups` (у порядку дерева, «Без категорії» — `groupId` null, останньою) з `categories`, `expenses`:
    рядок — 12 `cells` (`fact`, null — майбутній; `plan`; `difference`), `total`, `plan`, `difference` за завершені
    місяці; `approximate`.
  - `GET /v1/budget/plan-grid` (`getBudgetPlanGrid`; прапорець випуску і ключ функції `budget.plan`, вимагає
    `budget.period`) → `currency`, `months` (12: `period`, `mode` — `current` / `future`, `inBudget` — false до першого
    періоду), `income` (`plan` — клітинки «План доходу», `lineId` null, у сумі не рахуються; `rows`: `paymentId` — регулярний
    дохід, клітинка з `expected`; `other` — «Інші надходження», null — немає; `totals` — більше з «План доходу» і
    регулярних доходів), `expenses` (`groups` →
    `categories`), `goals` (`rows` — `goalId`, клітинки з `required`; `savings`), `debts` (`rows` — `accountId`, клітинки
    `minimum`, `extra`), кожен розділ із `totals` (null — суми немає: без курсу); клітинка — `amount` (null — порожня),
    `own` (власне значення місяця), `version`; `unallocated` — `kind` `unallocated` / `deficit` і `amount` (модуль), null
    без суми розділу. Без бюджету — 404.
  - `PUT /v1/budget/plan-grid/cells` (`setBudgetPlanCell`, той самий прапорець) — `period` (поточний або один з 11
    наступних; 400 `period`: `past`, `too_far`; до першого періоду — 404 `BUDGET_PERIOD_BEFORE_START`), `kind` (`income`,
    `limit`, `goal`, `savings`), `lineId` (категорія витрат, регулярний дохід, очікуваний у місяці, ціль; null — «План доходу» (будь-який місяць) чи
    «Заощадження без цілі»; 400 `lineId`: `not_found`, `not_expense`, `hidden`, `required`,
    `invalid`), `amount` (null — до типового),
    `version` (0 — власного значення ще не було; інша — 409 `VERSION_CONFLICT` з `currentVersion`) → `amount`, `version`.
    Під блокуванням рядка бюджету; те саме значення нічого не пише. Клітинка рядка, якого сітка вже не показує
    (закрита ціль, дохід, якого в місяці вже не очікують, прихована категорія), не враховується в плані періоду і знімку.
  - `GET /v1/budget/periods/{period}/spendable` (`getBudgetSpendable`; прапорець випуску і ключ функції
    `budget.spendable`, вимагає `budget.period`) — лише поточний місяць (інший — 400 `period: not_current`; без бюджету —
    404; до першого періоду — 404 `BUDGET_PERIOD_BEFORE_START`) → `period`, `currency`, `daysLeft` (з сьогодні),
    `figures` (null — джерело без суми, `unavailable`: `obligations`, `incomes`, `goals`, `plannedExpenses`; або
    транзакція періоду без жодного курсу — `approximate.unavailableCount` > 0, EC4): `amount`,
    `daily` (вниз до копійок; останній день — залишок; перевитрата чи ≤ 0 — 0), `overspend` (`amount` N, `base` — ліміти
    необов'язкових категорій для відтінку; null — немає), `income` (`plan` місяця, `actual`, `stillExpected` — регулярні
    доходи, що ще очікуються, `expected` = факт + вони, `value` — більше з плану й очікуваного, `pending` — «очікується»),
    `spent` (`total`, `limited`, `outsidePlan`), `regularPayments` (`items`: `recurring` — `paymentId`, `categoryId`,
    `dueOn`, `overdueDays`; `loan` — `accountId`; `total`), `goals` (`items` — `goalId`, `planned` за «Планом», типово
    потрібний, `contributed` цього місяця, `amount` = max(0, різниця); `total`), `plannedExpenses` (`items` — `accountId`;
    `total`), `mandatory` (`categories` — ще потрібно; `total`), `mini` (5 рядків: `income`, `spent`, `regular`,
    `goals` — з запланованими витратами, `mandatory`); `approximate` (`nearestRateCount`, `unavailableCount` — як у
    періоду; `obligations` — платіж за найближчим курсом; `incomes`, `goals`, `plannedExpenses` — дохід, що ще очікується, чи план доходу з регулярних доходів,
    сума цілі чи запланована витрата за найближчим курсом). Заплановані заощадження (п. 10, бюджет без лімітів) —
    заплановані внески в цілі й «Заощадження без цілі» «Плану». EC5: транзакції, списані з цілі («Витратити з цілі»),
    сума не враховує зовсім (BUD-05 п. 8); «Бюджет», «Порівняння» і знімок їх рахують.
- `createBudgetServices({ categories, accounts, transactions, categorization, fx, audit, clock, newId, obligations?, planSources?, goalSpends? })` →
  `BudgetServices` — порти маршрутів (`src/api.ts` → `ctx.services`; `main.ts`): `CategoryDirectory.categories`
  (categories), `AccountList` (accounts), `BudgetTransactions` (transactions), `TransactionCategories`
  (categorization), `FxReporting.total` (fx-rates); «сьогодні» — дата за Києвом; валюта — `SPACE_REPORTING_CURRENCY`;
  `BudgetTransactions.firstDate` (transactions) — початок історії для середніх і бази минулого року (BUD-06);
  `obligations` — `BudgetObligations.month(householdId, period, currency, from?)` → `PeriodObligations` або null
  (`recurring`: `categoryId`, `amount`, `paid`, `paymentId`, `dueOn`, `overdueDays`; `incomeExpected` — регулярні доходи
  місяця, що ще очікуються, null — без курсу; `debtMinimums`: `accountId`, `amount`, `paid` — щомісячний платіж
  кредиту, лише тут, не в `recurring`; `approximate`; `incomeApproximate`; суми у валюті бюджету за сьогоднішнім курсом);
  `goalSpends` — `GoalSpends` (goals): `BudgetReads.amounts(…, { withoutGoalSpends: true })` лишає поза сумою
  «Можна витратити» транзакції, списані з цілі (без нього — тестовий сервер — жодної).
- `createBudgetPlanSources({ goals, debts, fx, recurring?, planEnabled? })` → `BudgetPlanSources` (`src/main.ts`): `GoalPlans` (goals:
  активні цілі з потрібним внеском, датою і внесеним цього місяця — `contributed`; `requiredApproximate`,
  `contributedApproximate` — за найближчим курсом), `DebtPlannedExpenses` (debt-payoff: додаткові платежі місяця),
  `RecurringMonth` (recurring: очікувані регулярні доходи місяця за платежами; без нього — жодного; `planEnabled` —
  прапорець `budget.plan` простору: доки вимкнено, доходів не читають і план доходу місяця — «План доходу» BUD-02), `FxReporting.total`
  (fx-rates: інша валюта — за сьогоднішнім курсом; без курсу чи понад 15 цифр цілої частини — null).
- `createBudgetObligations({ recurring, credit, liabilities, payments, fx })` → `BudgetObligations` (`src/main.ts`):
  `RecurringMonth` (recurring), `CreditAccounts` (accounts), `Liabilities.forAccount` (liabilities), `AccountPayments`
  (transactions), `FxReporting.total` (fx-rates); `OBLIGATION_MAX_INTEGER_DIGITS` = 15.
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
`create`, `update`, `delete` — `categoryId`, `amount`; `budget.account` з ідентифікатором рахунку: `update` — `included`; `budget.plan-cell` з ідентифікатором рядка — категорії, цілі або бюджету для рядка без власного:
`create`, `update`, `delete` — `period`, `kind`, `amount`)
пише рядок і задачу `budget.hand-off` в одній транзакції модуля; запис аудиту — після коміту одразу, а якщо не вдалося
(WARN `budget.hand_off_deferred`) — воркером. Ключ — `<сутність>:<дія>:<ідентифікатор>:<зміна>`. Задача `dead` після 8
спроб щодня повертається в чергу. Знімок періоду — не зміна користувача, аудиту не має.

## Залежності

Шар: process. Модулі: accounts, audit, categories, categorization, debt-payoff, fx-rates, goals, household, liabilities,
recurring, transactions
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
| `plan_cells` | Власне значення місяця одного рядка «Плану» (BUD-17): `kind`, `line_id` (нульовий — рядок без власного), `amount` (null — до типового), `version` (`0005_plan_cells.sql`) |
| `period_snapshots` | Знімок завершеного періоду: план доходу, заплановані заощадження, ліміти з «обов'язкова» (jsonb) |
| `idempotency_keys` | Ключі ідемпотентності створення (ARC-07 п. 4; `0002_idempotency_keys.sql`, дослівно) |
| `outbox_events`, `jobs` | Черга модуля (`0003_queue.sql`, таблиці платформи дослівно): задачі `budget.hand-off`; подій модуль не публікує |

Синтетичні дані: `synthetic.ts` (бюджет простору з 3 лімітами, перемкнений рахунок, знімки завершених місяців, виконані задачі передачі).
