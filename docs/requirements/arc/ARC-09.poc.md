# ARC-09@PoC · Спостережуваність

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
5. Перевірка «живий»: запланований робочий процес GitHub Actions кожні 5–10 хв звертається до перевірки готовності API production (`/health/ready`); коли перевірка не проходить, він відкриває в репозиторії задачу або оновлює вже відкриту, і GitHub надсилає власнику продукту лист; коли перевірка знову проходить, задача закривається. Перевірка не передає і не отримує персональних даних; окремого сервісу моніторингу чи облікового запису для неї немає.

| Критерій | Поріг | Перевірка |
| --- | --- | --- |
| Персональні дані в телеметрії і логах сервера | 0 | Тест фільтра |
| Перевірка «живий» | Кожні 5–10 хв; недоступність production → відкрита або оновлена задача і лист власнику після першої невдалої перевірки | Пробний запуск на недоступній адресі під час налаштування |
