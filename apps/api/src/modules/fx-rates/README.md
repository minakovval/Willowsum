# Модуль fx-rates

**Створено:** 2026-11-12 · **Оновлено:** 2026-11-12

Картка модуля (ARC-01). Робота з модулем починається з неї; оновлюйте її в тому ж PR, що й інтерфейс.

## Призначення

Курси валют: щоденне оновлення з повторами, історія курсів із джерелом і датою, курс на дату (або найближчий
попередній) і конвертація для відображення. У PoC єдине джерело — НБУ (офіційні курси до гривні); будь-яка інша пара —
крос-курс через гривню на ту саму дату, джерело «НБУ» (рішення власника 2026-11-12). Адаптер ECB — у PoC v2.

## Вимоги

VAL-05@PoC (п. 1–5, AC1–AC5; стан інтерфейсу «оновлено <дата і час>» — у PR екранів із сумами); ARC-05 (адаптер
провайдера й синтетична реалізація).

## Публічний інтерфейс

`index.ts`:

- `fxRatesModule` — опис модуля (маршрутів і подій немає).
- `createFxRates({ db, now? })` → `FxRates` — читання для відображення, лише з історії модуля (збій провайдера не блокує
  перегляду, AC4):
  - `rate(from, to, date)` → `{ rate: ExchangeRate, updatedAt, stale }` — курс дати або найближчий попередній, крос-курс через
    UAH з курсів однієї дати й одного джерела; немає курсу — `RateUnavailableError`;
  - `convert(money, to, date)` → `{ conversion: Conversion, updatedAt, stale }` — `Conversion` з domain-kernel (сума, курс, дата
    курсу, джерело, `approximate`, якщо курс не на цю дату); сума лишається в оригінальній валюті;
  - `freshness()` → `{ updatedAt, stale }` — час останнього успішного оновлення (ISO, UTC) і чи минуло 24 год.
- `startFxRatesRefresh({ db, mode, report, feed?, clock?, firstDelayMs? })` → `{ attempt(), stop() }` — щоденне завдання
  ролі `scheduler`: перша спроба через хвилину після старту, далі раз на добу; після збою — 3 повтори через 15 хв, потім
  1 год, 2 год, 4 год … не більше 24 год. Звіт `report`: `updated`, `failed`, `stale` (24 год без успіху). `main.ts` пише
  `stale` подією рівня «помилка» `fx_rates.stale` у журнал сервера (FR 4, AC2).
- Константи й типи: `NBU_SOURCE`, `PIVOT_CURRENCY`, `REFRESH_INTERVAL_MS`, `STALE_AFTER_MS`, `retryDelayMs`, `PivotRate`,
  `FxRateFeed` (абстракція провайдера, FR 5), `FxClock`, `FxRefreshEvent`.

Провайдери (ARC-05, `adapters/feeds/`): порт `official-fx-rates` (`dailyRates`: поля `date`, `json`); `live` — НБУ
(`https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?date=YYYYMMDD&json=`, без ключа; курс — JSON-число, читається
з тексту відповіді в Decimal, без float), `test` — синтетичний фід (джерело «synthetic»). Вибір — `WS_PROVIDER_MODE`.

## Залежності

Шар: subject. Модулі: — (`apps/api/module-rules.json`).

## Події

| Публікує | Версія | Коли |
| --- | --- | --- |
| — | | |

| Споживає | Версія | Навіщо |
| --- | --- | --- |
| — | | |

## Власні таблиці

Схема `fx_rates`; міграції — `adapters/db/migrations/NNNN_slug.sql`. Довідкові дані платформи без `household_id`
(`schema-exemptions.json`):

- `rates` — курс валюти до гривні (NUMERIC(38,18)) на дату, джерело, час отримання; один курс на валюту й дату;
- `updates` — кожне успішне оновлення: реалізація фіду, дата, кількість валют, час завершення.
