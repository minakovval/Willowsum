# Артефакти Willowsum: покажчик і резервні знімки

**Створено:** 2026-11-05 · **Оновлено:** 2026-11-05

Рішення власника 2026-11-05: «вся ця інформація і артефакти мають бути доступні з інших сесій раптом
що». Тут перелічено всі артефакти проєкту поза репозиторієм, а для головних — де лежить їхній знімок
у репозиторії і як із нього відновитися.

> Знімки оновлюються вручну; дата знімка: 2026-11-05.
>
> Живий артефакт завжди новіший за знімок. Перед будь-якою публікацією спершу прочитайте живу версію
> (Artifact `read`); знімок потрібен лише тоді, коли живий артефакт недоступний або зламаний.

## Головні артефакти

| Артефакт | Посилання | Що це | Створено | Оновлено | Знімок у репозиторії |
| --- | --- | --- | --- | --- | --- |
| Канва «Willowsum · P0 оболонка і системні екрани» (тип Design) | https://claude.ai/artifact/EFfhV3a6L8TZCGtM1whfnR (те саме: https://claude.ai/code/artifact/6b531058-1f4c-4bfe-bac4-606d2391d6c2) | Макети всіх екранів PoC і MVP: оболонка, системні екрани, «Гроші», «Планування»; клікабельний прототип | 2026-11-02 (перша дизайн-сесія) | 2026-11-05 (версія `1793918556-0d97`) | `design/canvas/` — `canvas.json`, `ds/willowsum/tokens.json` і 308 дощок `*.dc.html` |
| Дизайн-система «Willowsum — дизайн-система (компоненти)» (тип Design System) | https://claude.ai/artifact/5vhCpxVe6hNG4Et65HEK8X (те саме: https://claude.ai/code/artifact/27e3c040-e930-438b-97b4-551785a95f84) | Токени, README системи, 77 карток компонентів (README і `preview.html`), обкладинка, знак | 2026-11-05 | 2026-11-05 (версія 15, `1793919625-34dc`) | `design/design-system/` |
| Документ «Willowsum — дизайн-система» (Claude Docs) | https://claude.ai/artifact/M5xuimL596iXYAXX3oWBgS | Текстовий опис дизайн-системи: джерела правди, основи, компоненти, графіки, сітки | 2026-11-05 | 2026-11-05 (ревізія 17) | `docs/design/design-system-doc.md` (експорт у Markdown) |
| Google-таблиця «Willowsum · релізи функцій» | https://docs.google.com/spreadsheets/d/1pH1VBozmZ4ORKSnyv1MqARa1H5sm7rZwVN-McDoSlEs (id `1pH1VBozmZ4ORKSnyv1MqARa1H5sm7rZwVN-McDoSlEs`) | Вимоги з релізами: ID, назва, опис, модуль, пріоритет, реліз, PoC, PoC v2, зрізи за релізами | 2026-11-03 | 2026-11-05 | Немає: таблиця будується з `docs/requirements/` і `docs/traceability/` |

## Інші артефакти Willowsum (без знімка)

Ранні документи вимог і процесу. Вимоги з них уже перенесено в `docs/requirements/` (єдине джерело
правди), тому знімків не робили.

| Артефакт | Посилання | Оновлено |
| --- | --- | --- |
| Willowsum — Специфікація вимог до продукту | https://claude.ai/artifact/3NDRu6kBbPBuomgvFbWUQ1 | 2026-10-26 |
| Willowsum: як будуємо | https://claude.ai/artifact/UAPBwn9wxh2VvKxh4B2mQc | 2026-11-01 |
| Willowsum — пропозиції за аналізом MyAssets | https://claude.ai/artifact/EUhpTKXVQRfex4hm6gMNdS | 2026-10-20 |

## Нотатки сесій 2026-11-05 у репозиторії

| Файл | Що це |
| --- | --- |
| `docs/validation/ds01-audit-area1-2026-11-05.md`, `-area2-`, `-area3-` | Аудит DS-01 (issue #32): однакові елементи з різною реалізацією, за трьома областями |
| `docs/validation/ds01-decisions-2026-11-05.md` | Рішення за аудитом DS-01 |
| `docs/decisions/state-2026-11-05.md` | Стан проєкту і журнал рішень власника на 2026-11-05 |
| `tools/design/` | Знімок допоміжних скриптів, якими збирали канву і дизайн-систему (див. його README) |

## Як відновитися зі знімка

Усі кроки — через інструмент Artifact. Спершу завжди прочитайте живу версію (`read` з `url`): якщо вона
є і ціла, відновлювати не треба; якщо в ній є новіші правки — злийте їх, а не перезаписуйте.

### Канва

1. Файли знімка відповідають опублікованим шляхам так: `design/canvas/<шлях>` → `project/<шлях>`
   (наприклад `design/canvas/canvas.json` → `project/canvas.json`).
2. Щоб відновити окремі дошки, опублікуйте їх у той самий артефакт: `publish` з `url` канви і `files`
   `{"project/<Дошка>.dc.html": "design/canvas/<Дошка>.dc.html"}`; разом із ними — `project/canvas.json`,
   якщо змінювався перелік або розташування дощок. Файли типу (`artifact-type/…`, `index.html`, `SKILL.md`,
   `support.js`) не публікуйте: вони належать типу Design і лишаються незмінними.
3. Якщо артефакт втрачено повністю: створіть новий артефакт типу Design (`quickstart` з `intent: "design"`
   або `publish` з `type_url` типу), потім опублікуйте всі файли знімка під `project/`.
   Одна публікація — не більше 255 файлів, тож дошки розбийте на дві публікації. Нове посилання впишіть
   у цей файл.

### Дизайн-система

1. Відповідність шляхів: `design/design-system/<шлях>` → `project/<шлях>` (`README.md`, `tokens.json`,
   `design-system.json`, `components/<Назва>/README.md` і `preview.html`, `components/index.d.ts`,
   `assets/Logos/README.md`).
2. Знак лежить у сховищі файлів артефакту, а не серед `project/`. Файли знімка й ідентифікатори з
   `design-system.json`:
   - `assets/Logos/mark-light.svg` — `23fe5adc8cd52239edb9429de35e2cef`
   - `assets/Logos/mark-dark.svg` — `36d313f9a9c99ed2ae379ac9c6884fa5`
   - `assets/Logos/mark-mono.svg` — `85b5fbf702ab71cad8332997785531f1`
   - `assets/Logos/app-icon.svg` — `11e2644fcd93bfa632b4e23ea2b9c506`

   Якщо файлів у сховищі немає, завантажте SVG знову (`publish` з `url`, `asset: true`, `file_paths`) і
   впишіть нові ідентифікатори в `assetGroups.Logos.files.*.blob` у `design-system.json` перед публікацією.
3. Якщо артефакт втрачено повністю: створіть новий артефакт типу Design System, опублікуйте всі файли
   знімка під `project/`, завантажте знак і оновіть ідентифікатори, як у кроці 2.

### Документ

1. Прочитайте документ інструментом Claude Docs (`read` з `ref {"object":"project","id":"M5xuimL596iXYAXX3oWBgS"}`).
2. Якщо його втрачено, створіть новий документ Claude Docs з текстом `docs/design/design-system-doc.md`
   і впишіть нове посилання сюди. Згадку автора експорт зберіг як текст («@Valentyn»).

### Таблиця релізів

Таблицю можна заповнити наново з `docs/requirements/` (картки і зрізи за релізами) та
`docs/traceability/release-*.md`; колонки перелічено вище і в `docs/decisions/state-2026-11-05.md`.

## Як оновити знімок

1. Створіть гілку і окремий git worktree від `origin/main`.
2. Прочитайте файли артефакту (`list` зі `scope: "files"`, потім `read` з `paths`, не більше 256 шляхів за
   виклик) у тимчасову теку і скопіюйте лише файли під `project/` у `design/canvas/` або
   `design/design-system/`. Знак — `read` з `path` = ідентифікатор файлу (по одному).
3. Оновіть у цьому файлі версії, дату знімка і «Оновлено»; відкрийте PR.
