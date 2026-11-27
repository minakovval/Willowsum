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

1. Локальне середовище. Призначення: розробка агентами і людьми; піднімається однією командою (контейнери БД, пошти і сховища). Дані: синтетичні. Як оновлюється: вручну.
2. Середовище CI. Призначення: тимчасове середовище на час конвеєра. Дані: синтетичні. Як оновлюється: на кожен PR.
3. Середовище production. Призначення: реальні користувачі: у цьому релізі лише родина власника продукту; екземпляр розгортається лише локально, на комп'ютері власника. Дані: реальні. Як оновлюється: лише за схваленням власника.
4. Тимчасове середовище форми production. Призначення: навантажувальні тести і репетиції переходу; знищується після тесту. Дані: синтетичні. Як оновлюється: за запитом.
5. У цьому релізі розгорнуте середовище одне — production; окремого середовища staging немає, перевірки перед production виконуються в CI і на тимчасовому середовищі форми production.
6. Реальні дані користувачів — лише в production. Жодне інше середовище не отримує реальних даних. Решта середовищ має окремі секрети, ключі та домени.
