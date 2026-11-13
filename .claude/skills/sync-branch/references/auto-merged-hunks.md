# Auto-merged hunks (full text with the example)

**Створено:** 2026-11-13 · **Оновлено:** 2026-11-13

Moved out of `sync-branch` SKILL.md without change (owner, 2026-11-13). Read when git merged files that both sides changed.

## 4. Look at the auto-merged hunks

Git merging without a conflict does not mean the result is right. Before committing:

1. List the files both sides changed: `git diff --name-only HEAD...origin/main` against your branch's own
   changed files (`git diff --name-only origin/main...HEAD`, taken before the merge); read every hunk of each
   file in both, and then the merged result (`git diff HEAD` on the staged merge).
2. Grep for the **old forms** of anything main renamed, moved or removed (routes, env variables, function and
   file names, config keys, copy) and for the new forms your branch must now use.
3. Real example: main moved the web to hash routes (`/#/…`) while the branch built a fragment link for the
   password reset; git merged both without a conflict and the link became `/#/password/reset#token=` with two
   `#`. Only reading the merged hunk (and grepping for `#/` next to `#token`) finds this.
