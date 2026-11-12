# ARC-09@MVP · Спостережуваність
> Згенеровано з [ARC-09.md](ARC-09.md) командою `node tools/req-check/index.mjs --views`. Не редагувати: змінюйте джерело.

**Реліз:** MVP · **Пріоритет:** M

**Зв'язки**
- Розширює: ARC-09@PoC
- Залежить від: —
- Дизайн: —
- Спільні правила: П-8, П-24
- Сценарії: —
- Модуль: —
- Перевіряється: apps/api/src/platform/telemetry/telemetry.test.ts, apps/api/src/platform/telemetry/otlp.test.ts, apps/api/src/platform/telemetry/redaction.test.ts, apps/api/src/platform/telemetry/jobs.test.ts, apps/api/src/platform/config/config.test.ts, apps/api/test/telemetry-http.test.ts, apps/api/test/telemetry-db.it.test.ts, apps/api/src/platform/adapters/telemetry-arc09.test.ts, apps/api/test/observability-catalogue.test.ts, packages/api-contract/src/index.test.ts, tools/observability/test/observability.test.mjs, apps/api/src/platform/telemetry/redaction-sec85.test.ts, apps/api/src/platform/telemetry/exporters-sec85.test.ts, apps/api/src/platform/config/config-sec85.test.ts, apps/api/test/telemetry-http-sec85.test.ts, apps/api/test/telemetry-http-r2.test.ts, apps/api/test/process.it.test.ts, apps/api/test/telemetry-flags-r3.test.ts, apps/api/src/platform/telemetry/redaction-sec85r2.test.ts, apps/api/test/telemetry-http-sec85r2.test.ts

1. Логи, метрики і траси збираються через OpenTelemetry і надсилаються в сервіс із даними в ЄС. Заміна сервісу — лише зміна конфігурації експортера.
2. У логах, трасах і звітах про помилки немає персональних і фінансових даних: фільтр на рівні експортера маскує email, суми, IBAN, токени та тіла запитів.
3. Кожен запит має ідентифікатор траси, який передається у фонові задачі та показується користувачу як код помилки.
4. Ключові SLO: доступність API 99,9 % на місяць; читання p95 ≤ 300 мс, запис p95 ≤ 500 мс; частка 5xx ≤ 1 %. Порушення бюджету помилок генерує алерт.
5. Зовнішній монітор перевіряє доступність вебу, API і адмін-панелі щохвилини з двох точок у ЄС.

| Критерій | Поріг | Перевірка |
| --- | --- | --- |
| Персональні дані в телеметрії | 0 | Тест фільтра + щотижневе автоматичне сканування вибірки логів |
| Час від збою до алерту | ≤ 5 хв | Щоквартальна перевірка алертів |
