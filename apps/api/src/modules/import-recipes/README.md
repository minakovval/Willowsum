# Модуль import-recipes

**Створено:** 2026-11-13 · **Оновлено:** 2026-11-27 (NFR-01@PoC п. 3: `importRecipesResealPart` для заміни ключів даних; раніше, 2026-11-26: IMP-07 a, рядок 49: шаблони — область «рахунок» / «простір», версії й відновлення, перевірка версії, «застарілий», автопідбір за відбитком і рахунком, лічильник використань, типізований рецепт у контракті); 2026-11-20 (`forFormat` і `fingerprint` для кроку розбору; рецепт для розбору з запечатаним значенням прив'язки, рядок 41, частина 3; раніше: рецепти простору, рядок 40, частина 2)

Картка модуля (ARC-01). Робота з модулем починається з неї; оновлюйте її в тому ж PR, що й інтерфейс.

## Призначення

Бібліотека шаблонів і профілів джерел.

Домен каталогу ARC-01: Імпорт. Реліз, з якого модуль у каталозі: PoC.

Рецепт розбору (IMP-06@PoC a, рядок 40 плану хвилі 2, частина 1): схема рецепта версії 1 — дані, не код (файл, ролі
колонок, дати, числа, знак, валюта, прив'язка до рахунку, фільтри, витяг полів; рядки й колонки — з 1), перевірка з кодом
помилки і шляхом поля (`columns[3].role`): до 32 КБ UTF-8, вкладеність до 6, невідомі ключі на будь-якому рівні, до 64 правил
колонок, до 20 правил із шаблонами, шаблони — безпечний діалект `file-parsers`; у текстах рецепта немає U+0000 та інших керівних символів (`INVALID_CHARACTER`,
#607 п. 5).

Рецепти простору (частина 2 рядка 40): зберегти, список, один рецепт, видалити — за прапорцем випуску `data.import`, права
`household.data.read` / `write`; учасник з областю доступу рецептів не бачить (404); рецепт іншого простору — 404. До 200
рецептів у просторі (технічна стеля, 422 `LIMIT_REACHED`, не 402). Значення прив'язки до рахунку (IBAN, номер, маска)
запечатане ключем простору й показується лише останніми 4 символами (NFR-01 п. 6). Записи аудиту — через чергу модуля
(ADR-0015) з щоденним поверненням мертвих завдань; без назви і правил. Застосування рецепта до файлу — воркер розбору
(рядок 41): API-процес не викликає `match` і `readDelimitedFile`.

Шаблони (IMP-07@PoC a, рядок 49): збережений рецепт — шаблон простору з областю «простір» або «рахунок» (`accountId` —
рахунок цього простору; чужий чи невідомий — 404, закритий — 409 `ACCOUNT_CLOSED`). Назва унікальна в межах області й
рахунку без урахування регістру (409 `TEMPLATE_NAME_TAKEN`); до 100 шаблонів у просторі (`RECIPES_PER_SPACE`, 422
`LIMIT_REACHED`). Кожне збереження й відновлення — нова версія; зберігаються останні 20 (`TEMPLATE_VERSIONS_KEPT`).
Збереження й відновлення вимагають `expectedVersion` — інакше 409 `TEMPLATE_CHANGED` з `currentVersion`. Шаблон зі старою
версією схеми — `stale` (не підбирається, обраний — 409 `TEMPLATE_STALE`). Автопідбір: шаблон рахунку файлу, потім простору,
нещодавно оновлений першим. Лічильник використань і час останнього — з кроку розбору (один раз на розбір).

## Вимоги

Зрізи PoC, що називають модуль: FLW-10@PoC, IMP-06@PoC, IMP-07@PoC, IMP-09@PoC, IMP-10@PoC. Функції додають PR цих зрізів.

## Публічний інтерфейс

`index.ts`:

- `importRecipesResealPart(db)` → `ResealPart` (NFR-01@PoC п. 3; `platform/modules/reseal.ts`): запечатане значення прив'язки до рахунку шаблонів і їхніх збережених версій (`recipes`, `recipe_versions`, поле `importRecipes.accountValue`) простору, запечатані заново новим ключем даних під час заміни ключів (`scripts/kms-rotate-data-keys.ts`); змінюється лише запечатане значення, повтор нічого не запечатує двічі.
- `PUT /v1/import/recipes/{recipeId}` (тіло `{ name, recipe, expectedVersion, fingerprint?, accountId? }`; рецепт із тією самою
  прив'язкою без значення зберігає запечатане), `GET …/{recipeId}/versions` (до 20, без правил),
  `POST …/{recipeId}/versions/{version}/restore` (тіло `{ expectedVersion }`; рецепт версії стає новою, назва й область —
  поточні). Відповідь шаблону: `scope`, `accountId`, `version`, `updatedAt`, `stale`, `useCount`, `lastUsedAt`; `recipe` —
  типізований (`recipeSchema`, переліки розширювані).
- `importRecipesModule` — маршрути `/v1/import/recipes` (зберегти: тіло `{ name, recipe, fingerprint?, accountId? }`, недійсний
  рецепт — 422 `RECIPE_INVALID` з `recipeErrors` (код і шлях поля); список без правил), `/v1/import/recipes/{recipeId}`
  (рецепт без значення прив'язки, `accountValueLast4`; видалити).
- `createImportRecipesServices({ keys, audit, clock, newId })` → `ImportRecipesServices` (src/api.ts, main.ts).
- `createImportRecipesWorkerQueue(db, audit)` — черга воркера (`import-recipes.hand-off`, `HAND_OFF_JOB`).
- `createImportRecipesHandOffRecovery(db, households)` — щоденне повернення мертвих завдань (до `queue.retention-cleanup`).
- `createImportRecipesReader(db)` → `forParse(householdId, recipeId)` → `{ id, recipe, accountValueSealed }` або null
  (рецепт чужого простору, невідомий чи не UUID): у транзакції простору під його політикою; значення прив'язки лишається
  запечатаним — його відкриває лише воркер розбору відкривачем поля `ACCOUNT_VALUE_FIELD` (`importRecipes.accountValue`);
  `fingerprint` — відбиток формату рецепта або null; `stale` — стара схема (IMP-07 п. 5). `forFormat(householdId, fingerprint,
  accountId?)` — шаблон для відбитка: рахунку файлу, потім простору, нещодавно оновлений; без чужого рахунку й застарілих
  (IMP-07 п. 6) або null. `recordUse(householdId, recipeId, parseId, at)` — використання шаблону (IMP-07 п. 13).
- `createImportRecipesErasure(db)` → `eraseHousehold(householdId)` → `{ recipes, jobs }` — лише для `data-erasure`.
- `RECIPES_PER_SPACE`, `TEMPLATE_VERSIONS_KEPT`.
- `createImportRecipesServices({ …, accounts? })` — `accounts.postingAccount` (модуль accounts, `src/main.ts`) для області «рахунок».
- `validateRecipe(input)` — рецепт як JSON-текст або значення → `{ ok: true, recipe }` або `{ ok: false, errors }`
  (`RecipeError`: `code`, `path`, `reason` для `UNSAFE_PATTERN`); коди — `RecipeErrorCode`.
- `readOptionsOf(recipe)` — файлові правила рецепта як `ReadOptions` модуля file-parsers.
- `recipeSchema`, `RECIPE_SCHEMA_VERSION`, `RECIPE_LIMITS`, `COLUMN_ROLES`, `RECIPE_ENCODINGS`, `RECIPE_DELIMITERS`; тип `Recipe`.

## Залежності

Шар: subject. Модулі: audit (записи про рецепти — версія схеми й лічильники, без назв і правил), file-parsers (безпечний
діалект шаблонів, файлові правила як параметри читання). Ключ простору — порт `keys.seal` (household), без залежності від
модуля
(`apps/api/module-rules.json`).

## Події

| Публікує | Версія | Коли |
| --- | --- | --- |
| — | | |

| Споживає | Версія | Навіщо |
| --- | --- | --- |
| — | | |

## Власні таблиці

Схема `import_recipes`; міграції — `adapters/db/migrations/NNNN_slug.sql`.

- `recipes` — рецепт простору: назва (≤ 120, без керівних символів), версія схеми, рецепт (jsonb, без значення прив'язки),
  `account_value_sealed` і `account_value_last4`, відбиток формату (`fp1:` + SHA-256, лише хеш), хто й коли створив;
  `account_id` (область «рахунок»), `version`, `updated_at`, `use_count`, `last_used_at`, `last_used_parse` (міграція 0004).
- `recipe_versions` — останні 20 версій шаблону (ті самі перевірки, значення прив'язки лише запечатане); видаляються з шаблоном.
- `jobs`, `outbox_events` — черга модуля (ARC-04, міграція платформи дослівно); `idempotency_keys` — ключі ідемпотентності
  маршруту збереження (ARC-07).

## Тести

`domain/imp06-recipe-schema.test.ts`, `domain/imp06-recipe-text.test.ts`, `application/imp06-validate-recipe.test.ts`,
`domain/imp07-template-schema.test.ts`, `test/imp07-templates.it.test.ts` (шаблони, версії, автопідбір на розборі),
`test/imp06-import-recipes.it.test.ts` (маршрути на PostgreSQL: межа простору, ролі, ліміти, аудит, стирання).
