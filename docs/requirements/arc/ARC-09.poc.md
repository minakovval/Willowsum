# ARC-09@PoC · Спостережуваність
> Згенеровано з [ARC-09.md](ARC-09.md) командою `node tools/req-check/index.mjs --views`. Не редагувати: змінюйте джерело.

**Реліз:** PoC · **Пріоритет:** M

**Зв'язки**
- Розширює: —
- Залежить від: —
- Дизайн: —
- Спільні правила: П-8, П-24
- Сценарії: —
- Модуль: —
- Перевіряється: apps/api/src/platform/telemetry/telemetry.test.ts, apps/api/src/platform/telemetry/server-logs.test.ts, apps/api/src/platform/telemetry/otlp.test.ts, apps/api/src/platform/telemetry/redaction.test.ts, apps/api/src/platform/telemetry/jobs.test.ts, apps/api/src/platform/config/config.test.ts, apps/api/test/telemetry-http.test.ts, apps/api/test/telemetry-db.it.test.ts, apps/api/src/platform/adapters/telemetry-arc09.test.ts, apps/api/test/observability-catalogue.test.ts, packages/api-contract/src/index.test.ts, tools/observability/test/observability.test.mjs, apps/api/src/platform/telemetry/redaction-sec85.test.ts, apps/api/src/platform/telemetry/exporters-sec85.test.ts, apps/api/src/platform/config/config-sec85.test.ts, apps/api/test/telemetry-http-sec85.test.ts, apps/api/test/telemetry-http-r2.test.ts, apps/api/test/process.it.test.ts, apps/api/test/telemetry-flags-r3.test.ts, apps/api/src/platform/telemetry/redaction-sec85r2.test.ts, apps/api/test/telemetry-http-sec85r2.test.ts

1. Логи, метрики і траси збираються через OpenTelemetry. У цьому релізі телеметрія не надсилається в жоден зовнішній сервіс: кожен запис логу після фільтра з п. 2 пишеться одним структурованим рядком JSON у журнал сервера (час, рівень, назва події, ідентифікатор траси, технічні атрибути); траси й метрики не зберігаються. Увімкнення експорту в сервіс із даними в ЄС — лише зміна конфігурації експортера, без змін коду.
2. У логах, трасах і звітах про помилки немає персональних і фінансових даних: фільтр на рівні експортера маскує email, суми, IBAN, токени та тіла запитів. Той самий фільтр діє для логів на сервері.
3. Кожен запит має ідентифікатор траси, який передається у фонові задачі та показується користувачу як код помилки.
4. Цілі рівня сервісу (SLO) і правила алертів описані в коді, але в цьому релізі не завантажуються в жоден сервіс: алертів, дашбордів і чергового немає.
5. Зовнішньої перевірки доступності («живий») у цьому релізі немає: про збій власник продукту дізнається, відкривши застосунок.
6. Сканування логів на персональні дані: щотижнева запланована задача на сервері перевіряє рядки JSON журналу сервера тими самими детекторами, що й фільтр експортера (email, IBAN, номери карток, суми, токени, координати, параметри URL); знахідка — лист власнику продукту, який надсилає сам застосунок через свій адаптер пошти, з назвою поля і детектора, але ніколи зі значенням. Задача будується разом із розгортанням production.

| Критерій | Поріг | Перевірка |
| --- | --- | --- |
| Персональні дані в телеметрії і логах сервера | 0 | Тест фільтра + щотижневе автоматичне сканування рядків журналу сервера тими самими детекторами; знахідка — лист власнику від застосунку з назвою поля і детектора, без значення |
