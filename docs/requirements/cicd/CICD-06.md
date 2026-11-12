# CICD-06 · Прапорці функцій і поступовий випуск

**Реліз:** PoC · **Пріоритет:** M

**Зв'язки**
- Зрізи: CICD-06@PoC
- Модуль: —

**Релізні зрізи.** Кожен зріз повний для свого релізу: функціональні вимоги, правила, права, стани і критерії приймання, що діють у ньому, без посилань на інші зрізи. Зріз діє до релізу наступного зрізу.

| Реліз | Зріз | Що змінюється порівняно з попереднім зрізом |
| --- | --- | --- |
| PoC | [CICD-06.poc.md](CICD-06.poc.md) | Нова функція виходить вимкненою прапорцем, власник і дата перегляду прапорця, аварійний вимикач модуля |

## Джерело зрізів

**Реліз:** PoC · **Пріоритет:** M

**Зв'язки**
- Розширює: —
- Залежить від: —
- Дизайн: —
- Спільні правила: П-14, П-21, ARC-01
- Сценарії: —
- Модуль: —
- Перевіряється: apps/api/src/modules/feature-flags/domain/rollout.test.ts, apps/api/src/modules/feature-flags/domain/review.test.ts, apps/api/src/modules/feature-flags/application/runtime.test.ts, apps/api/src/modules/feature-flags/application/admin.test.ts, apps/api/src/modules/feature-flags/feature-flags.it.test.ts, apps/api/src/modules/audit/audit.it.test.ts, apps/api/test/api-flags.test.ts, apps/api/scripts/lib/flags-cli.test.ts, apps/api/test/security-cicd06.test.ts, apps/api/test/security-cicd06.it.test.ts, apps/api/test/security-cicd06-r2.test.ts, apps/api/test/main-wiring.test.ts, apps/api/test/flags-pool.it.test.ts, apps/api/test/security-cicd06-r3.test.ts, apps/api/test/security-cicd06-r4.test.ts, apps/api/test/security-cicd06-r4.it.test.ts

#. [PoC] Кожна нова функція виходить вимкненою прапорцем. Власник вмикає її: спочатку для тестових просторів, потім для частки просторів, потім для всіх.
#. [PoC] Кожен прапорець має власника і дату перегляду. Тимчасовий прапорець видаляється з коду не пізніше ніж через 30 днів після повного вмикання.
#. [PoC] Кожний модуль має аварійний вимикач (kill switch), що вимикає його в production за ≤ 1 хв без релізу; користувачі бачать стан «Тимчасово недоступно», а решта продукту працює.
