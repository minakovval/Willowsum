# Модуль import-sessions

**Створено:** 2026-11-13 · **Оновлено:** 2026-11-19 (IMP-01 b: партії імпорту, хвиля 2, рядок 39, частина 1)

Картка модуля (ARC-01). Робота з модулем починається з неї; оновлюйте її в тому ж PR, що й інтерфейс.

## Призначення

Сесії імпорту, зіставлення колонок, перевірки, відкат.

Домен каталогу ARC-01: Імпорт. Реліз, з якого модуль у каталозі: PoC.

Партії імпорту (IMP-01@PoC b, рядок 39 плану хвилі 2): створення партії, завантаження одного чи багатьох файлів (multipart,
на потоці, під одним бюджетом запиту), оригінали лише через `file-storage` (вид «виписка»), підписані посилання ≤ 15 хв на
оригінал, стани партії (IMP-19@PoC п. 5) і «не вдалося розібрати», коли відхилено всі файли (п. 6). Записи аудиту — через
чергу модуля (ADR-0015) з щоденним поверненням мертвих завдань. За прапорцем випуску `data.import`. «Скасувати», «Видалити» і
щоденне прибирання через 30 днів (п. 12, п. 20, IMP-19 п. 6) — частина 2 рядка 39; розбір рядків — рядок 40.

## Вимоги

Зрізи PoC, що називають модуль: FLW-10@PoC, FLW-17@PoC, IMP-01@PoC, IMP-02@PoC, IMP-04@PoC, IMP-05@PoC, IMP-07@PoC, IMP-08@PoC, IMP-14@PoC, IMP-16@PoC, IMP-17@PoC, IMP-18@PoC, IMP-19@PoC, JRN-05@PoC, JRN-06@PoC. Функції додають PR цих зрізів.

## Публічний інтерфейс

`index.ts`:

- `importSessionsModule` — маршрути `/v1/import/batches` (створити, список, одна партія), `/v1/import/batches/{batchId}/files`
  (multipart, до 50 файлів), `/v1/import/batches/{batchId}/files/{fileId}/link` (підписане посилання),
  `/v1/import/originals/{token}` (відкрити оригінал як завантаження). Права: `household.data.read` / `write`; учасник з
  областю доступу партій не бачить (404). Партія чи файл іншого простору — 404.
- `createImportSessionsServices({ files, audit, clock, newId })` → `ImportSessionsServices` (src/api.ts, main.ts).
- `createImportSessionsWorkerQueue(db, audit)` — черга воркера (`import-sessions.hand-off`, `HAND_OFF_JOB`).
- `createImportSessionsHandOffRecovery(db, households)` — щоденне повернення мертвих завдань (до `queue.retention-cleanup`).
- `BATCH_LIMITS` (50 файлів, 150 МіБ), `BATCH_STATES`, `canMove`; тип `BatchState`.

## Залежності

Шар: subject. Модулі: audit (записи про партії — стани, лічильники, формати й коди причин, без назв і вмісту),
file-storage (збереження, видалення, посилання й відкриття оригіналів) (`apps/api/module-rules.json`).

## Події

| Публікує | Версія | Коли |
| --- | --- | --- |
| — | | |

| Споживає | Версія | Навіщо |
| --- | --- | --- |
| — | | |

## Власні таблиці

Схема `import_sessions`; міграції — `adapters/db/migrations/NNNN_slug.sql`.

- `batches` — партія: назва (необов'язкова, ≤ 120), стан (8 станів IMP-19 п. 5), хто створив, версія, час створення й
  останньої дії.
- `batch_files` — файл партії за порядком: прийнятий — id оригіналу у file-storage, формат і розмір; відхилений — лише код
  причини. Назва файлу очищена так само, як у file-storage. Байтів у базі немає.
- `jobs`, `outbox_events` — черга модуля (ARC-04, міграція платформи дослівно); `idempotency_keys` — ключі ідемпотентності
  маршруту створення (ARC-07).

## Тести

`domain/imp01-batch-states.test.ts` (кожен перехід станів, дозволений і заборонений), `test/imp01-import-batches.it.test.ts`
(маршрути на PostgreSQL), `src/platform/http/upload.test.ts` (читання multipart).
