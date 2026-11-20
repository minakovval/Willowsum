# Рішення ведучого: `pnpm typecheck` після `contract:check` на main

**Створено:** 2026-11-20

Рішення ведучого (2026-11-20; власник не схвалював): у workflow «Contract check on main» (`.github/workflows/main-contract-check.yml`)
після `pnpm contract:check` додано крок `pnpm typecheck`. Причина: рев'ю безпеки #662 (5995480792) показало, що PR без змін контракту
може використовувати типізований клієнт і потрапити в `main` без синку після зміни `schema.ts` в іншому PR; контракт лишається
узгодженим, але `main` не компілюється, а typecheck на `main` не йде ніде. Вартість: близько 30 с на злиття
(`.claude/references/ci-minutes.md` оновлено). Права й секрети не змінено (`contents: read`, без секретів).

Питання власнику: підтвердити крок або прибрати його (тоді повернути лише рядок у `merge-checklist.md` і `ci-minutes.md`).
