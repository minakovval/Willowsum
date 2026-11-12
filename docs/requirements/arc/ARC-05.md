# ARC-05 · Зовнішні провайдери через адаптери

**Реліз:** PoC · **Пріоритет:** M

**Зв'язки**
- Зрізи: ARC-05@PoC
- Модуль: —

**Релізні зрізи.** Кожен зріз повний для свого релізу: функціональні вимоги, правила, права, стани і критерії приймання, що діють у ньому, без посилань на інші зрізи. Зріз діє до релізу наступного зрізу.

| Реліз | Зріз | Що змінюється порівняно з попереднім зрізом |
| --- | --- | --- |
| PoC | [ARC-05.poc.md](ARC-05.poc.md) | Кожен провайдер через внутрішній інтерфейс, робоча і тестова реалізації, тайм-аути й захист від каскадних збоїв, останнє відоме значення, мінімум даних |

## Джерело зрізів

**Реліз:** PoC · **Пріоритет:** M

**Зв'язки**
- Розширює: —
- Залежить від: —
- Дизайн: —
- Спільні правила: П-9, П-22, П-23, П-24
- Сценарії: —
- Модуль: —
- Перевіряється: apps/api/src/platform/adapters/provider-client.test.ts, apps/api/src/platform/adapters/last-known.test.ts, apps/api/src/platform/adapters/outgoing.test.ts, apps/api/src/platform/adapters/http.test.ts, apps/api/src/platform/adapters/reference/exchange-rates/exchange-rates.test.ts, apps/api/src/platform/config/config.test.ts, apps/api/scripts/lib/provider-sdks.test.ts, apps/api/test/no-network.test.ts, apps/api/test/no-network-loaded.test.ts, apps/api/test/no-network-security.test.ts, apps/api/src/platform/adapters/security-arc05.test.ts, apps/api/scripts/lib/provider-sdks-security.test.ts, apps/api/scripts/lib/provider-sdks-security-r2.test.ts, apps/api/src/platform/adapters/security-arc05-r2.test.ts, apps/api/test/no-network-security-r2.test.ts, apps/api/test/no-network-security-r3.test.ts

#. [PoC] Кожен зовнішній сервіс (курси валют, ціни, банки, мапи, пошта, платежі, CAPTCHA, OCR, антивірус, сховище файлів, KMS, AI) викликається лише через внутрішній інтерфейс. Назви провайдерів та їхні SDK не з'являються поза адаптером.
#. [PoC] Кожен інтерфейс має щонайменше дві реалізації: робочу і тестову (синтетичну або пісочницю). Локальна розробка і CI працюють без доступу до зовнішніх сервісів.
#. [PoC] Кожен виклик має тайм-аут (за замовчуванням 10 с), повтори для ідемпотентних операцій і захист від каскадних збоїв: після 5 помилок поспіль виклики призупиняються на 60 с.
#. [PoC] Збій провайдера не блокує перегляд даних: показується останнє відоме значення з датою.
#. [PoC] Провайдеру передається мінімум даних, потрібний для операції; перелік полів зафіксований в адаптері і перевіряється тестом.

| Критерій | Поріг | Перевірка |
| --- | --- | --- |
| Імпорт SDK провайдера поза адаптером | 0 | Аналізатор залежностей у CI |
| Тести, що потребують інтернету в CI | 0 | CI без вихідного доступу до провайдерів |
| Заміна провайдера | Лише новий адаптер і конфігурація | Рев'ю PR |
