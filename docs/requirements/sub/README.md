# SUB — module requirements

Scope: Plans, entitlements, subscription lifecycle, billing and payments. Source: tab 1 of the Willowsum product specification.

## Module intro (from the specification tab)

Модуль охоплює обліковий запис користувача (реєстрація, вхід, двофакторна автентифікація, сесії, профіль, валюта звітності, експорт і закриття акаунта), робочий простір родини з ролями, обмеженням доступу і журналом аудиту, а також плани, підписки, оплату й адмін-панель, через яку персонал керує складом планів без релізу.

Shared text of this tab (title, intro, common sections) is kept in [../acc/README.md](../acc/README.md).

## Requirements

| ID | Title | Release | Priority |
| --- | --- | --- | --- |
| [SUB-01](SUB-01.md) | Плани та права плану (entitlements) | MVP; основа в архітектурі й моделі даних — PoC (функції вмикаються лише через механізм прав плану; у PoC усе ввімкнено, тарифів і оплати немає); v1-mobile (події й продукти App Store і Google Play); v1 (застосування лімітів планів); v2 (аварійний доступ до простору в матриці) | M |
| [SUB-02](SUB-02.md) | Життєвий цикл підписки | MVP; v1-mobile (події App Store і Google Play); v1 (об'єкти понад ліміт стають лише для читання після пониження) | M |
| [SUB-03](SUB-03.md) | Самообслуговування підписки | MVP; v1-mobile (керування підпискою, купленою через App Store або Google Play) | M |
| [SUB-04](SUB-04.md) | План радника | v2 | C |
| [SUB-05](SUB-05.md) | Back office | MVP (доступ підтримки до даних простору); v1 (решта back office: пошук користувачів, дії над підпискою, довідники) | S |
| [SUB-06](SUB-06.md) | Промо-механіки | v2 | C |
| [SUB-07](SUB-07.md) | Пропозиція апгрейду в продукті (upsell) | MVP (механізм прав плану без застосування лімітів); v1 (ліміти, попередження і пропозиції апгрейду) | M |
| [SUB-08](SUB-08.md) | Подарунки, спеціальні програми і канали оплати | v2 | C |
