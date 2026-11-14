# Рішення 2026-11-14: навантажувальні проби — лише через `pnpm db:test run`

**Створено:** 2026-11-14 · **Оновлено:** 2026-11-14

- Рішення ведучого (2026-11-14; власник не схвалював; #226): повторні й навантажувальні запуски інтеграційних тестів
  (пошук нестабільного тесту, проби на тисячах рядків) — лише як `pnpm db:test run -- …`, кожен на власній базі й під
  блокуванням кластера; проба на 20 000 рядків у базі, створеній вручну поза `pnpm db:test run`, вичерпала спільну
  для всього кластера таблицю блокувань (`out of shared memory`, `max_locks_per_transaction`), і впав чужий тест
  `arc11-balance-cache` (#226, корінна причина 2; `infra/local/README.md`).
- Де записано: `.claude/skills/pr-pipeline/SKILL.md` §3 («Parallel branches») і
  `.claude/skills/investigate-ci-failure/SKILL.md` §2 п. 3. Пропозиція 4 ретроспективи ведучого 4
  ([#180, коментар 6883180207](https://github.com/minakovval/Willowsum/issues/180#issuecomment-6883180207)) називає
  ще `review-pr` і `security-review`; їх тут не змінено.
