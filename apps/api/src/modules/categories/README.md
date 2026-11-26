# Модуль categories

**Створено:** 2026-11-13 · **Оновлено:** 2026-11-26 (BUD-01@PoC п. 12, AC 22, 23, рядок 221: точна причина видалення — `categoryUsage` у `/usage` і відмовах, `CATEGORY_LIMIT_CONFIRM`, `confirmLimit`; ліміт не тримає категорію і видаляється з нею через порт `CategoryUsage.limits`); 2026-11-21 (BUD-02@PoC п. 23: `getCategoryUsage`, `CategoryUsage.transactions`); 2026-11-15 (BUD-01@PoC п. 12: видалення порожньої власної категорії, серверна частина; BUD-01 b: споживач `categories.merged` і відповідь `categorization`)

Картка модуля (ARC-01). Робота з модулем починається з неї; оновлюйте її в тому ж PR, що й інтерфейс.

## Призначення

Дерево категорій доходів і витрат простору: системне дерево (10 груп і службові «Переказ» і «Коригування»), власні
групи й категорії, перейменування, приховування, об'єднання, іконка й колір, «обов'язкова».

Домен каталогу ARC-01: Бюджет. Реліз, з якого модуль у каталозі: PoC.

Категорії транзакції тут немає: її зберігає `categorization` (BUD-01 b, хвиля 2, рядок 20). Ліміти — `budget`.

## Вимоги

BUD-01@PoC a) (хвиля 2, рядок 19 — серверна частина): п. 1 (системне дерево з підказками), 2 (власні групи з типом і
категорії, перейменування, приховування, об'єднання; назва унікальна в просторі), 3 (системні не видаляються;
«Переказ» і «Коригування» не приховуються), 8 (об'єднання лише одного типу, аудит; перенесення записів — подією), 9
(довідник для інших модулів), 10 (іконка, колір, тон іконки), 11 (атрибут «обов'язкова»), 12 (видалення порожньої
власної категорії; #260); AC5 (серверна частина), AC6, AC7 (серверна частина), AC12, AC15, AC16, AC17, AC18 і AC19
(серверна частина), граничний випадок 5. Далі: категорія транзакції, правила, розділення,
пари переказів (BUD-01 b, рядок 20 і `transfer-matching`), бюджет (BUD-02), UI «Категорії» (BUD-01 c, рядок 119).
FLW-34@PoC лише читає дерево («типові групи без сум»).

## Публічний інтерфейс

`index.ts`:

- `categoriesModule` — опис модуля з маршрутами (прапорець випуску і ключ функції `categories.tree`; простір — лише
  сесії; категорія чи група іншого простору — як неіснуючі; читання — `household.data.read`, зміни —
  `household.data.write`; учасник з областю: «бюджет і цілі» закриті політикою видимості за замовчуванням — читання 404,
  зміни 403). Кожен маршрут спершу записує системне дерево простору, якщо його ще немає (окремою транзакцією):
  - `GET /v1/categories` (`listCategories`) — `groups`: групи за порядком (`id`, `systemKey`, `kind` — `expense` /
    `income` / `service`, `name`, `renamed`, `tone`, `categories`); категорії в ужитку, приховані теж: `id`, `groupId`,
    `systemKey` (клієнт показує назву системної неперейменованої категорії мовою користувача за ключем), `kind`, `name`,
    `renamed`, `icon` (Lucide), `color`, `iconTone` (`white` / `ink`, контраст 3 : 1), `essential` (null для доходу й
    службових), `hidden`, `deletable` (п. 12: меню має «Видалити» — власна і порожня; так само в кожній відповіді з
    категорією).
  - `GET /v1/categories/{categoryId}` (`getCategory`) — одна категорія; виведена з ужитку — 404.
  - `GET /v1/categories/{categoryId}/usage` (`getCategoryUsage`) — точна причина діалогу «Видалити категорію…»
    (BUD-01@PoC п. 12, 13, AC 19, 22, 23; BUD-02@PoC п. 23): `transactions` (сума `CategoryUsage.transactions`),
    `rules`, `recurringPayments` (суми `CategoryUsage.holds`), `mergedCategories` (об'єднані в неї), `budget` —
    `{ limit, stored, planCells }` (ліміт поточного періоду десятковим рядком, чи є ліміт або план доходу, кількість
    місяців «План» із власним значенням; видаляються разом із категорією) і `deletable`; інший простір, невідома чи
    виведена з ужитку — 404.
  - `POST /v1/category-groups` (`createCategoryGroup`, `Idempotency-Key`) — `name` (1–60, один рядок), `kind`
    (`expense` / `income`); тон — тони свого типу по черзі. → 201 група.
  - `PATCH /v1/category-groups/{groupId}` (`renameCategoryGroup`) — `name`. → 200 група з категоріями.
  - `POST /v1/categories` (`createCategory`, `Idempotency-Key`) — `groupId` (не службова група: 400 `groupId: service`;
    іншого простору — `groupId: not_found`), `name`, `icon` (за замовчуванням `shapes`), `color` (за замовчуванням тон
    групи), `essential` (лише витрати: інакше 400 `essential: not_expense`). → 201 категорія.
  - `PATCH /v1/categories/{categoryId}` (`updateCategory`) — `name`, `hidden`, `icon`, `color` (`#RRGGBB`),
    `essential`; кожне необов'язкове, без змін — нічого. Приховати «Переказ» чи «Коригування» — 409
    `CATEGORY_SERVICE_FIXED`. Показана знову об'єднана системна категорія — знову в ужитку (`mergedInto` знято).
  - `POST /v1/categories/{categoryId}/merge` (`mergeCategory`) — `targetId`; той самий тип, інакше 409
    `CATEGORY_KINDS_DIFFER` («Категорії різних типів не можна об'єднати»); службові — 409 `CATEGORY_SERVICE_FIXED`;
    ціль та сама, прихована чи невідома — 400 `targetId: same | hidden | not_found`. Системна стає прихованою, власна —
    виведеною з ужитку (`retired`, назва звільняється); категорії, раніше об'єднані з джерелом, тепер вказують на ціль.
    → `sourceId`, `targetId`, `sourceState`. Подія `categories.merged` — у тій самій транзакції.
  - `DELETE /v1/categories/{categoryId}[?confirmLimit=true]` (`deleteCategory`) — п. 12: власна категорія, яку не
    тримають дані (прихована теж), зникає з дерева, назва вільна, довідник її більше не знає; запис аудиту `delete` з
    полями «до» (і `limit`, `planCells` видалених записів бюджету). → `{ deleted: true }`. Системна — 409
    `CATEGORY_SYSTEM_FIXED`; яку тримають дані (транзакції чи частини, правила категорій, регулярні платежі, об'єднана в
    неї категорія) — 409 `CATEGORY_NOT_EMPTY` з `categoryUsage` (кожна причина з кількістю, як `/usage`), дані не
    змінюються, навіть із `confirmLimit`; виведена з ужитку — 404. Ліміт, план доходу і клітинки «План» не тримають
    категорію (рішення власника 2026-11-26, AC 22): без `confirmLimit=true` — 409 `CATEGORY_LIMIT_CONFIRM` з
    `categoryUsage.budget`, нічого не змінено; з ним `budget` видаляє їх у своїй транзакції (зі своїми записами аудиту;
    знімки завершених періодів лишаються), потім рядок категорії.
  Дубль назви категорії (серед категорій в ужитку) чи групи (серед груп), без урахування регістру, — 409
  `CATEGORY_NAME_TAKEN` («Така назва вже існує»); перевірка в коді й унікальний індекс.
- `createCategoriesServices({ audit, clock, newId, usage })` → `CategoriesServices` — порти маршрутів (`src/api.ts` →
  `ctx.services`; `main.ts`). `usage` (обов'язковий) — `CategoryUsage[]`: кожен модуль, що зберігає ідентифікатори
  категорій, відповідає `used(householdId, ids)` → які з них тримають його записи простору (п. 12). Сьогодні —
  `createTransactionCategoryUsage` модуля `transactions` (частини розділених), `createCategorizationCategoryUsage`
  модуля `categorization` (категорія транзакції, BUD-01 b; правила категорій, BUD-14), `createRecurringCategoryUsage`
  модуля `recurring` (регулярні платежі, BUD-07 a2) і `createBudgetCategoryUsage(db, budgetServices)` модуля `budget`
  (порт `limits`: не тримає категорію). **Модуль, що починає зберігати категорію, додає свою відповідь у
  `src/main.ts` у тому ж PR**, інакше категорію з його записами можна буде видалити.
- `CategoryUsage` — тип цього порту. Необов'язковий `transactions(householdId, categoryId)` → кількість транзакцій
  простору в категорії відповідають лише модулі, що зберігають категорію транзакції (`categorization` — власна категорія
  нерозділеної, `transactions` — розділені за частинами); одна транзакція рахується одним модулем (BUD-02@PoC п. 23).
  Необов'язковий `holds(householdId, categoryId)` → `{ rules?, recurringPayments? }` — кількості для причини (AC 23).
  Необов'язковий `limits` (лише `budget`) — `CategoryLimits`: `held(householdId, ids)`, `entries(householdId, id)` →
  `{ limit, stored, planCells }`, `release(caller, id)` — видаляє їх і повертає видалене (AC 22).
- `createCategoryDirectory({ db, audit, newId })` → `CategoryDirectory` (п. 9) — для `categorization`, `budget`,
  `recurring`, `transfer-matching`: `category(householdId, id)` → `CategoryRef` (`kind`, `state`, `mergedInto`,
  `essential`, `systemKey`) або null (іншого простору чи невідома); `serviceCategory(householdId, "transfer" |
  "adjustment")`. Записує системне дерево, якщо його ще немає.
- `createCategoriesErasure(db)` → `eraseHousehold(householdId)` → `{ categories, groups, idempotencyKeys, events, jobs }`
  — видалення простору (NFR-12@PoC п. 3); викликає лише `data-erasure` (крок `categories.records`).
- `categoryMerged`, `CATEGORY_KINDS`, `CATEGORY_STATES`, `SERVICE_CATEGORY_KEYS` і їхні типи.

Порядок однієї зміни (`application/categories.ts`): у транзакції модуля з рядками під блокуванням — перевірки → рядки →
для об'єднання подія в outbox модуля → запис аудиту (`categories.group` / `categories.category`, `create` · `update` ·
`delete`, поля до й після, на зміні — лише змінені, на видаленні — усі «до»; окрема транзакція модуля audit, закомічена раніше) → коміт. Системне дерево —
запис аудиту системи `categories.tree`/`create` (кількість категорій). Видалення (п. 12) тримає рядок категорії під
блокуванням, поки модулі з `usage` відповідають, тож об'єднання в неї чекає і потім її не знаходить. Залишковий ризик:
запис іншого модуля, збережений з категорією між його перевіркою в довіднику і комітом видалення, лишиться з
ідентифікатором видаленої категорії (у PoC один користувач; follow-up). Видалення з лімітом: `budget.release` комітить
свою транзакцію до коміту видалення категорії; збій між ними лишає категорію без ліміту — як після «Прибрати з бюджету».

## Залежності

Шар: subject. Модулі: audit (`apps/api/module-rules.json`).

## Події

| Публікує | Версія | Коли |
| --- | --- | --- |
| `categories.merged` | 1 | Категорію об'єднано (`sourceId`, `targetId`, `kind`, `mergedAt`): `categorization` переносить транзакції, частини розділених і правила, `budget` — ліміт з періоду `mergedAt`, `recurring` — регулярні платежі. Споживають `categorization` (транзакції, BUD-01 b) і `recurring` (BUD-07 a2); `budget` — у своїй частині |

| Споживає | Версія | Навіщо |
| --- | --- | --- |
| — | | |

## Власні таблиці

Схема `categories`; міграції — `adapters/db/migrations/NNNN_slug.sql`. Політика простору — від запуску міграцій.

| Таблиця | Що |
| --- | --- |
| `category_groups` | Група: ключ системної (або null), тип, назва (унікальна без регістру), `renamed`, тон, порядок (`0001_categories.sql`) |
| `categories` | Категорія: група і її тип, ключ системної, назва (унікальна без регістру серед категорій в ужитку), іконка, колір, `essential` (лише витрати), стан `active` / `hidden` / `retired`, `merged_into` (`0001_categories.sql`) |
| `idempotency_keys` | Ключі ідемпотентності створення (ARC-07 п. 4; `0002_idempotency_keys.sql`, дослівно) |
| `outbox_events`, `jobs` | Черга й outbox модуля (ARC-04; `0003_outbox.sql`, дослівно) |

Системне дерево — `domain/catalogue.ts` (назви uk, підказки, кольори таблиці п. 10, іконки, «обов'язкова»); у простір
записується при першому зверненні, новий ключ каталогу додається так само, без міграції. Синтетичні дані:
`synthetic.ts`.
