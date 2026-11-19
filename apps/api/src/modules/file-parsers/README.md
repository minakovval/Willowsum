# Модуль file-parsers

**Створено:** 2026-11-13 · **Оновлено:** 2026-11-19 (IMP-06 a: читання CSV/TSV, безпечні шаблони, відбиток формату, хвиля 2, рядок 40, частина 1)

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
текст). Застосування рецепта, дати, числа, знак і альтернативи полів — наступні частини. Таблиць, маршрутів і подій немає.

## Вимоги

Зрізи PoC, що називають модуль: FLW-10@PoC, IMP-01@PoC, IMP-02@PoC, IMP-05@PoC, IMP-06@PoC, IMP-09@PoC, IMP-19@PoC. Функції додають PR цих зрізів.

## Публічний інтерфейс

`index.ts`:

- `fileParsersModule`.
- `readDelimitedFile(bytes, options?)` → `FileReading`: кодування (`chosen`, `alternatives`, причина `bom` / `content` /
  `recipe`), роздільник, рядки, `unclosedQuote`, `headerRow` (з 0), `format` (`signature`, `fingerprint` «fp1:…»).
  `ReadOptions` — файлові правила рецепта (рядки з 0). Перевищення: `FileTooLargeError`, `TableLimitError` (`ceiling`,
  `limit`); `READ_LIMITS`, `TABLE_LIMITS`.
- `fingerprintOf(signature)`, `compareSignatures(expected, actual)` → `match` / `changed` (зі схожістю) / `unknown`,
  `signatureSimilarity`; тип `FormatSignature`.
- `compilePattern(source)` → `SafePattern` (`match`, `groups`) або причина відмови (`PatternIssue`); `PATTERN_LIMITS`.
- `ENCODINGS`, `DELIMITERS`; типи `Encoding`, `Delimiter`, `Quote`.

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

Схема `file_parsers`; міграції — `adapters/db/migrations/NNNN_slug.sql`.

## Тести

`domain/imp06-safe-pattern.test.ts`, `domain/imp06-encoding.test.ts`, `domain/imp06-table.test.ts`,
`domain/imp06-format.test.ts`, `application/imp06-read-file.test.ts`.
