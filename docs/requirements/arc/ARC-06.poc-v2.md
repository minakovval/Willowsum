# ARC-06@PoC v2 · Ключі, секрети, файли
> Згенеровано з [ARC-06.md](ARC-06.md) командою `node tools/req-check/index.mjs --views`. Не редагувати: змінюйте джерело.

**Реліз:** PoC v2 · **Пріоритет:** M

**Зв'язки**
- Розширює: ARC-06@PoC
- Залежить від: ARC-05@PoC
- Дизайн: —
- Спільні правила: П-24, NFR-01
- Сценарії: —
- Модуль: —
- Перевіряється: apps/api/src/platform/adapters/kms/kms.test.ts, apps/api/src/platform/adapters/kms/sec141-deployed.test.ts, apps/api/src/modules/household/space-keys.it.test.ts, apps/api/src/modules/household/sec141-space-keys.it.test.ts, tools/infra-check/test/start.test.mjs, apps/api/src/modules/file-storage/adapters/inspection/inspect.test.ts, apps/api/src/modules/file-storage/adapters/isolation/run.test.ts, apps/api/src/modules/file-storage/application/upload-budget.test.ts, apps/api/src/modules/file-storage/file-storage.it.test.ts, apps/api/src/modules/file-storage/file-storage.s3.test.ts, apps/api/src/platform/http/upload.test.ts, apps/api/test/imp01-import-batches.it.test.ts, apps/api/src/modules/file-parsers/adapters/isolation/sec619-parse-result-bound.test.ts, apps/api/src/platform/process/sec619-isolated-message.test.ts, apps/api/src/modules/household/arc06-field-opener.it.test.ts, apps/api/src/modules/file-parsers/adapters/isolation/sec630-opener-paths.test.ts

1. Конвертне шифрування: кожен простір має власний ключ даних (AES-256-GCM), обгорнутий головним ключем. Доступ до головного ключа — лише через порт KMS (адаптер `key-management`). PoC і PoC v2 розгортаються лише локально (рішення власника 2026-11-16): головний ключ дає локальний адаптер KMS, а справжній адаптер керованого KMS хмари хостингу (OCI Vault) — з MVP.
2. Поля з особливо чутливими даними (IBAN, номери полісів) шифруються окремо ключем простору. Токен провайдера зберігається в БД, зашифрований окремим ключем підключення (AES-256-GCM), обгорнутим ключем простору; головний ключ — лише через порт KMS. Токен лише записується: API його не повертає, у формі видно тільки останні 4 символи. Заміна токена і відключення одразу знищують ключ підключення (крипто-видалення, включно з копіями). Для monobank діалог відключення пояснює, як відкликати токен у кабінеті monobank.
3. Секрети не зберігаються в репозиторії, образах, логах і документації. Ротація головного ключа — щонайменше раз на рік, без простою (переобгортання ключів просторів у фоні).
4. Файли користувачів зберігаються в S3-сумісному сховищі зашифрованими ключем простору; доступ — лише через підписані посилання із коротким строком. Перед доступністю файл перевіряє антивірус.
5. Видалення простору знищує його ключ; дані зникають із резервних копій із їхньою ротацією (≤ 35 днів).

| Критерій | Поріг | Перевірка |
| --- | --- | --- |
| Секрети в історії git і образах | 0 | Сканер секретів на кожному PR і щотижня по всій історії |
| Файл, доступний без підписаного посилання | 0 | Інтеграційний тест у CI на локальному S3-сумісному сховищі: анонімний запит (список і об'єкт) отримує відмову |
| Ротація головного ключа | Без простою, раз на рік | Тест переобгортання ключів просторів із тестовим адаптером KMS у CI |
