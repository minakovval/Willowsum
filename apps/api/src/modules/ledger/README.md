# Модуль ledger

**Створено:** 2026-11-12 · **Оновлено:** 2026-11-13

Картка модуля (ARC-01). Робота з модулем починається з неї; оновлюйте її в тому ж PR, що й інтерфейс.

## Призначення

Бухгалтерський журнал: подвійний запис, проводки, баланси, звірка. Єдине джерело правди про гроші й вартість у
бухгалтерському сенсі. Не знає про категорії, бюджети, мерчантів і тексти. Рішення —
[ADR-0011](../../../../../docs/adr/0011-ledger-journal.md).

## Вимоги

FIN-04@PoC, хвиля 1: частина 1 — п. 1–4, 6, 7, AC1, AC2, AC4, обмеження бази; частина 2 — сторно і зміна події
(п. 5, AC3), щоденна перевірка цілісності (п. 9, 10, ядро AC7); лист власнику продукту про розбіжність (п. 10, AC7,
граничні випадки 4–5; issue #130). ARC-11@PoC без кешу залишків і вихідної події.
Далі: AC5, AC6, AC8–AC11 (рахунки, транзакції, аудит коригувань, імпорт виписок).

## Публічний інтерфейс

`index.ts`:

- `ledgerModule` — опис модуля (маршрутів немає: журнал не має власних дій користувача, FIN-04 п. 8).
- `createLedger(db)` → `Ledger`, де `db` — `ModuleDatabases.for("ledger")`; кожен виклик прив'язаний до одного простору:
  - `openAccount(householdId, owner: { module, id }, { type, currency })` → `LedgerAccount` — рахунок журналу для
    запису модуля-власника; ідемпотентний; інший тип чи валюта — `ACCOUNT_CONFLICT`.
  - `post(householdId, { source, idempotencyKey, operationDate, event })` → `Entry` — збалансований набір проводок
    події за правилами (`EVENT_TYPES`: `transaction`, `transfer`, `balance-adjustment`, `asset-purchase`,
    `asset-revaluation`, `asset-sale`, `mortgage-payment`, `rental-income`) в одній транзакції; повтор ключа повертає
    наявний запис.
  - `reverse(householdId, entryId, idempotencyKey)` → сторно; повтор ключа повертає лише сторно цього запису, ключ
    іншого запису — `IDEMPOTENCY_KEY_REUSED`. `correct(householdId, entryId, replacement)` → сторно і новий запис в
    одній транзакції; ключ сторно виводиться з ключа заміни фіксованої довжини (`reversal:` і SHA-256, 73 символи),
    тож підходить будь-який ключ заміни 1–200 символів; ключ заміни, вже вжитий іншим записом (зокрема ключ самого
    запису), — `IDEMPOTENCY_KEY_REUSED`.
  - `balanceAt(householdId, accountId, date, { asKnownAt? })` → `Money` зі знаком типу рахунку.
- `createLedgerIntegrityCheck(db, spaces, report?, failed?, alerts?)` → `{ run }` — щоденна перевірка цілісності
  (планувальник, `main.ts`); порушення — подія `ledger.integrity_violation` рівня «помилка» без сум і назв. Простір,
  перевірка якого впала з помилкою, не зупиняє інші: їхні порушення звітуються, а кількість таких просторів — подія
  `ledger.integrity_check_failed` рівня «помилка» (`ws.ledger.spaces`, без ідентифікаторів). `alerts`
  (`LedgerIntegrityAlerts`: `alertMail` — поштовий адаптер і `WS_ALERT_EMAIL`, `clock`, `report`) — лист власнику
  продукту: один на період розбіжності (період — поспіль перевірки з тими самими видами й кількостями знахідок;
  закінчується перевіркою без порушень, де перевірено всі простори, або зміною знахідок); лише види перевірок і
  кількості, без сум, ідентифікаторів і адреси. Події: `ledger.integrity_alert_sent` («інфо»),
  `ledger.integrity_alert_failed` («помилка», лише клас помилки; заявку повернуто, наступний прогін надішле знову),
  `ledger.integrity_alert_release_failed` («помилка», лише клас помилки; заявку не вдалося повернути, тож до зміни
  знахідок або перевірки без порушень листа не буде),
  `alerts.recipient_missing` («помилка», без адреси листа немає). Збій листа ніколи не зриває перевірку.
- `LedgerError` (коди: `UNKNOWN_EVENT_TYPE`, `EMPTY_POSTING_SET`, `INVALID_POSTING`, `INVALID_EVENT`, `UNBALANCED`,
  `UNKNOWN_ACCOUNT`, `ENTRY_NOT_FOUND`, `ALREADY_REVERSED`, `REVERSAL_OF_REVERSAL`, `IDEMPOTENCY_KEY_REUSED`,
  `INVALID_DATE`, …),
  `ACCOUNT_TYPES`, `SERVICE_ACCOUNTS`, `EVENT_TYPES`, `RULES_VERSION`, `INTEGRITY_CHECKS`, типи `Entry`, `PostInput`,
  `LedgerEvent`, `LedgerAccount`.

- `createLedgerErasure(db)` → `LedgerErasure.eraseHousehold(householdId)` → `{ postings, entries, accounts }` — видалення
  журналу одного простору цілком в одній транзакції (NFR-12@PoC п. 3, ARC-11 «Видалення даних»; ADR-0013, варіант A).
  `db` — пул ролі видалення `ws_era_ledger`, єдиної, яку тригери пускають до DELETE, і лише простору цілком
  (`migrations/0003_erasure.sql`); UPDATE і TRUNCATE заборонені всім; `integrity_alerts` не видаляються. Викликає лише
  `data-erasure` зі скрипта власника.

## Залежності

Шар: subject. Модулі: — (`apps/api/module-rules.json`). Перелік просторів для щоденної перевірки передає `main.ts`
(`HouseholdSpaces.spaceIds()`).

## Події

| Публікує | Версія | Коли |
| --- | --- | --- |
| — | | «Проводку записано» — разом із чергою подій (ARC-04) |

| Споживає | Версія | Навіщо |
| --- | --- | --- |
| — | | |

## Власні таблиці

Схема `ledger`; міграції — `adapters/db/migrations/NNNN_slug.sql`. Таблиці журналу — під політикою простору; роль
`ws_mod_ledger` має на всіх таблицях лише SELECT і INSERT; тригери відхиляють UPDATE, DELETE і TRUNCATE для будь-якої
ролі.

| Таблиця | Що |
| --- | --- |
| `accounts` | План рахунків: тип, валюта; власник (`owner_module`, `owner_id`) або службовий рахунок (`service_kind`, один на валюту) |
| `entries` | Записи: джерело, тип події, дата операції, час запису (ставить база), версія правил, ключ ідемпотентності, `reverses_entry_id` |
| `postings` | Проводки: дебет, кредит, сума NUMERIC(38,18) > 0, валюта — обидва рахунки в ній (складені зовнішні ключі) |
| `integrity_alerts` | Журнал заявок на лист про розбіжність (лише дописування): `seq`, період (види і кількості знахідок) або NULL — періоду немає, час. Без `household_id` (`schema-exemptions.json`): ні просторів, ні сум, ні адреси |

Синтетичні дані: `synthetic.ts` (4 рахунки, 100 записів і 100 проводок на простір).
