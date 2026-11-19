# Модуль import-recipes

**Створено:** 2026-11-13 · **Оновлено:** 2026-11-19 (рецепт для розбору з запечатаним значенням прив'язки, рядок 41, частина 3; раніше: рецепти простору, рядок 40, частина 2)

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

## Вимоги

Зрізи PoC, що називають модуль: FLW-10@PoC, IMP-06@PoC, IMP-07@PoC, IMP-09@PoC, IMP-10@PoC. Функції додають PR цих зрізів.

## Публічний інтерфейс

`index.ts`:

- `importRecipesModule` — маршрути `/v1/import/recipes` (зберегти: тіло `{ name, recipe, fingerprint? }`, недійсний
  рецепт — 422 `RECIPE_INVALID` з `recipeErrors` (код і шлях поля); список без правил), `/v1/import/recipes/{recipeId}`
  (рецепт без значення прив'язки, `accountValueLast4`; видалити).
- `createImportRecipesServices({ keys, audit, clock, newId })` → `ImportRecipesServices` (src/api.ts, main.ts).
- `createImportRecipesWorkerQueue(db, audit)` — черга воркера (`import-recipes.hand-off`, `HAND_OFF_JOB`).
- `createImportRecipesHandOffRecovery(db, households)` — щоденне повернення мертвих завдань (до `queue.retention-cleanup`).
- `createImportRecipesReader(db)` → `forParse(householdId, recipeId)` → `{ id, recipe, accountValueSealed }` або null
  (рецепт чужого простору, невідомий чи не UUID): у транзакції простору під його політикою; значення прив'язки лишається
  запечатаним — його відкриває лише воркер розбору відкривачем поля `ACCOUNT_VALUE_FIELD` (`importRecipes.accountValue`).
- `createImportRecipesErasure(db)` → `eraseHousehold(householdId)` → `{ recipes, jobs }` — лише для `data-erasure`.
- `RECIPES_PER_SPACE`.
- `validateRecipe(input)` — рецепт як JSON-текст або значення → `{ ok: true, recipe }` або `{ ok: false, errors }`
  (`RecipeError`: `code`, `path`, `reason` для `UNSAFE_PATTERN`); коди — `RecipeErrorCode`.
- `readOptionsOf(recipe)` — файлові правила рецепта як `ReadOptions` модуля file-parsers.
- `RECIPE_SCHEMA_VERSION`, `RECIPE_LIMITS`, `COLUMN_ROLES`, `RECIPE_ENCODINGS`, `RECIPE_DELIMITERS`; тип `Recipe`.

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
  `account_value_sealed` і `account_value_last4`, відбиток формату (`fp1:` + SHA-256, лише хеш), хто й коли створив.
- `jobs`, `outbox_events` — черга модуля (ARC-04, міграція платформи дослівно); `idempotency_keys` — ключі ідемпотентності
  маршруту збереження (ARC-07).

## Тести

`domain/imp06-recipe-schema.test.ts`, `domain/imp06-recipe-text.test.ts`, `application/imp06-validate-recipe.test.ts`,
`test/imp06-import-recipes.it.test.ts` (маршрути на PostgreSQL: межа простору, ролі, ліміти, аудит, стирання).
