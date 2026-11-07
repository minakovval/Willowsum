# @willowsum/api — бекенд

**Створено:** 2026-11-06 · **Оновлено:** 2026-11-07 (ARC-05)

Один застосунок на TypeScript, розділений на модулі з жорсткими межами (ARC-01). Стек і правила —
[ADR-0001](../../docs/adr/0001-backend-stack.md); ізоляція просторів, схема даних, міграції й аудит —
[ADR-0002](../../docs/adr/0002-data-isolation.md); HTTP API і контракт — [ADR-0003](../../docs/adr/0003-api-contract.md); прапорці функцій і аварійні вимикачі —
[ADR-0004](../../docs/adr/0004-feature-flags.md); зовнішні провайдери через адаптери — [ADR-0005](../../docs/adr/0005-provider-adapters.md).

## Будова

| Шлях | Що |
| --- | --- |
| `src/modules/<module>/` | Модуль: `index.ts` (публічний інтерфейс і події), `domain/`, `application/`, `adapters/` (зокрема `adapters/db/migrations/NNNN_slug.sql`), картка `README.md`, генератор синтетичних даних своїх таблиць `synthetic.ts` |
| `src/modules/index.ts` | Реєстр модулів (генератор додає сюди) |
| `src/platform/` | Інфраструктурний код без бізнес-правил: БД (`db/`), події (`events/`), опис модулів (`modules/`), HTTP API (`http/`: маршрути, помилки, ідемпотентність, пагінація, OpenAPI), набір інструментів адаптерів провайдерів (`adapters/`: порт і перелік полів, тайм-аут, повтори, запобіжник, останнє відоме значення; еталонний порт `adapters/reference/exchange-rates/`) |
| `src/api.ts` | Збирає API ролі `api`: маршрути платформи й модулів, перевірки feature-flags, access-scope і plan-catalog |
| `src/wiring.ts` | Налаштування пулів перевірки прапорців і перевірка готовності, які використовує `main.ts` (CICD-06) |
| `module-rules.json` | Єдиний файл правил: модулі, шар, від яких модулів залежить кожен |
| `events.snapshot.json` | Опубліковані версії подій і схеми їхніх даних |
| `provider-sdks.json` | SDK зовнішніх провайдерів: імпортуються лише в `src/modules/<module>/adapters/` і `src/platform/adapters/` (ARC-05, `check:modules` і ESLint) |
| `schema-exemptions.json` | Таблиці схем модулів без `household_id` (без даних клієнтів) і причина для кожної (ARC-03) |
| `scripts/` | `new-module`, `check-modules`, `check-schema`, `check-migrations`, `check-flags`, `flags`, `events-snapshot`, `migrate` |

## Команди

| Команда | Що робить |
| --- | --- |
| `pnpm new-module <name> [--depends a,b] [--layer platform\|subject\|process]` | Створює модуль із каталогу ARC-01 і реєструє його |
| `pnpm check:modules` | Правила модулів, аналізатор імпортів (зокрема SDK провайдерів лише в адаптерах, ARC-05), контракти подій (CI-задача `api`) |
| `DATABASE_URL=… pnpm check:schema` | Перевірка схеми (ARC-03): політики рядків на кожній таблиці клієнтів, `household_id`, суми NUMERIC(38,18) з валютою, лише `timestamptz`, регіон (CI-задача `api`) |
| `pnpm check:migrations` | «Розширити → перенести → звузити»: операції звуження лише з `-- ws:contract …`; з `WS_MIGRATION_BASE_DIR` — і незмінність випущених міграцій |
| `pnpm check:flags` | Кожен прапорець має власника і дату перегляду; падає, якщо дата минула, тимчасовий прапорець повністю ввімкнений понад 30 днів або функція не має прапорця (CICD-06, CI-задача `api`) |
| `node scripts/flags.ts state\|rollout\|kill\|revive\|test-space … --actor <uuid>` | Змінює прапорці, вимикачі модулів і тестові простори через `FlagAdmin` (кожна зміна в аудиті; діє за ≤ 15 с без релізу); конфігурація — та сама, що в процесів |
| `node tools/synthetic/index.ts --out <dir> [--households n] [--format csv\|sql]` | Синтетичні дані з генераторів модулів (ARC-03 п. 6); лише вигадані дані |
| `pnpm --filter @willowsum/api events:snapshot` | Записує нові версії подій; несумісну зміну відхиляє |
| `pnpm contract:write` (з кореня) | Пише контракт `packages/api-contract/openapi.json` з маршрутів і типи клієнта `src/schema.ts` (ARC-07) |
| `pnpm contract:check` (з кореня) | Контракт і типи збігаються з маршрутами (CI-задача `api`) |
| `pnpm --filter @willowsum/api contract:compat <base openapi.json>` | Зміни контракту сумісні в межах `/v1` щодо базової гілки (CI-задача `api`) |
| `pnpm --filter @willowsum/api test` | Юніт-тести (без БД і мережі: `tools/test-guards/no-network.mjs` блокує з'єднання поза цією машиною, ARC-05) |
| `DATABASE_URL=… pnpm test:integration` | Інтеграційні тести на реальному PostgreSQL (суперкористувач тимчасової БД) |
| `DATABASE_URL=<суперкористувач> pnpm --filter @willowsum/api db:bootstrap` | Один раз на нову базу: закриває функції великих об'єктів і ставить страж ізоляції — тригер подій `ws_module_guard` (ADR-0002) |
| `DATABASE_URL=… pnpm --filter @willowsum/api migrate` | Застосовує міграції: роль запуску — власник бази з CREATEROLE (суперкористувач лише для bootstrap); SQL модуля виконується від його ролі-власника `ws_own_<схема>` (ADR-0002) |
| `node src/main.ts --role api\|worker\|scheduler` | Запускає процес (ARC-02); образ — `docker build -f apps/api/Dockerfile .` з кореня |

## Конфігурація (ARC-02, CICD-12)

Лише змінні середовища; без обов'язкової змінної процес не стартує і називає її (без значення).

| Змінна | Що | Типово |
| --- | --- | --- |
| `WS_PORT` | Порт HTTP (API або лише перевірки `/health/live`, `/health/ready`) | 8080 |
| `WS_SHUTDOWN_TIMEOUT_MS` | Скільки чекати завершення запитів під час зупинки | 30000 |
| `WS_PLAN_ENTITLEMENTS` | Джерело матриці планів (plan-catalog); у PoC — лише `all-enabled` (П-24) | `all-enabled` |
| `WS_PROVIDER_MODE` | Реалізація портів провайдерів: `test` (синтетична, без мережі) або `live` (ARC-05, ADR-0005) | `test` |
| `WS_DB_HOST`, `WS_DB_PORT`, `WS_DB_NAME`, `WS_DB_SSL` | Сервер БД | порт 5432, SSL увімкнено |
| `WS_DB_PROBE_PASSWORD` | Пароль ролі `ws_probe` (лише читання списку міграцій для «готовий») | — |
| `WS_DB_CONTEXT_PASSWORD` | Пароль ролі `ws_context` (лише прив'язка з'єднань модулів до простору, ARC-03) | — |
| `WS_DB_PASSWORD_<СХЕМА>` | Пароль ролі входу кожного модуля (`ws_mod_<схема>`) | — |

## Доступ до БД

Код модуля отримує `ModuleDatabase` для свого модуля (`ModuleDatabases.for(<module>)`). Його пул
входить у базу під роллю `ws_mod_<module>`, яка має права лише на схему модуля і не є членом жодної
іншої ролі, тож запит до таблиці іншого модуля база відхиляє (`42501`) за будь-якого SQL.

## Простори і дані клієнтів (ARC-03)

- Таблиця з даними клієнтів має `household_id uuid NOT NULL`. Безпеку рядків і політику
  `household_isolation` вмикає виконавець міграцій у транзакції міграції; писати їх у міграції не треба.
  Таблиця без даних клієнтів іде в `schema-exemptions.json` із причиною.
- Код модуля працює з даними простору лише в `ModuleDatabase.inHousehold(householdId, async (q) => …)` і
  фільтрує `WHERE household_id = $1` значенням `q.householdId`. SQL модуля не може змінити простір:
  прив'язку пише роль `ws_context`, а роль модуля її лише читає (простір із сеансу користувача — з ARC-07). Якщо фільтр
  забуто, база все одно поверне лише рядки цього простору. `transaction(…)` без простору бачить 0 рядків.
- Суми — NUMERIC(38,18) і колонка валюти (`amount` + `currency`, `<x>_amount` + `<x>_currency`); час —
  `timestamptz`, кожна транзакція в UTC; регіон — тип `platform_types.data_region`. Унікальні й зовнішні
  ключі таблиць клієнтів містять `household_id` (виняток — унікальний ключ з однієї колонки uuid).
- SQL міграцій модуля виконується від ролі-власника `ws_own_<схема>` (NOLOGIN, без BYPASSRLS, CREATE лише
  на своїй схемі) усередині SECURITY DEFINER-обгортки, з якої не повернутися до ролі запуску. Тож міграція
  не створить нічого поза своєю схемою. Власник таблиці може вимкнути FORCE чи змінити політику, тому страж
  ізоляції (тригер подій із `db:bootstrap`) після кожної DDL міграції одразу ізолює нові таблиці клієнтів і
  відхиляє інструкцію, що послаблює ізоляцію (NO FORCE, DISABLE, інша чи змінена політика, правило,
  матеріалізоване представлення, представлення без `security_invoker`). У схемі модуля — лише тригерні
  функції; у CHECK, індексах і згенерованих колонках — лише незмінні функції `pg_catalog`; без успадкування
  таблиць (декларативні розділи можна); тип колонки змінюють через нову колонку; `CREATE TABLE AS` із
  таблиці клієнтів відхиляється. Після міграцій кожен запуск перевіряє всі правила `check:schema`.
  Перенесення даних між просторами (backfill) так не зробити: для нього потрібен окремий механізм із
  рецензією (пізніше). Кожен запуск міграцій і `check:schema` додатково перевіряють межу (ADR-0002).
- Міграції лише розширюють схему; звуження — окремою міграцією з `-- ws:contract <NNNN_expand.sql> <причина>`
  у пізнішому релізі. CI запускає тести модулів попередньої версії на новій схемі.
- Кожна таблиця з даними клієнтів має генератор у `src/modules/<module>/synthetic.ts` (`tools/synthetic`);
  без нього тест ізоляції `test/isolation.it.test.ts` падає.

## HTTP API (ARC-07)

- Усі маршрути — під `/v1`, оголошуються `defineRoute` у `adapters/http/` модуля і потрапляють у `routes` опису
  модуля. Кожен маршрут називає дозвіл (`access-scope`) і ключ функції (`plan-catalog`) або причину, чому він
  публічний (публічні — лише платформні, без даних простору; перелік — у `test/api-routes.test.ts`). Модулі не
  імпортують Fastify.
- Порядок: до читання тіла (хук `onRequest`) — аварійний вимикач модуля (503 `MODULE_UNAVAILABLE`, `Retry-After: 60`) →
  сеанс (401) → прапорці функції для простору сеансу (404 `NOT_FOUND`, як невідомий шлях); далі — тіло (415, 413, 400) →
  роль і scope (403) → план (402 `PLAN_LIMIT_REACHED`) → вхід за схемами zod (400) → ідемпотентність → обробник →
  відповідь за схемою відповіді. Прапорець маршруту — `access.feature` (ARC-01 п. 7), а підфункція додає `access.flag`
  (потрібні обидва); нова функція виходить вимкненою (CICD-06, ADR-0004). Дані простору — лише через `ctx.inHousehold`
  (простір із сеансу); `ctx.db` дає лише `transaction` без простору. До identity (ACC-01) сеансів немає:
  захищені маршрути відповідають 401. Маршрут в обхід `registerApi`, що може відповісти на запит під `/v1`
  (сирий `app.get("/v1/…")`, `/*`, `/:version/…`), і плагін із таким префіксом сервер відхиляє під час реєстрації.
- Помилки — RFC 9457 `application/problem+json` з `code`; без внутрішніх деталей і персональних даних. Запис, якого
  немає або який належить іншому простору, — `requireFound(record)` → 404 (DAT-05). Помилки 5xx ідуть у
  `reportError` лише як метод, шаблон маршруту, код, статус і клас помилки (ARC-09 додасть експортер).
- `create: true` — заголовок `Idempotency-Key`; модуль додає міграцію з `src/platform/http/idempotency-keys.sql`
  дослівно. `list: true` — `pageQuery` (`cursor`, `limit` ≤ 100) і `pageOf(item)`.
- Після зміни маршруту — `pnpm contract:write` і коміт `packages/api-contract/openapi.json` та `src/schema.ts`.
  Видаляти з контракту можна лише через 6 місяців після `deprecatedSince` (ADR-0003).

## Зовнішні провайдери (ARC-05)

- Кожен зовнішній сервіс — порт `defineProviderPort` (вид сервісу, операції з `idempotent` і переліком полів, що йдуть
  провайдеру) і дві реалізації: `test` (синтетична) і `live`. Вибір — `WS_PROVIDER_MODE`, типово `test`.
- Виклики — через `createProviderClient` (`src/platform/adapters/`): тайм-аут 10 с, повтори лише ідемпотентних
  операцій, після 5 невдач поспіль 60 с без викликів. Читання — через `createLastKnown`: збій провайдера повертає
  останнє відоме значення з `asOf` і `stale: true`.
- HTTP-провайдер без SDK — `createProviderHttp` (перевіряє поля до відправлення). SDK провайдера — лише в
  `adapters/` модуля і лише після внесення в `provider-sdks.json`.
- Тест робочої реалізації — без мережі: `recordingFetch` і `outgoingFieldViolations` (`src/platform/adapters/testing.ts`).
