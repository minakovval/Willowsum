# ARC-05@PoC · Зовнішні провайдери через адаптери

**Реліз:** PoC · **Пріоритет:** M

**Зв'язки**
- Розширює: —
- Залежить від: —
- Дизайн: —
- Спільні правила: П-9, П-22, П-23, П-24
- Сценарії: —
- Модуль: —
- Перевіряється: apps/api/src/platform/adapters/provider-client.test.ts, apps/api/src/platform/adapters/last-known.test.ts, apps/api/src/platform/adapters/outgoing.test.ts, apps/api/src/platform/adapters/http.test.ts, apps/api/src/platform/adapters/reference/exchange-rates/exchange-rates.test.ts, apps/api/src/platform/config/config.test.ts, apps/api/scripts/lib/provider-sdks.test.ts, apps/api/test/no-network.test.ts, apps/api/test/no-network-loaded.test.ts, apps/api/test/no-network-security.test.ts, apps/api/src/platform/adapters/security-arc05.test.ts, apps/api/scripts/lib/provider-sdks-security.test.ts

1. Кожен зовнішній сервіс (курси валют, ціни, банки, мапи, пошта, платежі, CAPTCHA, OCR, антивірус, сховище файлів, KMS, AI) викликається лише через внутрішній інтерфейс. Назви провайдерів та їхні SDK не з'являються поза адаптером.
2. Кожен інтерфейс має щонайменше дві реалізації: робочу і тестову (синтетичну або пісочницю). Локальна розробка і CI працюють без доступу до зовнішніх сервісів.
3. Кожен виклик має тайм-аут (за замовчуванням 10 с), повтори для ідемпотентних операцій і захист від каскадних збоїв: після 5 помилок поспіль виклики призупиняються на 60 с.
4. Збій провайдера не блокує перегляд даних: показується останнє відоме значення з датою.
5. Провайдеру передається мінімум даних, потрібний для операції; перелік полів зафіксований в адаптері і перевіряється тестом.

| Критерій | Поріг | Перевірка |
| --- | --- | --- |
| Імпорт SDK провайдера поза адаптером | 0 | Аналізатор залежностей у CI |
| Тести, що потребують інтернету в CI | 0 | CI без вихідного доступу до провайдерів |
| Заміна провайдера | Лише новий адаптер і конфігурація | Рев'ю PR |
