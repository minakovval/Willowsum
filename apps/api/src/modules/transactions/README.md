# Модуль transactions

**Створено:** 2026-11-13 · **Оновлено:** 2026-11-27 (IMP-03@PoC п. 24: `TransferCandidates.counterpartsOf` — кандидати «Позначити як переказ» для transfer-matching); 2026-11-27 (BUD-01@PoC п. 7, AC4, #722 D: `createTransferMarking` — позначка переказу платежу на кредитну картку для transfer-matching; порт `cardPayments` маршруту «Нова транзакція»); 2026-11-26 (IMP-03 b, рядок 48: «Не пара» — `POST /v1/transactions/{id}/not-transfer`, таблиця `transfer_dismissals` (`0017_transfer_dismissals.sql`), дія передачі `not-transfer`, `TransferCandidates` без таких пар); 2026-11-26 (BUD-07@PoC п. 16: `AccountInflows` для `recurring`); 2026-11-26 (FIN-03@PoC п. 8, AC31, #722 A: `currencyDifference` переказу і різниця переказу в `inPeriod` бюджету — `transfersDatedIn`; FIN-03@PoC п. 22, рядок 222s: фільтр «Категорії» списку — `category.eq|in`, порт `CategoryTransactions` модуля categorization, індекс `transaction_parts_category` (`0016_parts_by_category.sql`)); 2026-11-21 (IMP-02@PoC п. 5, #698: `bankFee` — комісія банку імпортованого рядка, `ImportedRowInput.fee`, подія `transaction` з `fee`, колонки `bank_fee`, `bank_fee_currency` (`0015_bank_fee.sql`)); 2026-11-21 (IMP-02@PoC п. 4, S-047: дані рядка виписки — `bankDescription`, `balanceAfter`, `importedFrom`, `originalAmount`, `exchangeRate`, `valueDate`, `bankReference` у транзакції й у списку, `ImportedRowInput.original` / `rate` / `valueDate` / `reference`, `importedRate`, колонки `0014_bank_fields.sql`); 2026-11-21 (IMP-03 a, рядок 47: обмін валют між гаманцями одного рахунку — кандидат пари і переказ; BUD-06@PoC п. 8: «Одноразова витрата» — `PUT /v1/transactions/{id}/one-off`, прапорець `transactions.one-off`, колонка `one_off` (`0013_one_off.sql`), `oneOff` у `BudgetTransactions.inPeriod`, `GoalTransactions.countedInWindow` без позначених); 2026-11-20 (IMP-08 п. 11: `ImportBatchTransactions` для кроку «Результат», `importBatchId` сторін `TransferCandidates`; IMP-04 FR 8, IMP-16, рядок 44: `ImportedTransactions.rollback` / `rolledBack` / `rolledBackSince`, порт `categories`, `rolled_back_at`, `listed_hidden`, `import_rollbacks`, дія передачі `rollback`; IMP-04 c, #654 п. 6, #658: `ImportedTransactions` — злиття з ручною (`mergeInto`: ручну злито в банківський рядок, подія `transactions.import-merged`, порт `merged`), заміна очікуваної (`replaces`), `ImportCandidates.merged`; BUD-08 b: `CashflowMovements` для `cashflow`; IMP-01 п. 11, частина b, #654: `ImportedTransactions.settle`, `import_voids`, місця очікування, блокування грошей лише навколо запису; IMP-01 п. 11: `ImportedTransactions`, `import_writes`; IMP-04 a: `ImportCandidates`, джерело «imported»; BUD-06: `BudgetTransactions.firstDate`; BUD-05 #553, #559: `GoalTransactions`; #567: `AccountPayments` для `budget`; рядок 198: записи беруть блокування грошей рахунку `lockAccounts` модуля accounts; FIN-03 п. 1, 28: `createTransfer`; FIN-01 граничний випадок 4: `createTransactionPendingPostings`; FIN-03 b: «Очікує», приховані, розділення; перекази між власними рахунками; дублі; BUD-01 п. 12: категорії частин; BUD-01 b: `TransactionLookup`; FIN-03 п. 34–35: зміна злитої, прихована копія без пари; BUD-14 a: `TransactionTexts`; BUD-07 a1: `TransactionHistory`; BUD-13 a: «Нотатка», «Теги», «Додати теги», «Вибрано N · Сума»; BUD-12 a: «До розбору»; FIN-03 п. 27: «Історія змін», #439; BUD-14 b2: `TransactionRuleTags`)

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

BUD-13@PoC a) (хвиля 2, рядок 21 — серверна частина): п. 1 («Нотатка» до 2 000 символів, «Теги»), 2 (теги простору без
урахування регістру, до 60 символів і 20 на транзакцію; перейменування на наявний — об'єднання; видалення з кількістю;
фільтр «Теги»; масова дія «Додати теги»), 3 і 4 (прапорців і вкладень немає), 5 (атрибути в деталі й рядку; фільтри тегу,
мерчанта — `counterparty`, і розділення), 9 («Вибрано N · Сума ±X €»), аудит змін атрибутів; AC1, AC4 і AC9 (серверна
частина), AC6, AC7, граничні випадки 1, 5, 6. Далі: калькулятор і стислий розклад (п. 7, граничний випадок 3), «Схожі
транзакції» (п. 10) — UI, рядок 117; повторний імпорт (граничний випадок 4) — з імпортом.

BUD-12@PoC a) (хвиля 2, рядок 24 — серверна частина): п. 2 (черга «До розбору» — список із `review.eq:queued` від
найстаріших, лічильник), 4 і 7 («Підтвердити» з перевіркою версії; автор і час — у журналі аудиту), 5 («Пропустити» —
без змін на сервері), 6 («Відмінити» підтвердження), 8 (ручні транзакції в чергу не потрапляють), 10 (одна черга
простору), 12 і 14 (масова дія «Підтвердити категорії», групою — за ідентифікаторами); AC1, AC3, AC10 (серверна частина),
AC2, AC5–AC7, AC9, граничний випадок 2. Далі: постановка в чергу імпортом, зокрема «Можливий дубль» і повернення з
«потребує перегляду» (п. 8, 9, AC4, граничні випадки 1, 3 — з імпортом), режим «Мерчанти» — групи черги за мерчантом у модулі `merchants`
(`TransactionTexts`), UI (рядок 121).

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
    `month` — YYYY-MM частки місяця або null, `amount`) або null, `recordedAt` («Дата і час»: час запису). IMP-02@PoC
    п. 4 (S-047): `bankDescription` (опис банку як надруковано, замаскований; правка «Опис» його не змінює),
    `balanceAfter`, `importedFrom` (`batchId`, `fileId`, `row`), `originalAmount` (початкова сума й валюта зі знаком
    суми), `exchangeRate` (курс банку), `valueDate` (дата валютування), `bankReference`, `bankFee` (комісія банку всередині суми, додатна; IMP-02 п. 5, #698) — null у введеної вручну й там,
    де виписка їх не має; так само в елементах `GET /v1/transactions`. Лише в просторі транзакції (інший — 404).
  - `PATCH /v1/transactions/{transactionId}` (`updateTransaction`, `household.data.write`) — ті самі поля, кожне
    необов'язкове; `null` чи порожній текст знімає контрагента чи опис. Зміна рахунку, суми чи дати — `correct` журналу
    (сторно і новий запис); лише тексти — без запису журналу; без змін — нічого. `status`: `pending` сторнує запис,
    `posted` проводить знову. Зміна суми розділеної — розділення лишається з `needsReview` (BUD-01 п. 6). Рахунок
    транзакції чи новий закритий — 409 `ACCOUNT_CLOSED`.
  - `DELETE /v1/transactions/{transactionId}` (`deleteTransaction`, `household.data.write`) — сторно запису, що діє, і
    видалення рядка; повтор — 404. Імпортовану (`source = imported`) не видаляють, а приховують: запис журналу лишається
    (FIN-03 п. 16, 18, AC9; IMP-04 п. 9); приховану вдруге — без змін.
  - `GET /v1/transactions` (`listTransactions`, `household.data.read`) — рушій DAT-01 (`transactionsList`,
    `adapters/db/store.ts`): `filter` (`accountId.eq|in`, `date.gte|lte`, `type.eq:in|out`, `amount.gte|lte` — сума без
    знака, `counterparty.eq|has`, `search.has` — контрагент і опис, `status.eq|in`, `split.eq`, `hidden.eq`, `tag.eq|in` (BUD-13; масив `tag_ids`, `array` рушія), `category.eq|in` (FIN-03 п. 22 «Категорії», «Показати транзакції»
    BUD-01 AC 20: точно названі категорії; нерозділена — за власною категорією через порт `CategoryTransactions`
    модуля categorization (`createTransactionsServices({ categoryTransactions })`, `src/main.ts`; без нього — 500),
    розділена — за частинами; категорія іншого простору — порожня сторінка; понад 20 000 транзакцій на всі фільтри категорії запиту разом (з кожного
    джерела; повторений фільтр читається раз) — 422
    `LIMIT_REACHED`; «Вибрати всі за фільтром» масових дій його ще не приймає); без фільтра
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
  - `PATCH /v1/transactions/{transactionId}/attributes` (`setTransactionAttributes`, ключ і прапорець
    `transactions.attributes`) — `note` (до 2 000; null чи порожній знімає) і `tags` (імена, замінюють теги транзакції:
    кожне 1–60 символів, обрізане, один рядок; той самий без урахування регістру — раз; понад 20 — 400 `tags: too_many`;
    тег, якого в просторі немає, створюється). Злитий дубль — 409 `TRANSACTION_MERGED`, закритий рахунок — 409
    `ACCOUNT_CLOSED`. Запис аудиту — `update` з полями `note` (замасковано) і `tags` (ідентифікатори); журнал не змінюється.
    Кожна транзакція має `note` і `tags` (`id`, `name` по порядку) — і в списку.
  - `PUT /v1/transactions/{transactionId}/one-off` (`setTransactionOneOff`, ключ і прапорець `transactions.one-off`,
    потребує `transactions.manual`; BUD-06@PoC п. 8, AC4) — `{ oneOff }`: «Одноразова витрата» в деталях транзакції.
    Лише витрата (від'ємна сума; дохід — 400 `oneOff: not_expense`), не сторона переказу (409 `TRANSACTION_IN_TRANSFER`);
    зняти можна завжди; злитий дубль — 409 `TRANSACTION_MERGED`, закритий рахунок — 409 `ACCOUNT_CLOSED`; те саме значення
    — нічого. Запис аудиту — `update` з полем `oneOff` (`true` / null); журнал не змінюється. Кожна транзакція має
    `oneOff` — і в списку (false, поки `transactions.one-off` вимкнено, #685). Зміна, після якої сума не від'ємна, або позначення стороною переказу знімає позначку із записом аудиту (`keepsOneOff`, #685). Позначена лишається у факті свого періоду, а середні (`BudgetTransactions`,
    `GoalTransactions`) її не рахують; злиття ручної в імпортовану переносить позначку.
  - `GET /v1/transaction-tags` (`listTransactionTags`) — теги простору за назвою з `count` (транзакцій із тегом, приховані
    теж: «Тег буде знято з N транзакцій»). `PATCH /v1/transaction-tags/{tagId}` (`renameTransactionTag`) — `{ name }`;
    назва іншого тегу простору (без урахування регістру) — об'єднання: той лишається, кожна транзакція має його раз, цей
    зникає; → 200 тег, що лишився. `DELETE /v1/transaction-tags/{tagId}` (`deleteTransactionTag`) — знімає тег з усіх
    транзакцій → `{ deleted, removed }`. Запис аудиту — сутність `transactions.tag` (назва замаскована; `mergedInto`,
    `transactions` — кількість) через задачу `transactions.tag-audit`; кожна транзакція з тегом отримує нову версію.
  - `POST /v1/transactions/selection-summary` (`summarizeTransactionSelection`, ключ `transactions.manual`) — `{ ids }`
    (1–500): `count`, `sum` у валюті профілю за курсом дати кожної транзакції (`ListTotals`), `convertedCount`,
    `approximate`, `nearestRateCount`, `noRateCount`; транзакції поза простором не рахуються і не згадуються.
  - `POST /v1/transactions/{transactionId}/hide` і `/show` (`hideTransaction`, `showTransaction`; ключ і прапорець
    `transactions.states`) — приховати і показати знову; ручна транзакція, прихована як дубль, знімається з балансу (її
    проводка сторнується, як у злитого дубля), а показана знову — проводиться (FIN-03 п. 17; рішення власника
    2026-11-15, #285 п. 1); проводка імпортованої лишається. Якщо вимкнути `transactions.states`, приховані рядки зникають
    зі списку, а `show` відповідає 404 (#264 п. 9).
  - `POST /v1/transactions/{transactionId}/transfer` (`markTransfer`; прапорець і ключ `transactions.transfers`, потребує
    `transactions.manual`) — `{ counterpartId }`: «Позначити як переказ» і «Підтвердити» пропозиції. Обидві — простору,
    «Проведена», не приховані, не розділені, не в іншому переказі, на двох активних рахунках, одна списання, друга
    зарахування; в одній валюті зарахування не більше за списання (інакше 400 `counterpartId: amount_mismatch`; інші коди
    — `not_found`, `same_account`, `same_direction`, `pending`, `hidden`, `split`, `in_transfer`); у двох валютах —
    офіційний курс дати переказу (немає — 400 `rate_unavailable`). Закритий рахунок — 409 `ACCOUNT_CLOSED`; сторона
    змінилася між читанням курсу і зміною — 409 `VERSION_CONFLICT`. → 200 транзакція з `transfer` (`id`, `side` —
    `outflow` / `inflow`, `counterpartId`, `date` — дата ранішої сторони, `fee` — комісія ≤ 0 або null,
    `currencyDifference` — у двох валютах зараховане мінус списання за збереженим офіційним курсом дати, у валюті
    зарахування (від'ємна — втрата, додатна — виграш «Комісії банку»; FIN-03@PoC п. 8, рішення власника 2026-11-26, № 11)
    або null, `rate` або null).
  - `POST /v1/transactions/transfers` (`createTransfer`; прапорець і ключ `transactions.transfers`, дозвіл
    `household.data.write`, `Idempotency-Key`) — FIN-03 п. 1, 28 «Переказ між рахунками» однією дією (#437):
    `fromAccountId`, `toAccountId`, `amount` (додатна, у валюті рахунку списання), `received` (необов'язкова, додатна, у
    валюті рахунку зарахування; в одній валюті не більша за `amount` — інакше 400 `received: amount_mismatch`, різниця —
    комісія; без неї — сама сума, у двох валютах — сума за офіційним курсом дати, округлена до парного до копійок
    валюти), `date`, `counterparty`, `description` (на обох сторонах). Обидві сторони «Проведена», пара і дві задачі
    передачі — в одній транзакції модуля, або нічого; журнал — одна подія `transfer` / `fx-transfer` (у двох валютах —
    курс дати, немає — 400 `date: rate_unavailable`). Рахунок іншого простору чи невідомий — 404; той самий —
    400 `toAccountId: same_account`; закритий — 409 `ACCOUNT_CLOSED`; решта полів — як у `createTransaction` (`amount` —
    `sign`, `zero`, `invalid`, `amount.currency` / `received.currency` — `currency_mismatch`, `date`). Запис аудиту —
    `create` кожної сторони з `transfer.side` і `transfer.with`. → 201 `{ outflow, inflow }`.
  - `DELETE /v1/transactions/{transactionId}/transfer` (`unmarkTransfer`) — п. 9: обидві знову дохід і витрата; без
    позначки — нічого.
  - `POST /v1/transactions/{transactionId}/not-transfer` (`dismissTransfer`; той самий прапорець, дозвіл і перевірки
    сторін, що й «Підтвердити») — `{ counterpartId }`: «Не пара» пропозиції (IMP-03 п. 12) — пара більше ніколи не
    кандидат (`TransferCandidates`), навіть після «Роз'єднати»; більше нічого не змінюється. Коди 400 — як у
    `markTransfer` (без `rate_unavailable`); закритий рахунок транзакції — 409 `ACCOUNT_CLOSED`. Повтор — нічого. Запис
    аудиту транзакції, на якій дія, — `notTransferOf` (п. 19).
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
    `account_mismatch`, `amount_mismatch`, `merged`); пара більше не «Можливий дубль». Повтор — нічого. Прихована
    сторона пари приймається і показується знову (п. 35).
  - Злитий дубль: `PATCH`, `DELETE`, `show`, `hide`, `split` — 409 `TRANSACTION_MERGED`; та, у яку злито, — `DELETE`
    409 `TRANSACTION_MERGED` (спершу «Роз'єднати»), `PATCH` суми (валюти) або рахунку — 409
    `TRANSACTION_HAS_DUPLICATES` (FIN-03 п. 34; клієнт пропонує «Роз'єднати»), решта (дата, тексти, статус) змінюється. Кожна транзакція має `mergedInto` (у яку злито
    або null) і `mergedDuplicates` (злиті в неї — «Об'єднано»).
  - `POST …/hide` (п. 18): лише «Можливий дубль» зараз за правилом `duplicate-matching` (`DuplicateCheck`: вікно і
    рішення; пошук — у транзакції зміни під блокуванням дублів простору, тож з двох копій приховується лише одна),
    інакше 409 `TRANSACTION_NOT_HIDEABLE`; технічних записів у цьому випуску немає (з підключеннями банків).
  - Прихована копія без пари (FIN-03 п. 35): `PATCH` суми, рахунку або дати, `DELETE` і «Не дубль» показують знову
    ручну приховану копію, у якої не лишилося пари «Можливий дубль» (і сам змінений рядок, якщо він прихована копія), у
    тій самій транзакції бази, з передачею `show` (проводка повертається). Порядок блокувань: консультативне
    `transactions.duplicates:<простір>` першим (його беруть і `hide`), потім рядки в порядку id.
  Учасник з областю: «Транзакції» закриті політикою видимості за замовчуванням — читання 404, зміни 403 (дозвіл
  `household.data.write`).
  - «До розбору» (BUD-12 a; прапорець випуску і ключ `transactions.review`, потребує `transactions.manual`): черга —
    `GET /v1/transactions?filter=review.eq:queued&sort=date`; кожна транзакція має `review` (`queued` — у черзі,
    `confirmed` — категорію підтверджено, null — ніколи не була в черзі: ручна) і `version`.
    `GET /v1/transaction-review` (`getTransactionReviewCount`) → `{ count }` — лічильник (показані транзакції черги).
    `POST /v1/transactions/{transactionId}/review/confirm` (`confirmTransactionReview`) і `…/review/reopen`
    (`reopenTransactionReview`, «Відмінити»), тіло `{ version }`: інша версія — 409 `VERSION_CONFLICT` з
    `currentVersion`; ручна (ніколи не в черзі) — 409 `TRANSACTION_NOT_IN_REVIEW`; злитий дубль — 409
    `TRANSACTION_MERGED`; уже підтверджена (у черзі) — нічого. Закритий рахунок не заважає (як і зміні категорії).
    Запис аудиту — `update` з полем `review`; журнал не змінюється. Зміна категорії чи транзакції після підтвердження
    в чергу не повертає.
  - `GET /v1/transactions/{transactionId}/history` (`getTransactionHistory`, `household.data.read`; прапорець і ключ
    `transactions.history`, потребує `transactions.manual`) — «Історія змін» деталі S-047 (FIN-03 п. 27, #439): записи
    журналу аудиту простору (п. 20) сутностей `transactions.transaction` і `categorization.transaction-category` цієї
    транзакції, від найстарішого (`domain/history.ts`), не відтворені з рядка; не більше 500 найновіших (`HISTORY_MAX`), журнал
    читається з `LIMIT`; `truncated: true` — давніші пропущено. → `items`: `id`, `occurredAt` (UTC),
    `actor` — відносно читача (`you`, `member`, `staff`, `system`; ідентифікатора акаунта немає), `channel`, `action`
    (`create` / `update` / `delete`), `changes` (`field`, `before`, `after`, `masked`; замасковані — контрагент, опис,
    нотатка — лише `•••` або null, хай що збережено і як позначено в журналі: маскування за назвою поля; зміни інших записів групового запису відкинуто). Транзакція іншого
    простору, невідома чи видалена — 404, журнал не читається; учасник з областю — 404.
- `createTransactionsServices({ accounts, ledger, totals, audit, clock, newId, categories?, flags?, rates?, duplicates? })` →
  `TransactionsServices` — порти маршрутів (`src/api.ts` → `ctx.services`; `main.ts`): `AccountDirectory` модуля
  accounts, `createLedger`, `createListTotals` (платформа) з `officialDatedRates` модуля fx-rates, журнал аудиту (з
  `entriesFor` — і джерело «Історії змін», без нього вона — 500),
  годинник; `CategoryDirectory` модуля categories (без нього «Розділити» — 500), середовище прапорців (без нього
  «Очікує» вимкнено), курси fx-rates (без них перекази — 500) і `DuplicateCheck` модуля duplicate-matching (без нього
  «Приховати транзакцію» — 500). BUD-01 п. 7 (#722 D): `cardPayments?` — `CardPaymentTransfers` модуля transfer-matching
  (за формою, без імпорту модуля): після «Нова транзакція» платіж на кредитну картку з власного рахунку простору стає
  переказом одразу, відповідь — уже з `transfer`; помилка там лишає пару пропозицією (WARN
  `transactions.card_payment_deferred`, лише клас).
- `createTransactionTagBulkActions({ db, accounts, newId })` → `{ targets, actions }` для `createBulkActionsServices`
  (`src/wiring.ts`; DAT-03 п. 2, BUD-13 п. 2): ціль `transaction-tags` (вибір за фільтром списку; поле `tags` — JSON імен
  по порядку; версія — версія транзакції; запис — правилами однієї зміни, без власного аудиту) і дія
  `transactions.add-tags` (`{ tags }`: теги додаються після наявних, той самий раз; усі вже є — «без змін»; понад 20 —
  «невалідний» `tags.too_many`; злитий дубль — `transaction.merged`; закритий рахунок — `account.closed`). Імена в
  груповому аудиті замасковані. «Відмінити» повертає теги за назвами.
- `createTransactionReviewBulkActions({ db, flags? })` → `{ targets, actions }` для `createBulkActionsServices`
  (`src/wiring.ts`; BUD-12 п. 12, 14): ціль `transaction-review` (вибір за фільтром списку від найстаріших; поле
  `review`; версія — версія транзакції; запис — правилами однієї зміни, без власного аудиту) і дія
  `transactions.confirm-category` (без параметрів; за прапорцем `transactions.review`): у черзі — підтверджено;
  підтверджена чи ручна — «без змін»; злитий дубль — `transaction.merged`. Груповий запис аудиту; «Відмінити» повертає в
  чергу.
- `createTransactionsErasure(db)` → `TransactionsErasure.eraseHousehold(householdId)` → `{ transactions, idempotencyKeys,
  jobs }` (і `import_writes`, `import_voids`, `import_rollbacks`) — видалення простору (NFR-12@PoC п. 3) разом із рядками черги; викликає лише `data-erasure` (крок
  `transactions.records`) перед рахунками і журналом.
- `createTransactionsWorkerQueue(db, { accounts, ledger, audit })` → черга воркера (`src/wiring.ts`, `workerQueues`):
  задачі `transactions.hand-off` (`HAND_OFF_JOB`) зі схеми модуля, з тими самими портами, що в маршрутів.
- `createTransactionsHandOffRecovery(db, households)` → `{ run() }` — щоденна задача планувальника
  `transactions.hand-off-recovery` (до очищення черги): невдалі (`dead`) задачі передачі й аудиту тегів
  (`transactions.tag-audit`) повертаються в чергу; подія логу
  `transactions.hand_off_requeued` (WARN), якщо хоч одна повернулася.
- `createTransactionPendingPostings(db, { accounts, ledger, audit })` → `PendingPostings` модуля accounts (FIN-01@PoC
  граничний випадок 4): перед закриттям рахунку незавершені (`queued`, `running`, `dead`) задачі `transactions.hand-off`,
  що ще можуть змінити його гроші (транзакція на рахунку зараз; на ньому до зміни — видалення чи переміщення, поле
  аудиту `accountId`; сторона переказу, друга сторона якого на рахунку), виконуються одразу тим самим кроком, що й у
  воркера (ідемпотентно, рядок під блокуванням), до 100 за раз; `false`, якщо хоч одна не вдалася чи їх більше (подія логу
  `transactions.hand_off_deferred`, WARN) — закриття відмовляє. Лише рядки простору (`inHousehold`).
- `createTransactionCategoryUsage(db)` → `CategoryUsage` модуля categories (BUD-01@PoC п. 12): які з даних категорій
  мають частини розділених транзакцій простору (будь-яких, прихованих теж). Лише читання; з'єднує `src/main.ts`. Його
  `transactions(householdId, categoryId)` (BUD-02@PoC п. 23) — скільки розділених транзакцій простору (не відкочених)
  мають частину з категорією; одна транзакція — один раз.
- `createTransactionLookup(db)` → `TransactionLookup` для `categorization` (BUD-01 b; DAT-03 п. 1, 2; #272 п. 1), лише
  читання: `facts(householdId, ids)` — чи є транзакція (приховані теж), чи вона сторона переказу, розділена, злитий
  дубль; `select(householdId, filter, excluded, limit)` — «Вибрати всі M за фільтром» на рушії списку «Транзакції»
  (`transactionsList.ids`; без фільтра `hidden` — лише показані; невідомий фільтр — `invalid`).
- `createGoalTransactions(db, { oneOffEnabled? })` → `GoalTransactions` для `goals` (BUD-05@PoC п. 8, 10; #553, #559), лише читання:
  `countedInWindow(householdId, from, to)` — транзакції простору, які рахує період бюджету, за вікно дат (як
  `budgetRows`, без фільтра рахунків): показані, «Очікує» теж, без злитих дублів і сторін переказу; сума зі знаком, у
  розділених — частини (категорія, сума, місяць); `oneOff` — «Одноразова витрата» (BUD-06@PoC п. 8; false, поки
  `transactions.one-off` вимкнено, `createGoalTransactions(db, { oneOffEnabled })`); `spendCandidates(householdId,
  { accountId, currency, excluded, search, after, limit })` — вихідні «Проведена» показані транзакції у валюті, не
  сторони переказу й не злиті, на рахунку (null — будь-якому), крім `excluded`, з пошуком (`%`, `_` — буквально);
  найновіші спершу (дата, час запису, id) після `after`, не більше `limit`, і `count` — усього без `after`.
- `createTransactionTexts(db)` → `TransactionTexts` для `merchants` (BUD-14 a), лише читання: `counterparties(householdId,
  ids)` — контрагент кожної наявної транзакції (приховані теж; null — немає); `counterpartyCounts(householdId)` — кожен
  різний контрагент показаних транзакцій простору і їхня кількість. BUD-12 FR 14–16 (режим «Мерчанти» черги, модуль
  `merchants`): `reviewQueueSlices(householdId, limit)` — черга (показані з `review = 'queued'`, як у лічильника),
  порахована й підсумована в SQL за контрагентом і валютою (сума — точний NUMERIC текстом), від найстаріших, не більше
  `limit`, `more`; `reviewQueueMembers(householdId, { counterparties, none, after, limit })` — транзакції черги цих
  контрагентів (`none` — і без контрагента): `id`, `counterparty`, за ідентифікатором після `after`, `more`.
- `createTransactionRuleInputs(db)` → `TransactionRuleInputs` для правил категорій `categorization` (BUD-14 b1), лише
  читання: `inputs(householdId, ids)` — рахунок, сума зі знаком і валюта, дата, контрагент і `eligible` (показана, не
  сторона переказу, не розділена, не злита) кожної наявної транзакції; `candidates(householdId, limit)` — такі
  транзакції від новішої (дата, потім ідентифікатор), не більше `limit`, і `more`. `transactionCreated` — подія.
- `createTransactionRuleTags({ db, accounts, newId, flags? })` → `TransactionRuleTags` для правил категорій
  `categorization` (BUD-14 b2, п. 5, 7, 9; за прапорцем `transactions.attributes`, без нього — `refused`): `check(names)`;
  `addTags(householdId, id, names, actorAccountId | null)` — теги правила після власних, той самий раз, тег створюється за
  потреби; правилами однієї зміни атрибутів (злитий дубль, закритий рахунок, понад 20 — `refused`) з передачею (запис
  аудиту `update` з `tags`; `actorAccountId` null — система: нова транзакція) → `changed` (назви до й після) /
  `unchanged` / `refused`; `restoreTags(householdId, id, expected, next, actorAccountId)` — «Відмінити» запуску: `next`,
  лише якщо теги досі `expected` (за ключем і порядком) → `restored` / `changed`. Кожен виклик — окрема транзакція модуля.
  `TransactionHandOff.actorAccountId` може бути null (система; запис аудиту — `system`).
- `createBudgetTransactions(db, { oneOffEnabled?, feeCategory? })` → `BudgetTransactions` для `budget` і `cashflow`, лише читання:
  `inPeriod` (транзакції рахунків за датами з частинами і `oneOff` — «Одноразова витрата», BUD-06@PoC п. 8; false, поки
  `transactions.one-off` вимкнено для простору; без `oneOffEnabled` — позначки діють; FIN-03@PoC п. 8, AC31 — з
  `feeCategory` («Комісії банку» простору, main.ts) ще по рядку на кожен позначений переказ дат із комісією (рахунок
  списання) чи валютною різницею (рахунок зарахування) на цих рахунках: `id` переказу, одна частина в «Комісії банку»,
  дата переказу; самі сторони переказу не входять) і `firstDate(householdId, accountIds)` — дата першої транзакції, яку рахує бюджет
  (BUD-06@PoC п. 4, 5: початок історії), null — немає.
- `createCashflowMovements(db)` → `CashflowMovements` для `cashflow` (BUD-08@PoC п. 5–7), лише читання: `transfers(householdId,
  from, to)` — позначені перекази між власними рахунками, чия показана вихідна сторона датована в ці дати (обидві
  сторони: рахунок, сума зі знаком, дата); `operations(householdId, accountIds, from, to)` — показані транзакції рахунків
  (кредитів) за датами, сторони переказу теж, без злитих дублів, з джерелом (`manual`, `imported`), найстаріші спершу.
- `createAccountPayments(db)` → `AccountPayments` для `budget` (#567, BUD-03 п. 5), лише читання: `paidIn(householdId,
  accountIds, from, to)` — рахунки (кредити), на які в ці дати надійшла показана транзакція з додатною сумою (сторона
  переказу теж; без злитих дублів).
- `createAccountInflows(db)` → `AccountInflows` для `recurring` (BUD-07 п. 16), лише читання: `inflows(householdId,
  accountIds, from, to)` — ті самі надходження (`accountId`, `transactionId`, `date`), від найстаршого; не більше 5 000
  найновіших (індекс `transactions_by_account`).
- `createTransactionHistory(db)` → `TransactionHistory` для `recurring` (BUD-07 a1), лише читання: `charges(householdId,
  { from, to, limit })` — показані транзакції простору з контрагентом за період (обидві дати включно), не сторони переказу
  і не злиті, будь-якого стану, від новішої, не більше `limit`; сума зі знаком у валюті транзакції.
- `createTransferCandidates(db)` → `TransferCandidates.candidatePairs(householdId, { windowDays, sameCurrencyMinShare,
  limit })` — пари-кандидати для `transfer-matching`: два рахунки або (IMP-03 п. 2, обмін валют) два гаманці одного
  рахунку у двох валютах (лише читання; правило вирішує той модуль). «Позначити як переказ» / «Підтвердити»
  (`POST /v1/transactions/{id}/transfer`) так само приймає обмін між гаманцями одного рахунку; один гаманець —
  `same_account`. Пари «Не пара» (IMP-03 п. 12) серед кандидатів не бувають.
  `TransferCandidates.counterpartsOf(householdId, transactionId, { windowDays, amountShare, limit })` (IMP-03 п. 24,
  «Позначити як переказ») — обрана транзакція простору (`chosen`: сторона, стан, прихована, розділена, у переказі; null —
  немає) і вільні транзакції протилежного напрямку на іншому рахунку (або в іншій валюті того самого) в межах
  `windowDays` до або після, у тій самій валюті в межах `amountShare` суми в обидва боки, в іншій — будь-яка сума; з
  `counterparty` і `description`; за днями між ними, потім різницею сум; до `limit`. Пари «Не пара» тут лишаються
  (лише читання).
- `createTransferMarking(db, { accounts, ledger, audit, newId, rates })` → `TransferMarking.mark(householdId,
  actorAccountId, outflowId, inflowId)` (BUD-01@PoC п. 7, AC4; #722 D) — «Позначити як переказ» пари для
  `transfer-matching` (платіж на кредитну картку): та сама дія, що й маршрут (`markTransfer`: блокування обох рядків і
  грошей рахунків, подія переказу в журналі, аудит кожної сторони від імені `actorAccountId`), передачі одразу; `true` —
  позначено, `false` — відмова (сторона змінилась, уже в переказі, інший простір, закритий рахунок, немає курсу), нічого
  не змінено.
- `createDuplicateCandidates(db)` → `DuplicateCandidates.candidatePairs(householdId, { windowDays, limit })` — пари
  можливих дублів для `duplicate-matching`: показані,
  на одному рахунку, та сама сума й валюта, у межах `windowDays`, не сторони переказу, не «Не дубль»; `first` — раніша
  (лише читання; правило вирішує той модуль).
- `createImportBatchTransactions(db)` → `ImportBatchTransactions.page(householdId, { batchId, limit, after? })` (IMP-08@PoC
  п. 11, AC7; для import-sessions): ідентифікатори транзакцій застосованої партії, про категорію яких питають — показані, не
  розділені, не сторона переказу; сторінка в порядку рядків партії (файл, рядок) після `after` на індексі
  `transactions_import_row`. Лише читання. `TransferCandidates`: кожна сторона має `importBatchId` (партія, що її записала;
  null — ручна).
- `createImportCandidates(db)` → `ImportCandidates.page(householdId, { accountId, from, to, limit, after })` — транзакції
  одного рахунку з датою в [from, to] для плану імпорту модуля `duplicate-matching` (IMP-04@PoC п. 1–6): приховані теж,
  злитий ручний дубль (і ручна, злита в банківський рядок) — ні, злита імпортована (замінена очікувана) — так, з `merged`; сума зі знаком, опис, залишок після операції, стан, джерело, партія імпорту, сторона переказу,
  `matched` (у неї вже щось злито); сторінка в порядку (дата, id) після `after` за індексом `transactions_by_account`.
  Лише читання.
- `createImportedTransactions(db, { accounts, ledger, audit, newId, now, merged? })` → `ImportedTransactions.write(householdId,
  input, plan)` для кроку застосування `import-sessions` (IMP-01@PoC п. 11, IMP-04@PoC п. 7): в одній транзакції —
  місце очікування простору (до `IMPORT_WAITERS_MAX` = 4 застосувань водночас, інакше `ImportBusy`, #654), блокування
  імпорту рахунків (`transactions.import:<простір>:<рахунок>`, чекає до 60 с), чи партію вже записано
  (`import_writes` → `first: false`, нічого не створює), чи спробу (`input.attemptId`) не відкликано (`import_voids` →
  `ImportWriteVoided`), перевірки рахунку (закритий — `ACCOUNT_CLOSED`), план (`plan(ctx)` — `ctx.candidates` для
  `planImport`, `ctx.creditCard(accountId)` — вид рахунку «кредитна картка» і `ctx.create(rows)` → `{ unlinked }`), рядки з джерелом `imported` (ключ `(партія, файл, рядок)` — унікальний, тож другий
  запис того самого рядка нічого не додає), «До розбору», банківський опис окремо (`bank_description`), подія
  `transactions.created`; IMP-04 п. 5 (`mergeInto`, #658): банківський рядок лишається показаним (дата, опис банку,
  власна подія журналу) і бере нотатку, теги й стан «До розбору» ручної; ручну злито в нього (прихована, `mergedInto`,
  її подія журналу сторнується; передачі `merge` ручної, потім `create` рядка; «Роз'єднати» повертає її), подія
  `transactions.import-merged` — категорію переносить categorization (порт `merged` одразу після коміту, задача — ще
  раз), п. 6 (`replaces` з сумою з плану): очікувану злито в проведений рядок (прихована, передача `merge`); інша
  транзакція блокується (рядки зв'язків — за зростанням ідентифікатора, як «Об'єднати»; нижчий за вже взятий — лише
  без очікування, `SKIP LOCKED`, зайнятий — зв'язку немає) й перевіряється знову (той самий рахунок і гаманець, не злита, не переказ, без злитих у неї;
  ручна — проведена, показана, не розділена, та сама сума; очікувана — імпортована, та сама сума, що в плані), інакше зв'язку немає
  (`unlinked`; рядок пишеться сам або, з `ifUnlinked: "skip"`, ні); лише потім блокування грошей рахунків і повторна перевірка рахунку (закритий чи замінений
  гаманець — `ImportWriteRefused`, усе відкочено; #654), передачі в журнал, запис `import_writes`. Після коміту виконує
  до 100 (`IMPORT_HAND_OFF_NOW`) передач, решту — воркер. Рядок, який рахунок не приймає, — `ImportWriteRefused` (усе
  відкочено). `ImportedTransactions.settle(householdId, { batchId, attemptId, accountIds })` (#654): під блокуванням
  імпорту — лічильники запису партії, якщо він є, інакше спробу відкликано (`import_voids`) і `null`. `importedText`
  — текст банку так, як його зберігає рядок (для плану; також `reference` — до 200 символів), `importedRate` — курс банку
  так, як його зберігає рядок (додатний, до 18 знаків, інакше null). IMP-02 п. 4: `ImportedRowInput.original`
  (початкова сума), `rate`, `valueDate`, `reference` пишуться в колонки `0014_bank_fields.sql`. Типи `ImportWriteInput`, `ImportedRowInput`, `ImportCreated`, `ImportCounts`,
  `ImportWriteResult`, `ImportPlanContext`.
- `createImportedTransactions(db, { …, categories? })` → `ImportedTransactions.rollback(householdId, { batchId, actorId,
  accountIds, mode })` (IMP-04@PoC п. 8, IMP-16@PoC п. 1–5, рядок 44): «Відкотити» партію в одній транзакції модуля — місце
  очікування, блокування імпорту рахунків партії (за id), запис `import_rollbacks` (є — `first: false`, нічого не змінює),
  рядки партії й злиті в них — одним запитом за зростанням id (`FOR UPDATE`; злитий у рядок партії тим часом —
  `ImportRollbackBusy`), блокування грошей і стан рахунків (закритий — `ImportWriteRefused`). Кожен рядок партії: сторона
  переказу — лишається (`transfers`; п. 6 — пізніша частина); змінений людиною після застосування (розділення, власна
  нотатка, категорія «вручну» за портом `categories` модуля categorization; нотатка й категорія ручної, злитої при
  застосуванні, — не зміна) з `keep-changed` — лишається (`kept`); інакше відкочено — прихований, `rolled_back_at`, передача
  `rollback` сторнує його подію журналу (нічого не видаляється), а злиті в нього (ручна, замінена очікувана) повертаються
  передачею `unmerge` (`restored`). Результат — `mode`, `rolledBackBy`, `rolledBackAt` (першого запиту), `counts` і
  `kept` (до 200 id). `ImportedTransactions.rolledBack(householdId, batchId)` — збережений результат або null;
  `rollbackPreview(householdId, batchId)` (IMP-16@PoC п. 4, рішення власника 2026-11-26, № 13) — без блокувань, за тим
  самим правилом, що й відкат: `{ transactions, changed, transfers }` діалогу відкату, null — уже відкочено;
  `rolledBackSince(householdId, since, before)` — записані відкати за проміжок (до `ROLLBACK_RECOVERY_LISTED` = 200,
  найраніші першими) для щоденного відновлення модуля import-sessions. Без порту `categories` відкат кидає помилку. Відкочена транзакція поза
  будь-яким читанням і зміною модуля (`find` / `lock` її не бачать, список — за `listed_hidden`, кандидати плану імпорту
  й категоризація — теж). Типи `ImportRollbackInput`, `ImportRollbackResult`, `RollbackMode` (`ROLLBACK_MODES`),
  `RollbackCategory`.
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
(закритий) читається окремою транзакцією модуля accounts, але під блокуванням грошей рахунку (`lockAccounts` модуля
accounts, рядок 198; #455, #409, #240, #290): кожен запис — створення, зміна (обидва рахунки), видалення, приховування,
розділення, переказ, позначка й зняття позначки переказу, злиття, роз'єднання, «Не дубль», «Не пара» — бере його для всіх своїх
рахунків разом, після блокувань рядків, і тримає до коміту. Тож закриття, «Оновити залишок» чи видалення гаманця йде
до запису (і запис бачить рахунок закритим: 409 `ACCOUNT_CLOSED`) або після нього (і бачить запис). Закриття спершу
доводить до журналу передачі, що вже в черзі (`createTransactionPendingPostings.settle`, FIN-01 граничний випадок 4), а
під блокуванням питає `unsettled`, чи не з'явилася передача після того.

## Розгортання і прапорці

Прапорці `transactions.states`, `transactions.transfers` і `transactions.duplicates` тримати вимкненими, доки всі процеси
(API і воркер) не працюють на цій версії: старий воркер не знає нових дій передачі (`merge`, `unmerge`, `not-duplicate`,
`transfer`) і не знімає прихований дубль з балансу, а старий `DELETE` не знає про злиті дублі (#281 п. 6, #264 п. 10).
Обмеження FIN-03 п. 18 (приховати можна лише «Можливий дубль», сторону переказу не приховують і не розділяють,
злитий дубль змінюється лише через «Роз'єднати») діють і при вимкненому прапорці відповідної частини: код перевірок не за
прапорцем (#281 п. 7). Те саме для п. 34 і 35. Блокування дублів простору змінено з `transactions.hide:<простір>:<рахунок>`
на `transactions.duplicates:<простір>`: стара версія й нова не бачать блокувань одна одної, тож і тут — прапорці
вимкнені, доки всі процеси не на цій версії. Так само для «Не пара» (IMP-03, рядок 48): старий воркер не знає дії
передачі `not-transfer`, тож нова версія розгортається на всі процеси до того, як «Не пара» стане доступною. Зняти прапорець `transactions.states` — приховані рядки зникають зі списку (див. вище).
Атрибути (BUD-13) — за прапорцем `transactions.attributes`: стара версія не знає задачі `transactions.tag-audit`
(задача чекає в черзі, потім `dead`, і щоденне повернення ставить її знову, коли процеси оновлено), а її `PATCH` не
стирає `note` і `tag_ids` (не пише цих колонок). «До розбору» (BUD-12) — за прапорцем `transactions.review`: стара
версія не пише й не стирає `review`, а запис аудиту підтвердження — звичайна дія передачі `update`.

## Залежності

Шар: subject. Модулі: accounts, audit, bulk-actions (типи портів), categories, fx-rates, ledger (`apps/api/module-rules.json`).
Викликає його import-sessions (`ImportedTransactions`, `ImportWriteRefused`).

## Події

| Публікує | Версія | Коли |
| --- | --- | --- |
| `transactions.created` | 1 | «Нова транзакція»: у транзакції створення, лише ідентифікатор (BUD-14 п. 8 — правила категорій `categorization`) |
| `transactions.import-merged` | 1 | «Злито з імпортом» (IMP-04 п. 5, #658): у транзакції запису партії — банківський рядок, злита в нього ручна, хто застосував; лише ідентифікатори (категорію переносить `categorization`) |

| Споживає | Версія | Навіщо |
| --- | --- | --- |
| — | | |

## Власні таблиці

Схема `transactions`; міграції — `adapters/db/migrations/NNNN_slug.sql`. Політика простору — від запуску міграцій.

| Таблиця | Що |
| --- | --- |
| `transactions` | Транзакція: рахунок і субрахунок (модуля accounts), сума NUMERIC(38,18) зі знаком (не 0) і валюта, дата, контрагент, опис, стан (`posted` / `pending`), джерело (`manual` / `imported`; імпортовану пише крок застосування імпорту), `import_batch_id` (партія import-sessions лише в імпортованої) і `balance_after` (залишок після операції з виписки) (`0009_imported.sql`), `import_file_id`, `import_row` (унікальний ключ рядка партії) і `bank_description` (опис банку) (`0010_import_rows.sql`), `original_amount` і `original_currency` (початкова сума), `exchange_rate` (курс банку), `value_date` (дата валютування), `bank_reference` (референс банку) — лише в імпортованої (`0014_bank_fields.sql`), `bank_fee` і `bank_fee_currency` (комісія банку, додатна, у своїй валюті — валюті рядка під час імпорту; обидва або жодного; лише в імпортованої; подія журналу — основна нога й нога комісії, `0015_bank_fee.sql`), `hidden`, режим розділення і `split_needs_review`, `one_off` («Одноразова витрата», BUD-06 п. 8, `0013_one_off.sql`), версія, час запису; похідні `direction`, `magnitude`, `search_text`, `is_split` для фільтрів списку (`0001_transactions.sql`, `0004_states_and_splits.sql`) |
| `tags` | Теги простору (BUD-13 п. 2): назва, ключ `name_key` (обрізана, нижній регістр; унікальний у просторі), версія; у `transactions` — `note` (до 2 000) і `tag_ids` (до 20, по порядку; GIN-індекс для фільтра) (`0007_attributes.sql`); `review` — «До розбору» (BUD-12: `queued` · `confirmed` · null), частковий індекс черги (`0008_review.sql`) |
| `transaction_parts` | Частини розділення по порядку: категорія (дерева модуля categories), місяць частки «На кілька місяців», сума зі знаком і валюта; видаляються з транзакцією (`0004_states_and_splits.sql`) |
| `transfers` | Пара переказу: списання і зарахування (кожна транзакція — в одному переказі), у двох валютах — курс (1 одиниця валюти зарахування у валюті списання), його дата і джерело (`0005_transfers.sql`); у `transactions` — `transfer_id` і похідна `is_transfer` |
| `duplicate_dismissals` | «Не дубль»: пара транзакцій у порядку ідентифікаторів; зникає з будь-якою з них (`0006_duplicates.sql`); у `transactions` — `merged_into` (злитий дубль) |
| `transfer_dismissals` | «Не пара» (IMP-03 п. 12): пара списання і зарахування, яку більше не пропонують; зникає з будь-якою з них (`0017_transfer_dismissals.sql`) |
| `import_writes` | Записана партія імпорту: лічильники, хто й коли (один рядок на партію; `0010_import_rows.sql`) |
| `import_voids` | Відкликані спроби застосування партії: партія, спроба, коли (`0011_import_voids.sql`) |
| `import_rollbacks` | Відкати партій (IMP-16 п. 3): партія, режим, лічильники, id залишених (до 200), хто й коли; `transactions.rolled_back_at` — транзакцію відкочено з партією, `listed_hidden` — фільтр «Приховані» без відкочених (`0012_import_rollbacks.sql`) |
| `idempotency_keys` | Ключі ідемпотентності створення (ARC-07 п. 4; `0002_idempotency_keys.sql`, дослівно) |
| `jobs`, `outbox_events` | Черга модуля (ARC-04; `0003_queue.sql`, дослівно `queue-tables.sql`): задачі передачі `transactions.hand-off`; подій модуль поки не публікує |

Синтетичні дані: `synthetic.ts` (20 транзакцій — серед них «Очікує», прихована і розділена на 2 частини, 1 переказ, 1 пара «Не дубль», 1 пара «Не пара», 2 теги на одній транзакції з нотаткою, 2 ключі, 3 виконані задачі передачі й 1 передана подія на простір).
