# Модуль transactions

**Створено:** 2026-11-13 · **Оновлено:** 2026-11-15 (ARC-04: передача журналу й аудиту через чергу модуля, ADR-0015)

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
AC7, AC10–AC14, AC21 (серверна частина), граничний випадок 2. Далі: категорія (після `categories`, BUD-01 a, рядок 19),
«Очікує», приховування імпортованих, коригування, розділення, перекази, дублі (FIN-03 b, рядок 16), масові дії (рядок
17), UI (рядки 115–117).

## Публічний інтерфейс

`index.ts`:

- `transactionsModule` — опис модуля з маршрутами (прапорець випуску і ключ функції `transactions.manual`, потребує
  `accounts.manual`; простір — лише сесії; транзакція чи рахунок іншого простору — як неіснуючі):
  - `POST /v1/transactions` (`createTransaction`, дозвіл `household.data.write`, `Idempotency-Key`) — `accountId`,
    `amount` (`amount` — десяткове зі знаком, не 0, не більше знаків, ніж у валюти; `currency` — валюта рахунку або
    субрахунку мультивалютного), `date` (не пізніше сьогодні, київська дата; 1900-01-01 і пізніше), `counterparty` (1–200,
    один рядок), `description` (до 1 000). Невідомий рахунок чи рахунок іншого простору — 400 `accountId: not_found`;
    інша валюта — 400 `amount.currency: currency_mismatch` («Валюта не відповідає рахунку»); майбутня дата — 400
    `date: date_in_future`; закритий рахунок — 409 `ACCOUNT_CLOSED`. → 201 транзакція.
  - `GET /v1/transactions/{transactionId}` (`getTransaction`, `household.data.read`) — `id`, `accountId`, `amount`,
    `type` (`income` / `expense`), `date`, `counterparty`, `description`, `status` (`posted`), `source` (`manual`),
    `recordedAt` («Дата і час»: час запису).
  - `PATCH /v1/transactions/{transactionId}` (`updateTransaction`, `household.data.write`) — ті самі поля, кожне
    необов'язкове; `null` чи порожній текст знімає контрагента чи опис. Зміна рахунку, суми чи дати — `correct` журналу
    (сторно і новий запис); лише тексти — без запису журналу; без змін — нічого. Рахунок транзакції чи новий закритий —
    409 `ACCOUNT_CLOSED`.
  - `DELETE /v1/transactions/{transactionId}` (`deleteTransaction`, `household.data.write`) — сторно запису, що діє, і
    видалення рядка; повтор — 404.
  - `GET /v1/transactions` (`listTransactions`, `household.data.read`) — рушій DAT-01 (`transactionsList`,
    `adapters/db/store.ts`): `filter` (`accountId.eq|in`, `date.gte|lte`, `type.eq:in|out`, `amount.gte|lte` — сума без
    знака, `counterparty.eq|has`, `search.has` — контрагент і опис), `sort` (`date`, `amount`, `counterparty`; за
    замовчуванням `-date`; у межах дати — час запису, `-date,-recordedAt`), `page`, `pageSize` (25, 50, 100). → `items`, `page`, `pageSize`, `count`, `from`, `to`,
    `summary` (рядок підсумків: `currency` профілю, `income`, `expense`, `difference`: сума без округлення, `converted`, `approximate`,
    `nearestRateCount`, `partial`, `noRateCount` — `createListTotals` платформи; групи сум рушія за знаком — `bySign`).
  Учасник з областю: «Транзакції» закриті політикою видимості за замовчуванням — читання 404, зміни 403 (дозвіл
  `household.data.write`).
- `createTransactionsServices({ accounts, ledger, totals, audit, clock, newId })` → `TransactionsServices` — порти маршрутів
  (`src/api.ts` → `ctx.services`; `main.ts`): `AccountDirectory` модуля accounts, `createLedger`, `createListTotals`
  (платформа) з `officialDatedRates` модуля fx-rates, журнал аудиту, годинник.
- `createTransactionsErasure(db)` → `TransactionsErasure.eraseHousehold(householdId)` → `{ transactions, idempotencyKeys,
  jobs }` — видалення простору (NFR-12@PoC п. 3) разом із рядками черги; викликає лише `data-erasure` (крок
  `transactions.records`) перед рахунками і журналом.
- `createTransactionsWorkerQueue(db, { accounts, ledger, audit })` → черга воркера (`src/wiring.ts`, `workerQueues`):
  задачі `transactions.hand-off` (`HAND_OFF_JOB`) зі схеми модуля, з тими самими портами, що в маршрутів.
- `createTransactionsHandOffRecovery(db, households)` → `{ run() }` — щоденна задача планувальника
  `transactions.hand-off-recovery` (до очищення черги): невдалі (`dead`) задачі передачі повертаються в чергу; подія логу
  `transactions.hand_off_requeued` (WARN), якщо хоч одна повернулася.
- `TRANSACTION_TYPES`, `typeOf`, тип `TransactionType`.

Порядок однієї зміни (`application/transactions.ts`; ARC-04 п. 2, 3, ADR-0015) — у транзакції модуля з рядком під
блокуванням: перевірки → рядок → задача передачі `transactions.hand-off` (`application/hand-off.ts`; ключ
`<дія>:<транзакція>:<версія рядка>`) → коміт. Журнал і аудит — лише після коміту: одразу сам запит (поза транзакцією
зміни) і воркер із черги, якщо це не вдалося; невдача одразу не є помилкою запиту (201 / 200, подія логу
`transactions.hand_off_deferred`, WARN, лише клас помилки). Передача не несе суми: під блокуванням рядка в новій
транзакції модуля журнал доводиться до рядка, яким він є на момент виконання — немає рядка: кожен запис, що діє,
сторнується (`reverse`, ключ `transactions.delete:<запис>`); немає запису: `post` (`transactions.create:<транзакція>`);
запис на іншому рахунку журналу, з іншою сумою чи датою: `correct` (`transactions.edit:<запис, що діє>`). Тож пізня
передача ранньої зміни не скасовує пізнішої. Потім — запис аудиту `transactions.transaction`/`create`·`update`·`delete`
з ключем `transactions.<дія>:<транзакція>:<версія>` (поля до й після; контрагент і опис замасковані вже в задачі, тож
корисне навантаження черги вільного тексту не має). Поки передачу не завершено (лише після збою), транзакція є без
запису журналу (залишок її ще не показує) і без запису аудиту — ніколи навпаки. Рахунок журналу субрахунку береться з
`AccountDirectory` модуля accounts; поки передача створення рахунку його не відкрила, задача повторюється. Стан рахунку
(закритий) читається окремою транзакцією модуля accounts: закриття, що збігається в часі зі створенням транзакції, не
блокується; закриття саме перевіряє рухи після дати закриття.

## Залежності

Шар: subject. Модулі: accounts, audit, fx-rates, ledger (`apps/api/module-rules.json`).

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
| `transactions` | Транзакція: рахунок і субрахунок (модуля accounts), сума NUMERIC(38,18) зі знаком (не 0) і валюта, дата, контрагент, опис, стан (`posted`), джерело (`manual`), версія, час запису; похідні `direction`, `magnitude`, `search_text` для фільтрів списку (`0001_transactions.sql`) |
| `idempotency_keys` | Ключі ідемпотентності створення (ARC-07 п. 4; `0002_idempotency_keys.sql`, дослівно) |
| `jobs`, `outbox_events` | Черга модуля (ARC-04; `0003_queue.sql`, дослівно `queue-tables.sql`): задачі передачі `transactions.hand-off`; подій модуль поки не публікує |

Синтетичні дані: `synthetic.ts` (20 транзакцій, 2 ключі, 3 виконані задачі передачі й 1 передана подія на простір).
