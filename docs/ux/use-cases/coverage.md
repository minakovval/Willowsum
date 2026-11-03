# Матриця покриття вимог сценаріями використання

Робочий артефакт UX, не вимога: якщо матриця розходиться з файлом вимоги, діє вимога. Матрицю згенеровано скриптом із `docs/requirements/*/*.md`, рядків «**Вимоги:**», «**Потоки й шляхи:**» і «**Екрани:**» каталогів `UC-*.md` та колонки «Вимоги» карти екранів `docs/ux/screen-map.md`.

## Як читати

- **сценарій** — функціональна вимога модуля. Сценарії — ті, що цитують ID у рядку «Вимоги».
- **наскрізна** — компонент (CMP), дизайн-система (DS), сітка (GRID), графік (CHT), правила й інвентар екранів (SCR), нефункціональна вимога (NFR). Перелічено сценарії, де вимога застосовується: спершу ті, що згадують ID прямо, далі — через екрани (екран карти, у колонці «Вимоги» якого стоїть ID, є в рядку «Екрани» сценарію), далі — за ключовими словами в тексті сценарію (наприклад, «спливне повідомлення» для CMP-20, «Приховати суми» для DS-18). Показано до 10 сценаріїв, «усього N» — повна кількість.
- **технічна, без сценарію** — архітектура, CI/CD чи внутрішня NFR, яку користувач не бачить; у дужках — чому.
- **потік/шлях** — FLW і JRN. Сценарії — ті, що цитують ID у рядку «Потоки й шляхи».

## Підсумок

| Показник | Кількість |
| --- | --- |
| Вимог у `docs/requirements` | 431 |
| Сценаріїв використання | 857 |
| Тип «сценарій» | 213 |
| Тип «наскрізна» | 120 |
| Тип «технічна, без сценарію» | 31 |
| Тип «потік/шлях» | 67 |
| Функціональних вимог без сценарію | 0 |
| FLW і JRN без сценарію | 1 (JRN-00) |
| Наскрізних вимог без жодного сценарію | 0 |
| Неіснуючих ID у рядках «Вимоги» і «Потоки й шляхи» | 0 |

JRN-00 — вступ до розділу JRN (як читати карти досвіду), а не шлях персони, тож сценарію в нього немає і не має бути.

## ACC (12)

| ID | Назва | Реліз | Сценарії | Тип |
| --- | --- | --- | --- | --- |
| ACC-01 | Реєстрація та вхід | MVP | UC-ACC-01, UC-ACC-02, UC-ACC-03, UC-ACC-04, UC-ACC-05, UC-ACC-06, UC-ACC-07, UC-ACC-08, UC-ACC-09, UC-ACC-18, UC-LEG-04 | сценарій |
| ACC-02 | Реєстрація та оплата в мобільному застосунку | v1-mobile | UC-ACC-10, UC-ACC-11, UC-ACC-12, UC-ACC-13, UC-ACC-14 | сценарій |
| ACC-03 | Двофакторна автентифікація | MVP | UC-ACC-08, UC-ACC-15, UC-ACC-16, UC-ACC-17, UC-ACC-18, UC-ACC-19, UC-ACC-20, UC-ACC-21, UC-ACC-26, UC-ACC-50, UC-ACC-58 | сценарій |
| ACC-04 | Керування сесіями і тайм-аут | MVP | UC-ACC-06, UC-ACC-22, UC-ACC-23, UC-ACC-24, UC-ACC-25, UC-ACC-26, UC-ACC-66 | сценарій |
| ACC-05 | Профіль, локалізація і зміна email | MVP | UC-ACC-25, UC-ACC-27, UC-ACC-28, UC-ACC-29, UC-ACC-30, UC-L10N-01, UC-L10N-02, UC-L10N-03, UC-L10N-04 | сценарій |
| ACC-06 | Валюта звітності | MVP | UC-ACC-31, UC-ACC-32, UC-ACC-33, UC-ACC-34 | сценарій |
| ACC-07 | Експорт даних і закриття акаунта | MVP | UC-ACC-35, UC-ACC-36, UC-ACC-37, UC-ACC-38, UC-ACC-39 | сценарій |
| ACC-08 | Робочий простір (Household), передача власності і видалення простору | MVP | UC-ACC-02, UC-ACC-17, UC-ACC-37, UC-ACC-38, UC-ACC-40, UC-ACC-41, UC-ACC-42, UC-ACC-43, UC-ACC-44, UC-ACC-45, UC-ACC-46, UC-ACC-47, UC-ACC-48 | сценарій |
| ACC-09 | Ролі та запрошення | MVP | UC-ACC-03, UC-ACC-17, UC-ACC-49, UC-ACC-50, UC-ACC-51, UC-ACC-52, UC-ACC-53, UC-ACC-54, UC-ACC-55, UC-ACC-56, UC-ACC-57, UC-ACC-61 | сценарій |
| ACC-10 | Область доступу (scope) | MVP | UC-ACC-49, UC-ACC-58, UC-ACC-59, UC-ACC-60, UC-ACC-61, UC-ACC-62 | сценарій |
| ACC-11 | Журнал аудиту | MVP | UC-ACC-35, UC-ACC-48, UC-ACC-55, UC-ACC-63, UC-ACC-64, UC-ACC-65, UC-ACC-66 | сценарій |
| ACC-12 | Аварійний доступ (digital legacy) | v2 | UC-ACC-67, UC-ACC-68, UC-ACC-69, UC-ACC-70 | сценарій |

## SUB (8)

| ID | Назва | Реліз | Сценарії | Тип |
| --- | --- | --- | --- | --- |
| SUB-01 | Плани та права плану (entitlements) | MVP | UC-ADM-11, UC-SUB-01, UC-SUB-02, UC-SUB-03, UC-SUB-04, UC-SUB-05, UC-SUB-06, UC-SUB-15, UC-SUB-32, UC-SUB-34 | сценарій |
| SUB-02 | Життєвий цикл підписки | MVP | UC-ACC-46, UC-SUB-07, UC-SUB-08, UC-SUB-09, UC-SUB-10, UC-SUB-11, UC-SUB-12 | сценарій |
| SUB-03 | Самообслуговування підписки | MVP | UC-SUB-06, UC-SUB-08, UC-SUB-13, UC-SUB-14, UC-SUB-15, UC-SUB-16, UC-SUB-17 | сценарій |
| SUB-04 | План радника | v2 | UC-SUB-18, UC-SUB-19, UC-SUB-20 | сценарій |
| SUB-05 | Back office | v1 | UC-ACC-69, UC-ADM-23, UC-SUB-21, UC-SUB-22, UC-SUB-23, UC-SUB-24, UC-SUB-25, UC-SUB-26 | сценарій |
| SUB-06 | Промо-механіки | v2 | UC-SUB-27, UC-SUB-28, UC-SUB-29, UC-SUB-30, UC-SUB-31 | сценарій |
| SUB-07 | Пропозиція апгрейду в продукті (upsell) | MVP (частково v1) | UC-SUB-32, UC-SUB-33, UC-SUB-34, UC-SUB-35, UC-SUB-36, UC-SUB-37 | сценарій |
| SUB-08 | Подарунки, спеціальні програми і канали оплати | v2 | UC-ADM-05, UC-SUB-38, UC-SUB-39, UC-SUB-40, UC-SUB-41 | сценарій |

## ADM (9)

| ID | Назва | Реліз | Сценарії | Тип |
| --- | --- | --- | --- | --- |
| ADM-01 | Каталог функцій | MVP | UC-ADM-01, UC-ADM-02, UC-ADM-03, UC-ADM-04 | сценарій |
| ADM-02 | Матриця «план × функція» | MVP | UC-ADM-05, UC-ADM-06, UC-ADM-07, UC-ADM-08 | сценарій |
| ADM-03 | Версії й публікація | MVP | UC-ADM-09, UC-ADM-10, UC-ADM-11, UC-ADM-12, UC-ADM-13, UC-ADM-14 | сценарій |
| ADM-04 | Захист існуючих користувачів | MVP | UC-ADM-13, UC-ADM-14, UC-ADM-15, UC-ADM-16, UC-ADM-17 | сценарій |
| ADM-05 | Ролі та безпека адмін-панелі | MVP | UC-ADM-10, UC-ADM-18, UC-ADM-19, UC-ADM-20, UC-ADM-21, UC-ADM-22, UC-ADM-23, UC-L10N-09 | сценарій |
| ADM-06 | Індивідуальні перевизначення | v1 | UC-ADM-24, UC-ADM-25, UC-ADM-26 | сценарій |
| ADM-07 | Ринки і регіони | v1 | UC-ADM-27, UC-ADM-28 | сценарій |
| ADM-08 | Попередній перегляд | v1 | UC-ADM-29, UC-ADM-30 | сценарій |
| ADM-09 | Звіти про плани і використання функцій | v1 | UC-ADM-31, UC-ADM-32 | сценарій |

## AST (17)

| ID | Назва | Реліз | Сценарії | Тип |
| --- | --- | --- | --- | --- |
| AST-01 | Уніфікована сутність «Актив» і схеми типів | MVP | UC-AST-01, UC-AST-02, UC-AST-04, UC-AST-07, UC-AST-08, UC-AST-09, UC-AST-10 | сценарій |
| AST-02 | Мінімальне створення і повнота запису | MVP | UC-AST-01, UC-AST-02, UC-AST-03 | сценарій |
| AST-03 | Форма створення і редагування | MVP | UC-AST-04, UC-AST-05, UC-AST-06 | сценарій |
| AST-04 | Дії життєвого циклу | MVP | UC-AST-01, UC-AST-12, UC-AST-13, UC-AST-14, UC-AST-15, UC-AST-16, UC-AST-22, UC-AST-40 | сценарій |
| AST-05 | Грошові проводки подій активу та реалізований прибуток | MVP (частково v1) | UC-AST-13, UC-AST-17, UC-AST-18, UC-AST-19 | сценарій |
| AST-06 | Доходи та витрати активу | v1 | UC-AST-20, UC-AST-21 | сценарій |
| AST-07 | Довідкові номери | MVP | UC-AST-02, UC-AST-08, UC-AST-11, UC-AST-16 | сценарій |
| AST-08 | Одиничні активи та лоти | MVP | UC-AST-15, UC-AST-22, UC-AST-23, UC-AST-24 | сценарій |
| AST-09 | Локації | MVP | UC-AST-12, UC-AST-25, UC-AST-26, UC-AST-27, UC-AST-28 | сценарій |
| AST-10 | Групи та теги | v1 | UC-AST-29, UC-AST-30, UC-AST-31 | сценарій |
| AST-11 | Зобов'язання як окрема сутність | MVP | UC-AST-07, UC-AST-32, UC-AST-33, UC-AST-34, UC-AST-35, UC-AST-36, UC-AST-37 | сценарій |
| AST-12 | Забезпечення і алокація | MVP | UC-AST-01, UC-AST-07, UC-AST-38, UC-AST-39, UC-AST-40 | сценарій |
| AST-13 | Вибуття активу-застави | MVP | UC-AST-15, UC-AST-40, UC-AST-41 | сценарій |
| AST-14 | Можливості окремих типів активів | MVP | UC-AST-04, UC-AST-07, UC-AST-42, UC-AST-43 | сценарій |
| AST-14a | Віджети й графіки за типом активу | MVP | UC-AST-07, UC-AST-42, UC-AST-44 | сценарій |
| AST-15 | Список бажаних покупок (Wishlist) | v2 | UC-AST-45, UC-AST-46 | сценарій |
| AST-16 | Медіа та фото-інвентаризація | v1 (частково v1-mobile) | UC-AST-47, UC-AST-48, UC-AST-49 | сценарій |

## VAL (11)

| ID | Назва | Реліз | Сценарії | Тип |
| --- | --- | --- | --- | --- |
| VAL-01 | Спостереження вартості | MVP | UC-VAL-01, UC-VAL-02, UC-VAL-03, UC-VAL-04, UC-VAL-05 | сценарій |
| VAL-02 | Політика поточної вартості | MVP | UC-VAL-02, UC-VAL-06, UC-VAL-07 | сценарій |
| VAL-03 | Свіжість оцінки | MVP (частково v1) | UC-VAL-08, UC-VAL-09, UC-VAL-10, UC-VAL-11 | сценарій |
| VAL-04 | Валюти та конвертація | MVP | UC-VAL-12, UC-VAL-13, UC-VAL-14, UC-VAL-15, UC-VAL-16 | сценарій |
| VAL-05 | Фіди курсів і цін | MVP (частково v1) | UC-VAL-17, UC-VAL-18, UC-VAL-19, UC-VAL-20 | сценарій |
| VAL-06 | Автоматичні ринкові оцінки | v1 | UC-VAL-21, UC-VAL-22 | сценарій |
| VAL-07 | Частки володіння та власницькі структури | MVP | UC-VAL-23, UC-VAL-24, UC-VAL-25 | сценарій |
| VAL-08 | Історія net worth і розклад змін | v1 | UC-VAL-05, UC-VAL-26, UC-VAL-27, UC-VAL-28 | сценарій |
| VAL-09 | Головний огляд net worth і список дій | MVP | UC-VAL-25, UC-VAL-29, UC-VAL-30, UC-VAL-31, UC-VAL-32, UC-VAL-33 | сценарій |
| VAL-10 | Нереалізований прибуток | v1 | UC-VAL-34, UC-VAL-35, UC-VAL-36 | сценарій |
| VAL-11 | Мапа портфеля | MVP | UC-VAL-37, UC-VAL-38 | сценарій |

## FIN (19)

| ID | Назва | Реліз | Сценарії | Тип |
| --- | --- | --- | --- | --- |
| FIN-01 | Рахунки | MVP | UC-FIN-01, UC-FIN-02, UC-FIN-03, UC-FIN-04, UC-FIN-05, UC-FIN-06, UC-FIN-07, UC-FIN-09, UC-FIN-10, UC-FIN-11, UC-FIN-13, UC-FIN-49 | сценарій |
| FIN-02 | Агрегація банків | MVP (частково v1) | UC-FIN-02, UC-FIN-14, UC-FIN-15, UC-FIN-16, UC-FIN-17, UC-FIN-18, UC-FIN-19, UC-FIN-20, UC-FIN-21, UC-FIN-22, UC-FIN-30 | сценарій |
| FIN-03 | Транзакції | MVP | UC-FIN-24, UC-FIN-33, UC-FIN-34, UC-FIN-35, UC-FIN-36, UC-FIN-37, UC-FIN-38, UC-FIN-39, UC-FIN-40, UC-FIN-41, UC-FIN-42, UC-FIN-43, UC-FIN-44, UC-FIN-77 | сценарій |
| FIN-04 | Двоканальний журнал (подвійний запис) | MVP | UC-FIN-45, UC-FIN-46, UC-FIN-47, UC-FIN-48, UC-FIN-52 | сценарій |
| FIN-05 | Інвестиційні портфелі | MVP (частково v1) | UC-FIN-49, UC-FIN-50, UC-FIN-51, UC-FIN-52, UC-FIN-53, UC-FIN-54, UC-FIN-55, UC-FIN-56 | сценарій |
| FIN-06 | Дохідність портфеля (TWR / MWR) | MVP (частково v1) | UC-FIN-57, UC-FIN-58, UC-FIN-59 | сценарій |
| FIN-07 | Криптоактиви | v1 | UC-FIN-16, UC-FIN-60, UC-FIN-61, UC-FIN-62, UC-FIN-63, UC-FIN-64 | сценарій |
| FIN-08 | Приватні інвестиції і capital calls | v1 | UC-FIN-65, UC-FIN-66, UC-FIN-67 | сценарій |
| FIN-09 | Пенсійні рахунки і страхування життя | v1 | UC-FIN-68, UC-FIN-69, UC-FIN-70, UC-FIN-71, UC-FIN-75 | сценарій |
| FIN-10 | Cash flow і прогноз ліквідності | v2 | UC-FIN-72, UC-FIN-73, UC-FIN-74, UC-FIN-75, UC-FIN-76 | сценарій |
| FIN-11 | Стандарт інтеграцій | MVP | UC-FIN-17, UC-FIN-18, UC-FIN-19, UC-FIN-20, UC-FIN-21, UC-FIN-22, UC-FIN-23, UC-FIN-24, UC-FIN-25, UC-FIN-64 | сценарій |
| FIN-12 | Керування рахунками | MVP | UC-FIN-01, UC-FIN-03, UC-FIN-07, UC-FIN-08, UC-FIN-09, UC-FIN-10, UC-FIN-11, UC-FIN-12, UC-FIN-13, UC-FIN-17 | сценарій |
| FIN-13 | Звірка з банком | v1 | UC-FIN-77, UC-FIN-78, UC-FIN-79, UC-FIN-80 | сценарій |
| FIN-14 | Кредитні картки | v1 | UC-FIN-81, UC-FIN-82, UC-FIN-83, UC-FIN-84 | сценарій |
| FIN-15 | Кредитний рейтинг | v2 | UC-FIN-85, UC-FIN-86, UC-FIN-87 | сценарій |
| FIN-16 | Компенсація акціями | v1 (частково v2) | UC-FIN-88, UC-FIN-89, UC-FIN-90, UC-FIN-91 | сценарій |
| FIN-17 | Аналіз фондів і портфеля | v2 | UC-FIN-92, UC-FIN-93, UC-FIN-94 | сценарій |
| FIN-18 | Розширені джерела даних | MVP (частково v1-mobile) | UC-FIN-16, UC-FIN-23, UC-FIN-26, UC-FIN-27, UC-FIN-28, UC-FIN-29, UC-FIN-30, UC-FIN-31, UC-FIN-32 | сценарій |
| FIN-19 | Бізнеси й оренда | v2 | UC-FIN-95, UC-FIN-96, UC-FIN-97 | сценарій |

## INV (3)

| ID | Назва | Реліз | Сценарії | Тип |
| --- | --- | --- | --- | --- |
| INV-01 | Реєстр інструментів і події брокерів | v1 | UC-INV-01, UC-INV-02, UC-INV-03, UC-INV-04, UC-INV-05 | сценарій |
| INV-02 | Сервіс цін і курсів із безкоштовних джерел | v1 (частково MVP) | UC-INV-06, UC-INV-07, UC-INV-08, UC-INV-09 | сценарій |
| INV-03 | Собівартість і реалізований результат (інформаційно) | v1 | UC-INV-03, UC-INV-10, UC-INV-11, UC-INV-12 | сценарій |

## CRY (2)

| ID | Назва | Реліз | Сценарії | Тип |
| --- | --- | --- | --- | --- |
| CRY-01 | Імпорт журналів криптобірж і реєстр активів | v1 | UC-CRY-01, UC-CRY-02, UC-CRY-03, UC-CRY-04 | сценарій |
| CRY-02 | Парування переміщень біржа ↔ гаманець ↔ банк | v1 | UC-CRY-05, UC-CRY-06, UC-CRY-07 | сценарій |

## BUD (20)

| ID | Назва | Реліз | Сценарії | Тип |
| --- | --- | --- | --- | --- |
| BUD-01 | Категорії витрат і доходів | MVP | UC-BUD-01, UC-BUD-02, UC-BUD-03, UC-BUD-04, UC-BUD-05, UC-BUD-06, UC-BUD-78, UC-BUD-112 | сценарій |
| BUD-02 | Бюджет періоду | MVP | UC-BUD-07, UC-BUD-08, UC-BUD-09, UC-BUD-10, UC-BUD-11, UC-BUD-12, UC-BUD-13, UC-BUD-21, UC-BUD-46, UC-BUD-87, UC-BUD-113, UC-BUD-114, UC-BUD-120 | сценарій |
| BUD-03 | «Можна витратити» | MVP | UC-BUD-14, UC-BUD-15, UC-BUD-16, UC-BUD-17, UC-BUD-18, UC-BUD-27, UC-BUD-51, UC-BUD-98, UC-BUD-99, UC-BUD-103, UC-BUD-112, UC-BUD-117, UC-FCS-05, UC-FCS-06 | сценарій |
| BUD-04 | «Чи можу я собі дозволити?» | MVP | UC-BUD-19, UC-BUD-20, UC-BUD-21, UC-BUD-22, UC-BUD-33 | сценарій |
| BUD-05 | Цілі накопичення | MVP | UC-BUD-19, UC-BUD-21, UC-BUD-22, UC-BUD-23, UC-BUD-24, UC-BUD-25, UC-BUD-26, UC-BUD-27, UC-BUD-28, UC-BUD-29, UC-BUD-30, UC-BUD-33, UC-BUD-114, UC-BUD-118, UC-BUD-119 | сценарій |
| BUD-06 | Порівняння періодів | MVP | UC-BUD-31, UC-BUD-32, UC-BUD-33, UC-BUD-115 | сценарій |
| BUD-07 | Регулярні платежі та підписки | MVP | UC-BUD-14, UC-BUD-34, UC-BUD-35, UC-BUD-36, UC-BUD-37, UC-BUD-38, UC-BUD-39, UC-BUD-40, UC-BUD-41, UC-BUD-117 | сценарій |
| BUD-08 | Грошовий потік і норма заощаджень | MVP | UC-BUD-42, UC-BUD-43, UC-BUD-44, UC-BUD-72, UC-BUD-119 | сценарій |
| BUD-09 | Спільний бюджет родини | MVP | UC-BUD-21, UC-BUD-22, UC-BUD-23, UC-BUD-45, UC-BUD-46, UC-BUD-47, UC-BUD-48, UC-BUD-49, UC-BUD-89, UC-BUD-95, UC-BUD-116, UC-BUD-120 | сценарій |
| BUD-10 | Сповіщення бюджету | MVP | UC-BUD-26, UC-BUD-50, UC-BUD-51, UC-BUD-52, UC-BUD-53, UC-BUD-54, UC-BUD-98, UC-BUD-116, UC-BUD-117 | сценарій |
| BUD-11 | Ручний режим без підключення банку | MVP | UC-BUD-55, UC-BUD-56, UC-BUD-57, UC-BUD-58, UC-BUD-59, UC-BUD-60, UC-BUD-61, UC-BUD-62 | сценарій |
| BUD-12 | Розбір транзакцій | MVP | UC-BUD-63, UC-BUD-64, UC-BUD-65, UC-BUD-66, UC-BUD-67, UC-BUD-68, UC-BUD-69, UC-BUD-80 | сценарій |
| BUD-13 | Атрибути транзакцій | MVP | UC-BUD-03, UC-BUD-70, UC-BUD-71, UC-BUD-72, UC-BUD-73, UC-BUD-74, UC-BUD-79, UC-BUD-80 | сценарій |
| BUD-14 | Мерчанти і правила | MVP | UC-BUD-75, UC-BUD-76, UC-BUD-77, UC-BUD-78, UC-BUD-79, UC-BUD-80, UC-BUD-81 | сценарій |
| BUD-15 | Чеки й замовлення | MVP | UC-BUD-82, UC-BUD-83, UC-BUD-84, UC-BUD-85, UC-BUD-86 | сценарій |
| BUD-16 | Методи бюджетування | MVP | UC-BUD-87, UC-BUD-88, UC-BUD-89, UC-BUD-90, UC-BUD-91, UC-BUD-112 | сценарій |
| BUD-17 | Керування планом | MVP | UC-BUD-21, UC-BUD-92, UC-BUD-93, UC-BUD-94, UC-BUD-95, UC-BUD-96, UC-BUD-97, UC-BUD-98, UC-BUD-113, UC-BUD-114 | сценарій |
| BUD-18 | Цільові суми категорій | MVP | UC-BUD-15, UC-BUD-99, UC-BUD-100, UC-BUD-101 | сценарій |
| BUD-19 | Погашення боргів | MVP | UC-BUD-102, UC-BUD-103, UC-BUD-104, UC-BUD-105 | сценарій |
| BUD-20 | Конструктор звітів | MVP | UC-BUD-106, UC-BUD-107, UC-BUD-108, UC-BUD-109, UC-BUD-110, UC-BUD-111 | сценарій |

## FCS (3)

| ID | Назва | Реліз | Сценарії | Тип |
| --- | --- | --- | --- | --- |
| FCS-01 | Прогноз витрат періоду | MVP | UC-BUD-112, UC-FCS-01, UC-FCS-02, UC-FCS-03 | сценарій |
| FCS-02 | Темп і попередження | MVP | UC-BUD-112, UC-FCS-04, UC-FCS-05 | сценарій |
| FCS-03 | Графік темпу і прогнозу у віджеті | MVP | UC-BUD-121, UC-FCS-02, UC-FCS-05, UC-FCS-06, UC-FCS-07 | сценарій |

## DOC (3)

| ID | Назва | Реліз | Сценарії | Тип |
| --- | --- | --- | --- | --- |
| DOC-01 | Сховище документів | MVP | UC-DOC-01, UC-DOC-02, UC-DOC-03, UC-DOC-04, UC-DOC-06, UC-DOC-07, UC-DOC-09, UC-DOC-10, UC-DOC-11, UC-DOC-12, UC-DOC-13, UC-DOC-14, UC-DOC-15, UC-DOC-16 | сценарій |
| DOC-02 | Типи документів, дати дії та зв'язки | MVP | UC-DOC-02, UC-DOC-04, UC-DOC-05, UC-DOC-06, UC-DOC-07, UC-DOC-08, UC-DOC-09, UC-DOC-10, UC-DOC-14 | сценарій |
| DOC-03 | Міграція зі звичайних документів (OCR) | v2 | UC-DOC-17, UC-DOC-18, UC-DOC-19, UC-DOC-20, UC-DOC-21 | сценарій |

## INS (2)

| ID | Назва | Реліз | Сценарії | Тип |
| --- | --- | --- | --- | --- |
| INS-01 | Страхові поліси | MVP | UC-INS-01, UC-INS-02, UC-INS-03, UC-INS-04, UC-INS-05, UC-INS-06, UC-INS-07, UC-INS-08, UC-INS-09, UC-INS-10, UC-INS-12 | сценарій |
| INS-02 | Аналіз покриття і страховий розклад | MVP (частково v1) | UC-INS-11, UC-INS-12, UC-INS-13, UC-INS-14, UC-INS-15, UC-INS-16 | сценарій |

## NOT (2)

| ID | Назва | Реліз | Сценарії | Тип |
| --- | --- | --- | --- | --- |
| NOT-01 | Нагадування і сповіщення | MVP | UC-NOT-01, UC-NOT-02, UC-NOT-03, UC-NOT-04, UC-NOT-05, UC-NOT-06, UC-NOT-07, UC-NOT-08, UC-NOT-09, UC-NOT-13 | сценарій |
| NOT-02 | Тригери сповіщень | v1 | UC-NOT-10, UC-NOT-11, UC-NOT-12, UC-NOT-13 | сценарій |

## DAT (5)

| ID | Назва | Реліз | Сценарії | Тип |
| --- | --- | --- | --- | --- |
| DAT-01 | Універсальний список | MVP | UC-DAT-01, UC-DAT-02, UC-DAT-03, UC-DAT-04, UC-DAT-24 | сценарій |
| DAT-02 | Глобальний пошук | MVP | UC-DAT-05, UC-DAT-06, UC-DAT-07, UC-DAT-08, UC-DAT-24 | сценарій |
| DAT-03 | Масові дії | MVP | UC-DAT-09, UC-DAT-10, UC-DAT-11, UC-DAT-12, UC-DAT-13 | сценарій |
| DAT-04 | Єдиний імпорт і майстер міграції | MVP | UC-DAT-14, UC-DAT-15, UC-DAT-16, UC-DAT-17, UC-DAT-18, UC-DAT-19 | сценарій |
| DAT-05 | Стани екранів і віджетів | MVP | UC-DAT-20, UC-DAT-21, UC-DAT-22, UC-DAT-23, UC-DAT-24 | сценарій |

## SUP (1)

| ID | Назва | Реліз | Сценарії | Тип |
| --- | --- | --- | --- | --- |
| SUP-01 | Підтримка і довідка | MVP | UC-SUP-01, UC-SUP-02, UC-SUP-03, UC-SUP-04, UC-SUP-05, UC-SUP-06, UC-SUP-07, UC-SUP-08, UC-SUP-09 | сценарій |

## RPT (2)

| ID | Назва | Реліз | Сценарії | Тип |
| --- | --- | --- | --- | --- |
| RPT-01 | Стандартні звіти | MVP | UC-RPT-01, UC-RPT-02, UC-RPT-03, UC-RPT-04, UC-RPT-05, UC-RPT-06, UC-RPT-07, UC-RPT-08, UC-RPT-09, UC-RPT-10, UC-RPT-11, UC-RPT-12, UC-RPT-13, UC-RPT-14 | сценарій |
| RPT-02 | Розклад звітів | v2 | UC-RPT-15, UC-RPT-16, UC-RPT-17, UC-RPT-18, UC-RPT-19 | сценарій |

## IMP (19)

| ID | Назва | Реліз | Сценарії | Тип |
| --- | --- | --- | --- | --- |
| IMP-01 | Завантаження файлів, партії та оригінали у сховищі | MVP | UC-IMP-01, UC-IMP-02, UC-IMP-03, UC-IMP-07, UC-IMP-10, UC-IMP-17, UC-IMP-18, UC-IMP-19, UC-IMP-21, UC-IMP-24, UC-IMP-25 | сценарій |
| IMP-02 | Мультивалютні рахунки та модель події з ногами | MVP | UC-IMP-07, UC-IMP-08, UC-IMP-09, UC-IMP-11 | сценарій |
| IMP-03 | Парування: обміни валют і внутрішні перекази | MVP | UC-IMP-17, UC-IMP-20, UC-IMP-30, UC-IMP-31, UC-IMP-32, UC-IMP-33, UC-IMP-34, UC-IMP-35 | сценарій |
| IMP-04 | Дублікати, ідемпотентність і відкат партії | MVP | UC-IMP-12, UC-IMP-17, UC-IMP-19, UC-IMP-20 | сценарій |
| IMP-05 | Контрольні суми, розриви історії та захист від чужого рахунку | MVP | UC-IMP-11, UC-IMP-13, UC-IMP-14, UC-IMP-17 | сценарій |
| IMP-06 | Рецепт розбору: схема, відбиток формату, альтернативи й пояснення | MVP | UC-IMP-10, UC-IMP-11, UC-IMP-25, UC-IMP-27, UC-IMP-44 | сценарій |
| IMP-07 | API шаблонів, автопідбір і повторний розбір з різницею | MVP | UC-IMP-03, UC-IMP-25, UC-IMP-26, UC-IMP-27, UC-IMP-28, UC-IMP-29 | сценарій |
| IMP-08 | Майстер імпорту: завантаження та перевірка розпізнавання | MVP | UC-IMP-01, UC-IMP-02, UC-IMP-03, UC-IMP-05, UC-IMP-10, UC-IMP-11, UC-IMP-13, UC-IMP-17, UC-IMP-19, UC-IMP-21, UC-IMP-25, UC-IMP-27, UC-IMP-35 | сценарій |
| IMP-09 | Редактор правил розпізнавання та шаблони (web) | MVP | UC-IMP-03, UC-IMP-25, UC-IMP-26, UC-IMP-27 | сценарій |
| IMP-10 | Бібліотека наших шаблонів банків та адмінка | MVP | UC-IMP-27, UC-IMP-39, UC-IMP-40, UC-IMP-41, UC-IMP-42, UC-IMP-43, UC-IMP-44 | сценарій |
| IMP-11 | Згода на збір анонімізованих відбитків форматів і статистика виправлень | MVP | UC-IMP-36, UC-IMP-37, UC-IMP-38, UC-IMP-39 | сценарій |
| IMP-12 | PDF із текстовим шаром | MVP | UC-IMP-03, UC-IMP-04, UC-IMP-10, UC-IMP-25 | сценарій |
| IMP-13 | Скани та фото виписок (OCR) | MVP | UC-IMP-05, UC-IMP-10, UC-IMP-13, UC-IMP-23, UC-IMP-28 | сценарій |
| IMP-14 | Файл помилок і повторний імпорт виправлених рядків | MVP | UC-IMP-22 | сценарій |
| IMP-15 | Кілька рахунків в одному файлі | MVP | UC-IMP-06, UC-IMP-14, UC-IMP-30 | сценарій |
| IMP-16 | Відкат партії через журнал проводок | MVP | UC-IMP-19, UC-IMP-20 | сценарій |
| IMP-17 | Підтверджена розбіжність залишку | MVP | UC-IMP-15, UC-IMP-16, UC-IMP-19 | сценарій |
| IMP-18 | Ідентичність рядка, перекриття виписок і основна дата | MVP | UC-IMP-12, UC-IMP-17 | сценарій |
| IMP-19 | Продуктивність, технічні стелі і стани партії | MVP | UC-IMP-01, UC-IMP-02, UC-IMP-17, UC-IMP-18, UC-IMP-23, UC-IMP-24 | сценарій |

## UX (9)

| ID | Назва | Реліз | Сценарії | Тип |
| --- | --- | --- | --- | --- |
| UX-01 | Онбординг | MVP | UC-UX-01, UC-UX-02, UC-UX-03, UC-UX-04, UC-UX-05, UC-UX-06, UC-UX-07, UC-UX-34, UC-UX-40 | сценарій |
| UX-02 | Приховування сум | MVP | UC-UX-08, UC-UX-09, UC-UX-10, UC-UX-11, UC-UX-12 | сценарій |
| UX-03 | Налаштовуваний головний екран | MVP | UC-UX-13, UC-UX-14, UC-UX-15, UC-UX-16, UC-UX-17 | сценарій |
| UX-04 | Командний рядок і скорочення | MVP | UC-UX-18, UC-UX-19, UC-UX-20, UC-UX-21 | сценарій |
| UX-05 | Персоналізація | v2 | UC-UX-22, UC-UX-23, UC-UX-24, UC-UX-25 | сценарій |
| UX-06 | Підсумки й поширення | v2 | UC-UX-26, UC-UX-27 | сценарій |
| UX-07 | Навчання | v2 | UC-UX-28, UC-UX-29, UC-UX-30, UC-UX-31, UC-UX-32 | сценарій |
| UX-08 | Режим «Тільки бюджет» на старті | MVP | UC-UX-01, UC-UX-02, UC-UX-07, UC-UX-33, UC-UX-34, UC-UX-40 | сценарій |
| UX-09 | Навігація і рівні меню | MVP | UC-UX-07, UC-UX-35, UC-UX-36, UC-UX-37, UC-UX-38, UC-UX-39, UC-UX-40, UC-UX-41, UC-UX-42, UC-UX-43 | сценарій |

## PLT (2)

| ID | Назва | Реліз | Сценарії | Тип |
| --- | --- | --- | --- | --- |
| PLT-01 | Віджети і швидкі дії | v1-mobile | UC-PLT-01, UC-PLT-02, UC-PLT-03, UC-PLT-04, UC-PLT-05 | сценарій |
| PLT-02 | Розширення платформ | v2 | UC-PLT-05, UC-PLT-06, UC-PLT-07, UC-PLT-08 | сценарій |

## WGT (25)

| ID | Назва | Реліз | Сценарії | Тип |
| --- | --- | --- | --- | --- |
| WGT-00 | Каркас віджетів і спільний контракт | MVP | UC-WGT-01, UC-WGT-02, UC-WGT-03, UC-WGT-04, UC-WGT-05, UC-WGT-06, UC-WGT-07, UC-WGT-12, UC-BUD-121 | сценарій |
| WGT-01 | Реєстр віджетів | MVP | UC-WGT-01, UC-WGT-04, UC-WGT-05, UC-WGT-06, UC-WGT-08, UC-WGT-12 | сценарій |
| WGT-02 | Режим редагування Головної | MVP | UC-WGT-08, UC-WGT-09, UC-WGT-10, UC-WGT-11, UC-WGT-12 | сценарій |
| WGT-10 | Плитка «Net worth» | MVP | UC-WGT-13 | сценарій |
| WGT-11 | Плитка «Доходи» | MVP | UC-WGT-13 | сценарій |
| WGT-12 | Плитка «Витрати» | MVP | UC-WGT-13 | сценарій |
| WGT-13 | Плитка «Норма заощаджень» | MVP | UC-WGT-13 | сценарій |
| WGT-14 | Віджет «Можна витратити» | MVP | UC-WGT-14 | сценарій |
| WGT-15 | Віджет «Цілі» | MVP | UC-WGT-15 | сценарій |
| WGT-16 | Віджет «Рахунки» | MVP | UC-WGT-16 | сценарій |
| WGT-17 | Віджет «Розподіл активів» | MVP | UC-WGT-21 | сценарій |
| WGT-18 | Віджет «Транзакції» | MVP | UC-WGT-17 | сценарій |
| WGT-19 | Віджет «Тип активу» | MVP | UC-WGT-22 | сценарій |
| WGT-20 | Віджет «До розбору» | MVP | UC-WGT-18 | сценарій |
| WGT-21 | Віджет «Регулярні платежі» | MVP | UC-WGT-19 | сценарій |
| WGT-22 | Віджет «Кредитний ліміт» | MVP | UC-WGT-16 | сценарій |
| WGT-23 | Віджет «Галерея активів» | MVP | UC-WGT-22 | сценарій |
| WGT-24 | Віджет «Бюджет за категоріями» | MVP | UC-WGT-20 | сценарій |
| WGT-25 | Віджет «Інвестиції» | MVP | UC-WGT-23 | сценарій |
| WGT-26 | Віджет «Підсумок тижня» | MVP | UC-WGT-20 | сценарій |
| WGT-27 | Віджет «Net worth» | MVP | UC-WGT-21 | сценарій |
| WGT-28 | Віджет «Мапа активів» | MVP | UC-WGT-22 | сценарій |
| WGT-29 | Віджет «Можна витратити» в режимі «Тільки бюджет» | MVP | UC-WGT-14 | сценарій |
| WGT-30 | Смуга «Потребує уваги» | MVP | UC-WGT-24 | сценарій |
| WGT-31 | Таблиця «Транзакції» | MVP | UC-WGT-17 | сценарій |

## L10N (2)

| ID | Назва | Реліз | Сценарії | Тип |
| --- | --- | --- | --- | --- |
| L10N-01 | Каркас локалізації: реєстр мов, RTL, формати, мова з браузера і профілю | MVP | UC-L10N-01, UC-L10N-02, UC-L10N-03, UC-L10N-04, UC-L10N-05, UC-L10N-06, UC-L10N-08, UC-L10N-09 | сценарій |
| L10N-02 | Переклади хвилі 1 і людська перевірка юридичних і платіжних текстів | MVP | UC-L10N-04, UC-L10N-05, UC-L10N-06, UC-L10N-07, UC-L10N-08, UC-L10N-09, UC-L10N-10 | сценарій |

## LEG (1)

| ID | Назва | Реліз | Сценарії | Тип |
| --- | --- | --- | --- | --- |
| LEG-01 | Юридичні документи, згода та приватність у застосунку | MVP | UC-LEG-01, UC-LEG-02, UC-LEG-03, UC-LEG-04, UC-LEG-05, UC-LEG-06, UC-LEG-07, UC-LEG-08 | сценарій |

## VLT (21)

| ID | Назва | Реліз | Сценарії | Тип |
| --- | --- | --- | --- | --- |
| VLT-01 | Розділ «Сейф» і категорії документів | MVP | UC-VLT-01, UC-VLT-02, UC-VLT-03, UC-VLT-09, UC-VLT-10, UC-VLT-11, UC-VLT-14, UC-VLT-16, UC-VLT-17, UC-VLT-18, UC-VLT-34 | сценарій |
| VLT-02 | Шаблони типів документів | MVP | UC-VLT-03, UC-VLT-04, UC-VLT-05, UC-VLT-06, UC-VLT-07, UC-VLT-09, UC-VLT-14 | сценарій |
| VLT-03 | Додавання документа: ручне введення, імпорт файлу і розпізнавання на пристрої | MVP (частково v1-mobile) | UC-VLT-03, UC-VLT-04, UC-VLT-07, UC-VLT-17 | сценарій |
| VLT-04 | Класи даних, ключ Сейфу і довірені пристрої | MVP | UC-VLT-01, UC-VLT-14, UC-VLT-26, UC-VLT-27, UC-VLT-28, UC-VLT-29, UC-VLT-30, UC-VLT-31 | сценарій |
| VLT-05 | Швидкий доступ і режим «Показати» | MVP (частково v1-mobile) | UC-VLT-15, UC-VLT-19, UC-VLT-20, UC-VLT-21, UC-VLT-22, UC-VLT-24, UC-VLT-27 | сценарій |
| VLT-06 | Захист перегляду | MVP (частково v1-mobile) | UC-VLT-20, UC-VLT-23, UC-VLT-24, UC-VLT-25 | сценарій |
| VLT-07 | Строки дії і нагадування | MVP (частково v1-mobile) | UC-VLT-03, UC-VLT-06, UC-VLT-14, UC-VLT-32, UC-VLT-33, UC-VLT-34, UC-VLT-35, UC-VLT-36 | сценарій |
| VLT-08 | Набір «В подорож» | MVP (частково v1-mobile) | UC-VLT-37, UC-VLT-38, UC-VLT-39, UC-VLT-40 | сценарій |
| VLT-09 | «Втратив документ або картку» | MVP (частково v1-mobile) | UC-VLT-41, UC-VLT-42, UC-VLT-43 | сценарій |
| VLT-10 | Приватність записів у просторі | MVP | UC-VLT-02, UC-VLT-15, UC-VLT-44, UC-VLT-45, UC-VLT-46, UC-VLT-47 | сценарій |
| VLT-11 | Тимчасове поширення копії | MVP | UC-VLT-07, UC-VLT-15, UC-VLT-48, UC-VLT-49, UC-VLT-50, UC-VLT-51 | сценарій |
| VLT-12 | Екстрений доступ довіреної особи | MVP (частково v1-mobile) | UC-VLT-15, UC-VLT-29, UC-VLT-31, UC-VLT-46, UC-VLT-47, UC-VLT-52, UC-VLT-53, UC-VLT-54, UC-VLT-55, UC-VLT-56 | сценарій |
| VLT-13 | Журнал дій із записами Сейфу | MVP (частково v1-mobile) | UC-VLT-14, UC-VLT-15, UC-VLT-49, UC-VLT-51, UC-VLT-57, UC-VLT-58, UC-VLT-59, UC-VLT-60 | сценарій |
| VLT-14 | Пошук і фільтри в Сейфі | MVP | UC-VLT-14, UC-VLT-27, UC-VLT-45, UC-VLT-61, UC-VLT-62 | сценарій |
| VLT-15 | Запис-посилання на офіційний цифровий документ | MVP | UC-VLT-18, UC-VLT-63, UC-VLT-64, UC-VLT-65, UC-VLT-66 | сценарій |
| VLT-16 | Юридичний статус копії | MVP | UC-VLT-12, UC-VLT-13, UC-VLT-20, UC-VLT-51, UC-VLT-65 | сценарій |
| VLT-17 | Платіжні картки без CVV і PIN | MVP (частково v1, v1-mobile) | UC-VLT-05, UC-VLT-06, UC-VLT-07, UC-VLT-08, UC-VLT-17 | сценарій |
| VLT-18 | Згода на медичні дані | MVP | UC-VLT-09, UC-VLT-10, UC-VLT-11, UC-VLT-47 | сценарій |
| VLT-19 | Приватна картка в Apple Wallet / Google Wallet | v2 | UC-VLT-15, UC-VLT-67 | сценарій |
| VLT-20 | Перевірка особи через офіційний цифровий гаманець | v2 | UC-VLT-68 | сценарій |
| VLT-21 | Автозаповнення з перевірених атрибутів | v2 | UC-VLT-69 | сценарій |

## AI (4)

| ID | Назва | Реліз | Сценарії | Тип |
| --- | --- | --- | --- | --- |
| AI-01 | AI-асистент | v1 | UC-AI-01, UC-AI-02, UC-AI-03, UC-AI-04, UC-AI-05, UC-AI-06, UC-AI-07, UC-AI-08 | сценарій |
| AI-02 | AI-пояснення | v1 | UC-AI-06, UC-AI-09, UC-AI-10, UC-AI-11, UC-AI-12 | сценарій |
| AI-03 | AI-розбір документів | v2 | UC-AI-01, UC-AI-13, UC-AI-14, UC-AI-15, UC-AI-16 | сценарій |
| AI-04 | Захист даних в AI | v1 | UC-AI-01, UC-AI-02, UC-AI-05, UC-AI-06, UC-AI-12, UC-AI-17, UC-AI-18, UC-AI-19 | сценарій |

## INT (1)

| ID | Назва | Реліз | Сценарії | Тип |
| --- | --- | --- | --- | --- |
| INT-01 | Відкритий доступ до даних | v2 | UC-INT-01, UC-INT-02, UC-INT-03, UC-INT-04, UC-INT-05, UC-INT-06, UC-INT-07, UC-INT-08, UC-INT-09 | сценарій |

## PLN (3)

| ID | Назва | Реліз | Сценарії | Тип |
| --- | --- | --- | --- | --- |
| PLN-01 | Довгостроковий прогноз | v2 | UC-PLN-01, UC-PLN-02, UC-PLN-03, UC-PLN-04, UC-PLN-05, UC-PLN-06, UC-PLN-07 | сценарій |
| PLN-02 | Пенсійне моделювання | v2 | UC-PLN-07, UC-PLN-08, UC-PLN-09, UC-PLN-10, UC-PLN-11 | сценарій |
| PLN-03 | Спадкове планування з партнером | v2 | UC-PLN-07, UC-PLN-12, UC-PLN-13, UC-PLN-14, UC-PLN-15, UC-PLN-16, UC-PLN-17 | сценарій |

## ADV (7)

| ID | Назва | Реліз | Сценарії | Тип |
| --- | --- | --- | --- | --- |
| ADV-01 | Організація радника | v2 | UC-ADV-01, UC-ADV-02, UC-ADV-03, UC-ADV-04, UC-ADV-05, UC-ADV-06, UC-ADV-07, UC-ADV-24, UC-ADV-28 | сценарій |
| ADV-02 | Список клієнтів радника | v2 | UC-ADV-07, UC-ADV-08, UC-ADV-09, UC-ADV-30 | сценарій |
| ADV-03 | Запрошення та передача простору | v2 | UC-ADV-06, UC-ADV-07, UC-ADV-10, UC-ADV-11, UC-ADV-12, UC-ADV-13, UC-ADV-14, UC-ADV-15, UC-ADV-23 | сценарій |
| ADV-04 | Контроль доступу клієнтом | v2 | UC-ADV-16, UC-ADV-17, UC-ADV-18, UC-ADV-19, UC-ADV-24, UC-ADV-28 | сценарій |
| ADV-05 | Фіди з систем радника | v2 | UC-ADV-20, UC-ADV-21, UC-ADV-22 | сценарій |
| ADV-06 | Походження даних і журнал правок | v2 | UC-ADV-04, UC-ADV-23, UC-ADV-24, UC-ADV-25, UC-ADV-26 | сценарій |
| ADV-07 | Брендовані звіти, нотатки, аналітика книги | v2 | UC-ADV-27, UC-ADV-28, UC-ADV-29, UC-ADV-30 | сценарій |

## FLW (58)

| ID | Назва | Реліз | Сценарії | Тип |
| --- | --- | --- | --- | --- |
| FLW-01 | Реєстрація та онбординг | MVP | UC-ACC-01, UC-ACC-02, UC-ACC-03, UC-ACC-04, UC-ACC-05, UC-ACC-09, UC-ACC-10, UC-ACC-15, UC-ACC-31, UC-ACC-41, UC-ACC-51, UC-AST-02, UC-BUD-55, UC-FIN-02, UC-L10N-01, UC-LEG-01, UC-LEG-02, UC-UX-01, UC-UX-02, UC-UX-03, UC-UX-04, UC-UX-05, UC-UX-07, UC-UX-11, UC-UX-33, UC-UX-40, UC-VAL-12, UC-VAL-32 | потік/шлях |
| FLW-02 | Вхід, 2FA і відновлення доступу | MVP | UC-ACC-05, UC-ACC-06, UC-ACC-07, UC-ACC-08, UC-ACC-09, UC-ACC-18, UC-ACC-19, UC-ACC-20, UC-ACC-23, UC-ACC-25, UC-ACC-26, UC-ACC-38, UC-LEG-04, UC-SUP-03 | потік/шлях |
| FLW-03 | Запрошення учасника і налаштування доступу | MVP | UC-ACC-21, UC-ACC-49, UC-ACC-50, UC-ACC-51, UC-ACC-52, UC-ACC-53, UC-ACC-55, UC-ACC-58, UC-AST-31, UC-DAT-04, UC-DAT-08, UC-DAT-22, UC-DOC-10, UC-UX-04, UC-VAL-33, UC-WGT-06 | потік/шлях |
| FLW-04 | Керування безпекою акаунта | MVP | UC-ACC-09, UC-ACC-15, UC-ACC-16, UC-ACC-17, UC-ACC-21, UC-ACC-22, UC-ACC-23, UC-ACC-24, UC-ACC-25, UC-ACC-29, UC-ACC-30, UC-ACC-63, UC-ACC-65, UC-ACC-66, UC-NOT-05, UC-VLT-59 | потік/шлях |
| FLW-05 | Вибір плану, пробний період і оплата | MVP (частково v1-mobile) | UC-ACC-10, UC-ACC-11, UC-ACC-12, UC-ACC-14, UC-ADM-08, UC-ADM-17, UC-ADM-28, UC-SUB-01, UC-SUB-05, UC-SUB-06, UC-SUB-07, UC-SUB-08, UC-SUB-11, UC-SUB-13, UC-SUB-14, UC-SUB-16, UC-SUB-17, UC-SUB-28 | потік/шлях |
| FLW-06 | Пропозиція апгрейду при досягненні ліміту | v1 | UC-ACC-42, UC-ACC-57, UC-AST-02, UC-BUD-21, UC-BUD-44, UC-BUD-74, UC-BUD-91, UC-BUD-111, UC-DAT-18, UC-DAT-22, UC-FIN-16, UC-FIN-59, UC-RPT-14, UC-SUB-33, UC-SUB-34, UC-SUB-35, UC-UX-17, UC-UX-38, UC-WGT-05 | потік/шлях |
| FLW-07 | Невдалий платіж, скасування, перехід на Free | MVP | UC-ACC-13, UC-ADM-16, UC-BUD-49, UC-RPT-19, UC-SUB-08, UC-SUB-09, UC-SUB-10, UC-SUB-11, UC-SUB-12, UC-SUB-13, UC-SUB-14, UC-SUB-15, UC-SUB-16 | потік/шлях |
| FLW-08 | Швидке додавання активу | MVP (частково v1, v1-mobile) | UC-AST-01, UC-AST-02, UC-AST-03, UC-AST-04, UC-AST-05, UC-AST-06, UC-AST-07, UC-AST-08, UC-AST-11, UC-AST-17, UC-AST-22, UC-AST-46, UC-AST-47, UC-AST-49, UC-DAT-07, UC-FIN-48, UC-SUB-32, UC-SUB-34, UC-UX-34, UC-UX-39, UC-UX-40, UC-VAL-07 | потік/шлях |
| FLW-09 | Додавання активу з документа (розпізнавання) | v2 | UC-AI-13, UC-AI-14, UC-AI-15, UC-DOC-17, UC-DOC-18, UC-DOC-19, UC-DOC-20 | потік/шлях |
| FLW-10 | Імпорт і міграція з іншого сервісу | MVP | UC-BUD-58, UC-BUD-85, UC-CRY-01, UC-DAT-14, UC-DAT-15, UC-DAT-16, UC-DAT-17, UC-DAT-18, UC-DAT-19, UC-FIN-55, UC-IMP-01, UC-IMP-21, UC-IMP-22, UC-INV-01, UC-INV-05, UC-SUB-37, UC-UX-41 | потік/шлях |
| FLW-11 | Життєвий цикл активу: позика, комісія, продаж, вибуття | MVP (частково v1) | UC-ACC-64, UC-AST-01, UC-AST-12, UC-AST-13, UC-AST-14, UC-AST-15, UC-AST-16, UC-AST-22, UC-AST-23, UC-AST-24, UC-AST-28, UC-AST-40, UC-DOC-13, UC-FIN-45, UC-VAL-34, UC-VAL-35, UC-VAL-36 | потік/шлях |
| FLW-12 | Зобов'язання і застава | MVP | UC-AST-07, UC-AST-32, UC-AST-33, UC-AST-36, UC-AST-37, UC-AST-38, UC-AST-39, UC-AST-40, UC-FIN-40, UC-FIN-84, UC-RPT-07 | потік/шлях |
| FLW-13 | Організація колекції: локації, групи, масові дії | MVP (частково v1) | UC-ACC-61, UC-AST-01, UC-AST-25, UC-AST-26, UC-AST-27, UC-AST-28, UC-AST-29, UC-AST-30, UC-AST-31, UC-AST-41, UC-AST-42, UC-DAT-01, UC-DAT-02, UC-DAT-09, UC-DAT-10, UC-DAT-11, UC-DAT-12, UC-DAT-13, UC-VAL-36, UC-VAL-37, UC-VAL-38, UC-WGT-22 | потік/шлях |
| FLW-14 | Перегляд Головної і net worth | MVP (частково v1) | UC-ACC-33, UC-ACC-34, UC-AST-42, UC-AST-44, UC-BUD-14, UC-BUD-15, UC-BUD-16, UC-BUD-65, UC-DAT-20, UC-DAT-21, UC-FCS-01, UC-FCS-02, UC-FCS-04, UC-FCS-05, UC-FCS-06, UC-FCS-07, UC-FIN-07, UC-FIN-71, UC-INS-09, UC-INV-06, UC-INV-08, UC-LEG-08, UC-RPT-02, UC-UX-08, UC-UX-13, UC-UX-14, UC-UX-15, UC-UX-33, UC-UX-34, UC-UX-35, UC-UX-36, UC-VAL-05, UC-VAL-07, UC-VAL-14, UC-VAL-17, UC-VAL-19, UC-VAL-25, UC-VAL-26, UC-VAL-27, UC-VAL-28, UC-VAL-29, UC-VAL-30, UC-VAL-31, UC-VAL-33, UC-VAL-37, UC-WGT-01, UC-WGT-02, UC-WGT-03, UC-WGT-04, UC-WGT-06, UC-WGT-07, UC-WGT-08, UC-WGT-09, UC-WGT-10, UC-WGT-11, UC-WGT-12, UC-WGT-13, UC-WGT-14, UC-WGT-15, UC-WGT-16, UC-WGT-17, UC-WGT-19, UC-WGT-20, UC-WGT-21, UC-WGT-22, UC-WGT-23, UC-WGT-24 | потік/шлях |
| FLW-15 | Оновлення оцінки активу | MVP (частково v1) | UC-AST-05, UC-AST-07, UC-DOC-08, UC-FIN-48, UC-FIN-69, UC-INS-05, UC-NOT-04, UC-NOT-11, UC-VAL-01, UC-VAL-02, UC-VAL-03, UC-VAL-04, UC-VAL-05, UC-VAL-06, UC-VAL-08, UC-VAL-09, UC-VAL-10, UC-VAL-11, UC-VAL-21, UC-VAL-22, UC-VAL-30, UC-WGT-24 | потік/шлях |
| FLW-16 | Власницькі структури і частки | MVP | UC-DOC-06, UC-FIN-09, UC-VAL-23, UC-VAL-24, UC-VAL-25 | потік/шлях |
| FLW-17 | Додавання рахунків: ручний рахунок, імпорт виписки, підключення банку | MVP (частково v1) | UC-AST-34, UC-BUD-01, UC-BUD-58, UC-BUD-62, UC-FIN-01, UC-FIN-02, UC-FIN-03, UC-FIN-04, UC-FIN-05, UC-FIN-06, UC-FIN-13, UC-FIN-14, UC-FIN-15, UC-FIN-17, UC-FIN-22, UC-FIN-26, UC-FIN-56, UC-FIN-68, UC-IMP-01, UC-IMP-02, UC-IMP-03, UC-IMP-04, UC-IMP-05, UC-IMP-06, UC-IMP-07, UC-IMP-08, UC-IMP-10, UC-IMP-11, UC-IMP-12, UC-IMP-13, UC-IMP-14, UC-IMP-15, UC-IMP-17, UC-IMP-19, UC-IMP-25, UC-IMP-26, UC-IMP-27, UC-IMP-30, UC-IMP-31, UC-IMP-35, UC-SUB-36, UC-UX-04, UC-UX-39, UC-UX-41, UC-WGT-16 | потік/шлях |
| FLW-18 | Відновлення зламаного підключення | MVP | UC-AST-34, UC-BUD-63, UC-DAT-21, UC-FIN-17, UC-FIN-18, UC-FIN-19, UC-FIN-20, UC-FIN-21, UC-FIN-22, UC-FIN-24, UC-FIN-27, UC-NOT-04 | потік/шлях |
| FLW-19 | Робота з транзакціями | MVP | UC-AST-18, UC-AST-19, UC-AST-21, UC-BUD-01, UC-BUD-02, UC-BUD-03, UC-BUD-04, UC-BUD-17, UC-BUD-33, UC-BUD-56, UC-BUD-68, UC-BUD-70, UC-BUD-72, UC-BUD-73, UC-DAT-01, UC-DAT-03, UC-FCS-02, UC-FCS-03, UC-FIN-23, UC-FIN-24, UC-FIN-33, UC-FIN-34, UC-FIN-35, UC-FIN-36, UC-FIN-37, UC-FIN-38, UC-FIN-39, UC-FIN-40, UC-FIN-41, UC-FIN-42, UC-FIN-44, UC-FIN-45, UC-IMP-08, UC-IMP-12, UC-IMP-20, UC-UX-09, UC-UX-35, UC-UX-37, UC-UX-39, UC-VAL-15, UC-WGT-17 | потік/шлях |
| FLW-20 | Аналіз портфеля і дохідності | MVP (частково v1) | UC-FIN-45, UC-FIN-49, UC-FIN-50, UC-FIN-51, UC-FIN-52, UC-FIN-53, UC-FIN-54, UC-FIN-55, UC-FIN-56, UC-FIN-57, UC-FIN-58, UC-FIN-59, UC-INV-01, UC-INV-02, UC-INV-03, UC-INV-04, UC-INV-07, UC-INV-08, UC-INV-10, UC-INV-11, UC-INV-12, UC-RPT-10, UC-VAL-17, UC-VAL-18, UC-VAL-20, UC-WGT-23 | потік/шлях |
| FLW-21 | Приватні інвестиції і capital call | v1 | UC-FIN-65, UC-FIN-66, UC-FIN-67 | потік/шлях |
| FLW-22 | Cash flow і прогноз ліквідності | v2 | UC-BUD-36, UC-FIN-72, UC-FIN-73, UC-FIN-74, UC-FIN-75, UC-FIN-76 | потік/шлях |
| FLW-23 | Завантаження і організація документів | MVP (частково v1-mobile) | UC-DOC-01, UC-DOC-02, UC-DOC-03, UC-DOC-04, UC-DOC-05, UC-DOC-06, UC-DOC-07, UC-DOC-08, UC-DOC-09, UC-DOC-10, UC-DOC-11, UC-DOC-12, UC-DOC-13, UC-DOC-14, UC-DOC-16, UC-VAL-04 | потік/шлях |
| FLW-24 | Страхування і аналіз покриття | MVP (частково v1) | UC-AST-27, UC-AST-47, UC-FIN-70, UC-INS-01, UC-INS-02, UC-INS-03, UC-INS-04, UC-INS-05, UC-INS-06, UC-INS-07, UC-INS-08, UC-INS-10, UC-INS-11, UC-INS-12, UC-INS-13, UC-INS-14, UC-INS-15, UC-INS-16, UC-NOT-11, UC-NOT-13, UC-RPT-08 | потік/шлях |
| FLW-25 | Реакція на сповіщення | MVP (частково v1, v1-mobile) | UC-ACC-62, UC-AST-35, UC-AST-39, UC-AST-43, UC-BUD-26, UC-BUD-34, UC-BUD-37, UC-BUD-41, UC-BUD-50, UC-BUD-51, UC-BUD-52, UC-BUD-53, UC-BUD-54, UC-BUD-61, UC-BUD-67, UC-BUD-83, UC-DAT-16, UC-DOC-14, UC-FIN-04, UC-FIN-19, UC-FIN-66, UC-FIN-69, UC-FIN-74, UC-FIN-82, UC-IMP-23, UC-INS-07, UC-INS-14, UC-NOT-01, UC-NOT-02, UC-NOT-03, UC-NOT-04, UC-NOT-06, UC-NOT-08, UC-NOT-09, UC-NOT-10, UC-NOT-11, UC-NOT-12, UC-NOT-13, UC-RPT-11, UC-RPT-17, UC-RPT-18, UC-UX-08, UC-UX-10, UC-UX-12, UC-UX-30, UC-UX-38, UC-VAL-09 | потік/шлях |
| FLW-26 | Формування і розклад звітів | MVP (частково v2) | UC-BUD-106, UC-BUD-107, UC-BUD-108, UC-BUD-109, UC-BUD-110, UC-FIN-57, UC-INS-15, UC-INS-16, UC-RPT-01, UC-RPT-02, UC-RPT-03, UC-RPT-04, UC-RPT-05, UC-RPT-06, UC-RPT-07, UC-RPT-08, UC-RPT-09, UC-RPT-10, UC-RPT-11, UC-RPT-12, UC-RPT-13, UC-RPT-14, UC-RPT-15, UC-RPT-16, UC-RPT-17, UC-RPT-18, UC-RPT-19, UC-UX-10, UC-VAL-16, UC-VAL-28 | потік/шлях |
| FLW-27 | Глобальний пошук | MVP | UC-AST-11, UC-BUD-70, UC-DAT-05, UC-DAT-06, UC-DAT-07, UC-DAT-08, UC-DOC-02, UC-DOC-21, UC-UX-18, UC-UX-19, UC-UX-20, UC-VLT-62 | потік/шлях |
| FLW-28 | Експорт даних і закриття акаунта | MVP | UC-ACC-21, UC-ACC-35, UC-ACC-36, UC-ACC-37, UC-ACC-38, UC-ACC-39, UC-ACC-44, UC-ACC-45, UC-ACC-46, UC-DOC-15, UC-IMP-24, UC-LEG-05, UC-LEG-07, UC-UX-10 | потік/шлях |
| FLW-29 | Звернення в підтримку | MVP | UC-ACC-20, UC-ADM-20, UC-DAT-20, UC-SUB-21, UC-SUB-23, UC-SUB-24, UC-SUB-25, UC-SUP-01, UC-SUP-02, UC-SUP-03, UC-SUP-04, UC-SUP-05, UC-SUP-06, UC-SUP-07, UC-SUP-08, UC-SUP-09, UC-UX-43 | потік/шлях |
| FLW-30 | Аварійний доступ до простору | v2 | UC-ACC-67, UC-ACC-68, UC-ACC-69, UC-ACC-70, UC-PLN-16 | потік/шлях |
| FLW-31 | Онбординг організації радника | v2 | UC-ADV-01, UC-ADV-02, UC-ADV-03, UC-ADV-04, UC-ADV-05, UC-ADV-27, UC-SUB-18 | потік/шлях |
| FLW-32 | Підключення клієнта до радника | v2 | UC-ADV-10, UC-ADV-11, UC-ADV-12, UC-ADV-13, UC-ADV-14, UC-ADV-15, UC-ADV-16, UC-ADV-17, UC-ADV-18, UC-SUB-18, UC-SUB-19 | потік/шлях |
| FLW-33 | Щоденна робота радника з клієнтами | v2 | UC-ADV-07, UC-ADV-08, UC-ADV-09, UC-ADV-20, UC-ADV-21, UC-ADV-22, UC-ADV-23, UC-ADV-24, UC-ADV-25, UC-ADV-26, UC-ADV-28, UC-ADV-29, UC-ADV-30, UC-FIN-25, UC-SUB-20 | потік/шлях |
| FLW-34 | Перший бюджет | MVP | UC-BUD-05, UC-BUD-07, UC-BUD-08, UC-BUD-10, UC-BUD-55, UC-FIN-01, UC-FIN-03, UC-UX-04, UC-UX-06, UC-WGT-20 | потік/шлях |
| FLW-35 | Щоденна перевірка і розбір транзакцій | MVP (частково v1-mobile) | UC-BUD-01, UC-BUD-02, UC-BUD-03, UC-BUD-14, UC-BUD-18, UC-BUD-57, UC-BUD-59, UC-BUD-63, UC-BUD-64, UC-BUD-65, UC-BUD-66, UC-BUD-67, UC-BUD-69, UC-BUD-72, UC-FIN-34, UC-FIN-39, UC-IMP-12, UC-IMP-30, UC-IMP-31, UC-IMP-32, UC-IMP-33, UC-IMP-34, UC-IMP-35, UC-NOT-01, UC-PLT-01, UC-PLT-02, UC-PLT-03, UC-PLT-04, UC-UX-12, UC-WGT-14, UC-WGT-17, UC-WGT-18 | потік/шлях |
| FLW-36 | «Чи можу я собі дозволити?» | MVP | UC-BUD-19, UC-BUD-20, UC-BUD-22, UC-UX-29, UC-WGT-14 | потік/шлях |
| FLW-37 | Ціль накопичення: від створення до витрати | MVP | UC-AST-17, UC-BUD-22, UC-BUD-23, UC-BUD-24, UC-BUD-25, UC-BUD-26, UC-BUD-27, UC-BUD-28, UC-BUD-29, UC-BUD-30, UC-UX-04, UC-UX-16, UC-WGT-15 | потік/шлях |
| FLW-38 | Підсумок періоду і порівняння витрат | MVP (частково v2) | UC-BUD-08, UC-BUD-11, UC-BUD-31, UC-BUD-32, UC-BUD-42, UC-BUD-43, UC-UX-26, UC-UX-27, UC-WGT-13, UC-WGT-20 | потік/шлях |
| FLW-39 | Зміна складу плану в адмін-панелі | MVP (частково v1, v1-mobile) | UC-ADM-01, UC-ADM-02, UC-ADM-03, UC-ADM-04, UC-ADM-05, UC-ADM-06, UC-ADM-07, UC-ADM-09, UC-ADM-10, UC-ADM-11, UC-ADM-12, UC-ADM-13, UC-ADM-14, UC-ADM-15, UC-ADM-18, UC-ADM-27, UC-ADM-29, UC-ADM-30, UC-ADM-31, UC-L10N-09, UC-SUB-02, UC-SUB-03, UC-SUB-04 | потік/шлях |
| FLW-40 | Звірка рахунку з банком | v1 | UC-FIN-77, UC-FIN-78, UC-FIN-79, UC-FIN-80 | потік/шлях |
| FLW-41 | Правила і мерчанти | MVP | UC-AST-21, UC-BUD-02, UC-BUD-64, UC-BUD-75, UC-BUD-76, UC-BUD-77, UC-BUD-78, UC-BUD-79, UC-BUD-80, UC-BUD-81, UC-FIN-35, UC-FIN-36, UC-UX-22, UC-UX-23 | потік/шлях |
| FLW-42 | Чек: від фото до розділеної транзакції | MVP (частково v1-mobile) | UC-BUD-03, UC-BUD-82, UC-BUD-83, UC-BUD-84, UC-BUD-85, UC-BUD-86, UC-FIN-29, UC-FIN-30, UC-FIN-31, UC-FIN-43, UC-PLT-04, UC-UX-39 | потік/шлях |
| FLW-43 | Місячний розподіл «Кожній копійці — завдання» | MVP | UC-BUD-87, UC-BUD-89, UC-BUD-90, UC-BUD-93, UC-BUD-99, UC-BUD-100, UC-BUD-101 | потік/шлях |
| FLW-44 | План погашення боргів | MVP | UC-AST-32, UC-AST-33, UC-AST-36, UC-BUD-102, UC-BUD-103, UC-BUD-104, UC-BUD-105 | потік/шлях |
| FLW-45 | Розмова з AI-асистентом | v1 | UC-AI-01, UC-AI-02, UC-AI-03, UC-AI-04, UC-AI-05, UC-AI-06, UC-AI-07, UC-AI-08, UC-AI-09, UC-AI-10, UC-AI-17, UC-LEG-08, UC-UX-21 | потік/шлях |
| FLW-46 | Компенсація акціями: від гранту до net worth | v1 (частково v2) | UC-FIN-88, UC-FIN-89, UC-FIN-90, UC-FIN-91 | потік/шлях |
| FLW-47 | Довгостроковий прогноз і сценарії | v2 | UC-PLN-01, UC-PLN-02, UC-PLN-03, UC-PLN-04, UC-PLN-05, UC-PLN-06, UC-PLN-07, UC-PLN-08, UC-PLN-09, UC-PLN-10, UC-PLN-11 | потік/шлях |
| FLW-48 | Підключення зовнішнього AI-асистента або сервісу через API | v2 | UC-INT-01, UC-INT-02, UC-INT-03, UC-INT-04, UC-INT-05, UC-INT-06, UC-INT-07, UC-INT-08, UC-INT-09 | потік/шлях |
| FLW-49 | Перехід з іншого бюджетного застосунку | MVP (частково v1) | UC-BUD-87, UC-DAT-15 | потік/шлях |
| FLW-50 | Увімкнення Сейфу і ключ відновлення | MVP | UC-VLT-01, UC-VLT-10, UC-VLT-11, UC-VLT-16, UC-VLT-26, UC-VLT-27, UC-VLT-28, UC-VLT-29, UC-VLT-30, UC-VLT-52 | потік/шлях |
| FLW-51 | Додавання документа в Сейф | MVP (частково v1-mobile) | UC-DOC-09, UC-VLT-02, UC-VLT-03, UC-VLT-04, UC-VLT-05, UC-VLT-06, UC-VLT-07, UC-VLT-08, UC-VLT-09, UC-VLT-12, UC-VLT-14, UC-VLT-17, UC-VLT-18 | потік/шлях |
| FLW-52 | Показати документ на стійці | MVP (частково v1-mobile) | UC-VLT-02, UC-VLT-19, UC-VLT-20, UC-VLT-21, UC-VLT-22, UC-VLT-23, UC-VLT-24, UC-VLT-25 | потік/шлях |
| FLW-53 | Нагадування про строк дії і продовження | MVP (частково v1-mobile) | UC-NOT-04, UC-NOT-11, UC-VLT-14, UC-VLT-32, UC-VLT-33, UC-VLT-34, UC-VLT-35, UC-VLT-36 | потік/шлях |
| FLW-54 | Набір «В подорож» перед поїздкою сім'ї | MVP (частково v1-mobile) | UC-VLT-37, UC-VLT-38, UC-VLT-39, UC-VLT-40 | потік/шлях |
| FLW-55 | Втратив картку або паспорт за кордоном | MVP (частково v1-mobile) | UC-VLT-13, UC-VLT-41, UC-VLT-42, UC-VLT-43, UC-VLT-51 | потік/шлях |
| FLW-56 | Тимчасове поширення копії | MVP | UC-VLT-44, UC-VLT-48, UC-VLT-49, UC-VLT-50, UC-VLT-51 | потік/шлях |
| FLW-57 | Екстрений доступ довіреної особи до Сейфу | MVP (частково v1, v1-mobile) | UC-VLT-52, UC-VLT-53, UC-VLT-54, UC-VLT-55, UC-VLT-56, UC-VLT-57, UC-VLT-58, UC-VLT-60 | потік/шлях |
| FLW-58 | Перевірка особи через офіційний цифровий гаманець | v2 | UC-VLT-26, UC-VLT-28, UC-VLT-68, UC-VLT-69 | потік/шлях |

## JRN (9)

| ID | Назва | Реліз | Сценарії | Тип |
| --- | --- | --- | --- | --- |
| JRN-00 | Як читати вимоги до досвіду | — | — (службовий опис формату карт досвіду, сценарію немає) | потік/шлях |
| JRN-01 | Родина з різнорідними активами: перші 90 днів | MVP (частково v1) | UC-ACC-01, UC-ACC-02, UC-ACC-15, UC-ACC-31, UC-ACC-50, UC-AST-02, UC-AST-03, UC-DAT-14, UC-FIN-01, UC-FIN-02, UC-FIN-03, UC-FIN-14, UC-IMP-01, UC-LEG-01, UC-SUB-01, UC-SUB-07, UC-UX-01, UC-VAL-08, UC-VAL-21, UC-VAL-23, UC-VAL-26, UC-VAL-29, UC-VAL-32, UC-WGT-01, UC-WGT-21 | потік/шлях |
| JRN-02 | Колекціонер: купівля, облік, страхування, продаж | MVP (частково v1) | UC-AST-04, UC-AST-07, UC-AST-12, UC-AST-13, UC-AST-25, UC-DAT-01, UC-DAT-09, UC-DAT-14, UC-DOC-01, UC-INS-01, UC-INS-02, UC-INS-04, UC-INS-05, UC-INS-11, UC-INS-15, UC-NOT-03, UC-NOT-10, UC-RPT-06, UC-RPT-08, UC-VAL-01, UC-WGT-22 | потік/шлях |
| JRN-03 | Життєва подія: смерть або недієздатність власника | v2 (частково MVP) | UC-ACC-35, UC-ACC-44, UC-ACC-45, UC-ACC-67, UC-ACC-68, UC-ACC-69, UC-ACC-70, UC-INS-15, UC-PLN-12, UC-PLN-13, UC-PLN-14, UC-PLN-15, UC-PLN-16, UC-SUP-01, UC-VLT-52, UC-VLT-53, UC-VLT-55 | потік/шлях |
| JRN-04 | Клієнт радника | v2 | UC-ADV-07, UC-ADV-10, UC-ADV-11, UC-ADV-12, UC-ADV-15, UC-ADV-16, UC-ADV-17, UC-ADV-23, UC-ADV-24, UC-ADV-26, UC-ADV-28, UC-RPT-15, UC-RPT-17, UC-SUB-18, UC-SUB-19, UC-SUB-20 | потік/шлях |
| JRN-05 | Молода родина з бюджетом: перші 6 місяців | MVP | UC-ACC-01, UC-ACC-02, UC-ACC-15, UC-ACC-31, UC-ACC-50, UC-BUD-01, UC-BUD-02, UC-BUD-05, UC-BUD-07, UC-BUD-08, UC-BUD-09, UC-BUD-14, UC-BUD-31, UC-BUD-45, UC-BUD-46, UC-BUD-47, UC-BUD-55, UC-BUD-56, UC-BUD-63, UC-BUD-97, UC-FCS-01, UC-FCS-05, UC-FCS-06, UC-FIN-01, UC-FIN-03, UC-FIN-34, UC-IMP-01, UC-IMP-17, UC-NOT-01, UC-PLT-01, UC-UX-01, UC-UX-04, UC-UX-06, UC-UX-33, UC-UX-34, UC-UX-40, UC-WGT-01, UC-WGT-14 | потік/шлях |
| JRN-06 | Перехід з іншого бюджетного застосунку: перші 90 днів | MVP (частково v1) | UC-ACC-50, UC-AST-04, UC-AST-32, UC-BUD-87, UC-BUD-89, UC-DAT-15, UC-FIN-88, UC-IMP-12 | потік/шлях |
| JRN-07 | Сім'я збирається в подорож з документами в Сейфі | MVP (частково v1-mobile) | UC-VLT-01, UC-VLT-03, UC-VLT-20, UC-VLT-32, UC-VLT-36, UC-VLT-37, UC-VLT-38, UC-VLT-41 | потік/шлях |
| JRN-08 | Наскрізні вимоги з усіх шляхів | — | UC-ACC-49, UC-ACC-50, UC-ACC-56, UC-ACC-58, UC-ACC-59, UC-ACC-60, UC-ACC-67, UC-AST-01, UC-DAT-20, UC-FIN-14, UC-UX-07, UC-UX-33, UC-UX-34, UC-UX-35, UC-VAL-01, UC-VAL-02, UC-VAL-08, UC-VAL-29, UC-VLT-01, UC-VLT-52 | потік/шлях |

## SCR (2)

| ID | Назва | Реліз | Сценарії | Тип |
| --- | --- | --- | --- | --- |
| SCR-01 | Інвентар екранів | — | UC-DOC-03, UC-INT-01, UC-UX-38, UC-UX-43, UC-ACC-01, UC-ACC-02, UC-ACC-03, UC-ACC-05, UC-ACC-06, UC-ACC-07 … усього 815 | наскрізна |
| SCR-02 | Правила екранів | — | UC-ACC-09, UC-ACC-15, UC-ACC-16, UC-ACC-21, UC-ACC-29, UC-ACC-35, UC-ACC-37, UC-ACC-44, UC-ACC-45, UC-ACC-46 … усього 145 | наскрізна |

## GRID (8)

| ID | Назва | Реліз | Сценарії | Тип |
| --- | --- | --- | --- | --- |
| GRID-00 | Основа сітки, оболонка навігації і загальні правила інтерфейсу | MVP | UC-ACC-23, UC-ACC-65, UC-AI-02, UC-AI-05, UC-AST-42, UC-BUD-65, UC-DOC-16, UC-FIN-85, UC-IMP-01, UC-PLN-01 … усього 25 | наскрізна |
| GRID-01 | Сітки сторінок розділу «Головна» (Огляд і Net worth) | MVP | UC-ACC-02, UC-ACC-03, UC-ACC-17, UC-ACC-32, UC-ACC-33, UC-ACC-34, UC-ACC-59, UC-ADM-15, UC-ADV-19, UC-AI-09 … усього 103 | наскрізна |
| GRID-02 | Сітки сторінок розділу «Гроші» | MVP | UC-ADM-28, UC-AI-12, UC-AST-19, UC-AST-21, UC-BUD-01, UC-BUD-02, UC-BUD-04, UC-BUD-32, UC-BUD-45, UC-BUD-56 … усього 90 | наскрізна |
| GRID-03 | Сітки сторінок розділу «Активи» | MVP | UC-ACC-34, UC-ACC-59, UC-ACC-61, UC-ADV-23, UC-AI-13, UC-AI-14, UC-AI-16, UC-AST-01, UC-AST-02, UC-AST-03 … усього 94 | наскрізна |
| GRID-04 | Сітки сторінок розділу «Планування» | MVP | UC-ACC-60, UC-ADM-16, UC-AST-20, UC-BUD-07, UC-BUD-08, UC-BUD-09, UC-BUD-11, UC-BUD-13, UC-BUD-14, UC-BUD-15 … усього 69 | наскрізна |
| GRID-05 | Сітки сторінок розділу «Ще» (акаунт) | MVP | UC-ACC-03, UC-ACC-12, UC-ACC-13, UC-ACC-37, UC-ACC-44, UC-ACC-45, UC-ACC-50, UC-ACC-56, UC-ACC-57, UC-ACC-58 … усього 74 | наскрізна |
| GRID-06 | Сітки сторінок входу і онбордингу | MVP | UC-ACC-01, UC-ACC-02, UC-ACC-03, UC-ACC-05, UC-ACC-06, UC-ACC-07, UC-ACC-08, UC-ACC-09, UC-ACC-18, UC-ACC-19 … усього 22 | наскрізна |
| GRID-07 | Сітки сторінок адмін-панелі | MVP | UC-ADM-01, UC-ADM-02, UC-ADM-03, UC-ADM-04, UC-ADM-05, UC-ADM-06, UC-ADM-07, UC-ADM-11, UC-ADM-12, UC-ADM-13 … усього 30 | наскрізна |

## CMP (72)

| ID | Назва | Реліз | Сценарії | Тип |
| --- | --- | --- | --- | --- |
| CMP-01 | Button — Кнопка | MVP | UC-ACC-01, UC-ACC-06, UC-ACC-09, UC-ACC-10, UC-ACC-12, UC-ACC-14, UC-ACC-15, UC-ACC-22, UC-ACC-23, UC-ACC-25 … усього 239 | наскрізна |
| CMP-02 | Field — Поле введення | MVP | UC-ACC-01, UC-ACC-06, UC-ACC-07, UC-ACC-08, UC-ACC-09, UC-ACC-15, UC-ACC-18, UC-ACC-19, UC-ACC-27, UC-ACC-29 … усього 122 | наскрізна |
| CMP-03 | Select — Список вибору | MVP | UC-ACC-44, UC-ADV-03 | наскрізна |
| CMP-04 | Checkbox — Прапорець | MVP | UC-ACC-01, UC-ACC-59, UC-ADM-01, UC-ADV-16, UC-BUD-27, UC-BUD-79, UC-BUD-80, UC-DAT-04, UC-DAT-09, UC-DOC-10 … усього 25 | наскрізна |
| CMP-05 | Switch — Перемикач | MVP | UC-ACC-11, UC-ACC-33, UC-ACC-40, UC-ACC-41, UC-ACC-43, UC-ACC-51, UC-ACC-60, UC-ADM-05, UC-ADM-27, UC-ADV-05 … усього 71 | наскрізна |
| CMP-06 | Dropzone — Зона завантаження файлів | MVP | UC-AI-13, UC-DOC-01 | наскрізна |
| CMP-07 | Amount — Сума | MVP | UC-AST-05, UC-BUD-08, UC-DAT-05, UC-FIN-01, UC-FIN-04, UC-FIN-05, UC-FIN-29, UC-FIN-37, UC-FIN-77, UC-FIN-79 … усього 32 | наскрізна |
| CMP-08 | Delta — Зміна | MVP | UC-ACC-43, UC-ACC-53, UC-ADV-07, UC-AI-09, UC-BUD-26, UC-FIN-45, UC-FIN-86, UC-FIN-93, UC-IMP-25, UC-INS-03 … усього 19 | наскрізна |
| CMP-09 | GoalProgress — Прогрес цілі | MVP | UC-ADM-05, UC-BUD-08, UC-BUD-22, UC-BUD-78, UC-BUD-99, UC-PLT-01, UC-VLT-38 | наскрізна |
| CMP-10 | PageHeader — Заголовок сторінки | MVP | UC-UX-05, UC-WGT-03 | наскрізна |
| CMP-11 | Tabs — Вкладки | MVP | UC-ACC-23, UC-ACC-59, UC-ACC-64, UC-AST-02, UC-AST-03, UC-AST-04, UC-AST-11, UC-AST-17, UC-AST-26, UC-BUD-44 … усього 59 | наскрізна |
| CMP-12 | Segmented — Сегментований перемикач | MVP | UC-AST-35, UC-AST-49, UC-BUD-03, UC-BUD-08, UC-BUD-22, UC-BUD-37, UC-BUD-41, UC-BUD-42, UC-BUD-43, UC-BUD-64 … усього 34 | наскрізна |
| CMP-13 | Pagination — Пагінація | MVP | UC-ACC-65, UC-DAT-01, UC-DOC-02, UC-NOT-01, UC-NOT-02 | наскрізна |
| CMP-14 | Stepper — Індикатор кроків | MVP | UC-ACC-31, UC-BUD-07, UC-BUD-56, UC-BUD-58, UC-DAT-14, UC-DAT-15, UC-FIN-02, UC-FIN-14, UC-FIN-15, UC-IMP-01 … усього 17 | наскрізна |
| CMP-15 | Checklist — Список налаштування | MVP | UC-VAL-32 | наскрізна |
| CMP-16 | CommandPalette — Командна панель | MVP | UC-ACC-59, UC-AST-11, UC-BUD-70, UC-DAT-05, UC-DAT-06, UC-DAT-07, UC-DAT-08, UC-DOC-21, UC-PLT-05, UC-UX-08 … усього 14 | наскрізна |
| CMP-17 | Tree — Дерево | MVP | UC-ADV-16, UC-AST-25, UC-BUD-01, UC-BUD-05, UC-UX-37 | наскрізна |
| CMP-18 | Badge — Бейдж статусу | MVP | UC-ADM-16, UC-ADV-07, UC-ADV-10, UC-ADV-29, UC-AST-07, UC-BUD-72, UC-BUD-84, UC-BUD-85, UC-DOC-02, UC-FIN-19 … усього 20 | наскрізна |
| CMP-19 | Banner — Банер | MVP | UC-ACC-03, UC-ACC-06, UC-ACC-17, UC-ACC-19, UC-ACC-29, UC-ACC-69, UC-ADM-15, UC-ADM-29, UC-BUD-49, UC-BUD-87 … усього 44 | наскрізна |
| CMP-20 | Toast — Спливне повідомлення | MVP | UC-ACC-34, UC-ACC-58, UC-ACC-59, UC-ACC-64, UC-ADV-23, UC-AI-09, UC-AST-01, UC-AST-05, UC-AST-07, UC-AST-10 … усього 61 | наскрізна |
| CMP-21 | Dialog — Діалог | MVP | UC-ACC-21, UC-ACC-23, UC-ACC-37, UC-ACC-46, UC-ACC-50, UC-ADM-17, UC-AI-01, UC-AI-02, UC-AI-05, UC-AI-07 … усього 55 | наскрізна |
| CMP-22 | Skeleton — Скелетон завантаження | MVP | UC-ADM-31, UC-ADV-07, UC-ADV-30, UC-AI-09, UC-AST-01, UC-AST-07, UC-AST-44, UC-FIN-01, UC-FIN-34, UC-FIN-50 … усього 33 | наскрізна |
| CMP-23 | EmptyState — Порожній стан | MVP | UC-ACC-59, UC-ACC-61, UC-AST-01, UC-AST-02, UC-AST-13, UC-AST-31, UC-AST-41, UC-AST-42, UC-DAT-01, UC-DAT-02 … усього 31 | наскрізна |
| CMP-24 | ErrorState — Стан помилки | MVP | UC-AI-02, UC-AI-13, UC-INT-06, UC-RPT-02, UC-UX-07, UC-UX-13, UC-WGT-04, UC-WGT-09, UC-WGT-19 | наскрізна |
| CMP-25 | Tooltip — Підказка | MVP | UC-ACC-09, UC-ACC-31, UC-ACC-34, UC-ACC-41, UC-ACC-50, UC-ADM-08, UC-ADM-18, UC-ADV-26, UC-AI-02, UC-AST-04 … усього 88 | наскрізна |
| CMP-26 | Table — Таблиця | MVP | UC-ACC-35, UC-ACC-56, UC-ADM-01, UC-ADM-05, UC-ADM-19, UC-ADM-28, UC-ADM-29, UC-ADM-32, UC-ADV-24, UC-AST-07 … усього 65 | наскрізна |
| CMP-27 | ListRow — Рядок списку | MVP | UC-ACC-22, UC-ACC-31, UC-ACC-35, UC-ACC-47, UC-ACC-49, UC-ACC-50, UC-ACC-59, UC-ACC-61, UC-ADM-09, UC-ADM-13 … усього 127 | наскрізна |
| CMP-28 | TransactionRow — Рядок транзакції | MVP | UC-ACC-56, UC-ACC-59, UC-ACC-60, UC-ACC-63, UC-ACC-65, UC-ADM-20, UC-ADM-31, UC-ADM-32, UC-ADV-07, UC-ADV-16 … усього 209 | наскрізна |
| CMP-29 | NotificationItem — Сповіщення в центрі сповіщень | MVP | UC-ACC-36, UC-ACC-45, UC-ACC-51, UC-ACC-55, UC-ACC-62, UC-ACC-69, UC-ADV-18, UC-AST-35, UC-AST-39, UC-AST-43 … усього 58 | наскрізна |
| CMP-30 | Avatar — Аватар учасника | MVP | UC-ACC-27, UC-BUD-75, UC-BUD-84, UC-FIN-34, UC-FIN-80, UC-UX-36 | наскрізна |
| CMP-31 | Timeline — Хронологія подій | MVP | UC-ACC-64, UC-AST-36, UC-BUD-87, UC-FIN-35, UC-FIN-83, UC-VAL-01, UC-VAL-02, UC-VLT-57 | наскрізна |
| CMP-32 | FilterBar — Панель фільтрів | MVP | UC-ACC-59, UC-ACC-65, UC-ADM-01, UC-ADM-21, UC-ADM-31, UC-ADM-32, UC-ADV-08, UC-AI-02, UC-AST-01, UC-AST-09 … усього 54 | наскрізна |
| CMP-33 | Icon — Іконка | MVP | UC-ACC-09, UC-AST-44, UC-AST-47, UC-BUD-01, UC-BUD-05, UC-BUD-77, UC-BUD-78, UC-DAT-24, UC-FIN-33, UC-FIN-34 … усього 36 | наскрізна |
| CMP-34 | AssetPlaceholder — Заглушка зображення | MVP | UC-ACC-11, UC-ACC-22, UC-ACC-27, UC-ACC-65, UC-ADM-01, UC-ADM-05, UC-AST-47, UC-BUD-85, UC-INS-15, UC-SUB-01 … усього 14 | наскрізна |
| CMP-35 | AssetMap — Мапа активів | MVP | UC-AST-25, UC-AST-27, UC-VAL-37, UC-VAL-38, UC-WGT-22 | наскрізна |
| CMP-36 | AssetGallery — Галерея активів | MVP | UC-AST-12, UC-AST-19, UC-AST-25, UC-AST-47, UC-AST-48, UC-DOC-16, UC-WGT-12, UC-WGT-22 | наскрізна |
| CMP-37 | PhotoGallery — Фотогалерея активу | v1 | UC-AST-47, UC-AST-48 | наскрізна |
| CMP-38 | AssetMapWidget — Віджет мапи активів | MVP | UC-UX-33, UC-VAL-25, UC-VAL-37, UC-WGT-03, UC-WGT-22 | наскрізна |
| CMP-39 | AssetGalleryWidget — Віджет галереї активів | MVP | UC-AST-12, UC-AST-19, UC-AST-25, UC-AST-47, UC-AST-48, UC-DOC-16, UC-WGT-12, UC-WGT-22 | наскрізна |
| CMP-40 | SummaryWidget — Підсумковий віджет | MVP | UC-ACC-56, UC-ACC-63, UC-AI-09, UC-AI-11, UC-AST-07, UC-AST-20, UC-AST-36, UC-AST-42, UC-AST-44, UC-BUD-07 … усього 79 | наскрізна |
| CMP-41 | AssetTypeWidget — Віджет типу активу | MVP | UC-AST-42, UC-AST-44, UC-UX-33, UC-VAL-08 | наскрізна |
| CMP-42 | LineChart — Лінійний графік | MVP | UC-ADV-30, UC-AST-07, UC-FCS-06, UC-PLN-01, UC-UX-08, UC-VAL-02, UC-VAL-26, UC-WGT-21, UC-WGT-22 | наскрізна |
| CMP-43 | SmallMultiples — Малі множини | v1 | UC-BUD-31, UC-BUD-32, UC-BUD-106 | наскрізна |
| CMP-44 | Sparkline — Спарклайн | MVP | UC-BUD-31 | наскрізна |
| CMP-45 | Treemap — Мозаїка часток | MVP | UC-BUD-106, UC-BUD-107, UC-FIN-93 | наскрізна |
| CMP-46 | InvestmentChart — Графік інвестиції | MVP | UC-ACC-59, UC-AI-02, UC-AST-20, UC-BUD-41, UC-CRY-01, UC-CRY-03, UC-FIN-57, UC-FIN-58, UC-FIN-59, UC-PLN-01 … усього 14 | наскрізна |
| CMP-47 | BarChart — Стовпчиковий графік | MVP | UC-AI-02, UC-BUD-32, UC-BUD-43, UC-WGT-02, UC-WGT-21 | наскрізна |
| CMP-48 | DonutChart — Кільцева діаграма | MVP | UC-FIN-58, UC-WGT-21 | наскрізна |
| CMP-49 | RingProgress — Кільце прогресу | MVP | UC-ADM-26, UC-AST-41, UC-BUD-08, UC-BUD-22, UC-BUD-23, UC-BUD-24, UC-BUD-25, UC-BUD-52, UC-BUD-63, UC-BUD-64 … усього 33 | наскрізна |
| CMP-50 | Waterfall — Каскадна діаграма | MVP | UC-VAL-27 | наскрізна |
| CMP-51 | Heatmap — Теплова карта | v1 | UC-BUD-32, UC-BUD-42, UC-BUD-71, UC-BUD-72, UC-BUD-82 | наскрізна |
| CMP-52 | AllocationBar — Смуга розподілу | MVP | UC-AST-07, UC-AST-15, UC-AST-36, UC-AST-38, UC-AST-40, UC-FIN-58, UC-VAL-33 | наскрізна |
| CMP-53 | Card — Картка | MVP | UC-ACC-11, UC-ACC-12, UC-ACC-59, UC-ACC-64, UC-ADM-01, UC-ADM-03, UC-ADM-04, UC-ADM-18, UC-ADM-19, UC-ADM-20 … усього 191 | наскрізна |
| CMP-54 | Widget — Віджет | MVP | UC-ACC-56, UC-ACC-63, UC-AI-09, UC-AI-11, UC-AST-07, UC-AST-20, UC-AST-36, UC-AST-42, UC-AST-44, UC-BUD-07 … усього 79 | наскрізна |
| CMP-55 | BudgetRow — Рядок бюджету | MVP | UC-BUD-05, UC-BUD-16, UC-BUD-103 | наскрізна |
| CMP-56 | ConnectionCard — Картка підключення | MVP | UC-DAT-21, UC-FIN-14, UC-FIN-15, UC-FIN-16, UC-FIN-17, UC-FIN-18, UC-FIN-19, UC-FIN-20, UC-FIN-21, UC-FIN-22 … усього 17 | наскрізна |
| CMP-57 | PlanCard — Картка плану | MVP | UC-ACC-42, UC-ACC-57, UC-ADM-17, UC-ADM-28, UC-BUD-21, UC-BUD-49, UC-BUD-74, UC-BUD-91, UC-BUD-111, UC-DAT-09 … усього 27 | наскрізна |
| CMP-58 | ViewSwitch — Перемикач вигляду | MVP | UC-AST-47, UC-BUD-42, UC-BUD-43, UC-BUD-71, UC-DAT-01, UC-IMP-10, UC-IMP-25, UC-WGT-10, UC-WGT-15, UC-WGT-16 … усього 16 | наскрізна |
| CMP-59 | IconButton — Кнопка-іконка | MVP | UC-ACC-09, UC-BUD-101, UC-UX-36 | наскрізна |
| CMP-60 | Toolbar — Панель інструментів списку | MVP | UC-ACC-59, UC-ACC-60, UC-ACC-63, UC-ADV-09, UC-ADV-16, UC-AST-21, UC-AST-26, UC-AST-31, UC-AST-41, UC-BUD-70 … усього 19 | наскрізна |
| CMP-61 | Menu — Меню і спливна панель | MVP | UC-ACC-40, UC-ADM-18, UC-ADM-19, UC-ADV-01, UC-ADV-05, UC-AI-01, UC-AI-02, UC-AST-12, UC-AST-13, UC-AST-45 … усього 41 | наскрізна |
| CMP-62 | SortMenu — Меню сортування | MVP | UC-ACC-59, UC-BUD-31, UC-BUD-77, UC-BUD-84, UC-DAT-01, UC-DAT-02, UC-DAT-03, UC-DAT-04, UC-FIN-08, UC-FIN-30 … усього 12 | наскрізна |
| CMP-63 | ColumnPicker — Вибір колонок | MVP | UC-ADM-05, UC-AI-05, UC-AST-01, UC-AST-10, UC-AST-27, UC-BUD-58, UC-BUD-77, UC-BUD-89, UC-BUD-109, UC-DAT-01 … усього 43 | наскрізна |
| CMP-64 | Chip — Чип | MVP | UC-ADV-08, UC-AST-30, UC-AST-31, UC-BUD-01, UC-BUD-65, UC-BUD-70, UC-BUD-71, UC-BUD-73, UC-BUD-79, UC-BUD-81 … усього 25 | наскрізна |
| CMP-65 | PillTabs — Вкладки-пігулки | MVP | UC-UX-04 | наскрізна |
| CMP-66 | GroupHeader — Заголовок групи активів | MVP | UC-ACC-61, UC-ADV-16, UC-FIN-06, UC-FIN-81, UC-NOT-02, UC-RPT-09 | наскрізна |
| CMP-67 | FolderCard — Картка папки | MVP | UC-ACC-61, UC-ADV-16, UC-AST-29, UC-AST-30, UC-RPT-09, UC-VAL-36 | наскрізна |
| CMP-68 | MiniMap — Міні-мапа | MVP | UC-AST-07, UC-AST-27, UC-VAL-37 | наскрізна |
| CMP-69 | AppNavigation — Навігація застосунку | MVP | UC-UX-43 | наскрізна |
| CMP-70 | KpiTile — Плитка показника | MVP | UC-AST-42, UC-BUD-106, UC-DAT-15, UC-FIN-14, UC-WGT-01, UC-WGT-02, UC-WGT-12, UC-WGT-13, UC-WGT-21, UC-WGT-22 | наскрізна |
| CMP-71 | BrandMark — Знак і назва продукту | MVP | UC-ADV-27, UC-ADV-28, UC-BUD-75, UC-BUD-76, UC-BUD-77, UC-BUD-84, UC-FIN-22, UC-FIN-27, UC-FIN-34, UC-FIN-81 … усього 11 | наскрізна |
| CMP-72 | PeriodPicker — Вибір періоду аналітичної таблиці | MVP | UC-BUD-115 | наскрізна |

## CHT (4)

| ID | Назва | Реліз | Сценарії | Тип |
| --- | --- | --- | --- | --- |
| CHT-00 | Принципи модуля «Графіки» | MVP | UC-ACC-32, UC-ACC-59, UC-ADM-31, UC-AI-02, UC-AI-09, UC-AI-14, UC-AST-07, UC-AST-32, UC-AST-33, UC-AST-36 … усього 57 | наскрізна |
| CHT-01 | Часовий ряд з кількома серіями | MVP | UC-ACC-02, UC-ACC-03, UC-ACC-17, UC-ACC-32, UC-ACC-33, UC-ACC-34, UC-ACC-59, UC-ADM-15, UC-ADV-19, UC-AI-09 … усього 133 | наскрізна |
| CHT-02 | Витрати проти бюджету | MVP | UC-BUD-09, UC-BUD-14, UC-BUD-16, UC-BUD-19, UC-BUD-89, UC-BUD-96, UC-BUD-99, UC-FCS-01, UC-FCS-04, UC-FCS-05 … усього 15 | наскрізна |
| CHT-03 | Склад цілого | MVP | UC-ACC-32, UC-ACC-33, UC-ACC-34, UC-AST-38, UC-FIN-67, UC-FIN-70, UC-FIN-71, UC-INS-09, UC-INV-06, UC-INV-08 … усього 25 | наскрізна |

## DS (23)

| ID | Назва | Реліз | Сценарії | Тип |
| --- | --- | --- | --- | --- |
| DS-01 | Принципи UX | MVP | UC-BUD-56, UC-BUD-77, UC-BUD-79, UC-BUD-80, UC-BUD-82, UC-FIN-02, UC-FIN-03, UC-FIN-04, UC-FIN-05, UC-FIN-06 … усього 19 | наскрізна |
| DS-02 | Бренд: назва, слоган, знак і логотип | MVP | UC-ADV-27, UC-ADV-28, UC-AST-04, UC-AST-42, UC-AST-45, UC-AST-46, UC-BUD-75, UC-BUD-76, UC-BUD-77, UC-BUD-84 … усього 16 | наскрізна |
| DS-03 | Тон голосу і правила мікротексту | MVP | UC-ACC-06, UC-AI-03, UC-AST-15, UC-BUD-08, UC-BUD-100, UC-FCS-05, UC-LEG-02, UC-LEG-07, UC-PLN-12, UC-SUB-15 … усього 13 | наскрізна |
| DS-04 | Формати сум, чисел, відсотків, дат і часу | MVP | UC-ACC-57, UC-ACC-59, UC-ADV-07, UC-AI-14, UC-AST-01, UC-AST-02, UC-AST-03, UC-AST-04, UC-AST-05, UC-AST-07 … усього 147 | наскрізна |
| DS-05 | Довгі тексти і великі числа | MVP | UC-IMP-02, UC-L10N-07, UC-PLT-05, UC-UX-18, UC-UX-20, UC-VLT-49, UC-WGT-01, UC-WGT-13, UC-WGT-15, UC-WGT-23 | наскрізна |
| DS-06 | Колірні токени і ролі кольорів | MVP | UC-ADV-27, UC-ADV-28, UC-AST-07, UC-BUD-05, UC-BUD-106, UC-FCS-05, UC-FCS-06, UC-FIN-22, UC-FIN-73, UC-FIN-81 … усього 19 | наскрізна |
| DS-07 | Семантичні кольори статусів і палітра графіків | MVP | UC-ACC-23, UC-ACC-35, UC-ACC-36, UC-ACC-49, UC-ACC-50, UC-ACC-51, UC-ACC-57, UC-ACC-63, UC-ACC-67, UC-ACC-68 … усього 146 | наскрізна |
| DS-08 | Типографіка | MVP | UC-ACC-23, UC-ACC-65, UC-BUD-43, UC-BUD-58, UC-BUD-72, UC-BUD-76, UC-BUD-77, UC-BUD-78, UC-BUD-109, UC-DAT-01 … усього 54 | наскрізна |
| DS-09 | Відступи, радіуси, тіні, рівні і шари | MVP | UC-BUD-43, UC-IMP-04, UC-IMP-05, UC-L10N-03, UC-SUB-02, UC-WGT-10 | наскрізна |
| DS-10 | Точки переходу і адаптивна поведінка | MVP | UC-ACC-12, UC-ACC-19, UC-ACC-26, UC-ACC-27, UC-ADV-01, UC-AST-06, UC-AST-42, UC-AST-45, UC-BUD-18, UC-BUD-54 … усього 41 | наскрізна |
| DS-11 | Теми: світла, темна, як у системі | MVP | UC-BUD-106, UC-FCS-06, UC-IMP-10, UC-IMP-25, UC-L10N-05, UC-SUP-02, UC-SUP-03, UC-UX-24, UC-UX-43, UC-VAL-37 | наскрізна |
| DS-12 | Іконки і зображення | MVP | UC-ACC-09, UC-AI-13, UC-AST-03, UC-AST-44, UC-AST-45, UC-AST-46, UC-AST-47, UC-AST-49, UC-BUD-01, UC-BUD-05 … усього 71 | наскрізна |
| DS-13 | Рух і зменшений рух | MVP | UC-FCS-06, UC-WGT-11, UC-WGT-12 | наскрізна |
| DS-14 | Стани взаємодії, фокус і зони дотику | MVP | UC-ACC-09, UC-ACC-34, UC-AST-04, UC-BUD-31, UC-BUD-32, UC-BUD-57, UC-BUD-78, UC-BUD-100, UC-DAT-05, UC-DAT-06 … усього 37 | наскрізна |
| DS-15 | Візуалізація даних: вибір графіка | MVP | UC-ACC-32, UC-ACC-59, UC-ADM-31, UC-AI-02, UC-AI-09, UC-AI-14, UC-AST-07, UC-AST-32, UC-AST-33, UC-AST-36 … усього 57 | наскрізна |
| DS-16 | Візуалізація даних: осі, підписи, легенди, підказки і скорочення | MVP | UC-ACC-32, UC-ACC-59, UC-ADM-31, UC-AI-02, UC-AI-09, UC-AI-14, UC-AST-07, UC-AST-32, UC-AST-33, UC-AST-36 … усього 59 | наскрізна |
| DS-17 | Візуалізація даних: джерело оцінки, прогноз, застарілість і чужа частка | MVP | UC-ADM-01, UC-ADM-02, UC-AST-01, UC-AST-07, UC-AST-32, UC-AST-42, UC-BUD-14, UC-BUD-19, UC-BUD-23, UC-BUD-26 … усього 65 | наскрізна |
| DS-18 | Режим «Приховати суми» в дизайн-системі | MVP | UC-AI-11, UC-AST-07, UC-AST-35, UC-AST-39, UC-AST-43, UC-BUD-08, UC-BUD-14, UC-BUD-15, UC-BUD-18, UC-BUD-23 … усього 57 | наскрізна |
| DS-19 | Доступність графіків і візуалізацій | MVP | UC-ACC-32, UC-ACC-59, UC-ADM-31, UC-AI-02, UC-AI-09, UC-AI-14, UC-AST-07, UC-AST-32, UC-AST-33, UC-AST-36 … усього 57 | наскрізна |
| DS-20 | Стиль мапи: підкладка в обох темах | MVP | UC-ACC-60, UC-AST-07, UC-AST-25, UC-AST-27, UC-AST-45, UC-FIN-97, UC-UX-08, UC-UX-33, UC-VAL-19, UC-VAL-25 … усього 16 | наскрізна |
| DS-21 | Мапа: маркери, кластери, приблизні зони і керування | MVP | UC-ACC-60, UC-AST-04, UC-AST-07, UC-AST-25, UC-AST-27, UC-AST-45, UC-BUD-16, UC-FCS-05, UC-FCS-06, UC-FIN-97 … усього 30 | наскрізна |
| DS-22 | Сторінка-зразок дизайн-системи і перевірка відповідності | MVP | — (службова сторінка-зразок для перевірки дизайн-системи командою) | технічна, без сценарію |
| DS-23 | Словник статусів «Планування» | MVP | UC-BUD-116, UC-BUD-117 | наскрізна |

## NFR (19)

| ID | Назва | Реліз | Сценарії | Тип |
| --- | --- | --- | --- | --- |
| NFR-01 | Безпека | MVP | UC-ACC-01, UC-ACC-02, UC-ACC-05, UC-ACC-06, UC-ACC-07, UC-ACC-08, UC-ACC-09, UC-ACC-10, UC-ACC-15, UC-ACC-16 … усього 162 | наскрізна |
| NFR-02 | Відповідність вимогам | MVP | UC-ACC-01, UC-ACC-05, UC-ACC-06, UC-ACC-10, UC-ACC-39, UC-ADM-20, UC-ADM-31, UC-ADM-32, UC-ADV-16, UC-ADV-26 … усього 54 | наскрізна |
| NFR-03 | Доступність сервісу і відновлення | MVP | UC-BUD-57, UC-BUD-69, UC-DAT-10, UC-DAT-24, UC-FIN-17, UC-IMP-17, UC-IMP-30, UC-RPT-18, UC-SUB-22, UC-UX-32 … усього 20 | наскрізна |
| NFR-04 | Продуктивність | MVP | UC-ACC-11, UC-ACC-22, UC-ADV-04, UC-ADV-06, UC-ADV-08, UC-ADV-15, UC-ADV-17, UC-AST-02, UC-IMP-01, UC-IMP-23 … усього 15 | наскрізна |
| NFR-05 | Архітектура | MVP | — (архітектура API, журналу й адаптерів провайдерів — внутрішня властивість системи) | технічна, без сценарію |
| NFR-06 | Цілісність даних | MVP | UC-ACC-12, UC-ACC-35, UC-ADM-08, UC-ADM-26, UC-ADV-21, UC-AI-15, UC-AST-13, UC-AST-16, UC-AST-17, UC-AST-25 … усього 71 | наскрізна |
| NFR-07 | Платформи | MVP | UC-ACC-10, UC-ACC-11, UC-ACC-22, UC-ACC-23, UC-ACC-26, UC-ACC-28, UC-ACC-63, UC-ADM-28, UC-AST-10, UC-AST-45 … усього 75 | наскрізна |
| NFR-08 | Доступність інтерфейсу | MVP | UC-ACC-09, UC-ACC-34, UC-AST-04, UC-BUD-31, UC-BUD-32, UC-BUD-57, UC-BUD-78, UC-FCS-05, UC-FCS-06, UC-FCS-07 … усього 24 | наскрізна |
| NFR-09 | Локалізація | MVP | UC-ACC-01, UC-ACC-02, UC-ACC-28, UC-ACC-31, UC-ACC-37, UC-ADM-01, UC-ADM-18, UC-ADM-28, UC-AI-02, UC-AST-04 … усього 50 | наскрізна |
| NFR-10 | Спостережуваність | MVP | — (моніторинг і сповіщення для команди експлуатації) | технічна, без сценарію |
| NFR-11 | Поставка | MVP | — (процес поставки: середовища, перевірки, випуск) | технічна, без сценарію |
| NFR-12 | Зберігання даних | MVP | UC-ACC-21, UC-ACC-38, UC-ACC-39, UC-ACC-45, UC-AI-19, UC-AST-16, UC-AST-37, UC-AST-41, UC-DAT-11, UC-DAT-13 … усього 23 | наскрізна |
| NFR-13 | Стек мобільного застосунку | v1-mobile | — (вибір технологічного стеку мобільного застосунку) | технічна, без сценарію |
| NFR-14 | Захисні HTTP-заголовки, політика вмісту і обмеження частоти запитів | MVP | UC-ACC-01, UC-ACC-06, UC-ACC-15, UC-ACC-18, UC-ACC-35, UC-INT-05, UC-INT-06 | наскрізна |
| NFR-15 | Обов'язкові засоби захисту від загроз | MVP | UC-ACC-01, UC-ACC-06, UC-ACC-25, UC-ACC-66, UC-AST-47, UC-BUD-70, UC-DAT-14, UC-DOC-01, UC-DOC-17, UC-FIN-56 … усього 14 | наскрізна |
| NFR-16 | Резервне копіювання і процедура відновлення | MVP | — (процедура резервного копіювання для команди експлуатації) | технічна, без сценарію |
| NFR-17 | Резидентність даних і обробники | MVP | UC-ACC-02, UC-ACC-41, UC-ADM-27, UC-IMP-05 | наскрізна |
| NFR-18 | Критерії готовності до запуску і релізні гейти | MVP | — (релізні гейти — критерії для рішення про запуск) | технічна, без сценарію |
| NFR-19 | Критерії готовності вимоги (Definition of Done) | MVP | — (Definition of Done для команди, не поведінка продукту) | технічна, без сценарію |

## ARC (11)

| ID | Назва | Реліз | Сценарії | Тип |
| --- | --- | --- | --- | --- |
| ARC-01 | Модульний моноліт із жорсткими межами | MVP | — (архітектурне рішення бекенду, користувач його не бачить) | технічна, без сценарію |
| ARC-02 | Процеси застосунку | MVP | — (архітектурне рішення бекенду, користувач його не бачить) | технічна, без сценарію |
| ARC-03 | Дані та ізоляція просторів | MVP | — (архітектурне рішення бекенду, користувач його не бачить) | технічна, без сценарію |
| ARC-04 | Фонові задачі та події | MVP | — (архітектурне рішення бекенду, користувач його не бачить) | технічна, без сценарію |
| ARC-05 | Зовнішні провайдери через адаптери | MVP | — (архітектурне рішення бекенду, користувач його не бачить) | технічна, без сценарію |
| ARC-06 | Ключі, секрети, файли | MVP | — (архітектурне рішення бекенду, користувач його не бачить) | технічна, без сценарію |
| ARC-07 | API і клієнти | MVP | — (архітектурне рішення бекенду, користувач його не бачить) | технічна, без сценарію |
| ARC-08 | Переносимість між профілями розгортання | MVP | — (архітектурне рішення бекенду, користувач його не бачить) | технічна, без сценарію |
| ARC-09 | Спостережуваність | MVP | — (архітектурне рішення бекенду, користувач його не бачить) | технічна, без сценарію |
| ARC-10 | Масштаб і продуктивність | MVP | — (архітектурне рішення бекенду, користувач його не бачить) | технічна, без сценарію |
| ARC-11 | Бухгалтерський журнал (модуль ledger) | MVP | — (архітектурне рішення бекенду, користувач його не бачить) | технічна, без сценарію |

## CICD (12)

| ID | Назва | Реліз | Сценарії | Тип |
| --- | --- | --- | --- | --- |
| CICD-01 | Гілки, PR і захист основної гілки | MVP | — (процес розробки й поставки, не користувацька дія) | технічна, без сценарію |
| CICD-02 | Обов'язкові перевірки PR | MVP | — (процес розробки й поставки, не користувацька дія) | технічна, без сценарію |
| CICD-03 | Збірка і ланцюг постачання | MVP | — (процес розробки й поставки, не користувацька дія) | технічна, без сценарію |
| CICD-04 | Середовища | MVP | — (процес розробки й поставки, не користувацька дія) | технічна, без сценарію |
| CICD-05 | Розгортання в production і відкат | MVP | — (процес розробки й поставки, не користувацька дія) | технічна, без сценарію |
| CICD-06 | Прапорці функцій і поступовий випуск | MVP | — (процес розробки й поставки, не користувацька дія) | технічна, без сценарію |
| CICD-07 | Інфраструктура як код і резервні копії | MVP | — (процес розробки й поставки, не користувацька дія) | технічна, без сценарію |
| CICD-08 | Доступ AI-агентів до середовищ | MVP | — (процес розробки й поставки, не користувацька дія) | технічна, без сценарію |
| CICD-09 | Інциденти | MVP | — (процес розробки й поставки, не користувацька дія) | технічна, без сценарію |
| CICD-10 | Мобільні застосунки | v1-mobile | — (процес розробки й поставки, не користувацька дія) | технічна, без сценарію |
| CICD-11 | Метрики поставки | MVP | — (процес розробки й поставки, не користувацька дія) | технічна, без сценарію |
| CICD-12 | Зберігання секретів і доступів | MVP | — (процес розробки й поставки, не користувацька дія) | технічна, без сценарію |
