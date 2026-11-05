# INV — module requirements

Scope: Investment instruments, prices and FX service, cost basis. Source: tab 3 of the Willowsum product specification.

## Module intro (from the specification tab)

Модуль «Фінанси, інвестиції та інтеграції» охоплює грошові рахунки й транзакції, внутрішній журнал подвійного запису, інвестиційні портфелі та інструменти, криптоактиви, приватні інвестиції, пенсійні накопичення, кредитні картки, підключення банків і інших провайдерів даних та єдиний стандарт інтеграцій. Усі суми в прикладах наведено в EUR або UAH.

Shared text of this tab (title, intro, common sections) is kept in [../fin/README.md](../fin/README.md).

## Requirements

| ID | Title | Release | Priority |
| --- | --- | --- | --- |
| [INV-01](INV-01.md) | Реєстр інструментів і події брокерів | v1 | S |
| [INV-02](INV-02.md) | Сервіс цін і курсів із безкоштовних джерел | MVP (курси ECB і НБУ і щоденні ціни закриття з одного фіду раз на добу, перевірка ліцензій джерел); v1 | S |
| [INV-03](INV-03.md) | Собівартість і реалізований результат (інформаційно) | v1 | S |
