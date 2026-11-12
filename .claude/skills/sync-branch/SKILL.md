---
name: sync-branch
description: Bring a Willowsum working branch up to date with origin/main by merging — conflicts resolved by understanding both sides, generated files regenerated, auto-merged hunks checked, checks run, merge commit message, reviewer confirmation. Use when a PR branch is behind main or conflicts with it.
---

# Sync a branch with main

**Створено:** 2026-11-12 · **Оновлено:** 2026-11-12

Up to 3 working branches exist at once (AGENTS.md, «Parallel branches»), so `main` moves under every PR.
Input: a working branch in its own worktree. Output: the branch containing `origin/main`, checks green, one
merge commit pushed, the reviewers' confirmation requested on the new head.

## 1. Merge

1. Work only in the branch's own worktree. Commit or stash your changes first.
2. `git fetch origin main`, then `git merge origin/main`.
3. **Never rebase, never force-push.** Rebasing rewrites the commits the reviews name by SHA and forces a
   full re-review; a force-push does the same to published history (AGENTS.md step 7 ties every verdict to the exact head SHA).
   If the merge goes wrong: `git merge --abort`, then start again; do not reset published commits.

## 2. Conflicts

1. Read both sides before editing: `git log origin/main --not HEAD -- <file>` and `git diff HEAD...origin/main -- <file>`
   show what main changed and why. Keep the intent of both; never take «ours» or «theirs» wholesale to make a
   conflict go away.
2. A conflict between the branch and a requirement or rule that main changed is not yours to settle by
   guessing: follow AGENTS.md «Ambiguity» (real product question → stop and write it in the PR body for the
   owner).
3. In `docs/requirements` the «Перевіряється» lines: take the **union** of both test lists (no duplicates, paths
   still existing).
4. Tests are the spec: never weaken or delete a test to make the merge pass.

## 3. Generated files

`docs/traceability/` and `docs/validation/req-check-report.md` are generated. Never hand-merge them: take any
side to clear the conflict, then regenerate:

`node tools/req-check/index.mjs --report docs/validation/req-check-report.md --traceability` (0 errors).

Do this after the «Перевіряється» lines are merged, and `git add` the regenerated files.

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

## 5. Check

Run the fast checks from the repository root:

- `pnpm typecheck`, `pnpm lint`, `pnpm test`;
- `node --test tools/req-check` (and `node --test tools/pr-rules` when the merge touched them).

Run the integration tests of the touched modules on your own test database, never one shared with another
worktree: `pnpm db:test run -- <command>`, e.g. `pnpm db:test run -- pnpm test:integration`. Without Docker,
point the tool at the machine's own PostgreSQL: `WS_TEST_PG_ADMIN_URL=postgres://postgres@127.0.0.1:5432/postgres`.
Exact usage: `infra/local/README.md`, «Test database per agent». Runs on one cluster queue; do not start two.

Run the local secret-shaped literal check before pushing (what the CI job `secrets` checks).

## 6. Commit and push

1. Conclude the merge with `git commit` (not `--no-edit` when the branch's own code changed).
2. The message names what the merge changed **in the branch's own code**: files you edited to adapt to main,
   conflicts resolved and how, regenerated files. Example subject: `Merge origin/main into <branch>`; body:
   «reset link now /#/password/reset?token=…; req-check report regenerated». A merge that touched nothing of
   the branch's own code says so in one line.
3. End with the attribution lines the session gives; then a normal `git push` (never `--force`).

## 7. Reviewer confirmation

AGENTS.md step 7: «any later commit, even a small fix, needs a re-review of that fix»; the verdict must
name the PR head. It makes no exception for merge commits, so **every** merge into a PR that has a reviewer
verdict needs a confirmation on the new head SHA:

- the merge changed reviewed code of the PR (conflicts, adaptations, auto-merged files both sides touched) →
  ask the reviewers (a fresh agent, narrow brief: the merge commit's diff against the previous head restricted
  to the branch's own files, plus their previous findings) for a short confirmation with a verdict line that
  names the new head; a `sensitive` PR also needs the security reviewer's;
- the merge only brought in files outside the PR → the confirmation is still required, but it is a
  one-line check that the PR's own diff against `main` is unchanged (`git diff origin/main...HEAD --stat`
  before and after).

Report to the lead: the new head SHA (full), what the merge changed in the branch's code, checks run.
