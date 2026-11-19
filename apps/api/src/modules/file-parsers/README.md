# Модуль file-parsers

**Створено:** 2026-11-13 · **Оновлено:** 2026-11-19 (прив'язка виписки до рахунку рецепта у воркері розбору, хвиля 2, рядок 41, частина 3; раніше: IMP-02 b, події з ногами, частина 2)

Картка модуля (ARC-01). Робота з модулем починається з неї; оновлюйте її в тому ж PR, що й інтерфейс.

## Призначення

Читання форматів CSV, XLS, XLSX, XML, OFX, PDF, ZIP.

Домен каталогу ARC-01: Імпорт. Реліз, з якого модуль у каталозі: PoC.

Рушій розбору, частина 1 (IMP-06@PoC a, рядок 40 плану хвилі 2): читання CSV і TSV до таблиці — кодування за BOM або за
найправдоподібнішим прочитанням (UTF-8, UTF-16 LE/BE, Windows-1251, Windows-1252, CP866, KOI8-U) з альтернативами й
оцінками, роздільник з альтернативами, лапки, рядки, рядок заголовка; відбиток формату (SHA-256 нормалізованого заголовка,
кількості колонок і міток шапки) і міра схожості; безпечний діалект регулярних виразів рецепта з власним лінійним
виконавцем (Pike VM; без `RegExp`/`eval`). Чисте і детерміноване: без годинника, мережі й випадковості; файл — недовірені
дані: межі 25 МіБ, 20 000 записів, 2 млн клітинок, 512 колонок, 32 768 символів клітинки; формули не виконуються (клітинка —
текст). Застосування рецепта — наступні частини. Таблиць, маршрутів і подій немає.

Частина 2 (IMP-06@PoC b, рядок 41, частина 1): рішення рушія щодо таблиці — роль кожної колонки, формат дат, формат чисел і
знак — з альтернативами (оцінка 0–1, підпис у термінах рецепта, живі приклади з файлу) і доказами «чому так» (код і числа,
текст — на клієнті); пояснення таблиці (рядок заголовка, рядки до нього, рядки даних) і валюти (колонка, код у заголовку).
Читання файлу до рядків і шаблони рецепта виконуються лише в ізольованому воркері розбору (#607 п. 3): публічний інтерфейс
не експортує `readDelimitedFile` і `compilePattern`, лише `checkPattern` (перевірка без виконання) і
`isolatedStatementParser`.

Частина 3 (IMP-02@PoC b, рядок 41, частина 2): рядки виписки як події — основна нога (сума зі знаком у валюті рядка,
гаманець рахунку) і окрема нога комісії (стягнута комісія, додатна; як подія `legs` журналу), початкова сума й валюта,
курс банку, дата валютування, опис банку як надруковано (до 2 000 символів). Валюта: коди ISO, числові коди, символи;
неоднозначний символ («$», «kr», «¥») вирішує символ рецепта або країна IBAN (з параметрів або з шапки файлу — назовні лише
дві літери); локальні назви й нечинні коди — «невідома валюта»; рушій суми не конвертує. Позначки: валюта не належить
однавалютному рахунку, точність перевищує валюту, розбіжність або перевернутий курс (0,5 % або одна мінімальна одиниця).
Частина 4 (IMP-06@PoC п. 1 «прив'язка до рахунку», рядок 41, частина 3): воркер розбору розпечатує
`importRecipes.accountValue` відкривачем поля з household (ключ простору переноситься у воркер і витирається до читання
файлу) і шукає IBAN, номер рахунку чи маску картки в рядках до таблиці. Назовні — лише `account: { by, status }`
(`match` / `mismatch` / `not-found`; для номера рахунку — лише `match` / `not-found`), ніколи значення. Відкритого значення
в потоці API немає. Прив'язки шаблоном у шапці й колонкою — із застосуванням рецепта (п. 4). Маршрут розбору з лімітом
одночасних воркерів — наступна частина.

## Вимоги

Зрізи PoC, що називають модуль: FLW-10@PoC, IMP-01@PoC, IMP-02@PoC, IMP-05@PoC, IMP-06@PoC, IMP-09@PoC, IMP-19@PoC. Функції додають PR цих зрізів.

## Публічний інтерфейс

`index.ts`:

- `fileParsersModule`.
- `isolatedStatementParser(options?)` → `StatementParser.parse(bytes, readOptions?, statement?, binding?)` → `StatementParse`: у свіжому воркері
  (`platform/process/isolated.ts`, 512 МіБ, 60 с — `PARSE_LIMITS`, як у file-storage) читання файлу (`reading`: кодування
  з альтернативами й причиною `bom` / `content` / `recipe`, роздільник, `unclosedQuote`, `replacementChars`, `format` з
  `fingerprint` «fp1:…»), `events` (`StatementEvents`: `events[]` — `StatementEvent` з `legs`, `fee`, `original`, `rate`,
  `valueDate`, `description`, `currencyMark`, `flags` (`EventFlag`); `currencies` — гаманці партії; `country`) і `analysis` (`StatementAnalysis`: `table`, `columns[].role`, `dates`, `numbers`, `sign` —
  кожне `Decision` з `chosen`, `alternatives`, `evidence`, `flags`; `currency`). Рядки й колонки аналізу — з 1. Відмова —
  `StatementParseError` (`FILE_TOO_LARGE`, `TABLE_LIMIT` з `ceiling`, `PARSE_MEMORY`, `PARSE_TIMEOUT`, `CORRUPTED`,
  `ACCOUNT_BINDING`). `binding` — `SealedAccountBinding` `{ by, sealedValue, opener }` (`ACCOUNT_BINDINGS`: `iban`,
  `account-number`, `mask`; `opener` — household `SpaceKeys.fieldOpener` простору рецепта для `ACCOUNT_VALUE_FIELD`):
  ключ відкривача переноситься у воркер (у потоці API від'єднаний, а якщо воркер не стартував — витертий); значення, яке
  відкривач не відкриває (чужий простір чи поле, неправильний чи вже використаний ключ), — відмова `ACCOUNT_BINDING`,
  розбору без прив'язки не буває. Результат: `account` (`AccountMatch`) або null без прив'язки.
  `ReadOptions` — файлові правила рецепта (рядки з 0); `StatementOptions` — рахунок (`currencies`, `multiCurrency`),
  символи валют рецепта, країна IBAN; `EVENT_LIMITS`. Результат містить клітинки файлу: не логувати й не аудитувати; `READ_LIMITS`, `TABLE_LIMITS`, `ANALYSIS_LIMITS`, `ROLES`,
  `DATE_ORDERS`.
- `fingerprintOf(signature)`, `compareSignatures(expected, actual)` → `match` / `changed` (зі схожістю) / `unknown`,
  `signatureSimilarity`; тип `FormatSignature`.
- `checkPattern(source)` → `{ ok, groups }` або причина відмови (`PatternIssue`); `PATTERN_LIMITS`. Сам збіг — лише у
  воркері.
- `ENCODINGS`, `DELIMITERS`; типи `Encoding`, `Delimiter`, `Quote`.

## Залежності

Шар: subject. Модулі: household — відкривач запечатаного поля у воркері (`apps/api/module-rules.json`).

## Події

| Публікує | Версія | Коли |
| --- | --- | --- |
| — | | |

| Споживає | Версія | Навіщо |
| --- | --- | --- |
| — | | |

## Власні таблиці

Схема `file_parsers`; міграції — `adapters/db/migrations/NNNN_slug.sql`.

## Тести

`domain/imp06-safe-pattern.test.ts`, `domain/imp06-encoding.test.ts`, `domain/imp06-table.test.ts`,
`domain/imp06-format.test.ts`, `application/imp06-read-file.test.ts`, `domain/imp06-alternatives.test.ts`,
`adapters/isolation/imp06-parse-worker.test.ts`, `sec607-parse-worker-only.test.ts` (читання й збіг — лише у воркері),
`application/imp02-events.test.ts`, `adapters/isolation/imp02-parse-events.test.ts`, `domain/imp06-followups.test.ts`,
`domain/sec619-header-bound.test.ts`.
