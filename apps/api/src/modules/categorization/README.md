# Модуль categorization

**Створено:** 2026-11-13 · **Оновлено:** 2026-11-16 (BUD-14 b1: правила категорій — умови, пріоритет, нові транзакції, «Показати», «Потребує уваги»)

Картка модуля (ARC-01). Робота з модулем починається з неї; оновлюйте її в тому ж PR, що й інтерфейс.

## Призначення

Категорія транзакції і її джерело, автоматичне визначення категорії і правила користувача.

Домен каталогу ARC-01: Гроші. Реліз, з якого модуль у каталозі: PoC.

Транзакція належить модулю `transactions`; тут — лише її категорія і джерело категорії за непрозорим ідентифікатором
транзакції. Категорії частин розділеної транзакції — у `transactions` (BUD-01 п. 6). Дерево категорій — `categories`.

## Вимоги

BUD-01@PoC b) (хвиля 2, рядок 20 — серверна частина): п. 1 («Без категорії» — стан, а не категорія; повернення
отримує категорію покупки), 4 (джерело категорії зберігається; пріоритет джерел — `pickCategory`, `proposalApplies`),
6 (розділена — категорії частин), 8 (об'єднання переносить транзакції — подія `categories.merged`), 9 (категорія з
дерева простору), 12 (відповідь «категорія в ужитку»); AC8, AC12, граничний випадок 3; зміна вручну лише цієї
транзакції (п. 5 без перемикача). DAT-03@PoC п. 2, AC1 (#272 п. 1): дія «Змінити категорію» на цілі «транзакції».
Далі: імпорт із категорією банку і словник MCC (AC1, AC9–AC11 — з імпортом), «як раніше» (мерчанти, рядок 22), правила
і перемикач «Застосувати до всіх…» (BUD-14, рядок 23; п. 5, AC2), пари переказів «Переказ» (п. 7, AC4 —
`transfer-matching`), колонка й фільтр «Категорія» списку транзакцій, UI (рядок 118).

BUD-14@PoC b1) (хвиля 2, рядок 23 — серверна частина, перший зріз): п. 4 (серверна частина: правила в порядку
пріоритету, «Застосовано: N», «Увімкнено», «Змінити правило», порядок «#» / «Вище» / «Нижче»), 5 (умови «Мерчант», «Опис»,
«Сума», «Рахунок»; «Лише для рахунків»; дія — категорія), 7 («Показати» і N наявних, що підходять, без змін; без прапорця
минулі транзакції не змінюються), 8 (нові транзакції — перше правило, що підходить), 9 (ручна категорія не
перезаписується), 10 («Потребує уваги», об'єднання категорій переписує правила), 11 (попередження про ідентичні умови),
12 (дії «приховати» немає), 13 (серверна частина: правило, що задало категорію); AC7, AC8, AC9, AC12, AC14 (серверна
частина). Далі (зріз b2): «Застосувати до N наявних транзакцій» однією операцією (до 500 — одразу, понад 500 — у фоні),
«Відмінити» 7 днів, «Пропущено: ручні зміни» (п. 7, AC2, AC4–AC6, AC15, граничні випадки 1 і 5), дія «теги» і
«Застосовано правила: №…» з кількох правил (п. 8, AC3) — після тегів транзакцій BUD-13; UI — рядок 120.

## Публічний інтерфейс

`index.ts`:

- `categorizationModule` — маршрути (прапорець випуску і ключ функції `categories.tree`, як у дерева категорій; дозвіл
  читання `household.data.read`, зміни — `household.data.write`; простір — лише сесії; транзакція чи категорія іншого
  простору — як неіснуючі; учасник з областю: «Транзакції» закриті політикою видимості за замовчуванням — читання 404,
  зміни 403):
  - `GET /v1/transactions/{transactionId}/category` (`getTransactionCategory`) → `transactionId`, `categoryId` (null —
    «Без категорії»), `source` (`manual` «вручну», `rule` «за правилом», `merchant` «як раніше», `bank` «з банку»,
    `dictionary` «за словником», `none` «немає»). Транзакція, якої немає в просторі, — 404.
  - `PUT /v1/transactions/{transactionId}/category` (`setTransactionCategory`) — `{ categoryId }`: категорія «вручну»
    лише цієї транзакції (AC8); null — «Без категорії» (`none`). Категорія — з дерева простору через `CategoryDirectory`
    (до транзакції модуля): іншого простору, невідома, об'єднана чи службова — 400 `categoryId: not_found`; прихована —
    можна; тип категорії зі знаком суми не звіряється (повернення, п. 1). Сторона переказу — 409
    `TRANSACTION_IN_TRANSFER`, розділена — 409 `TRANSACTION_SPLIT`, злитий дубль — 409 `TRANSACTION_MERGED`; рядок
    вставив одночасно інший запит — 409 `VERSION_CONFLICT`. Без змін — нічого.
  - `GET /v1/transactions/{transactionId}/category` також повертає `rule` (BUD-14 п. 13: `{ id, position }` правила, що
    задало категорію зі джерелом `rule`; інакше null).
- Правила категорій (BUD-14 b1; прапорець випуску і ключ функції `categorization.rules` «правила», потребує
  `transactions.merchants`; дозвіл читання `household.data.read`, зміни — `household.data.write`; учасник з областю —
  404; правило, категорія чи рахунок іншого простору — як неіснуючі). Правило: `id`, `position` (1 — найвищий
  пріоритет), `conditions` (1–10: `merchant` / `description` — `equals` / `contains`, 1–200 символів одним рядком, без
  урахування регістру; `amount` — `equals` / `greater` / `less`, `{ amount, currency }` додатне, не більше знаків, ніж у
  валюти, порівнюється із сумою без знака в тій самій валюті; `account` — `equals`, ідентифікатор рахунку), `accountIds`
  («Лише для рахунків», до 20), `categoryId`, `enabled`, `needsAttention` (`category_deleted` / `account_deleted` / null),
  `appliedCount`. «Опис» — оригінальний опис банку (контрагент транзакції).
  - `GET /v1/category-rules` (`listCategoryRules`) → `items` у порядку пріоритету.
  - `POST /v1/category-rules` (`createCategoryRule`) — `{ conditions, accountIds?, categoryId, enabled? }` → 201 правило
    з `duplicateOf` (п. 11: правило з ідентичними умовами вищого пріоритету або null; збереження не блокується). Нове —
    останнє в порядку. Понад 500 правил — 422 `LIMIT_REACHED` (`limit: 500`). Категорія поза деревом простору, об'єднана
    чи службова — 400 `categoryId: not_found`; рахунок не простору — 400 `accountIds` / `conditions.N.value: not_found`.
  - `PATCH /v1/category-rules/{ruleId}` (`updateCategoryRule`) — ті самі поля, кожне необов'язкове (`enabled` —
    «Увімкнено») → правило з `duplicateOf`; минулі транзакції не змінюються (п. 7).
  - `POST /v1/category-rules/{ruleId}/move` (`moveCategoryRule`) — `{ position }` (1…n; більше — 400
    `position: out_of_range`) → усі правила в новому порядку.
  - `POST /v1/category-rules/matches` (`matchCategoryRule`) — `{ conditions, accountIds? }` → `count`, `totals` (сума зі
    знаком за валютами), `items` (до 100 найновіших: `transactionId`, `accountId`, `date`, `amount`, `counterparty`),
    `truncated`. Перевіряються найновіші 20 000 показаних транзакцій простору (не сторони переказу, не розділені, не
    злиті); нічого не пише.
- `createCategorizationServices({ transactions, categories, audit, rules?, scanMax? })` → `CategorizationServices` — порти
  маршрутів (`src/api.ts` → `ctx.services`; `main.ts`): `TransactionLookup` модуля transactions, `CategoryDirectory`
  модуля categories, журнал аудиту; `rules` — `categorizationRulePorts({ accounts, merchants, inputs })` з
  `AccountDirectory`, `MerchantDirectory` і `TransactionRuleInputs` (без них маршрути правил — 500).
- `createCategorizationCategoryUsage(db, transactions)` → `CategoryUsage` модуля categories (п. 12): які з категорій
  мають наявні транзакції простору (рядок видаленої транзакції — не вжиток). З'єднує `src/main.ts`.
- `createCategoryBulkActions({ db, transactions, categories })` → `{ targets, actions }` для `createBulkActionsServices`
  (`src/wiring.ts`): ціль `transactions` (вибір за фільтром списку «Транзакції» — `TransactionLookup.select`; поля
  `category`, `source`; версія — версія рядка, 0 без рядка; запис — правилами однієї зміни, без власного аудиту) і дія
  `transactions.set-category` (`{ categoryId }`; та сама категорія — «без змін»; переказ, розділена, злитий дубль —
  «невалідний» `transaction.in_transfer` / `transaction.split` / `transaction.merged`; категорія поза деревом —
  `category.not_found` для всіх). «Відмінити» повертає категорію і джерело.
- `createCategorizationWorkerQueue(db, audit, categories, rules)`, `categorizationSubscriptions` — черга воркера і
  підписки (`src/wiring.ts`): задачі `categorization.hand-off` (`HAND_OFF_JOB`, запис аудиту зміни),
  `categorization.category-merged` (`CATEGORY_MERGED_JOB`, подія `categories.merged`: транзакції й правила),
  `categorization.transaction-created` (`TRANSACTION_CREATED_JOB`, подія `transactions.created`: правила нової
  транзакції) і `categorization.audit` (`AUDIT_JOB`, запис аудиту правила чи категорії «за правилом»).
- `createCategorizationRecovery(db, households)` → `{ run() }` — щоденна задача планувальника `categorization.recovery`
  (до очищення черги): задачі `dead` усіх чотирьох назв повертаються в чергу; подія логу
  `categorization.jobs_requeued` (WARN).
- `createCategorizationErasure(db)` → `eraseHousehold(householdId)` → `{ transactionCategories, jobs }` — видалення
  простору (NFR-12@PoC п. 3, крок `categorization.records`; правила теж); викликає лише `data-erasure`.
- `CATEGORY_SOURCES`, `pickCategory` (п. 4: перше джерело з категорією вирішує), `proposalApplies` (автоматична
  пропозиція не замінює ручної і вищого джерела; граничний випадок 3), типи `CategorySource`, `TransactionCategory`.

Порядок однієї зміни (ARC-04, ADR-0015): перевірки через інші модулі (транзакція, категорія) → у транзакції модуля з
рядком під блокуванням: рядок (версія + 1) і задача `categorization.hand-off` (ключ `set:<транзакція>:<версія>`) → коміт
→ запис аудиту одразу (невдача — 200 і WARN `categorization.hand_off_deferred`, запис допише воркер). Запис аудиту —
сутність `categorization.transaction-category` (ідентифікатор транзакції), дія `update`, поля `categoryId` і `source`
до й після (лише змінені), ключ `categorization.set:<транзакція>:<версія>`. Об'єднання: задача події переносить рядки
джерела на ціль (версія + 1, джерело лишається), повтор нічого не переносить; аудит об'єднання пише `categories`.
Залишковий ризик: транзакцію можна розділити чи зробити стороною переказу між перевіркою і комітом зміни категорії
(перевірка між модулями без спільного блокування); рядок видаленої транзакції лишається до видалення простору
(follow-up: подія видалення транзакції).

## Залежності

Порядок зміни правила: перевірки через інші модулі (категорія, рахунки) → у транзакції модуля під консультативним
блокуванням правил простору (`categorization.rules:<простір>`): рядки і задача `categorization.audit` (ключ
`categorization.rule:<правило>:<версія>`) → коміт → запис аудиту одразу (невдача — WARN
`categorization.hand_off_deferred`, запис допише воркер). Запис — сутність `categorization.rule`, дія `create` / `update`,
поля `conditions` (замасковано: умови можуть містити опис банку), `position`, `categoryId`, `accountIds`, `enabled`.
Нова транзакція: задача події читає вхід транзакції (`TransactionRuleInputs`) і мерчанта (`MerchantDirectory`); перше
ввімкнене правило, що підходить і не потребує уваги, записує категорію `rule` з `rule_id`, якщо `proposalApplies` (ручна
категорія лишається); запис аудиту — сутність `categorization.transaction-category`, автор — система (`system`), ключ
`categorization.set:<транзакція>:<версія>`. «Застосовано: N» рахує рядки категорій, що досі задані правилом (рядки
видалених транзакцій теж — до події видалення транзакції, як і вище).

## Залежності

Шар: subject. Модулі: accounts, audit, bulk-actions (типи портів), categories, merchants, transactions
(`apps/api/module-rules.json`).

## Події

| Публікує | Версія | Коли |
| --- | --- | --- |
| — | | |

| Споживає | Версія | Навіщо |
| --- | --- | --- |
| `categories.merged` | 1 | BUD-01 п. 8: транзакції об'єднаної категорії отримують цільову (задача `categorization.category-merged`); BUD-14 п. 10: правила теж |
| `transactions.created` | 1 | BUD-14 п. 8: нова транзакція проходить правила категорій (задача `categorization.transaction-created`) |

## Власні таблиці

Схема `categorization`; міграції — `adapters/db/migrations/NNNN_slug.sql`. Політика простору — від запуску міграцій.

| Таблиця | Що |
| --- | --- |
| `transaction_categories` | Категорія транзакції: ідентифікатор транзакції (модуля transactions), категорія (дерева модуля categories) або null, джерело (`manual` · `rule` · `merchant` · `bank` · `dictionary` · `none`; null лише з `none`), версія, час зміни (`0001_transaction_categories.sql`) |
| `jobs`, `outbox_events` | Черга модуля (ARC-04; `0002_queue.sql`, дослівно `queue-tables.sql`); подій модуль не публікує |
| `rules` | Правило категорії: позиція (пріоритет, 1…n без пропусків, унікальна — перевіряється при коміті), умови (JSON), «Лише для рахунків», категорія, «Увімкнено», канонічний ключ умов (п. 11), версія (`0003_rules.sql`); `transaction_categories.rule_id` — правило, що задало категорію |

Синтетичні дані: `synthetic.ts` (4 категорії транзакцій — серед них «Без категорії», 2 виконані задачі передачі й 1
передана подія на простір).
