# Модуль transactions

**Створено:** 2026-11-13 · **Оновлено:** 2026-11-15 (FIN-03 b: «Очікує», приховані, розділення; перекази між власними рахунками; дублі; BUD-01 п. 12: категорії частин)

Картка модуля (ARC-01). Робота з модулем починається з неї; оновлюйте її в тому ж PR, що й інтерфейс.

## Призначення

Облік транзакцій: запис, розбиття, атрибути, нотатки, приховування.

Домен каталогу ARC-01: Гроші. Реліз, з якого модуль у каталозі: PoC.

Грошей модуль не зберігає окремо від журналу: кожна транзакція — одна подія `transaction` журналу (джерело
`transactions` / ідентифікатор транзакції) на рахунку журналу субрахунку її валюти; залишок рахунку — сума проводок
(FIN-03 п. 2, 3; FIN-04). Тут — те, чого в журналі бути не може (ARC-11: без вільного тексту): контрагент і опис, а
також сума, дата й рахунок для списку.

## Вимоги

FIN-03@PoC a) (хвиля 2, рядок 15 — серверна частина): п. 1 (створення; форма — UI), 2 (сума зі знаком у валюті рахунку,
залишок одразу), 3 (одна подія журналу; дохід і витрата; покупка на кредитній картці збільшує борг), 13 і 22 (список на
рушії DAT-01: пошук, сортування, фільтри «Рахунки», «Період», «Тип», «Сума», «Мерчант» — як контрагент; сторінки 25 / 50 /
100; підсумки надходжень, списань і різниці у валюті профілю за курсом дати кожної транзакції), 16 (видалення ручної —
сторно), 20 (аудит кожної зміни), 24 (стан «Проведена»), 29 (дата не пізніше сьогодні), 32 (рахунок обов'язковий); AC1,
AC7, AC10–AC14, AC21 (серверна частина), граничний випадок 2.

FIN-03@PoC b) (хвиля 2, рядок 16a — серверна частина): п. 4 і 24 («Очікує» без запису журналу до проведення; заміна
банківською проведеною — з імпортом), 16 і 17 (приховування й показ знову; проводка лишається), 22 (фільтри «Стан»:
`status`, `split`, `hidden`), 23 (частини розділення по порядку — перша для колонки «Категорія»), 28 («Статус»);
BUD-01@PoC п. 6 і AC3, BUD-13@PoC п. 6, 8, AC2 (серверна частина), AC3 (серверна частина), AC5, AC7, AC8 (частки),
граничний випадок 2 — розділення за категоріями і на кілька місяців. Далі: категорія (BUD-01 b, рядок 20), дублі
(`duplicate-matching`, рядок 16c), приховування імпортованої замість видалення і видалених банком (AC9, п. 17 — з
імпортом), коригування, масові дії (рядок 17), UI (рядки 115–117).

FIN-03@PoC b) (хвиля 2, рядок 16b — серверна частина): п. 7 (позначка «Переказ»: ні дохід, ні витрата; видно на обох
рахунках), 8 (комісія в одній валюті — власна подія списання; дві валюти — `fx-transfer` через «Валютна різниця» за
курсом дати), 9 (зняти позначку), 18 (сторону переказу не приховати й не розділити), 22 (фільтр «Стан: переказ»), 23
(позначка в рядку), 27 («Позначити як переказ»), граничний випадок 1; AC3. Пропозиції (п. 5, 6) — модуль
`transfer-matching`. Категорія «Комісії банку» комісії — з категоризацією (рядок 20); кредитний платіж (п. 14, AC20) — далі.

FIN-03@PoC b) (хвиля 2, рядок 16c — серверна частина): п. 11 (злиття: та, що лишається, зберігає свої поля; дубль
прихований і без власної події журналу; «Об'єднано», «Роз'єднати»), 12 («Об'єднати» і «Не дубль» — пара більше не
позначається), 18 (приховати можна лише «Можливий дубль»; переказ — ні), 27 («Об'єднати з іншою»), граничний випадок 4.
Пошук «Можливий дубль» і правило автоматичного злиття (п. 10, AC6) — модуль `duplicate-matching`. Злиття з банківською
транзакцією (поля банку за п. 11, AC5) — з імпортом (IMP-04, рядок 43); фільтр «Стан: можливий дубль» і бейдж — далі.

## Публічний інтерфейс

`index.ts`:

- `transactionsModule` — опис модуля з маршрутами (прапорець випуску і ключ функції `transactions.manual`, потребує
  `accounts.manual`; простір — лише сесії; транзакція чи рахунок іншого простору — як неіснуючі):
  - `POST /v1/transactions` (`createTransaction`, дозвіл `household.data.write`, `Idempotency-Key`) — `accountId`,
    `amount` (`amount` — десяткове зі знаком, не 0, не більше знаків, ніж у валюти; `currency` — валюта рахунку або
    субрахунку мультивалютного), `date` (не пізніше сьогодні, київська дата; 1900-01-01 і пізніше), `counterparty` (1–200,
    один рядок), `description` (до 1 000). Невідомий рахунок чи рахунок іншого простору — 400 `accountId: not_found`;
    інша валюта — 400 `amount.currency: currency_mismatch` («Валюта не відповідає рахунку»); майбутня дата — 400
    `date: date_in_future`; закритий рахунок — 409 `ACCOUNT_CLOSED`; `status` — `posted` (за замовчуванням) або `pending`
    (лише з прапорцем `transactions.states`, інакше 400 `status: invalid`). → 201 транзакція.
  - `GET /v1/transactions/{transactionId}` (`getTransaction`, `household.data.read`) — `id`, `accountId`, `amount`,
    `type` (`income` / `expense`), `date`, `counterparty`, `description`, `status` (`posted` / `pending`), `source`
    (`manual`), `hidden`, `split` (`mode` — `categories` / `months`, `needsReview`, `parts` по порядку: `categoryId`,
    `month` — YYYY-MM частки місяця або null, `amount`) або null, `recordedAt` («Дата і час»: час запису).
  - `PATCH /v1/transactions/{transactionId}` (`updateTransaction`, `household.data.write`) — ті самі поля, кожне
    необов'язкове; `null` чи порожній текст знімає контрагента чи опис. Зміна рахунку, суми чи дати — `correct` журналу
    (сторно і новий запис); лише тексти — без запису журналу; без змін — нічого. `status`: `pending` сторнує запис,
    `posted` проводить знову. Зміна суми розділеної — розділення лишається з `needsReview` (BUD-01 п. 6). Рахунок
    транзакції чи новий закритий — 409 `ACCOUNT_CLOSED`.
  - `DELETE /v1/transactions/{transactionId}` (`deleteTransaction`, `household.data.write`) — сторно запису, що діє, і
    видалення рядка; повтор — 404.
  - `GET /v1/transactions` (`listTransactions`, `household.data.read`) — рушій DAT-01 (`transactionsList`,
    `adapters/db/store.ts`): `filter` (`accountId.eq|in`, `date.gte|lte`, `type.eq:in|out`, `amount.gte|lte` — сума без
    знака, `counterparty.eq|has`, `search.has` — контрагент і опис, `status.eq|in`, `split.eq`, `hidden.eq`; без фільтра
    `hidden` — лише показані), `sort` (`date`, `amount`, `counterparty`; за
    замовчуванням `-date`; у межах дати — час запису, `-date,-recordedAt`), `page`, `pageSize` (25, 50, 100). → `items`, `page`, `pageSize`, `count`, `from`, `to`,
    `summary` (рядок підсумків: `currency` профілю, `income`, `expense`, `difference`: сума без округлення, `converted`, `approximate`,
    `nearestRateCount`, `partial`, `noRateCount` — `createListTotals` платформи; групи сум рушія за знаком — `bySign`).
  - `POST /v1/transactions/{transactionId}/split` (`splitTransaction`, ключ і прапорець `transactions.attributes`,
    потребує `transactions.manual`) — `{ mode: "categories", parts: [{ categoryId, amount }] }` (2–20 частин зі знаком і
    точністю суми, сума точно дорівнює сумі транзакції — інакше 400 `parts: sum_mismatch`; `parts: []` скасовує) або
    `{ mode: "months", startMonth, months (2–60), categoryId }` (рівні частки до копійки до нуля, залишок — в останній).
    Категорія — з дерева простору через `CategoryDirectory` модуля categories (до транзакції модуля): іншого простору,
    невідома, об'єднана чи службова — 400 `…categoryId: not_found`; іншого типу, ніж сума, — `kind_mismatch`. Журнал не
    змінюється. → 200 транзакція.
  - `DELETE /v1/transactions/{transactionId}/split` (`unsplitTransaction`) — «Об'єднати назад».
  - `POST /v1/transactions/{transactionId}/hide` і `/show` (`hideTransaction`, `showTransaction`; ключ і прапорець
    `transactions.states`) — приховати і показати знову; проводка й залишок не змінюються.
  - `POST /v1/transactions/{transactionId}/transfer` (`markTransfer`; прапорець і ключ `transactions.transfers`, потребує
    `transactions.manual`) — `{ counterpartId }`: «Позначити як переказ» і «Підтвердити» пропозиції. Обидві — простору,
    «Проведена», не приховані, не розділені, не в іншому переказі, на двох активних рахунках, одна списання, друга
    зарахування; в одній валюті зарахування не більше за списання (інакше 400 `counterpartId: amount_mismatch`; інші коди
    — `not_found`, `same_account`, `same_direction`, `pending`, `hidden`, `split`, `in_transfer`); у двох валютах —
    офіційний курс дати переказу (немає — 400 `rate_unavailable`). Закритий рахунок — 409 `ACCOUNT_CLOSED`; сторона
    змінилася між читанням курсу і зміною — 409 `VERSION_CONFLICT`. → 200 транзакція з `transfer` (`id`, `side` —
    `outflow` / `inflow`, `counterpartId`, `date` — дата ранішої сторони, `fee` — комісія ≤ 0 або null, `rate` або null).
  - `DELETE /v1/transactions/{transactionId}/transfer` (`unmarkTransfer`) — п. 9: обидві знову дохід і витрата; без
    позначки — нічого.
  - Сторона переказу: `hide`, `split`, `DELETE` і зміна рахунку, суми, дати чи статусу — 409 `TRANSACTION_IN_TRANSFER`
    (тексти змінюються). Список: фільтр `transfer.eq`, поле `transfer` кожного рядка.
  - `POST /v1/transactions/{transactionId}/merge` (`mergeDuplicate`; прапорець і ключ `transactions.duplicates`, потребує
    `transactions.manual`) — `{ duplicateId }`: «Об'єднати» «Можливого дубля» і «Об'єднати з іншою». Обидві — простору,
    на одному рахунку з тією самою сумою й валютою (дата — будь-яка: вибір користувача), не приховані, не сторони
    переказу, не злиті; у дубля немає злитих у нього (без ланцюжків). Коди 400: `duplicateId` — `not_found`, `invalid`,
    `account_mismatch`, `amount_mismatch`, `hidden`, `in_transfer`, `merged`, `has_duplicates`; `transactionId` —
    `hidden`, `in_transfer`, `merged`. Закритий рахунок — 409 `ACCOUNT_CLOSED`. Дубль стає `hidden` з `mergedInto`,
    його власна подія журналу сторнується; та, що лишається, не змінюється. → 200 та, що лишається.
  - `DELETE /v1/transactions/{transactionId}/merge` (`unmergeDuplicate`) — «Роз'єднати»: на дублі — він повертається;
    на тій, що лишається, — усі злиті в неї; кожен знову показаний зі своїми полями й подією журналу. Без злиття — нічого.
  - `POST /v1/transactions/{transactionId}/not-duplicate` (`dismissDuplicate`) — `{ counterpartId }`: «Не дубль» (той
    самий рахунок, сума й валюта, обидві не злиті; інакше 400 `counterpartId` — `not_found`, `invalid`,
    `account_mismatch`, `amount_mismatch`, `merged`); пара більше не «Можливий дубль». Повтор — нічого.
  - Злитий дубль: `PATCH`, `DELETE`, `show`, `hide`, `split` — 409 `TRANSACTION_MERGED`; та, у яку злито, — `DELETE`
    409 `TRANSACTION_MERGED` (спершу «Роз'єднати»), решта змінюється. Кожна транзакція має `mergedInto` (у яку злито
    або null) і `mergedDuplicates` (злиті в неї — «Об'єднано»).
  - `POST …/hide` (п. 18): лише «Можливий дубль» зараз за правилом `duplicate-matching` (`DuplicateCheck`), інакше
    409 `TRANSACTION_NOT_HIDEABLE`; технічних записів у цьому випуску немає (з підключеннями банків).
  Учасник з областю: «Транзакції» закриті політикою видимості за замовчуванням — читання 404, зміни 403 (дозвіл
  `household.data.write`).
- `createTransactionsServices({ accounts, ledger, totals, audit, clock, newId, categories?, flags?, rates?, duplicates? })` →
  `TransactionsServices` — порти маршрутів (`src/api.ts` → `ctx.services`; `main.ts`): `AccountDirectory` модуля
  accounts, `createLedger`, `createListTotals` (платформа) з `officialDatedRates` модуля fx-rates, журнал аудиту,
  годинник; `CategoryDirectory` модуля categories (без нього «Розділити» — 500), середовище прапорців (без нього
  «Очікує» вимкнено), курси fx-rates (без них перекази — 500) і `DuplicateCheck` модуля duplicate-matching (без нього
  «Приховати транзакцію» — 500).
- `createTransactionsErasure(db)` → `TransactionsErasure.eraseHousehold(householdId)` → `{ transactions, idempotencyKeys,
  jobs }` — видалення простору (NFR-12@PoC п. 3) разом із рядками черги; викликає лише `data-erasure` (крок
  `transactions.records`) перед рахунками і журналом.
- `createTransactionsWorkerQueue(db, { accounts, ledger, audit })` → черга воркера (`src/wiring.ts`, `workerQueues`):
  задачі `transactions.hand-off` (`HAND_OFF_JOB`) зі схеми модуля, з тими самими портами, що в маршрутів.
- `createTransactionsHandOffRecovery(db, households)` → `{ run() }` — щоденна задача планувальника
  `transactions.hand-off-recovery` (до очищення черги): невдалі (`dead`) задачі передачі повертаються в чергу; подія логу
  `transactions.hand_off_requeued` (WARN), якщо хоч одна повернулася.
- `createTransactionCategoryUsage(db)` → `CategoryUsage` модуля categories (BUD-01@PoC п. 12): які з даних категорій
  мають частини розділених транзакцій простору (будь-яких, прихованих теж). Лише читання; з'єднує `src/main.ts`.
- `createTransferCandidates(db)` → `TransferCandidates.candidatePairs(householdId, { windowDays, sameCurrencyMinShare,
  limit })` — пари-кандидати для `transfer-matching` (лише читання; правило вирішує той модуль).
- `createDuplicateCandidates(db)` → `DuplicateCandidates.candidatePairs(householdId, { windowDays, limit })` і
  `candidatesOf(householdId, transactionId, { windowDays })` — пари можливих дублів для `duplicate-matching`: показані,
  на одному рахунку, та сама сума й валюта, у межах `windowDays`, не сторони переказу, не «Не дубль»; `first` — раніша
  (лише читання; правило вирішує той модуль).
- `TRANSACTION_TYPES`, `typeOf`, тип `TransactionType`, тип `DuplicateCheck`.

Журнал переказу (`application/hand-off.ts`): поки позначено, власна подія зарахування сторнована, власна подія списання —
комісія (в одній валюті, якщо є) за датою переказу, а подія `transfer` / `fx-transfer` з джерелом `transactions` /
ідентифікатор переказу (ключ `transactions.transfer:<переказ>`) — від рахунку журналу списання до рахунку зарахування.
Подію переказу веде передача списання; передача зарахування сторнує лише подію переказу, якого рядок уже не має. Дії
передачі `transfer` / `untransfer` несуть `transferId`; запис аудиту — `update` з полями `transfer.side`,
`transfer.with`, `transfer.rate`.

Порядок однієї зміни (`application/transactions.ts`; ARC-04 п. 2, 3, ADR-0015) — у транзакції модуля з рядком під
блокуванням: перевірки → рядок → задача передачі `transactions.hand-off` (`application/hand-off.ts`; ключ
`<дія>:<транзакція>:<версія рядка>`) → коміт. Журнал і аудит — лише після коміту: одразу сам запит (поза транзакцією
зміни) і воркер із черги, якщо це не вдалося; невдача одразу не є помилкою запиту (201 / 200, подія логу
`transactions.hand_off_deferred`, WARN, лише клас помилки). Передача не несе суми: під блокуванням рядка в новій
транзакції модуля журнал доводиться до рядка, яким він є на момент виконання — немає рядка: кожен запис, що діє,
сторнується (`reverse`, ключ `transactions.delete:<запис>`), так само для рядка «Очікує»; немає запису: `post`
(`transactions.create:<транзакція>` для версії 1, далі `transactions.post:<транзакція>:<версія>`);
запис на іншому рахунку журналу, з іншою сумою чи датою: `correct` (`transactions.edit:<запис, що діє>`). Тож пізня
передача ранньої зміни не скасовує пізнішої. Потім — запис аудиту `transactions.transaction`/`create`·`update`·`delete`
(розділення, приховування й показ — `update` з полями `split.*` чи `hidden`; дія передачі `split`, `hide`, `show`)
з ключем `transactions.<дія>:<транзакція>:<версія>` (поля до й після; контрагент і опис замасковані вже в задачі, тож
корисне навантаження черги вільного тексту не має). Поки передачу не завершено (лише після збою), транзакція є без
запису журналу (залишок її ще не показує) і без запису аудиту — ніколи навпаки. Рахунок журналу субрахунку береться з
`AccountDirectory` модуля accounts; поки передача створення рахунку його не відкрила, задача повторюється. Стан рахунку
(закритий) читається окремою транзакцією модуля accounts: закриття, що збігається в часі зі створенням транзакції, не
блокується; закриття саме перевіряє рухи після дати закриття.

## Залежності

Шар: subject. Модулі: accounts, audit, categories, fx-rates, ledger (`apps/api/module-rules.json`).

## Події

| Публікує | Версія | Коли |
| --- | --- | --- |
| — | | |

| Споживає | Версія | Навіщо |
| --- | --- | --- |
| — | | |

## Власні таблиці

Схема `transactions`; міграції — `adapters/db/migrations/NNNN_slug.sql`. Політика простору — від запуску міграцій.

| Таблиця | Що |
| --- | --- |
| `transactions` | Транзакція: рахунок і субрахунок (модуля accounts), сума NUMERIC(38,18) зі знаком (не 0) і валюта, дата, контрагент, опис, стан (`posted` / `pending`), джерело (`manual`), `hidden`, режим розділення і `split_needs_review`, версія, час запису; похідні `direction`, `magnitude`, `search_text`, `is_split` для фільтрів списку (`0001_transactions.sql`, `0004_states_and_splits.sql`) |
| `transaction_parts` | Частини розділення по порядку: категорія (дерева модуля categories), місяць частки «На кілька місяців», сума зі знаком і валюта; видаляються з транзакцією (`0004_states_and_splits.sql`) |
| `transfers` | Пара переказу: списання і зарахування (кожна транзакція — в одному переказі), у двох валютах — курс (1 одиниця валюти зарахування у валюті списання), його дата і джерело (`0005_transfers.sql`); у `transactions` — `transfer_id` і похідна `is_transfer` |
| `duplicate_dismissals` | «Не дубль»: пара транзакцій у порядку ідентифікаторів; зникає з будь-якою з них (`0006_duplicates.sql`); у `transactions` — `merged_into` (злитий дубль) |
| `idempotency_keys` | Ключі ідемпотентності створення (ARC-07 п. 4; `0002_idempotency_keys.sql`, дослівно) |
| `jobs`, `outbox_events` | Черга модуля (ARC-04; `0003_queue.sql`, дослівно `queue-tables.sql`): задачі передачі `transactions.hand-off`; подій модуль поки не публікує |

Синтетичні дані: `synthetic.ts` (20 транзакцій — серед них «Очікує», прихована і розділена на 2 частини, 1 переказ, 1 пара «Не дубль», 2 ключі, 3 виконані задачі передачі й 1 передана подія на простір).
