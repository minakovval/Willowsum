# Модуль bulk-actions

**Створено:** 2026-11-13 · **Оновлено:** 2026-11-15 (DAT-03 a: механізм масових дій — серверна частина)

Картка модуля (ARC-01). Робота з модулем починається з неї; оновлюйте її в тому ж PR, що й інтерфейс.

## Призначення

Масові дії з undo протягом 24 год: один механізм для всіх сутностей. Модуль не знає полів записів: кожну сутність
(«транзакції») дає модуль-власник через порт `BulkTarget`, кожну дію («Змінити категорію») — через порт
`BulkActionHandler`; записи читаються й пишуться лише через них (DAT-03 п. 5).

Домен каталогу ARC-01: Спільні функції. Реліз, з якого модуль у каталозі: PoC.

## Вимоги

DAT-03@PoC a) (хвиля 2, рядок 17 — серверна частина): п. 1 (вибір за ідентифікаторами або «усі за фільтром» — умови
фільтра і зняті вручну записи), 3 (підсумок без запису), 4 (причини пропуску), 5, 6 (понад 50 записів — у фоні,
«Оброблено X з N»; одна дія на акаунт), 7 (до 500 записів, NFR-15 п. 17), 8, 9 («Відмінити» 24 год, «не відновлено»),
10 («перервано» і «Продовжити»), 11 (один груповий запис аудиту); AC2–AC11, граничні випадки 1–3. Далі: дії списку
транзакцій (п. 2, AC1) — з полями, які вони змінюють: «Змінити категорію» (BUD-01 b, рядок 20), «Додати теги» (BUD-13 a,
рядок 21), «Підтвердити категорії» (BUD-12 a, рядок 24); панель вибору (AC12) — UI, рядок 118. Поки жодної цілі й дії
не підключено (`src/wiring.ts` `bulkActionsServicesFor`), кожна дія — 400 `action: unknown`.

## Публічний інтерфейс

`index.ts`:

- `bulkActionsModule` — маршрути (прапорець випуску і ключ функції `data.bulk_actions`; дозвіл `household.data.write`,
  звіт — `household.data.read`; простір — лише сесії; учасник з областю нічого не змінює і не бачить жодної дії — 404):
  - `POST /v1/bulk-actions/preview` (`previewBulkAction`) — `{ action, selection, params }`: `selection` —
    `{ kind: "ids", ids }` або `{ kind: "filter", filter: ["<поле>.<оп>:<значення>"], excluded }` (синтаксис фільтра списку
    сутності; до 50 умов). → `count`, `changes`, `skipped` (`unavailable`, `unchanged`, `conflict`, `invalid`), `examples`
    (до 3 на причину: `id`, `reason`, `issue`), `background`, `undoable`. Нічого не пише.
  - `POST /v1/bulk-actions` (`startBulkAction`, `Idempotency-Key`) — те саме тіло → 201 звіт. До 50 записів — одразу (звіт
    остаточний), більше — у фоні. Понад 500 — 422 `LIMIT_REACHED` (`limit: 500`); жодного видимого запису (чужий простір чи
    неіснуючі) — 404; уже є дія, що виконується, — 409 `BULK_ACTION_RUNNING`; невідома дія, параметри чи фільтр — 400.
  - `GET /v1/bulk-actions/{actionId}` (`getBulkAction`) — звіт: `status` (`running`, `interrupted`, `completed`, `undone`),
    `background`, `count`, `processed`, `changed`, `skipped`, `skippedRecords` (кожен пропущений: лише `id`, причина, код),
    `undo` (`available`, `until`, `restored`, `notRestored`), `createdAt`, `endedAt`. Лише автору дії; іншим — 404.
  - `POST /v1/bulk-actions/{actionId}/undo` (`undoBulkAction`) — «Відмінити»: до 24 год після `endedAt`, один раз; інакше
    409 `BULK_UNDO_UNAVAILABLE`. Повертає попередні значення записам, версія яких досі та, що лишила дія; решта — «не
    відновлено».
  - `POST /v1/bulk-actions/{actionId}/resume` (`resumeBulkAction`) — «Продовжити» перервану дію (новий прогін по записах,
    що лишились); не перервана — 409 `BULK_ACTION_NOT_INTERRUPTED`.
- `createBulkActionsServices({ targets, actions, audit, clock, newId, partSize? })` → `BulkActionsServices` — порти маршрутів
  і воркера (`src/wiring.ts` `bulkActionsServicesFor`, однаково для `main.ts` і воркера).
- Порти, які реалізує модуль-власник записів: `BulkTarget` (`entity`; `select(caller, filter, excluded, limit)` →
  `{ ids, count }` або `{ invalid }`; `read(caller, ids)` — лише видимі; `write(caller, id, expectedVersion, values)` →
  `changed` / `conflict` / `unavailable` / `invalid` — правилами одиничного редагування, під блокуванням, без власного запису
  аудиту) і `BulkActionHandler` (`name` `<entity>.<action>`, `params` (zod), `sensitiveFields`, `plan(caller, records,
  params)` → для кожного запису `change` / `unchanged` / `invalid`); `bulkRegistry`, типи `BulkCaller`, `BulkRecord`,
  `BulkWrite`, `BulkValues`, `PlannedChange`; `BULK_ITEMS_MAX`, `FOREGROUND_MAX`, `UNDO_WINDOW_MS`.
- `createBulkActionsWorkerQueue(db, services)` → черга воркера: `bulk-actions.run-part` (частина фонового прогону, 25
  записів), `bulk-actions.undo`, `bulk-actions.audit` (`RUN_PART_JOB`, `UNDO_JOB`, `AUDIT_JOB`).
- `createBulkActionsRecovery(db, households)` → `{ run() }` — щоденна задача планувальника `bulk-actions.recovery` (до
  очищення черги): невдалі (`dead`) задачі повертаються в чергу; подія логу `bulk_actions.jobs_requeued` (WARN).
- `createBulkActionsErasure(db)` → `eraseHousehold(householdId)` → `{ actions, idempotencyKeys, jobs }` — видалення простору
  (NFR-12@PoC п. 3, крок `bulk-actions.records`); викликає лише `data-erasure`.

Порядок прогону (ARC-04, як передача транзакцій, ADR-0015): дія з записами (знімок версії і значень до / після) і задача
першої частини — одна транзакція модуля. Кожна частина — транзакція модуля з рядком дії під блокуванням: записи
читаються ціллю, пишуться з очікуваною версією, результати зберігаються, і до коміту ставиться задача наступної частини
або, наприкінці, задача групового запису аудиту. Дію до 50 записів маршрут виконує одразу після коміту (задача — запасний
шлях). Задача частини, взята вдруге (збій чи перезапуск, `attempt` > 1), не продовжує: дія стає «перервано», виконане
лишається. Запис, який дія вже записала перед збоєм (версія інша, значення — заплановані), рахується зміненим і вдруге не
пишеться. «Відмінити» так само: статус `undone` і задача — одна транзакція, потім маршрут виконує задачу одразу.
Груповий запис аудиту — сутність `bulk-actions.action`, дія `update`, ключ `bulk-actions.run:<дія>:<прогін>` або
`bulk-actions.undo:<дія>:<прогін>`; перша зміна — `action` / `undo` з назвою дії, далі по зміні на поле кожного запису з
`record` (ідентифікатор запису); поля `sensitiveFields` замасковані. Прогін, що нічого не змінив, запису не пише.

## Залежності

Шар: platform. Модулі: audit (`apps/api/module-rules.json`). Цілі й дії інших модулів підключаються в `src/wiring.ts`, не
імпортом.

## Події

| Публікує | Версія | Коли |
| --- | --- | --- |
| — | | |

| Споживає | Версія | Навіщо |
| --- | --- | --- |
| — | | |

## Власні таблиці

Схема `bulk_actions`; міграції — `adapters/db/migrations/NNNN_slug.sql`. Політика простору — від запуску міграцій.

| Таблиця | Що |
| --- | --- |
| `actions` | Дія: автор, назва, сутність, параметри, `background`, стан, номер прогону, кількість записів, час початку, кінця, відміни; одна дія `running` на акаунт (частковий унікальний індекс) (`0001_bulk_actions.sql`) |
| `items` | Записи дії по порядку вибору: ідентифікатор запису, версія і значення до / після, результат (`pending`, `changed` або причина), код невалідності, версія після, прогін, результат відміни (`0001_bulk_actions.sql`) |
| `idempotency_keys` | Ключі ідемпотентності запуску (ARC-07 п. 4; `0002_idempotency_keys.sql`, дослівно) |
| `jobs`, `outbox_events` | Черга модуля (ARC-04; `0003_queue.sql`, дослівно `queue-tables.sql`); подій модуль не публікує |

Синтетичні дані: `synthetic.ts` (1 завершена дія на 3 записи, 2 виконані задачі, 1 ключ і 1 передана подія на простір).
