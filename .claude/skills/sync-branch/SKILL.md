---
name: sync-branch
description: Bring a Willowsum working branch up to date with origin/main by merging — conflicts resolved by understanding both sides, generated files regenerated, auto-merged hunks checked, checks run, merge commit message, reviewer confirmation. Use when a PR branch is behind main or conflicts with it.
---

# Sync a branch with main

**Створено:** 2026-11-12 · **Оновлено:** 2026-11-13

Up to 3 working branches exist at once (AGENTS.md, «Parallel branches»), so `main` moves under every PR.
Input: a working branch in its own worktree. Output: the branch containing `origin/main`, checks green, one
merge commit pushed, the reviewers' confirmation requested on the new head.

## 1. Merge

1. Work only in the branch's own worktree. Commit or stash your changes first. Scratchpad files (owner,
   2026-11-13): only under a prefix or subfolder unique to the PR and role (`pr153-sync/`), never a generic
   name like `body.md`.
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
3. Requirements: resolve conflicts **only in the sources** (`<module>/<ID>.md`). Keep both sides' lines with
   their release tags; where both changed the same line, merge the text and keep the tag that each side meant
   (a line `--move` retagged on one side and reworded on the other gets the new tag and the new text). In the
   «Перевіряється» lines take the **union** of both test lists (no duplicates, paths still existing), per
   tagged line.
4. Release views (`<ID>.<release key>.md`, line 2 «Згенеровано з …») are generated: **never hand-merge a
   view**. Take either side to clear the conflict, then regenerate them from the merged sources (section 3).
5. Tests are the spec: never weaken or delete a test to make the merge pass.
6. Decision log (owner, 2026-11-13): each decision is its own new file in `docs/decisions/log/`, so decision-log
   conflicts should no longer happen. Two branches that picked the same file name: rename yours with a numeric
   suffix (`-2`). A conflict in the archive `docs/decisions/state-2026-11-05.md` (an old branch appended to it):
   keep both sides' entries. A decision you record while syncing goes into a new file in `log/`.

## 3. Generated files

The release views are generated and committed. Never hand-merge them: take any side to clear the conflict,
then regenerate:

1. `node tools/req-check/index.mjs --views` (writes every view from its source; 0 errors);
2. `node tools/req-check/index.mjs --check-mentions` (no test names an item that no longer exists).

Do this after the sources (and their «Перевіряється» lines) are merged, and `git add` the regenerated views.
`docs/traceability/` and `docs/validation/req-check-report.md` are not committed (owner, 2026-11-13): an old
branch that still tracks them gets them removed in the merge (`git rm -r --cached docs/traceability
docs/validation/req-check-report.md`); CI generates them.
Also regenerate when git merged without a conflict but either side changed a source: a view merged by git
from two sides can differ from what the merged source generates (`view-stale`).

## 4. Look at the auto-merged hunks

A merge without conflicts can still be wrong: read every hunk of the files both sides changed and grep for the
old forms of anything `main` renamed or removed — [how, with a real example](references/auto-merged-hunks.md)
(read whenever both sides changed a file).

## 5. Check

Run the fast checks from the repository root:

- `pnpm typecheck`, `pnpm lint`, `pnpm test`;
- `node --test tools/req-check` (and `node --test tools/pr-rules` when the merge touched them).

Run the integration tests of the touched modules on your own test database, never one shared with another
worktree: `pnpm db:test run -- <command>`, e.g. `pnpm db:test run -- pnpm test:integration`. Without Docker,
point the tool at the machine's own PostgreSQL: `WS_TEST_PG_ADMIN_URL=postgres://postgres@127.0.0.1:5432/postgres`.
Exact usage: `infra/local/README.md`, «Test database per agent». Runs on one cluster queue; do not start two.

Run the local secret-shaped literal check before pushing (what the CI job `secrets` checks).

Servers, databases and background processes: only your slot's ports, your own `pnpm db:test` databases and
your own PIDs — [own ports](../../references/own-ports.md) (read when you start any of them).

## 6. Commit and push

1. Conclude the merge with `git commit` (not `--no-edit` when the branch's own code changed).
2. The message names what the merge changed **in the branch's own code**: files you edited to adapt to main,
   conflicts resolved and how, regenerated files. Example subject: `Merge origin/main into <branch>`; body:
   «reset link now /#/password/reset?token=…; req-check report regenerated». A merge that touched nothing of
   the branch's own code says so in one line.
3. End with the attribution lines the session gives; then a normal `git push` (never `--force`).

**Local PR checks before every push and body change** (owner, 2026-11-13):

```
git fetch origin main
node tools/pr-rules/index.mjs local --title "<the PR title>" --body-file <scratchpad>/pr<n>-<role>/body.md
```

Exit 0 required; tick «Sensitive areas touched» if it lists `sensitive`; record the owner decision if it lists
`owner-decision` — [details](../../references/local-pr-checks.md) (read when the output is unclear).
The body to check is the PR's current one (`gh api repos/{owner}/{repo}/pulls/<n> --jq .title,.body`):
the merge can change the files and so the labels and the «Sensitive areas touched» box it needs.

GitHub 502 / 503 / «token store unavailable» → [retry rules](../../references/github-errors.md) (read when it
happens: retry with backoff; check that a review, comment, issue or PR did not land before posting it again).


## 7. Reviewer confirmation

Every merge into a PR with a verdict needs a confirmation on the new head SHA (a tree comparison when the merge
only brought in files outside the PR; none for a docs-only PR that does not overlap `main`, owner 2026-11-13) —
[what to ask for](references/confirmation.md) (read after every merge).

Report to the lead in 10–15 lines, no narrative (owner, 2026-11-13): PR, the new head SHA (full), result (what
the merge changed in the branch's code, checks), blockers, owner questions. Details go in the merge commit
message or the PR body.
