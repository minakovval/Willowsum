# ARC-09 · Спостережуваність

**Реліз:** PoC (структуровані логи на сервері без експорту телеметрії, щотижневе сканування логів на персональні дані; без зовнішньої перевірки доступності, SLO, алертів і чергового); MVP (експорт телеметрії в сервіс із даними в ЄС, SLO і алерти, зовнішній монітор доступності) · **Пріоритет:** M

**Зв'язки**
- Зрізи: ARC-09@PoC, ARC-09@MVP
- Модуль: —

**Релізні зрізи.** Кожен зріз повний для свого релізу: функціональні вимоги, правила, права, стани і критерії приймання, що діють у ньому, без посилань на інші зрізи. Зріз діє до релізу наступного зрізу.

| Реліз | Зріз | Що змінюється порівняно з попереднім зрізом |
| --- | --- | --- |
| PoC | [ARC-09.poc.md](ARC-09.poc.md) | OpenTelemetry без експорту: структуровані логи на сервері, телеметрія без персональних даних, ідентифікатор траси, щотижневе сканування логів на персональні дані з листом власнику від застосунку, без зовнішньої перевірки доступності; SLO і алерти описані в коді, але не діють |
| MVP | [ARC-09.mvp.md](ARC-09.mvp.md) | Експорт телеметрії в сервіс із даними в ЄС, SLO і алерти, зовнішній монітор доступності щохвилини з двох точок у ЄС |

## Джерело зрізів

[лише PoC] **Реліз:** PoC · **Пріоритет:** M
[MVP] **Реліз:** MVP · **Пріоритет:** M

**Зв'язки**
- [лише PoC] Розширює: —
- [MVP] Розширює: ARC-09@PoC
- Залежить від: —
- Дизайн: —
- Спільні правила: П-8, П-24
- Сценарії: —
- Модуль: —
- [лише PoC] Перевіряється: apps/api/src/platform/telemetry/telemetry.test.ts, apps/api/src/platform/telemetry/server-logs.test.ts, apps/api/src/platform/telemetry/otlp.test.ts, apps/api/src/platform/telemetry/redaction.test.ts, apps/api/src/platform/telemetry/jobs.test.ts, apps/api/src/platform/config/config.test.ts, apps/api/test/telemetry-http.test.ts, apps/api/test/telemetry-db.it.test.ts, apps/api/src/platform/adapters/telemetry-arc09.test.ts, apps/api/test/observability-catalogue.test.ts, packages/api-contract/src/index.test.ts, tools/observability/test/observability.test.mjs, apps/api/src/platform/telemetry/redaction-sec85.test.ts, apps/api/src/platform/telemetry/exporters-sec85.test.ts, apps/api/src/platform/config/config-sec85.test.ts, apps/api/test/telemetry-http-sec85.test.ts, apps/api/test/telemetry-http-r2.test.ts, apps/api/test/process.it.test.ts, apps/api/test/telemetry-flags-r3.test.ts, apps/api/src/platform/telemetry/redaction-sec85r2.test.ts, apps/api/test/telemetry-http-sec85r2.test.ts
- [MVP] Перевіряється: apps/api/src/platform/telemetry/telemetry.test.ts, apps/api/src/platform/telemetry/otlp.test.ts, apps/api/src/platform/telemetry/redaction.test.ts, apps/api/src/platform/telemetry/jobs.test.ts, apps/api/src/platform/config/config.test.ts, apps/api/test/telemetry-http.test.ts, apps/api/test/telemetry-db.it.test.ts, apps/api/src/platform/adapters/telemetry-arc09.test.ts, apps/api/test/observability-catalogue.test.ts, packages/api-contract/src/index.test.ts, tools/observability/test/observability.test.mjs, apps/api/src/platform/telemetry/redaction-sec85.test.ts, apps/api/src/platform/telemetry/exporters-sec85.test.ts, apps/api/src/platform/config/config-sec85.test.ts, apps/api/test/telemetry-http-sec85.test.ts, apps/api/test/telemetry-http-r2.test.ts, apps/api/test/process.it.test.ts, apps/api/test/telemetry-flags-r3.test.ts, apps/api/src/platform/telemetry/redaction-sec85r2.test.ts, apps/api/test/telemetry-http-sec85r2.test.ts

#. [лише PoC] Логи, метрики і траси збираються через OpenTelemetry. У цьому релізі телеметрія не надсилається в жоден зовнішній сервіс: кожен запис логу після фільтра з п. 2 пишеться одним структурованим рядком JSON у журнал сервера (час, рівень, назва події, ідентифікатор траси, технічні атрибути); траси й метрики не зберігаються. Увімкнення експорту в сервіс із даними в ЄС — лише зміна конфігурації експортера, без змін коду.
#. [лише PoC] У логах, трасах і звітах про помилки немає персональних і фінансових даних: фільтр на рівні експортера маскує email, суми, IBAN, токени та тіла запитів. Той самий фільтр діє для логів на сервері.
#. [MVP] Логи, метрики і траси збираються через OpenTelemetry і надсилаються в сервіс із даними в ЄС. Заміна сервісу — лише зміна конфігурації експортера.
#. [MVP] У логах, трасах і звітах про помилки немає персональних і фінансових даних: фільтр на рівні експортера маскує email, суми, IBAN, токени та тіла запитів.
#. [PoC] Кожен запит має ідентифікатор траси, який передається у фонові задачі та показується користувачу як код помилки.
#. [лише PoC] Цілі рівня сервісу (SLO) і правила алертів описані в коді, але в цьому релізі не завантажуються в жоден сервіс: алертів, дашбордів і чергового немає.
#. [лише PoC] Зовнішньої перевірки доступності («живий») у цьому релізі немає: про збій власник продукту дізнається, відкривши застосунок.
#. [лише PoC] Сканування логів на персональні дані: щотижнева запланована задача на сервері перевіряє рядки JSON журналу сервера тими самими детекторами, що й фільтр експортера (email, IBAN, номери карток, суми, токени, координати, параметри URL); знахідка — лист власнику продукту, який надсилає сам застосунок через свій адаптер пошти, з назвою поля і детектора, але ніколи зі значенням. Задача будується разом із розгортанням production.
#. [MVP] Ключові SLO: доступність API 99,9 % на місяць; читання p95 ≤ 300 мс, запис p95 ≤ 500 мс; частка 5xx ≤ 1 %. Порушення бюджету помилок генерує алерт.
#. [MVP] Зовнішній монітор перевіряє доступність вебу, API і адмін-панелі щохвилини з двох точок у ЄС.

| Критерій | Поріг | Перевірка |
| --- | --- | --- |
| [лише PoC] Персональні дані в телеметрії і логах сервера | 0 | Тест фільтра + щотижневе автоматичне сканування рядків журналу сервера тими самими детекторами; знахідка — лист власнику від застосунку з назвою поля і детектора, без значення |
| [MVP] Персональні дані в телеметрії | 0 | Тест фільтра + щотижневе автоматичне сканування вибірки логів |
| [MVP] Час від збою до алерту | ≤ 5 хв | Щоквартальна перевірка алертів |
