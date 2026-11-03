# L10N — module requirements

Scope: Localisation framework and translations. Source: tab 6 of the Willowsum product specification.

## Module intro (from the specification tab)

Модуль описує досвід користувача Willowsum: онбординг, рівні складності й режим «Тільки бюджет», навігацію, головний екран, приховування сум, командний рядок, персоналізацію, підсумки, навчання, мобільні віджети й інші платформи, сітку інтерфейсу та шаблони всіх сторінок, локалізацію, а також юридичні документи, згоду й налаштування приватності в застосунку.

Shared text of this tab (title, intro, common sections) is kept in [../ux/README.md](../ux/README.md).

## Requirements

| ID | Title | Release | Priority |
| --- | --- | --- | --- |
| [L10N-01](L10N-01.md) | Каркас локалізації: реєстр мов, RTL, формати, мова з браузера і профілю | MVP; основа в архітектурі й моделі даних — PoC (усі тексти в каталозі рядків, формати сум і дат — через локаль; у PoC одна мова) | M |
| [L10N-02](L10N-02.md) | Переклади хвилі 1 і людська перевірка юридичних і платіжних текстів | MVP | M |
