# Модуль duplicate-matching

**Створено:** 2026-11-13 · **Оновлено:** 2026-11-15 (FIN-03 b: «Можливий дубль», рядок 16c)

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

## Публічний інтерфейс

`index.ts`:

- `duplicateMatchingModule` — опис модуля з маршрутом `GET /v1/duplicate-proposals` (`listDuplicateProposals`, дозвіл
  `household.data.read`, прапорець випуску і ключ функції `transactions.duplicates`; учасник з областю — 404): `items`
  (новіші спочатку; `first` — раніша, `second` — `transactionId`, `accountId`, `amount` зі знаком, `date`), `count`, `more`
  (пошук переглянув свої `CANDIDATES_MAX` = 500 пар).
- `createDuplicateMatchingServices({ candidates })` → `DuplicateMatchingServices` (`src/api.ts` → `ctx.services`; `main.ts`):
  `createDuplicateCandidates` модуля transactions.
- `createDuplicateCheck({ candidates })` → `DuplicateCheck` модуля transactions (`isPossibleDuplicate(householdId,
  transactionId)`): чи транзакція зараз «Можливий дубль» (FIN-03 п. 18).
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
