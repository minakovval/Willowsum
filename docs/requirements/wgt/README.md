# WGT — module requirements

Scope: Home widgets: widget framework and shared contract (sizes, heights, header, states), widget registry, Home edit mode, one thin file per widget. Source: product owner decisions of 2026-11-02 (design review of the Home screen and the approved canvas catalogue).

## Text from the specification tab (outside individual requirements)

<!-- spec-text:begin -->
## Віджети Головної

Модуль «Віджети Головної» описує каркас віджетів (шкала ширин XS 3, S 4, M 6, L 8, XL 12 колонок і шкала висот 132, 376, 776 і 48 px; висота не залежить від даних; спільний заголовок; стани), реєстр віджетів, режим редагування Головної з 13 правилами власника і по одному короткому файлу на кожен віджет реєстру. Віджет визначає, що і де показати; як рахувати — модуль-джерело даних; як малювати графік — модуль «Графіки» (CHT). Усі вимоги модуля входять у реліз MVP; стан «Вимкнено планом» діє з v1, бо в MVP ліміти планів не застосовуються.

Вимоги модуля: WGT-00, WGT-01, WGT-02, WGT-10…WGT-31.

<!-- spec-text:end -->

## Traceability: widget → data source and components

Requirement files stay self-contained and name other modules by name; this table gives the IDs.

| Widget | Data source (requirement IDs) | Chart or UI component |
| --- | --- | --- |
| WGT-00 framework | UX-03, GRID-00, GRID-01, DS-10, SUB-07 | CMP-54, CMP-22, CMP-23, CMP-24 |
| WGT-01 registry | UX-03, UX-08 | — |
| WGT-02 edit mode | UX-03, UX-08, FLW-14 | CMP-21, CMP-54, CMP-61 |
| WGT-10 Плитка «Net worth» | VAL-09, VAL-08 | CMP-70 |
| WGT-11 Плитка «Доходи» | BUD-08 | CMP-70 |
| WGT-12 Плитка «Витрати» | BUD-08 | CMP-70 |
| WGT-13 Плитка «Норма заощаджень» | BUD-08 | CMP-70 |
| WGT-14 «Можна витратити» (S) | BUD-03, FCS-01, FCS-02, FCS-03 | CHT-02 |
| WGT-15 «Цілі» | BUD-05 | CMP-09 |
| WGT-16 «Рахунки» | FIN-01, FIN-12 | CMP-27 |
| WGT-17 «Розподіл активів» | VAL-09 | CHT-03 (CMP-52, CMP-48, CMP-45) |
| WGT-18 «Транзакції» (S) | FIN-03 | CMP-28 |
| WGT-19 «Тип активу» | AST-14a | CMP-41 |
| WGT-20 «До розбору» | BUD-12 | CMP-28 |
| WGT-21 «Регулярні платежі» | BUD-07 | CMP-27 |
| WGT-22 «Кредитний ліміт» | FIN-01 (credit card), FIN-14 (v1 details) | CMP-49 |
| WGT-23 «Галерея активів» | AST-01, AST-16 | CMP-39, CMP-36 |
| WGT-24 «Бюджет за категоріями» | BUD-02 | CMP-55 |
| WGT-25 «Інвестиції» | FIN-05 | CHT-01, CMP-46 |
| WGT-26 «Підсумок тижня» | BUD-10 | CMP-47 |
| WGT-27 «Net worth» (L, tall) | VAL-09, VAL-08 | CHT-01 |
| WGT-28 «Мапа активів» | VAL-11 | CMP-38, CMP-35 |
| WGT-29 «Можна витратити» (L, «Тільки бюджет») | BUD-03, FCS-01…03, UX-08 | CHT-02 |
| WGT-30 «Потребує уваги» | VAL-09 (action list) | — |
| WGT-31 Таблиця «Транзакції» (XL) | FIN-03 | CMP-26 |

Rules moved here from other files: UX-03 FR 3–7, 12, 15–19 and criteria 8, 14–17, 19–26 (edit mode, sizes, widget header, attention strip, allocation widget); CMP-54 states, content and edit-mode sections and criteria 1, 3–5, 8, 9. UX-03 and CMP-54 keep short references by module name.

## Requirements

| ID | Title | Release | Priority |
| --- | --- | --- | --- |
| [WGT-00](WGT-00.md) | Каркас віджетів і спільний контракт | MVP | M |
| [WGT-01](WGT-01.md) | Реєстр віджетів | MVP | M |
| [WGT-02](WGT-02.md) | Режим редагування Головної | MVP | S |
| [WGT-10](WGT-10.md) | Плитка «Net worth» | MVP | M |
| [WGT-11](WGT-11.md) | Плитка «Доходи» | MVP | S |
| [WGT-12](WGT-12.md) | Плитка «Витрати» | MVP | S |
| [WGT-13](WGT-13.md) | Плитка «Норма заощаджень» | MVP | S |
| [WGT-14](WGT-14.md) | Віджет «Можна витратити» | MVP | M |
| [WGT-15](WGT-15.md) | Віджет «Цілі» | MVP | M |
| [WGT-16](WGT-16.md) | Віджет «Рахунки» | MVP | M |
| [WGT-17](WGT-17.md) | Віджет «Розподіл активів» | MVP | M |
| [WGT-18](WGT-18.md) | Віджет «Транзакції» | MVP | M |
| [WGT-19](WGT-19.md) | Віджет «Тип активу» | MVP | M |
| [WGT-20](WGT-20.md) | Віджет «До розбору» | MVP | M |
| [WGT-21](WGT-21.md) | Віджет «Регулярні платежі» | MVP | S |
| [WGT-22](WGT-22.md) | Віджет «Кредитний ліміт» | MVP | S |
| [WGT-23](WGT-23.md) | Віджет «Галерея активів» | MVP | M |
| [WGT-24](WGT-24.md) | Віджет «Бюджет за категоріями» | MVP | M |
| [WGT-25](WGT-25.md) | Віджет «Інвестиції» | MVP | M |
| [WGT-26](WGT-26.md) | Віджет «Підсумок тижня» | MVP | S |
| [WGT-27](WGT-27.md) | Віджет «Net worth» | MVP | M |
| [WGT-28](WGT-28.md) | Віджет «Мапа активів» | MVP | S |
| [WGT-29](WGT-29.md) | Віджет «Можна витратити» в режимі «Тільки бюджет» | MVP | M |
| [WGT-30](WGT-30.md) | Смуга «Потребує уваги» | MVP | M |
| [WGT-31](WGT-31.md) | Таблиця «Транзакції» | MVP | S |
