# Рішення 2026-11-14: `pnpm typecheck` ловить те саме, що CI; тести `tools/token-report` у CI

**Створено:** 2026-11-14 · **Оновлено:** 2026-11-14

- Рішення власника (2026-11-14): схвалено окремий PR `sensitive:pipeline`, щоб `pnpm typecheck` ловив те саме, що
  CI (у #184 CI впав на `tsc -p apps/api/tsconfig.json`, а локальна перевірка пройшла), з рецензією безпеки; доти
  брифи вимагали запускати `tsc` напряму. Джерело:
  [#178, коментар 2026-11-14 07:47 UTC](https://github.com/minakovval/Willowsum/issues/178#issuecomment-6874057255), пункт «`pnpm typecheck`».
- Що з'ясовано: CI (джоб `web`) уже запускає саме `pnpm typecheck`, і скрипт кожного пакета покриває всі його
  tsconfig разом із тестами. На коміті #184 `e0d0e51` у чистому worktree `pnpm typecheck` падає з тими самими двома
  помилками, що й CI. Отже, команди не розходилися; локальна «зелена» перевірка була запущена не на тому дереві
  (найімовірніше — оболонка агента стартує в основному checkout, а не у worktree).
- Що змінено: у скілах `implement-requirement`, `fix-review-findings`, `pr-pipeline` правило «`tsc -p` напряму»
  замінено на `pnpm typecheck`, запущений у своєму worktree (`cd <worktree> && pnpm typecheck`). Новий тест
  `tools/pr-rules/test/typecheck-scripts.test.mjs` не дає командам розійтися: кореневий `typecheck` —
  `pnpm -r run typecheck`; кожен пакет workspace з `tsconfig.json` запускає `tsc -p` для кожного свого tsconfig;
  кожен tsconfig належить пакету workspace; жоден workflow не запускає `tsc` сам. CI-джоб `requirements` запускає
  тести `tools/token-report` (#196, остання позиція).
- Пункти #196 про `tools/token-report` (нуль без `log=`, відсутній журнал, порожнє вікно) і про тексти скілів
  («as one comment», джерело «30–90 разів») уже виконано в #197; тут лише перевірено.
