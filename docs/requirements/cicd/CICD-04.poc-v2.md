# CICD-04@PoC v2 · Середовища
> Згенеровано з [CICD-04.md](CICD-04.md) командою `node tools/req-check/index.mjs --views`. Не редагувати: змінюйте джерело.

**Реліз:** PoC v2 · **Пріоритет:** M

**Зв'язки**
- Розширює: CICD-04@PoC
- Залежить від: —
- Дизайн: —
- Спільні правила: П-9
- Сценарії: —
- Модуль: —
- Перевіряється: tools/local-env/test/compose.test.mjs, tools/local-env/test/state.test.mjs, tools/local-env/test/info.test.mjs, tools/local-env/test/backup.test.mjs, tools/local-env/test/smoke.it.mjs, apps/api/scripts/lib/local-dev.test.ts, apps/api/scripts/lib/local-dev-macos.test.ts, apps/api/scripts/lib/local-dev.security.test.ts, apps/api/test/local-dev.it.test.ts, tools/local-env/test/s3.test.mjs, apps/api/src/platform/adapters/object-storage/directory.test.ts

| Середовище | Призначення | Дані | Як оновлюється |
| --- | --- | --- | --- |
| Локальне | Розробка агентами і людьми; піднімається однією командою (контейнери БД, пошти і сховища) | Синтетичні | Вручну |
| CI | Тимчасове середовище на час конвеєра | Синтетичні | На кожен PR |
| Production | Реальні користувачі: у цьому релізі лише родина власника продукту; екземпляр розгортається лише локально, на комп'ютері власника | Реальні | Лише за схваленням власника |
| Тимчасове середовище форми production | Навантажувальні тести і репетиції переходу; знищується після тесту | Синтетичні | За запитом |

У цьому релізі розгорнуте середовище одне — production; окремого середовища staging немає, перевірки перед production виконуються в CI і на тимчасовому середовищі форми production.
Реальні дані користувачів — лише в production. Жодне інше середовище не отримує реальних даних. Решта середовищ має окремі секрети, ключі та домени.
