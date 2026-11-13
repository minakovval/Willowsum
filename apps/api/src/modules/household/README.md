# Модуль household

**Створено:** 2026-11-12 · **Оновлено:** 2026-11-13 (ACC-06@PoC: валюта звітності простору)

Картка модуля (ARC-01). Робота з модулем починається з неї; оновлюйте її в тому ж PR, що й інтерфейс.

## Призначення

Простір, учасники, запрошення, ролі, передача ролі Owner. Зараз (ACC-01@PoC, частина c): перший простір
«Родина <Прізвище>» під час першого входу, де користувач — Owner, і довідник «логін → простори», з якого API знає простір
і роль сесії. Рішення — [ADR-0010](../../../../../docs/adr/0010-first-space-and-daily-cleanup.md). Ключі просторів (ARC-06@PoC):
власний ключ даних кожного простору, обгорнутий головним ключем через порт KMS, окреме шифрування полів, переобгортання
після ротації і знищення ключа — [ADR-0012](../../../../../docs/adr/0012-space-keys.md).

## Вимоги

ACC-01@PoC п. 7 (AC5 — серверна частина); ACC-08@PoC п. 1 (назва, Owner, регіон ЄС; граничний випадок «одне слово»),
п. 2 (назва для профілю — серверна частина), п. 4 (рівно один Owner: унікальний індекс, передачі немає), п. 5 і AC5
(перейменування Owner з аудитом); ARC-06@PoC п. 1, 2 (механізм), 3 (переобгортання), 5 (знищення ключа); ACC-06@PoC п. 1, 2,
AC1, AC2 — серверна частина (валюта звітності — атрибут простору, EUR без вибору).
Далі: ACC-08@PoC AC1 — особа-власник (Person); UI «Налаштування → Простір», назва в профілі й валюта — рядок 111.

## Публічний інтерфейс

`index.ts`:

- `householdModule` — опис модуля з маршрутами налаштувань простору (ACC-08@PoC п. 2, 5; прапорець
  `household.space-settings`, ключ функції `household.core`; простір — лише сесії, ідентифікатора простору в запиті немає):
  - `GET /v1/space` (`getSpace`, дозвіл `household.data.read`) → `{ name, dataRegion, reportingCurrency }` — назва для
    профілю; `reportingCurrency` — валюта звітності простору (ACC-06@PoC: завжди `EUR`, перелік розширюваний);
  - `PATCH /v1/space` (`renameSpace`, дозвіл `household.rename` — Owner) `{ name }` → `{ name, dataRegion, reportingCurrency }`
    (маршруту зміни валюти звітності в PoC немає; `reportingCurrency` у тілі ігнорується): назва
    1–60 символів (кодові точки, NFC, без пробілів по краях, один рядок), унікальність не потрібна; інакше 400
    `VALIDATION_FAILED`. Запис `household.space`/`update` (`name`: стара → нова) пишеться в журнал простору всередині
    транзакції під замком запису: невдалий запис аудиту відкочує перейменування. Та сама назва — без змін і без запису.
- `createHouseholdServices({ audit })` → `HouseholdServices` — порти маршрутів модуля (`src/api.ts` → `ctx.services`).
- `createHouseholdSpaces(db, audit, kms)` → `HouseholdSpaces` (`kms` — порт `key-management`, `platform/adapters/kms`):
  - `ensureFirstSpace({ accountId, displayName })` → `{ householdId, role, created }` — простір «Родина <Прізвище>»
    (останнє слово імені; одне слово → «Родина <Ім'я>»; до 60 символів) у регіоні `eu` з акаунтом як Owner, лише якщо в
    акаунта немає жодного простору. Ідемпотентний, також для паралельних викликів (замок на акаунт у транзакції). Аудит —
    у журналі простору: `household.space` (`name`, `dataRegion`) і `household.member` (`role`). Ключ даних простору
    обгортається через KMS до транзакції і зберігається разом із простором (`encryption_key_ref` = `dek:<key_id>`); без KMS
    простір не створюється. Валюта звітності нового простору — `EUR` для будь-якої локалі (ACC-06@PoC п. 2, AC1); запис
    аудиту `household.space` має і `reportingCurrency`.
  - `membershipOf(accountId)` → `{ householdId, role }` або null — простір і роль акаунта (у PoC — його один простір).
  - `spaceIds()` → ідентифікатори всіх просторів з учасником — для щоденних перевірок планувальника (FIN-04 п. 9).
- `createSpaceKeys(db, audit, kms)` → `SpaceKeys` (ARC-06@PoC):
  - `seal(householdId, field, text)` → `ws1.…` — AES-256-GCM ключем простору, прив'язано до простору й поля (до 4096 символів);
  - `open(householdId, field, sealed)` → текст; інакше `SpaceKeyError` (`SEALED_VALUE_INVALID`, `SPACE_KEY_MISSING`,
    `SPACE_KEY_DESTROYED`);
  - `rewrapAll()` → `{ rewrapped, provisioned, failed }` — щоденна задача `household.space-keys` (`src/wiring.ts`); нова
    обгортка перевіряється розгортанням до збереження; кожне переобгортання — запис `household.space-key`/`update`
    (`masterKeyVersion`) у журналі простору;
  - `destroy(householdId)` → `{ destroyed }` — спершу запис `household.space-key`/`delete` у журналі платформи, потім
    знищення ключа; простір `pending:` позначається `destroyed:<id простору>` і ключа вже не отримає.
- `createSpaceErasure(db, audit)` → `SpaceErasure` (NFR-12@PoC п. 3; ADR-0013): `spacesOf(accountId)` — простори акаунта й
  кількість учасників; `eraseSpace(householdId)` — останній крок видалення простору: знищення ключа (запис у журналі
  платформи першим) і в тій самій транзакції під замком запису простору — видалення запису й рядків «логін → простір».
  Ключ, виданий щоденною задачею між читанням і замком, теж знищується (повторна перевірка під замком). Викликає лише
  `data-erasure`.
- `firstSpaceName`, `spaceName` (перевірка нової назви), `SPACE_NAME_MAX`, `SPACE_REPORTING_CURRENCY` (`EUR` — валюта звітності
  кожного простору в PoC; суми у валюті звітності — `createFxReporting` модуля fx-rates із цією валютою), `SPACE_ROLES`, `SPACE_KEY_ERROR_CODES`, `SEAL_MAX_LENGTH`, `SpaceKeyError`, типи
  `SpaceRole`, `SpaceMembership`, `SpaceKeyErrorCode`, `RewrapResult`.

Хто викликає: `main.ts` передає `createHouseholdServices({ audit })` у `mountApi`; `ensureFirstSpace` модулю identity (порт `FirstSpace`), `membershipOf` — у `src/api.ts`,
який будує того, хто викликає захищені маршрути, а `spaceIds` — щоденній перевірці журналу (ledger); `createSpaceKeys` — щоденній задачі ключів (`schedulerDailyTasks`).

## Залежності

Шар: platform. Модулі: audit (`apps/api/module-rules.json`) — записи про створення простору і власника, про ключі.
Зовнішні сервіси: KMS лише через порт `key-management` (`src/platform/adapters/kms`; робочий адаптер OCI Vault — до деплою).

## Події

| Публікує | Версія | Коли |
| --- | --- | --- |
| — | | |

| Споживає | Версія | Навіщо |
| --- | --- | --- |
| — | | |

## Власні таблиці

Схема `household`; міграції — `adapters/db/migrations/NNNN_slug.sql`.

| Таблиця | Що |
| --- | --- |
| `households` | Простір: `household_id` (ключ), назва (1–60), `data_region`, `reporting_currency` (ISO 4217; у PoC перевірка бази — лише `EUR`, міграція 0004), `encryption_key_ref` (`dek:<key_id>`; `destroyed:<key_id>` після знищення; `pending:<id>` у просторів, створених до ARC-06, доки задача не дасть ключ). Під політикою простору |
| `space_keys` | Обгорнутий ключ даних простору: `key_id`, `master_key_version`, `wrapped_key` (base64url), час створення і переобгортання. Відкритого ключа немає. Під політикою простору |
| `account_spaces` | Довідник «логін → простори»: `account_id`, `space_id`, роль; унікальний індекс `account_spaces_one_owner` — не більше одного Owner на простір (ACC-08 п. 4). Без політики простору (його читають до прив'язки простору); лише ідентифікатори й роль; виняток із причиною в `schema-exemptions.json` |

Синтетичні дані: `synthetic.ts` — один запис простору і один «обгорнутий ключ» (випадкові байти) на синтетичний простір.
