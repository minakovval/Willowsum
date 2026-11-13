# Модуль household

**Створено:** 2026-11-12 · **Оновлено:** 2026-11-13

Картка модуля (ARC-01). Робота з модулем починається з неї; оновлюйте її в тому ж PR, що й інтерфейс.

## Призначення

Простір, учасники, запрошення, ролі, передача ролі Owner. Зараз (ACC-01@PoC, частина c): перший простір
«Родина <Прізвище>» під час першого входу, де користувач — Owner, і довідник «логін → простори», з якого API знає простір
і роль сесії. Рішення — [ADR-0010](../../../../../docs/adr/0010-first-space-and-daily-cleanup.md). Ключі просторів (ARC-06@PoC):
власний ключ даних кожного простору, обгорнутий головним ключем через порт KMS, окреме шифрування полів, переобгортання
після ротації і знищення ключа — [ADR-0012](../../../../../docs/adr/0012-space-keys.md).

## Вимоги

ACC-01@PoC п. 7 (AC5 — серверна частина); ACC-08@PoC п. 1 (назва, Owner, регіон ЄС; граничний випадок «одне слово»);
ARC-06@PoC п. 1, 2 (механізм), 3 (переобгортання), 5 (знищення ключа).
Далі, ACC-08 (хвиля 2): особа-власник, валюта звітності, перейменування, назва в профілі.

## Публічний інтерфейс

`index.ts`:

- `householdModule` — опис модуля (маршрутів поки немає).
- `createHouseholdSpaces(db, audit, kms)` → `HouseholdSpaces` (`kms` — порт `key-management`, `platform/adapters/kms`):
  - `ensureFirstSpace({ accountId, displayName })` → `{ householdId, role, created }` — простір «Родина <Прізвище>»
    (останнє слово імені; одне слово → «Родина <Ім'я>»; до 60 символів) у регіоні `eu` з акаунтом як Owner, лише якщо в
    акаунта немає жодного простору. Ідемпотентний, також для паралельних викликів (замок на акаунт у транзакції). Аудит —
    у журналі простору: `household.space` (`name`, `dataRegion`) і `household.member` (`role`). Ключ даних простору
    обгортається через KMS до транзакції і зберігається разом із простором (`encryption_key_ref` = `dek:<key_id>`); без KMS
    простір не створюється.
  - `membershipOf(accountId)` → `{ householdId, role }` або null — простір і роль акаунта (у PoC — його один простір).
  - `spaceIds()` → ідентифікатори всіх просторів з учасником — для щоденних перевірок планувальника (FIN-04 п. 9).
- `createSpaceKeys(db, audit, kms)` → `SpaceKeys` (ARC-06@PoC):
  - `seal(householdId, field, text)` → `ws1.…` — AES-256-GCM ключем простору, прив'язано до простору й поля (до 4096 символів);
  - `open(householdId, field, sealed)` → текст; інакше `SpaceKeyError` (`SEALED_VALUE_INVALID`, `SPACE_KEY_MISSING`,
    `SPACE_KEY_DESTROYED`);
  - `rewrapAll()` → `{ rewrapped, provisioned, failed }` — щоденна задача `household.space-keys` (`src/wiring.ts`);
  - `destroy(householdId)` → `{ destroyed }` — знищує ключ; запис `household.space-key`/`delete` у журналі платформи.
- `firstSpaceName`, `SPACE_NAME_MAX`, `SPACE_ROLES`, `SPACE_KEY_ERROR_CODES`, `SEAL_MAX_LENGTH`, `SpaceKeyError`, типи
  `SpaceRole`, `SpaceMembership`, `SpaceKeyErrorCode`, `RewrapResult`.

Хто викликає: `main.ts` передає `ensureFirstSpace` модулю identity (порт `FirstSpace`), `membershipOf` — у `src/api.ts`,
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
| `households` | Простір: `household_id` (ключ), назва (1–60), `data_region`, `encryption_key_ref` (`dek:<key_id>`; `destroyed:<key_id>` після знищення; `pending:<id>` у просторів, створених до ARC-06, доки задача не дасть ключ). Під політикою простору |
| `space_keys` | Обгорнутий ключ даних простору: `key_id`, `master_key_version`, `wrapped_key` (base64url), час створення і переобгортання. Відкритого ключа немає. Під політикою простору |
| `account_spaces` | Довідник «логін → простори»: `account_id`, `space_id`, роль. Без політики простору (його читають до прив'язки простору); лише ідентифікатори й роль; виняток із причиною в `schema-exemptions.json` |

Синтетичні дані: `synthetic.ts` — один запис простору і один «обгорнутий ключ» (випадкові байти) на синтетичний простір.
