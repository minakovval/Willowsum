# Модуль file-parsers

**Створено:** 2026-11-13 · **Оновлено:** 2026-11-27

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
курс банку, дата валютування, опис банку як надруковано (до 2 000 символів; IMP-02 п. 4, S-047: кілька колонок опису й колонка приміток — «Concepto · Movimiento · Observaciones» — разом через « · », без порожніх і повторів; одна колонка — клітинка як є). Валюта: коди ISO, числові коди, символи;
неоднозначний символ («$», «kr», «¥») вирішує символ рецепта або країна IBAN (з параметрів або з шапки файлу — назовні лише
дві літери); локальні назви й нечинні коди — «невідома валюта»; рушій суми не конвертує. Позначки: валюта не належить
однавалютному рахунку, точність перевищує валюту, розбіжність або перевернутий курс (0,5 % або одна мінімальна одиниця).
Виписка картки: якщо заголовок суми називає валюту («Сума в валюті картки (UAH)»), а поруч є початкова сума без власної
колонки валюти, колонка «Валюта» — валюта операції, а не рядка (IMP-02 п. 4; покупка за кордоном не робить файл чужим, IMP-05 EC3).
Частина 4 (IMP-06@PoC п. 1 «прив'язка до рахунку», рядок 41, частина 3): воркер розбору розпечатує
`importRecipes.accountValue` відкривачем поля з household (ключ простору переноситься у воркер і витирається до читання
файлу) і шукає IBAN, номер рахунку чи маску картки в рядках до таблиці. Назовні — лише `account: { by, status }`
(`match` / `mismatch` / `not-found`; для номера рахунку — лише `match` / `not-found`), ніколи значення. Відкритого значення
в потоці API немає. Прив'язки шаблоном у шапці й колонкою — із застосуванням рецепта (п. 4). Маршрут розбору з лімітом
одночасних воркерів — наступна частина.

Частина 5 (IMP-05@PoC частина 1, рядок 42): перевірка виписки її власними підсумками — чистий домен, результат у
`StatementParse.checks` (`StatementChecks`). Контрольні числа з підписаних рядків до, всередині й після таблиці
(«Вхідний залишок:», «Кінцевий залишок:», «Разом» у колонках дебету й кредиту, «Сума списань», «Кількість операцій»,
«Період»; `readFigures`) — такі рядки не є операціями й не входять в аналіз таблиці. Перевірки `controls` (`CHECK_KINDS`:
початковий і кінцевий залишок, «початковий + рядки = кінцевий», суми списань і надходжень, кількість, період, ланцюжок
залишків у будь-якому порядку рядків) зі станом `verified` / `mismatch` / `not-checked`, оголошеним і обчисленим значенням і
різницею — точні десяткові у масштабі валюти без округлення. `bounds` — дати й залишки на кінцях для розриву історії;
`historyGap(previous, next)` → `continuous` / `gap` / `overlap` / `unknown` з діапазоном і різницею (попередню виписку
шукає import-sessions). `account` — докази чужого рахунку: IBAN або маска картки з прив'язки (`maskedMismatch`, лише
останні 4 символи) і валюта, якої рахунок не тримає. `signs` — підстава знака кожного рядка (`SIGN_BASES`, від сильнішої)
з упевненістю; слабкі (профіль, картка, більшість, ≤ 0,6) — група `unconfirmed`; `card` — «знак картки». `clarifications`
— неоднозначні суми з обома прочитаннями (`readingFits` відхиляє прочитання з більшою кількістю знаків, ніж у валюті) і
порядок дня й місяця. `flags` (`BatchFlag` з `severity`: `block` — лише `foreign-account`; решта `review`). Рішення й
відмови застосування — import-sessions (IMP-05 частина 2).

Борг кредитної картки (IMP-05@PoC FR 6, Рішення власника (2026-11-20), п. 6; `readCardDebt`): для рахунку виду
`credit-card`, коли надруковані залишки (вхідний, кінцевий, залишки рядків) не від'ємні й один додатний, додатний залишок —
борг. Залишки, вхідний і кінцевий перевертаються (суми рядків ніколи) лише тоді, коли ланцюжок залишків підтверджує
перевернуте прочитання, а надрукований ланцюжок не сходиться (`checks.cardDebt` = `inverted`, залишки подій розбору вже
перевернуті); прочитання «перевернуто й суми рядків» — це надрукований ланцюжок з протилежним знаком, тож він його не
підтверджує (рішення ведучого, #643). Інакше нічого не перевертається, ланцюжок і підсумки знака не підтверджують, і партія має «знак картки»
(`cardDebt` = `unconfirmed`).

Що виписка каже про свій рахунок (IMP-08@PoC п. 2, «Створити рахунок»; рядок 230; `detectAccount`): `checks.detected`
`{ bank?, bankInDirectory?, currency?, mask? }`. `mask` — єдина маскована картка в рядках до таблиці, інакше єдиний IBAN там, лише як «…» і 4
останні символи (`maskLast4`); дві різні — нічого; латинська «x» після іншої літери («Box 2024», «Fax 044…») — частина слова, не знак маски (і для `hasCardMask`, #711). `currency` — одна валюта рядків і підсумків файлу. `bank` — назва банку
довідника, який передає викликач (`StatementOptions.institutions`, accounts `bankDirectory`; межі `INSTITUTION_LIMITS`:
1000 банків, назва до 300 символів, псевдонім від 3): клітинка до таблиці, що є назвою, юридичною назвою чи частиною
назви з дужками («Універсал Банк (monobank)» → «Універсал Банк», «monobank») цілими словами після згортання регістру,
лапок, розділових знаків і пробілів — лише точний чи нормалізований збіг (Рішення ведучого (2026-11-26; власник не
схвалював; row 230)); два різні банки довідника — нічого. Немає банку довідника — назва, яку файл друкує
(`printedBank`; Рішення власника (2026-11-26, чат), рядок 230b): значення після мітки «Банк» / «Bank» / «Назва банку» /
«Bank name», інакше коротка клітинка зі словом «Bank» чи «Банк» («Revolut Bank UAB»); одна назва, інакше нічого.
`bankName` — одна перевірка назви для воркера і межі імпорту: NFKC, без керівних символів і знаків напрямку, до 100
символів, не більше 4 цифр (`PRINTED_BANK_LIMITS`). `bankInDirectory` — чи `bank` з довідника.

## Вимоги

Зрізи PoC, що називають модуль: FLW-10@PoC, IMP-01@PoC, IMP-02@PoC, IMP-05@PoC, IMP-06@PoC, IMP-09@PoC, IMP-19@PoC; BUD-21@PoC (читання файлу історії, частина a). Функції додають PR цих зрізів.

## Публічний інтерфейс

`index.ts`:

- `fileParsersModule`.
- `isolatedStatementParser(options?)` → `StatementParser.parse(bytes, readOptions?, statement?, binding?)` → `StatementParse`: у свіжому воркері
  (`platform/process/isolated.ts`, 512 МіБ, 60 с — `PARSE_LIMITS`, як у file-storage) читання файлу (`reading`: кодування
  з альтернативами й причиною `bom` / `content` / `recipe`, роздільник, `unclosedQuote`, `replacementChars`, `format` з
  `fingerprint` «fp1:…»), `events` (`StatementEvents`: `events[]` — `StatementEvent` з `legs`, `fee`, `feeIncluded` (є лише з комісією: `true` — сума рядка містить комісію, як у monobank; `false` — сума без неї), `original`, `rate`,
  `valueDate`, `description`, `currencyMark`, `flags` (`EventFlag`); `currencies` — гаманці партії; `country`) і `analysis` (`StatementAnalysis`: `table`, `columns[].role`, `dates`, `numbers`, `sign` —
  кожне `Decision` з `chosen`, `alternatives`, `evidence`, `flags`; `currency`). Рядки й колонки аналізу — з 1. Відмова —
  `StatementParseError` (`FILE_TOO_LARGE`, `TABLE_LIMIT` з `ceiling`, `PARSE_MEMORY`, `PARSE_TIMEOUT`, `CORRUPTED`,
  `ACCOUNT_BINDING`). `statement.institutions` — довідник банків для `checks.detected.bank` (IMP-08 п. 2). `binding` — `SealedAccountBinding` `{ by, sealedValue, opener }` (`ACCOUNT_BINDINGS`: `iban`,
  `account-number`, `mask`; `opener` — household `SpaceKeys.fieldOpener` простору рецепта для `ACCOUNT_VALUE_FIELD`):
  ключ відкривача переноситься у воркер (у потоці API від'єднаний, а якщо воркер не стартував — витертий); значення, яке
  відкривач не відкриває (чужий простір чи поле, неправильний чи вже використаний ключ), — відмова `ACCOUNT_BINDING`,
  розбору без прив'язки не буває. Результат: `account` (`AccountMatch`) або null без прив'язки; `checks`
  (`StatementChecks`, IMP-05: `figures`, `controls`, `bounds`, `account`, `signs`, `clarifications`, `flags`, `cardDebt`).
- Не більше `PARSE_LIMITS.concurrent` (2; параметр `concurrent`) воркерів розбору одного парсера водночас, решта чекає черги
  (#624); `binding` може бути функцією, що повертає прив'язку: відкривач поля береться лише тоді, коли настала черга воркера.
  `PARSE_ENGINE_VERSION` — версія рушія, яку партія зберігає з кожним файлом (IMP-01 п. 9).
- `HistoryParser.parseHistory(bytes, options?, corrections?)` → `HistoryParse` (BUD-21@PoC п. 4–6; той самий ізольований
  воркер, стелі й черга, що в `parse`; `isolatedStatementParser()` реалізує обидва): ролі виписки й ролі колонок
  користувача (`HISTORY_ROLES`: `category`, `subcategory`, `transfer-flag`, `tags`, `account`) з причинами (`header-word`,
  `transfer-values`, `user-choice`) і альтернативами, формати дат, чисел і знака, рядки (`HistoryRow`), значення колонки
  переказу з лічильниками й підказкою, `missing` (`HISTORY_MISSING`: `date`, `amount`, `description`, `categories`).
  `HistoryReadOptions` — виправлення користувача (ролі колонок, порядок дати, десятковий роздільник, знак). Результат
  містить клітинки файлу: не логувати.
- `historyGap(previous, next)` → `HistoryGap`; `readingFits(value, currency)`; `CHECK_KINDS`, `SIGN_BASES`,
  `FLAG_SEVERITY`; типи `ControlCheck`, `StatementBounds`, `BatchFlag`, `Clarification`, `SignReview` та інші з `index.ts`.
  `ReadOptions` — файлові правила рецепта (рядки з 0); `StatementOptions` — рахунок (`currencies`, `multiCurrency`,
  `kind` з `ACCOUNT_KINDS` для ознак картки), символи валют рецепта, країна IBAN; `EVENT_LIMITS`. Результат містить клітинки файлу: не логувати й не аудитувати; `READ_LIMITS`, `TABLE_LIMITS`, `ANALYSIS_LIMITS`, `ROLES`,
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
| -------- | ------ | ---- |
| —        |        |      |

| Споживає | Версія | Навіщо |
| -------- | ------ | ------ |
| —        |        |        |

## Власні таблиці

Схема `file_parsers`; міграції — `adapters/db/migrations/NNNN_slug.sql`.

## Тести

`domain/imp06-safe-pattern.test.ts`, `domain/imp06-encoding.test.ts`, `domain/imp06-table.test.ts`,
`domain/imp06-format.test.ts`, `application/imp06-read-file.test.ts`, `domain/imp06-alternatives.test.ts`,
`adapters/isolation/imp06-parse-worker.test.ts`, `sec607-parse-worker-only.test.ts` (читання й збіг — лише у воркері),
`application/imp02-events.test.ts`, `adapters/isolation/imp02-parse-events.test.ts`, `domain/imp06-followups.test.ts`,
`domain/sec619-header-bound.test.ts`, `application/imp05-checks.test.ts`,
`adapters/isolation/imp05-parse-checks.test.ts`, `application/sec632-checks.test.ts`,
`adapters/isolation/sec624-parse-concurrency.test.ts`, `adapters/isolation/sec639-opener-wipe.test.ts`,
`application/bud21-history-parse.test.ts`, `adapters/isolation/bud21-history-worker.test.ts` (файл історії).
