# Модуль transfer-matching

**Створено:** 2026-11-13 · **Оновлено:** 2026-11-19 (BUD-08@PoC: `createTransferProposalSides` для cashflow; раніше, 2026-11-15, FIN-03 b: пропозиції переказів, рядок 16b)

Картка модуля (ARC-01). Робота з модулем починається з неї; оновлюйте її в тому ж PR, що й інтерфейс.

## Призначення

Розпізнавання переказів між власними рахунками.

Домен каталогу ARC-01: Гроші. Реліз, з якого модуль у каталозі: PoC.

Модуль нічого не зберігає: пропозиції знаходяться під час кожного читання з транзакцій простору, якими вони є зараз
(кандидати дає публічний `TransferCandidates` модуля transactions, курси — `rates` модуля fx-rates). Сама позначка
переказу, її журнал і аудит — у модулі transactions (`POST /v1/transactions/{id}/transfer`): «Підтвердити» пропозиції — та
сама дія.

## Вимоги

FIN-03@PoC b) (хвиля 2, рядок 16b — серверна частина): п. 5 (пари в межах 3 днів; одна валюта — різниця 0–2 %, дві —
до 3 % за офіційним курсом дати, крос-курс через гривню), п. 6 (лише пропозиція; «Підтвердити» — позначка модуля
transactions), AC2, AC4, граничний випадок 1 (дата ранішої сторони). Далі: «Не пара» (п. 6) і платіж на кредитну картку з
відомим джерелом (п. 6, виняток) — наступна частина; парування з виписок — IMP-03 (рядки 47, 48); UI «Пари · N» — рядок 139.

## Публічний інтерфейс

`index.ts`:

- `transferMatchingModule` — опис модуля з маршрутом `GET /v1/transfer-proposals` (`listTransferProposals`, дозвіл
  `household.data.read`, прапорець випуску і ключ функції `transactions.transfers`; учасник з областю — 404): `items`
  (новіші спочатку; `outflow` і `inflow` — `transactionId`, `accountId`, `amount` зі знаком, `date`; `date` — дата ранішої
  сторони; `kind` — `same-currency` з `fee` (різниця, ≤ 0) або `cross-currency` з `rate` (1 одиниця валюти списання у
  валюті зарахування), `converted` і `difference` без округлення), `count` (N «Пари · N»), `more` (пошук переглянув свої
  `CANDIDATES_MAX` = 500 пар).
- `createTransferMatchingServices({ candidates, rates })` → `TransferMatchingServices` (`src/api.ts` → `ctx.services`;
  `main.ts`): `createTransferCandidates` модуля transactions і `rates` модуля fx-rates.
- `createTransferProposalSides({ candidates, rates })` → `TransferProposalSides.pendingSides(householdId)` — ідентифікатори
  транзакцій, що є стороною запропонованої, ще не підтвердженої пари (те саме читання, що й маршрут; до
  `CANDIDATES_MAX` пар) — для «Перекази без пари» модуля cashflow (BUD-08@PoC п. 8).
- `MATCH_WINDOW_DAYS` (3), `FEE_MAX_SHARE` (0,02), `CROSS_CURRENCY_MAX_SHARE` (0,03) — правило п. 5 (`domain/matching.ts`).

## Залежності

Шар: subject. Модулі: fx-rates, transactions (`apps/api/module-rules.json`).

## Події

| Публікує | Версія | Коли |
| --- | --- | --- |
| — | | |

| Споживає | Версія | Навіщо |
| --- | --- | --- |
| — | | |

## Власні таблиці

Схема `transfer_matching`; міграції — `adapters/db/migrations/NNNN_slug.sql`. Таблиць поки немає.
