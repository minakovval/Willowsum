# Модуль duplicate-matching

**Створено:** 2026-11-13 · **Оновлено:** 2026-11-20 (#654, #655: залишок у ключі дубля — спершу значення, потім для кредитної картки модуль, `creditCard`; крок застосування import-sessions викликає `planImport`; IMP-04 FR 6: допуск min(0,25; 10 % суми), рішення власника 2026-11-20, п. 8; раніше IMP-04 a: план партії імпорту, рядок 43; раніше FIN-03 b: «Можливий дубль», рядок 16c)

Картка модуля (ARC-01). Робота з модулем починається з неї; оновлюйте її в тому ж PR, що й інтерфейс.

## Призначення

Пошук дублів і злиття ручних та імпортованих транзакцій.

Домен каталогу ARC-01: Гроші. Реліз, з якого модуль у каталозі: PoC.

Модуль нічого не зберігає: «Можливий дубль» знаходиться під час кожного читання з транзакцій простору, якими вони є зараз
(кандидати дає публічний `DuplicateCandidates` модуля transactions). Злиття, «Роз'єднати», «Не дубль» і їхні журнал та
аудит — у модулі transactions (`/v1/transactions/{id}/merge`, `/not-duplicate`), як позначка переказу.

## Вимоги

FIN-03@PoC b) (хвиля 2, рядок 16c — серверна частина): п. 12 і бізнес-правило «Можливий дубль» (той самий рахунок, та
сама сума й валюта, дата ± 3 дні; нічого не зливається, не видаляється і не приховується автоматично), п. 18 (приховати
можна лише «Можливий дубль» — перевірка для модуля transactions), п. 10 і AC6 (правило автоматичного злиття банківської
транзакції з ручною: лише єдиний кандидат, ручний і ще не зіставлений; інакше «Можливий дубль») — чисте правило
`decideIncoming`, яке викличе імпорт (IMP-04, рядок 43); IMP-04@PoC п. 5 (те саме правило для імпорту). UI «До розбору» —
рядки UI транзакцій.

IMP-04@PoC a) (хвиля 2, рядок 43): п. 1–6 — план партії імпорту для кроку застосування (його ще немає; він — наступний
зріз): для кожного рядка файлу один результат — `import`, `repeat` («повтор у файлі» з номером повторення), `duplicate`
(з якою транзакцією збіг), `already-imported` («дубль — уже імпортовано», той самий файл), `merge` (з ручною),
`possible-duplicate` («Можливий дубль» у «До розбору»; також пара імпортованих з різних партій) і `replace` («замінено»:
проведена замість «в обробці» попереднього імпорту того самого знаку, у день «в обробці» або до 10 днів після, допуск min(0,25; 10 % суми проведеної) у валюті рахунку, точні десяткові). Модуль і далі нічого не зберігає.

## Публічний інтерфейс

`index.ts`:

- `duplicateMatchingModule` — опис модуля з маршрутом `GET /v1/duplicate-proposals` (`listDuplicateProposals`, дозвіл
  `household.data.read`, прапорець випуску і ключ функції `transactions.duplicates`; учасник з областю — 404): `items`
  (новіші спочатку; `first` — раніша, `second` — `transactionId`, `accountId`, `amount` зі знаком, `date`), `count`, `more`
  (пошук переглянув свої `CANDIDATES_MAX` = 500 пар).
- `createDuplicateMatchingServices({ candidates })` → `DuplicateMatchingServices` (`src/api.ts` → `ctx.services`; `main.ts`):
  `createDuplicateCandidates` модуля transactions.
- `createDuplicateCheck()` → `DuplicateCheck` модуля transactions (`windowDays` і `isPossibleDuplicate(pairs)`): правило,
  за яким модуль transactions у транзакції зміни вирішує, чи транзакція зараз «Можливий дубль» (FIN-03 п. 18).
- `planImport({ candidates }, householdId, { batchId, accountId, rows, sameFileAppliedIn, creditCard? })` → `RowOutcome[]`
  (`creditCard` — рахунок виду «кредитна картка»: залишок після операції збігається й за модулем, обидві основи IMP-05 п. 6;
  інакше лише за значенням)
  (IMP-04 п. 1–6): читає транзакції рахунку у вікні дат рядків ± 10 днів через публічний `ImportCandidates` модуля
  transactions сторінками по `PLAN_PAGE` (1 000) за індексом рахунку й дати; понад `PLAN_EXISTING_MAX` (50 000) —
  `PlanTooLargeError`; з `sameFileAppliedIn` (import-sessions `sameFileApplied`) нічого не читає. Нічого не пише.
  Викликає крок застосування import-sessions у транзакції запису transactions (кандидати бачать уже записані рядки партії).
- `planBatch(input)` — те саме правило, чисте (`domain/import-plan.ts`; порядок кроків — у його коментарі),
  `duplicateKey`, `normalizeDescription` (NFKC, нижній регістр, один пробіл, обрізано), `planWindow`, `outcomeCounts`,
  `ROW_OUTCOMES`, `REPLACE_WINDOW_DAYS` (10), `REPLACE_TOLERANCE` («0.25», межа допуску), `REPLACE_TOLERANCE_SHARE` («0.1»), `replaceTolerance(posted)`; типи `IncomingRow`, `KnownTransaction`,
  `PlanInput`, `RowOutcome`, `RowOutcomeKind`.
- `isPossibleDuplicate(a, b)`, `decideIncoming(incoming, existing)` → `merge` / `possible-duplicate` / `new`,
  `MATCH_WINDOW_DAYS` (3); типи `DuplicateSide`, `ExistingTransaction`, `IncomingDecision` (`domain/matching.ts`).

## Залежності

Шар: subject. Модулі: transactions (`apps/api/module-rules.json`).

## Події

| Публікує | Версія | Коли |
| --- | --- | --- |
| — | | |

| Споживає | Версія | Навіщо |
| --- | --- | --- |
| — | | |

## Власні таблиці

Схема `duplicate_matching`; міграції — `adapters/db/migrations/NNNN_slug.sql`. Таблиць поки немає: пари «Не дубль» —
у `transactions.duplicate_dismissals` (їх читають пошук і список у SQL модуля transactions).
