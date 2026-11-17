# Модуль file-storage

**Створено:** 2026-11-13 · **Оновлено:** 2026-11-17 (IMP-01 a: сховище файлів, хвиля 2, рядок 38)

Картка модуля (ARC-01). Робота з модулем починається з неї; оновлюйте її в тому ж PR, що й інтерфейс.

## Призначення

Сховище файлів просторів: перевірка типу за вмістом до збереження, межі ZIP-пакета під час розпакування, розміри на
потоці запиту, розбір в окремому воркері з межею пам'яті й часу, шифрування ключем простору, S3-сумісне сховище,
технічна межа 100 ГіБ на простір і віддача лише через підписані посилання ≤ 15 хв як завантаження з `nosniff`.
Антивірусу в PoC немає (ARC-06@PoC п. 4): тому приймаються лише CSV (і TSV), XLSX без макросів і XLS без VBA чи макросів.

Домен каталогу ARC-01: Документи. Реліз, з якого модуль у каталозі: PoC.

## Вимоги

ARC-06@PoC п. 4 і рядки критеріїв «Файл, доступний без підписаного посилання», «Файл недозволеного типу у сховищі»,
«Віддача файлу», «Розбір в окремому процесі»; NFR-01@PoC п. 4 і рядок «Підписані посилання»; NFR-15@PoC п. 18, п. 31, AC4,
AC6 і рядок «Технічна межа сховища»; IMP-01@PoC п. 3 (тип за вмістом), п. 13 (стелі), п. 14 (відхилення до читання клітинок),
п. 15 (тексти відхилень), AC2, граничні випадки 2 і 3 — серверна частина сховища. Партії, маршрути завантаження і відкриття
оригіналу, щоденне прибирання — рядок 39 (`import-sessions`), розбір рядків транзакцій — рядок 40 (`file-parsers`).

## Публічний інтерфейс

`index.ts`:

- `fileStorageModule` — опис модуля (маршрутів і подій ще немає).
- `createFileStorage({ db, audit, keys, objects, linkKey, now?, isolation?, spaceBytes? })` → `FileStorage`:
  - `store({ householdId, actorId, kind: "statement", fileName, declaredBytes?, budget, body })` → `StoredFile` — порядок:
    межа простору за заявленою довжиною (без читання потоку) → читання потоку під бюджетом запиту → перевірка типу і стелі в
    окремому воркері → шифрування ключем простору → у транзакції під блокуванням меж простору (`pg_advisory_xact_lock` на
    `space-limits:<простір>`, `SPACE_LIMITS_LOCK`) повторна перевірка 100 ГіБ, рядок, об'єкт `spaces/<простір>/files/<файл>`,
    запис аудиту. Відхилення — `FileRejectedError` (`rejection`: `code`, `status` 413 або 422, `ceiling`, `message.uk|en`), і
    нічого не збережено ні в сховищі, ні в базі;
  - `find(householdId, fileId)`, `link(householdId, fileId, ttlMs?)` → `{ token, expiresAt }` (≤ 15 хв),
    `open(householdId, token)` → `Download` `{ status: 200, headers, body }`: `content-type` за вмістом,
    `content-disposition: attachment`, `x-content-type-options: nosniff`, `cache-control: private, no-store`, CSP `sandbox`;
    посилання іншого простору, підроблене, прострочене чи на видалений файл — `FileNotFoundError` (одна відповідь);
  - `remove(householdId, fileId, actorId)` — рядок і запис аудиту в одній транзакції, об'єкт — після її коміту (невдалий коміт лишає і рядок, і об'єкт); `usage(householdId)` — байти всіх файлів простору.
- `uploadBudget(declaredRequestBytes?)` — бюджет одного запиту завантаження, спільний для його файлів: запит, заявлений понад 150 МіБ,
  відхиляється першим `read` до жодного байта (не при створенні, тож перевірка місця в `store` іде першою й повний простір
  отримує своє повідомлення про 100 ГБ, NFR-15 AC4); файл понад 25 МіБ або запит понад 150 МіБ — на потоці, читання зупиняється.
  Кожен шлях завантаження читає файли лише через нього.
- `linkKey(bytes)` — ключ підписів посилань (≥ 32 байти, із секретів розгортання); токен `v1.<файл>.<строк>.<HMAC-SHA256 над
  простором, файлом і строком>`, порівняння за сталий час.
- `FILE_LIMITS`, `PARSE_CEILINGS`, `SIGNED_LINK_MAX_TTL_MS`, `REJECTION_CODES`, `rejection`, `CONTENT_TYPES`, `FILE_FORMATS`,
  `FILE_KINDS`, `SPACE_LIMITS_LOCK`; типи `StoredFile`, `StoreRequest`, `Download`, `UploadBudget`, `LinkKey`, `Rejection`,
  `RejectionCode`, `FileFormat`, `FileKind`.

Одиниці — двійкові (25 МіБ, 150 МіБ, 200 МіБ, 100 ГіБ), рішення ведучого 2026-11-17. Хто викликає: поки ніхто — підключення в
`main.ts` (налаштування S3 і ключа посилань) і маршрути завантаження та відкриття оригіналу додає рядок 39.

## Залежності

Шар: subject. Модулі: audit (записи про збережені й видалені файли — лише вид, формат і розмір, без назви й вмісту),
household (`SpaceKeys.sealBytes` / `openBytes` — шифрування ключем простору) (`apps/api/module-rules.json`).
Зовнішні сервіси: S3-сумісне сховище лише через порт `object-storage` (`src/platform/adapters/object-storage`: `test` — у
пам'яті, `live` — S3 API з підписом `aws4fetch`); KMS — через household.

## Події

| Публікує | Версія | Коли |
| --- | --- | --- |
| — | | |

| Споживає | Версія | Навіщо |
| --- | --- | --- |
| — | | |

## Власні таблиці

Схема `file_storage`; міграції — `adapters/db/migrations/NNNN_slug.sql`.

- `files` — збережений файл простору: вид (`statement`), формат і тип за вмістом, назва для завантаження, розмір оригіналу,
  SHA-256, ключ об'єкта. Самих байтів у базі немає.

## Тести

`adapters/inspection/inspect.test.ts` (тип за вмістом, ZIP, XLS, стелі), `adapters/isolation/run.test.ts` (воркер, пам'ять,
час), `application/upload-budget.test.ts`, `application/signed-link.test.ts`, `domain/rejection.test.ts`,
`file-storage.it.test.ts` (PostgreSQL, тестове сховище), `file-storage.s3.test.ts` (локальне S3-сумісне сховище, `pnpm test:s3`,
CI-частина `checks`). Синтетичні файли — `synthetic-files.ts`, `synthetic-cases.ts`.
