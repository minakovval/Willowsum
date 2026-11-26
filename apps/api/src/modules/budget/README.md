# Модуль budget

**Створено:** 2026-11-13 · **Оновлено:** 2026-11-26 (BUD-17@PoC п. 1, рядок 231, рішення власника 2026-11-21, 2 б: «Надходження» «Плану» — рядок на кожну категорію доходу плану бюджету, `income.categories` сітки, клітинка `income` з `lineId` категорії у валюті її плану; `income.plan`, `income.rows`, `income.other` — застарілі (ARC-07 п. 3, `x-deprecated-since` 2026-11-26); план доходу місяця й очікуваний дохід BUD-03 — сума рядків; регулярні доходи — не рядки: порт `BudgetPlanSources.incomes` прибрано, «приблизно» плану доходу з регулярних доходів (#651) більше немає; введений «План доходу» місяця перенесено в клітинки категорій, `0010_plan_income_categories.sql`; видалення категорії доходу прибирає і її клітинки; раніше того ж дня — BUD-02@PoC FR 1, FR 24, AC21, BUD-03@PoC і BUD-17@PoC бізнес-правила, рядок 223: «Валюта категорії» — ліміт і план доходу категорії у власній валюті (`limits.currency`, `income_plans.currency`), підсумки у валюті бюджету за курсом «сьогодні», завершений період — за курсом останнього дня в знімку (`period_snapshots.rates`, `0009_category_currency.sql`); порт `BudgetRates` над fx-rates (`adapters/plan-rates.ts`); поле `rates` у бюджеті, періоді, «Можна витратити» і «Плані»; рядок періоду і картка «Дохід» — у валюті категорії з `inBudgetCurrency`; клітинка категорії «Плану» — у валюті її ліміту; BUD-01@PoC п. 12, AC 22, рядок 221: ліміт, план доходу і клітинки «План» не тримають категорію — `createBudgetCategoryUsage(db, services)` з портом `limits` (`held`, `entries`, `release`), `releaseCategory`; індекс `plan_cells_line` (`0008_plan_cells_line.sql`)); 2026-11-21 (BUD-02@PoC i: «План доходу» за категоріями доходу — `incomePlans` у бюджеті, майстрі, `PATCH` і знімку, таблиця `income_plans` (`0007_income_plans.sql`), картка «Дохід» — `incomeCategories` періоду; округлення майстра до парного; бюджет з дефіцитом — `allocation` більше не відхиляє непокритий дефіцит; BUD-06@PoC п. 8: «Одноразова витрата» не входить у середні «Порівняння» і майстра — `oneOff` у `BudgetReads.window` і `amounts`); 2026-11-20 (FLW-38@PoC: «Підсумок періоду» — `GET /v1/budget/periods/{period}/summary`, прапорець `budget.summary`, порт `BudgetChargeHistory` над recurring; BUD-03@PoC d: EC5 — списане з цілі не зменшує суму, порт `GoalSpends`; «приблизно» для доходів, цілей і запланованих витрат; транзакція без курсу — `figures: null` з `unavailableCount`; BUD-02@PoC h: «Розподіл» зберігається з бюджетом — `allocation` у `POST /v1/budget` і `/allocation`, клітинки першого періоду, вид клітинки `debt` (`0006_plan_cell_debt.sql`), `spendable` у розрахунку; BUD-03@PoC c: «Можна витратити» — `GET /v1/budget/periods/{period}/spendable`, прапорець `budget.spendable`; `BudgetObligations` дає платіж, дату й прострочення списання і `incomeExpected`; `BudgetPlanSources.goals` — `contributed`); 2026-11-19 (BUD-17@PoC b: рішення власника Q2 — власні значення місяців зберігаються при зміні ліміту чи плану доходу; Q3 — «Інші надходження», `income.plan`, `income.other`; раніше BUD-17@PoC a: «План» — `GET /v1/budget/plan-grid`, `PUT /v1/budget/plan-grid/cells`, прапорець `budget.plan`, таблиця `plan_cells`, порт `BudgetPlanSources` над goals і debt-payoff; раніше BUD-06@PoC a: «Порівняння» — `GET /v1/budget/compare`, `GET /v1/budget/compare/year`, прапорець `budget.compare`; BUD-16@PoC a: метод «Ліміти», «План місяця» = сума лімітів, `GET /v1/budget/trend`; раніше #586: «Витрачено» — суми поза межами пропущено, ніколи не 500, `adapters/money-range.ts`; #567 і BUD-03@PoC a: порт `BudgetObligations` під'єднано — адаптер над recurring, accounts, liabilities, transactions; ядро розрахунку «Можна витратити»; раніше BUD-02@PoC c: «Розподіл» — смуга кроку лімітів, профіцит і дефіцит, покриття; рядок підсумку «Категорії»; «Очікувані платежі» місяця; порт `BudgetObligations`; раніше, 2026-11-16, b: майстер — «За моїми витратами», старт посеред періоду, пропорційний перший період; a: бюджет, ліміти, «Поза планом», рахунки бюджету, знімок періоду)

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
початку історії, «за N міс.»; без «Одноразових витрат», п. 8), 5 (база минулого року лише з
даними там), 6 (сортування за абсолютною різницею, три найбільші зміни з кількістю транзакцій; тексти — на сторінці), 11
(«Рік: план і факт»), бізнес-правила; AC1, AC2, AC5–AC11, AC13–AC15 (серверні частини), граничні випадки 1–3. UI —
рядок 132; п. 9 («з цілі») — далі (follow-ups PR).
BUD-06@PoC п. 8, AC4 і FLW-38@PoC п. 4, AC3 (серверна частина): позначка «Одноразова витрата» — у модулі transactions
(`PUT /v1/transactions/{id}/one-off`); budget лише читає її: `BudgetReads.window` дає `oneOff` кожної суми — база
«Середнє за 3 / 6 / 12 міс.» «Порівняння» їх не рахує (ні суми, ні кількість транзакцій; місяць «з даними» лишається);
`BudgetReads.amounts` теж дає `oneOff` — майстер «Створити за моїми витратами» не рахує їх у середніх, але місяць лишається місяцем історії (#685). Факт періоду, «Бюджет»,
знімок, «Тренд», «Попередній період», «Минулий рік», «Рік: план і факт» і «Можна витратити» рахують її, як завжди.
BUD-17@PoC a) (рядок 35, серверна частина): п. 1 (сітка поточного й 11 наступних місяців: «Надходження» — з рядка 231
рядок на кожну активну категорію доходу плану бюджету в порядку дерева, клітинка — план категорії на місяць у її валюті,
типово — її план у бюджеті; сума розділу — план доходу місяця, сума рядків (рішення власника 2026-11-21, 2 б; раніше —
«План доходу», регулярні доходи й «Інші надходження», Q3 2026-11-19); бюджет без категорій доходу — без рядків, сума — його
план без категорій; «Витрати» — ліміти активних категорій за групами; «Цілі й
заощадження» — внесок кожної активної цілі, типово потрібний, до місяця її дати, і «Заощадження без цілі»; «Погашення
боргів» — мінімальні платежі `BudgetObligations` і додаткові платежі збережених планів, лише читання; «Не розподілено» /
«Дефіцит»), 2 (клітинка — власне значення місяця, діє лише на нього, і в знімку завершеного місяця; минулий — лише
читання), 3 (версія клітинки, 409 `VERSION_CONFLICT`), 4, 6; AC1–AC7, граничні випадки 1–2 (серверні частини). Зміна
ліміту чи плану доходу через `PATCH /v1/budget/plan` власних значень місяців не змінює (рішення власника 2026-11-19, Q2). UI — рядок 127; п. 5, 7, 8 — UI.
BUD-02@PoC i) (рішення власника 2026-11-21, варіанти 1 а і 2 а; серверна частина): п. 3 і 21 («План доходу» за
категоріями доходу: пропозиція «Створити за моїми витратами» — середнє категорії за 3 міс. до 10, до парного; план
доходу — сума категорій), 9 (картка «Дохід»: план і факт кожної категорії), 11 (знімок — план кожної категорії доходу),
15 (дефіцит лишається — «Лишити дефіцит», «Створити бюджет» активна завжди); AC1, AC7, AC17, AC18 (серверні частини);
граничний випадок 1 — для кожної категорії доходу. BUD-17@PoC п. 1: типовий «План доходу» сітки — сума категорій.
Банер «План з дефіцитом N €» бере N з `unallocated` сітки «План» поточного місяця (рішення ведучого 2026-11-21) — UI.
Далі: розбивка «Можна витратити» з внесками в цілі — BUD-03 (рядок 34) читає `plannedSavings` періоду; «Можна витратити в <місяць> ≈» — BUD-03 (рядок 34); UI (рядки 123–125).

BUD-02@PoC FR 1, FR 24, AC21 (рішення власника 2026-11-26, Q3 а; рядок 223 — серверна частина): ліміт категорії витрат і
план категорії доходу — у валюті категорії (типово — валюта бюджету; інша — лише з курсом на «сьогодні», інакше 400
`….currency: currency`); рядок періоду показує ліміт, витрачене (транзакції за курсом їхньої дати) і залишок у валюті
категорії, `inBudgetCurrency` — у валюті бюджету; підсумки, «Можна витратити» (BUD-03) і суми розділів «Плану» (BUD-17) —
у валюті бюджету за курсом «сьогодні», завершений період — за курсом свого останнього дня, записаним у знімок (без курсу на той день — власні суми ліній і перший курс, що з’явиться після, записаний у знімок, #709); `rates`
називає курси для «≈». Клітинка категорії «Плану» — у валюті її ліміту. Зміна валюти пише в аудит поле `currency`.
Перерахунок введеної суми при зміні валюти (округлення до 10 до парного) — на клієнті (рядок 224).

Зрізи PoC, що ще називають модуль: BUD-03@PoC, BUD-06@PoC, BUD-16@PoC, BUD-17@PoC, FLW-34@PoC, FLW-35@PoC, FLW-37@PoC,
FLW-38@PoC, JRN-05@PoC, JRN-06@PoC.

## Публічний інтерфейс

`index.ts`:

- `budgetModule` — маршрути (прапорець випуску і ключ функції `budget.period`; простір — лише сесії; читання —
  `household.data.read`, зміни — `household.data.write`; учасник з областю: «бюджет і цілі» закриті політикою видимості
  за замовчуванням — читання й зміни 404, створення 403; ліміту плану немає):
  - `GET /v1/budget` (`getBudget`) → `{ budget }` або `{ budget: null }` (порожній стан): `id`, `currency`,
    `firstPeriod` (YYYY-MM), `proportional` (`from`, `to`, `days`, `daysInPeriod` або null), `incomePlan` (сума `incomePlans`; бюджет без них — план без категорій), `incomePlans` (`categoryId`, `amount` — «План доходу», п. 21), `limits` (`categoryId`, `amount`), `rates` (FR 24: курси валют категорій на сьогодні; порожньо — без «≈»), `createdOn`, `version`.
  - `GET /v1/budget/wizard` (`getBudgetWizard`) — лише читання: `today`, `midPeriod` (false першого числа), `starts`
    (`period-start`, `next-period`, `proportional` з `days`/`daysInPeriod`; жоден не типовий), `fromSpending`
    (`available` — ≥ 3 повних місяців категоризованих транзакцій поспіль, `historyMonths`, `incomePlan` — сума
    `incomes`, `incomeIrregular` — хоч одна категорія нерегулярна, `incomes` — категорії доходу з доходом за 3 міс.,
    спершу більший план: `categoryId`, `average` за 3 міс. (за місяці, що є, якщо історія категорії коротша),
    `plan` — середнє до 10 або для нерегулярної категорії (граничний випадок 1, окремо для кожної; лише з 6 повними
    місяцями її історії) мінімум за 6 міс. до 10, `irregular`; `categories` — `categoryId`, `average` за 3 міс.,
    `limit` — до 10; null — менше 5). Округлення до 10 і до копійок — до парного (405 → 400, рядок 179).
    Рахує, як період (п. 12), рахунки, що ввійшли б у бюджет.
  - `POST /v1/budget/allocation` (`previewBudgetAllocation`) — лише розрахунок, нічого не зберігає: тіло як у
    `createBudget` (`firstPeriod`, `proportional`, `incomePlan` або `incomePlans`, `limits`) і `chosen` (до 100 сум, обраних на кроці) →
    `period`, `incomePlan` і `limits` (сума; пропорційний — × частку днів), `balance` (`recurringOutsideLimits`,
    `unallocated` — смуга кроку лімітів, `debtMinimums`, `goalContributions` — заплановані внески в цілі місяця, як їх
    віднімає «План» (рішення власника 2026-11-20, Q5 а), `difference` = `unallocated` − `debtMinimums` −
    `goalContributions` (null і без курсу внеску цілі з датою), `kind` — `surplus` / `deficit` / `balanced`,
    `amount` = |difference|; null без `BudgetObligations`), `choice` (`chosen`, `rest` = N − chosen, `status` —
    `short` / `exact` / `over`; дефіцит покрито повністю лише при `exact`, `short` лишає решту дефіцитом плану; null без `chosen`/`allocation` або `balance`), `spendable`
    («Можна витратити в <місяць> ≈ M», п. 3, AC6: `period`, `amount` — BUD-03 п. 2 для першого періоду; поточний місяць
    — на сьогодні з фактом рахунків, що ввійшли б у бюджет, наступний — на 1-ше; внески в цілі — клітинки «Розподілу»,
    інакше потрібні; поточний місяць — мінус уже внесене в цілі й плюс регулярні доходи, що ще очікуються, як
    «Можна витратити» (#641); заплановані витрати — додаткові платежі планів, клітинка боргу замість них; `amount`
    null і `missing` — `obligations`, `rates`). Помилки — як у `createBudget` (`chosen.<i>`: `invalid`, `….currency: currency`;
    `chosen: with_allocation`); `allocation` — ті самі правила, що в `createBudget`.
  - `POST /v1/budget` (`createBudget`, `Idempotency-Key`) — `firstPeriod` (поточний або наступний місяць; першого числа —
    лише поточний; інакше 400 `firstPeriod: invalid`), `proportional` (true — поточний місяць від сьогодні, не першого
    числа; інакше 400 `proportional: invalid`), `incomePlans` (до 100, п. 21: активна категорія доходу простору — 400
    `incomePlans.<i>.categoryId`: `not_found`, `not_income`, `hidden`, `duplicate`; сума — як ліміт; план доходу — їхня
    сума; аудит `budget.income-plan`/`create`) або `incomePlan` (план без категорій, типово 0; обидва — 400
    `incomePlan: with_income_plans`), `limits` (до 300). Ліміт — активна категорія витрат простору (400
    `limits.<i>.categoryId`: `not_found`, `not_expense`, `hidden`, `duplicate`), ≥ 0 у валюті бюджету (`limits.<i>.amount`:
    `invalid`, `….currency: currency`). `allocation` (до 100 рядків «Розподілу», п. 15): профіцит — `goal` (`goalId`,
    внесок першого періоду; рахується як зміна проти запланованого внеску, бо N його вже віднімає — Q5 а; ціль у валюті
    бюджету із запланованим внеском без рядка пишеться як 0 € — Q4 а), `debt` (`accountId`, додатковий платіж понад мінімум — запланована витрата), `savings`
    («Заощадження без цілі»), решта — «Не розподілено»; дефіцит — `from-goal` (внесок місяця − сума); `from-savings` («Із заощаджень») і `to-debt` («У борг») у PoC не
    зберігаються — 400 `allocation.<i>.kind: not_saved` (Q3 а). Перевірка — як у
    розрахунку, до транзакції: 400 `allocation`: `balance_unknown`, `over`; непокритий дефіцит (частково або
    «Лишити дефіцит» — без рядків) зберігається: решта — дефіцит плану (п. 15, AC17);
    `allocation.<i>.kind`: `invalid` (не той вид), `duplicate`; `….goalId`/`….accountId`: `not_found` (ціль чи борг
    іншого простору — так само), `duplicate`, `no_contribution`; `….amount`: `invalid`, `over_contribution`,
    `….currency: currency`. Рядки пишуться клітинками «Плану» першого періоду в транзакції бюджету (аудит
    `budget.plan-cell`/`create`). Другий бюджет — 409 `BUDGET_EXISTS`. → 201 бюджет.
  - `PATCH /v1/budget/plan` (`updateBudgetPlan`) — `version`, `incomePlans` (`amount` null прибирає категорію; план
    доходу стає сумою категорій; аудит `budget.income-plan`), `incomePlan` (лише бюджет без категорій доходу, інакше 400
    `incomePlan: by_category`; не разом з `incomePlans`), `limits` (`amount` null прибирає ліміт).
    Інша версія — 409 `VERSION_CONFLICT` (`currentVersion`). Зміна діє з поточного періоду; завершені періоди
    спершу отримують знімок. Без змін — нічого. → 200 бюджет.
  - `DELETE /v1/budget` (`deleteBudget`) — з лімітами, вибором рахунків і знімками. → `{ deleted: true }`.
  - `GET /v1/budget/accounts` (`listBudgetAccounts`) → `accounts`: `accountId`, `kind`, `status`, `included` (типово —
    поточні, кредитні картки, готівка).
  - `PUT /v1/budget/accounts/{accountId}` (`setBudgetAccount`) — `{ included }`; рахунок іншого простору — 404.
  - `GET /v1/budget/periods/{period}` (`getBudgetPeriod`) — `proportional` (пропорційний перший період: план уже × частку
    днів, витрати — від `from`; інакше null), `mode` (`past`: план зі знімка — записується під час
    першого перегляду — проти живого факту; `current`; `future`: лише план), `incomePlan`, `plannedSavings` (0 до
    рядка 31), `incomeCategories` (картка «Дохід», п. 9: `categoryId`, `plan`, `actual` — null у майбутньому; спершу
    категорії з фактом нижче плану, далі ті, що досягли, у кожній — спершу більший план; дохід категорії без плану — з планом 0; знімок до `0007` —
    без категорій), `incomeActual`, `groups` (категорії з лімітом за групами в порядку дерева: `limit`, `spent`, `remaining`,
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
    періоду), `income` (`categories` — рядок на кожну активну категорію доходу плану бюджету, `categoryId`, клітинки у
    валюті її плану; `totals` — сума рядків у валюті бюджету, null — рядок без курсу; застарілі з 2026-11-26: `plan` —
    план доходу місяця як клітинка без власного значення, `rows` — порожньо, `other` — null), `expenses` (`groups` →
    `categories`), `goals` (`rows` — `goalId`, клітинки з `required`; `savings`), `debts` (`rows` — `accountId`, клітинки
    `minimum`, `extra`), кожен розділ із `totals` (null — суми немає: без курсу); клітинка — `amount` (null — порожня),
    `own` (власне значення місяця), `version`; `unallocated` — `kind` `unallocated` / `deficit` і `amount` (модуль), null
    без суми розділу. Без бюджету — 404.
  - `PUT /v1/budget/plan-grid/cells` (`setBudgetPlanCell`, той самий прапорець) — `period` (поточний або один з 11
    наступних; 400 `period`: `past`, `too_far`; до першого періоду — 404 `BUDGET_PERIOD_BEFORE_START`), `kind` (`income`,
    `limit`, `goal`, `savings`), `lineId` (категорія витрат, категорія доходу плану бюджету — `income`, валюта її плану, інакше 400 `amount.currency`; ціль; null — лише
    «Заощадження без цілі»; 400 `lineId`: `not_found` (зокрема категорія доходу без плану), `not_expense`, `not_income`, `hidden`, `required`,
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
    періоду; `obligations` — платіж за найближчим курсом; `incomes`, `goals`, `plannedExpenses` — дохід, що ще очікується,
    сума цілі чи запланована витрата за найближчим курсом). Заплановані заощадження (п. 10, бюджет без лімітів) —
    заплановані внески в цілі й «Заощадження без цілі» «Плану». EC5: транзакції, списані з цілі («Витратити з цілі»),
    сума не враховує зовсім (BUD-05 п. 8); «Бюджет», «Порівняння» і знімок їх рахують.
  - `GET /v1/budget/periods/{period}/summary` (`getBudgetPeriodSummary`; прапорець випуску і ключ функції
    `budget.summary`, вимагає `budget.period`; FLW-38@PoC п. 1, AC5, EC1; S-135) — лише завершений місяць (поточний чи
    пізніший — 400 `period: not_finished`; без бюджету — 404; до першого періоду — 404 `BUDGET_PERIOD_BEFORE_START`) →
    `period`, `currency`, `window` (`from` — перший день, пропорційний перший — від `countsFrom`; `to`), `income` і
    `expenses` (`actual`, `plan` — зі знімка, `difference` = факт − план; витрати — категорії з лімітом і «Поза планом»,
    план — сума лімітів), `netFlow` = дохід − витрати, `savingsRate` (відсоток з одним знаком, до парного; null — без
    доходу, «–»), `regularPayments` (списання витратних регулярних платежів місяця, хоч який стан платежу зараз:
    `count` M, `paid` N, `late`, `missed`; `items` — `paymentId`, `categoryId`, `dueOn`, `expected` у валюті платежу,
    `status`, `paidOn`, `overdueDays`; null без `BudgetChargeHistory`), `approximate` — як у періоду. Таблиця категорій —
    `GET /v1/budget/periods/{period}`, найбільші зміни — `GET /v1/budget/compare` з базою `avg3`.
- `createBudgetServices({ categories, accounts, transactions, categorization, fx, audit, clock, newId, obligations?, planSources?, goalSpends?, chargeHistory? })` →
  `BudgetServices` — порти маршрутів (`src/api.ts` → `ctx.services`; `main.ts`): `CategoryDirectory.categories`
  (categories), `AccountList` (accounts), `BudgetTransactions` (transactions), `TransactionCategories`
  (categorization), `FxReporting.total` (fx-rates); «сьогодні» — дата за Києвом; валюта — `SPACE_REPORTING_CURRENCY`;
  `BudgetTransactions.firstDate` (transactions) — початок історії для середніх і бази минулого року (BUD-06);
  `obligations` — `BudgetObligations.month(householdId, period, currency, from?)` → `PeriodObligations` або null
  (`recurring`: `categoryId`, `amount`, `paid`, `paymentId`, `dueOn`, `overdueDays`; `incomeExpected` — регулярні доходи
  місяця, що ще очікуються (лише «Очікується»: «Дохід не надійшов» і «Пропущено» — ні, BUD-07 п. 15), null — без курсу; `debtMinimums`: `accountId`, `amount`, `paid` — щомісячний платіж
  кредиту, лише тут, не в `recurring`; `approximate`; `incomeApproximate`; суми у валюті бюджету за сьогоднішнім курсом);
  `goalSpends` — `GoalSpends` (goals): `BudgetReads.amounts(…, { withoutGoalSpends: true })` лишає поза сумою
  «Можна витратити» транзакції, списані з цілі (без нього — тестовий сервер — жодної); `chargeHistory` —
  `BudgetChargeHistory.finishedMonth(householdId, period)` (recurring: `createRecurringHistory`, списання місяця з
  `paidOn`; без нього `regularPayments` null).
- `createBudgetPlanSources({ goals, debts, fx })` → `BudgetPlanSources` (`src/main.ts`): `GoalPlans` (goals:
  активні цілі з потрібним внеском, датою і внесеним цього місяця — `contributed`; `requiredApproximate`,
  `contributedApproximate` — за найближчим курсом), `DebtPlannedExpenses` (debt-payoff: додаткові платежі місяця),
  `FxReporting.total`
  (fx-rates: інша валюта — за сьогоднішнім курсом; без курсу чи понад 15 цифр цілої частини — null).
- `createBudgetObligations({ recurring, credit, liabilities, payments, fx })` → `BudgetObligations` (`src/main.ts`):
  `RecurringMonth` (recurring), `CreditAccounts` (accounts), `Liabilities.forAccount` (liabilities), `AccountPayments`
  (transactions), `FxReporting.total` (fx-rates); `OBLIGATION_MAX_INTEGER_DIGITS` = 15.
- `createBudgetCategoryUsage(db, services)` → `CategoryUsage` модуля categories (BUD-01 п. 12, AC 22; рішення власника
  2026-11-26; `src/main.ts`): записи бюджету категорії не тримають її. Порт `limits`: `held(householdId, ids)` — які
  мають ліміт, план доходу чи клітинку «План»; `entries(householdId, id)` → `{ limit, stored, planCells }` (ліміт поточного
  періоду з власним значенням місяця; рішення ведучого 2026-11-26); `release(caller, id)` — підтверджене видалення
  категорії: під блокуванням бюджету спершу знімки завершених періодів, потім ліміт, план доходу (план доходу бюджету —
  сума решти) і всі клітинки рядка, кожне з записом аудиту, нова версія бюджету (`releaseCategory`). `services` — ті самі
  `BudgetServices` маршрутів (або функція, що їх повертає).
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
`create`, `update`, `delete` — `categoryId`, `amount`; `budget.income-plan` з ідентифікатором категорії доходу: `create`,
`update`, `delete` — `categoryId`, `amount`; `budget.account` з ідентифікатором рахунку: `update` — `included`; `budget.plan-cell` з ідентифікатором рядка — категорії, цілі або бюджету для рядка без власного:
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
| `plan_cells` | Власне значення місяця одного рядка «Плану» (BUD-17): `kind`, `line_id` (нульовий — рядок без власного), `amount` (null — до типового), `version` (`0005_plan_cells.sql`); `debt` — додатковий платіж за боргом із «Розподілу» (BUD-02 п. 15; `line_id` — рахунок боргу): сітка показує його як `extra` місяця замість плану погашення, лише читання (`0006_plan_cell_debt.sql`) |
| `plan_cells` (індекс) | `plan_cells_line` — клітинки рядка категорії (`kind = 'limit'`) за `line_id`, для `limits.held` і видалення категорії (`0008_plan_cells_line.sql`); `plan_cells_income_line` — те саме для `kind = 'income'` (`0010_plan_income_categories.sql`) |
| `plan_cells` (`income`, рядок 231) | `line_id` — категорія доходу плану бюджету, `currency` — валюта її плану; рядки, записані раніше (нульовий `line_id` — «План доходу», ідентифікатор регулярного платежу), лишаються й не рахуються, крім нульового в бюджеті без категорій доходу; міграція `0010` розклала введений «План доходу» місяця на клітинки категорій у валюті бюджету точно в суму (рішення ведучого 2026-11-26) |
| `income_plans` | План категорії доходу (непрозорий ідентифікатор категорії `categories`) і його валюта (BUD-02 п. 21; `0007_income_plans.sql`); `budgets.income_plan` — їхня сума |
| `period_snapshots` | Знімок завершеного періоду: план доходу, заплановані заощадження, ліміти з «обов'язкова» (jsonb); `income_plans` — план кожної категорії доходу (jsonb, null — знімок до `0007`) |
| `idempotency_keys` | Ключі ідемпотентності створення (ARC-07 п. 4; `0002_idempotency_keys.sql`, дослівно) |
| `outbox_events`, `jobs` | Черга модуля (`0003_queue.sql`, таблиці платформи дослівно): задачі `budget.hand-off`; подій модуль не публікує |

Синтетичні дані: `synthetic.ts` (бюджет простору з 3 лімітами, перемкнений рахунок, знімки завершених місяців, виконані задачі передачі).
