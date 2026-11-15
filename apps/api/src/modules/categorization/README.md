# Модуль categorization

**Створено:** 2026-11-13 · **Оновлено:** 2026-11-15 (BUD-01 b: категорія транзакції, «Без категорії», зміна вручну; DAT-03 «Змінити категорію»)

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
- `createCategorizationServices({ transactions, categories, audit })` → `CategorizationServices` — порти маршрутів
  (`src/api.ts` → `ctx.services`; `main.ts`): `TransactionLookup` модуля transactions, `CategoryDirectory` модуля
  categories, журнал аудиту.
- `createCategorizationCategoryUsage(db, transactions)` → `CategoryUsage` модуля categories (п. 12): які з категорій
  мають наявні транзакції простору (рядок видаленої транзакції — не вжиток). З'єднує `src/main.ts`.
- `createCategoryBulkActions({ db, transactions, categories })` → `{ targets, actions }` для `createBulkActionsServices`
  (`src/wiring.ts`): ціль `transactions` (вибір за фільтром списку «Транзакції» — `TransactionLookup.select`; поля
  `category`, `source`; версія — версія рядка, 0 без рядка; запис — правилами однієї зміни, без власного аудиту) і дія
  `transactions.set-category` (`{ categoryId }`; та сама категорія — «без змін»; переказ, розділена, злитий дубль —
  «невалідний» `transaction.in_transfer` / `transaction.split` / `transaction.merged`; категорія поза деревом —
  `category.not_found` для всіх). «Відмінити» повертає категорію і джерело.
- `createCategorizationWorkerQueue(db, audit)`, `categorizationSubscriptions` — черга воркера і підписка
  (`src/wiring.ts`): задачі `categorization.hand-off` (`HAND_OFF_JOB`, запис аудиту зміни) і
  `categorization.category-merged` (`CATEGORY_MERGED_JOB`, подія `categories.merged`).
- `createCategorizationRecovery(db, households)` → `{ run() }` — щоденна задача планувальника `categorization.recovery`
  (до очищення черги): задачі `dead` обох назв повертаються в чергу; подія логу `categorization.jobs_requeued` (WARN).
- `createCategorizationErasure(db)` → `eraseHousehold(householdId)` → `{ transactionCategories, jobs }` — видалення
  простору (NFR-12@PoC п. 3, крок `categorization.records`); викликає лише `data-erasure`.
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

Шар: subject. Модулі: audit, bulk-actions (типи портів), categories, transactions (`apps/api/module-rules.json`).

## Події

| Публікує | Версія | Коли |
| --- | --- | --- |
| — | | |

| Споживає | Версія | Навіщо |
| --- | --- | --- |
| `categories.merged` | 1 | BUD-01 п. 8: транзакції об'єднаної категорії отримують цільову (задача `categorization.category-merged`) |

## Власні таблиці

Схема `categorization`; міграції — `adapters/db/migrations/NNNN_slug.sql`. Політика простору — від запуску міграцій.

| Таблиця | Що |
| --- | --- |
| `transaction_categories` | Категорія транзакції: ідентифікатор транзакції (модуля transactions), категорія (дерева модуля categories) або null, джерело (`manual` · `rule` · `merchant` · `bank` · `dictionary` · `none`; null лише з `none`), версія, час зміни (`0001_transaction_categories.sql`) |
| `jobs`, `outbox_events` | Черга модуля (ARC-04; `0002_queue.sql`, дослівно `queue-tables.sql`); подій модуль не публікує |

Синтетичні дані: `synthetic.ts` (4 категорії транзакцій — серед них «Без категорії», 2 виконані задачі передачі й 1
передана подія на простір).
