---
name: fix-review-findings
description: Apply the findings of the review-pr and security-review reviews to a Willowsum PR — reviewer tests first, then their patches, one fix commit, updated PR body, head SHA reported. Use when the lead asks the implementing agent to fix review findings on its PR.
---

# Fix review findings

**Створено:** 2026-11-12 · **Оновлено:** 2026-11-14

Input: a PR number, the review IDs to address (usually the latest `review-pr` and, for a `sensitive` PR, the
latest `security-review`), and the lead's decisions where reviewers disagree. Output: one pushed fix commit that
fixes every blocking item, CI green, the new head SHA.

## 1. Load

1. `git pull --ff-only` on the PR branch (in its worktree); stop on a conflict with `main` and rebase only if
   the lead asks.
2. Read each review **in full** — the summary shown in lists is cut:
   `gh api repos/{owner}/{repo}/pulls/<n>/reviews/<id> --jq .body`.
3. Read the reviewers' output files (scratchpad paths named in the review), with their
   `// ===== FILE: <repo path> =====` headers.

## 2. Apply, tests first

1. Add the reviewers' tests to the named repository paths first. Run them: `it.fails` tests pass while the
   defect exists; a plain test fails.
2. Apply the reviewers' patches (or write the fix yourself when only the failing path is given).
3. Flip each `it.fails` to `it` once its fix is in, and run it: it must pass.
4. Two reviewers' patches conflict → apply the lead's decision from the request; no decision → ask the lead,
   do not pick one yourself. On a lighter model applying ready patches (owner, 2026-11-14, #178): if a patch
   cannot be applied as given (it fails, deadlocks or needs a different design, as in #191), stop and report to
   the lead; the fix then moves to the strong model. Do not improvise.
5. Never weaken, skip or delete a test to get green (AGENTS.md step 6); never edit an acceptance test unless
   the requirement changed. A test that fails only sometimes needs a root cause, never «load», «flake» or
   «timeout under load» (owner, 2026-11-13): reproduce it, compare with `main`, find the cause (#146: a shared
   `test/.tmp` race), or list it under Follow-ups in the PR body / report with the evidence; the lead opens the issue. Never skip, quarantine or raise a
   timeout without a stated basis.
6. Requirement text: a finding or patch against a release view (`<ID>.<release key>.md`, line 2 «Згенеровано
   з …») is applied to the source `<ID>.md` instead — the same line, with the release tag that limits it to the
   releases the finding names — and then `node tools/req-check/index.mjs --views` regenerates the views. Never
   patch a view. A moved item goes through `--move` (`change-requirement`), and its warnings are handled in the
   same commit. New tests go into «Перевіряється» of the source.

## 3. Non-blocking

Do not fix non-blocking items in this commit unless they are one-line and safe. List each under «Follow-ups»
in the PR body / report; the lead opens the issue.

A decision this round records (the lead's choice between patches, a small detail) goes into a **new file**
`docs/decisions/log/YYYY-MM-DD-<short-slug>.md` (a numeric suffix if the name is taken; owner, 2026-11-13),
worded as before; never append to the archive `docs/decisions/state-2026-11-05.md`.

## 4. Check

Before tests (owner, 2026-11-14, #178): `pg_lsclusters`; if the cluster is down, `pg_ctlcluster 16 main start` (the environment's setup script does not run when a container restarts).
Run what the changed code needs: `pnpm typecheck` (the same command as the CI job `web`, every tsconfig
included; run it as `cd <worktree> && pnpm typecheck`, #184; owner, 2026-11-14), `pnpm lint`, `pnpm test`; integration tests as
`pnpm db:test run -- pnpm test:integration` when the database is involved (one run per cluster at a time;
without Docker, as in cloud sessions, give the admin URL:
`WS_TEST_PG_ADMIN_URL=postgres://postgres@127.0.0.1:5432/postgres pnpm db:test run -- pnpm test:integration`);
`node --test tools/pr-rules` / `tools/req-check` when those changed; when requirements, «Перевіряється» or
`tools/req-check` changed, also `node tools/req-check/index.mjs --views` and `node tools/req-check/index.mjs --check-mentions` (0 errors,
regenerated views committed; the traceability files and the req-check report are not committed, CI generates
them); the local secret-shaped literal check.

Servers, databases and background processes: only your slot's ports, your own `pnpm db:test` databases and
your own PIDs — [own ports](../../references/own-ports.md) (read when you start any of them).


## 5. Push and report

Scratchpad files (owner, 2026-11-13): only under a prefix or subfolder unique to the PR and role
(`pr153-fix/`), never a generic name like `body.md` (two PR bodies were overwritten with
another agent's text).

**Local PR checks before every push and body change** (owner, 2026-11-13):

```
git fetch origin main
node tools/pr-rules/index.mjs local --title "<the PR title>" --body-file <scratchpad>/pr<n>-<role>/body.md
```

Exit 0 required; tick «Sensitive areas touched» if it lists `sensitive`; record the owner decision if it lists
`owner-decision` — [details](../../references/local-pr-checks.md) (read when the output is unclear).

GitHub 502 / 503 / «token store unavailable» → [retry rules](../../references/github-errors.md) (read when it
happens: retry with backoff; check that a review, comment, issue or PR did not land before posting it again).

1. Update the PR body (from a file: first check that it is the one you wrote for this PR): the criteria →
   tests table if tests were added, «Follow-ups».
2. One fix commit for the round (`<ID>: address review round <n>`), with the attribution lines the session gives,
   plus a separate sync merge commit when the branch is behind `main` (pr-pipeline step 4); WIP commits made during
   the round are fine (pr-pipeline step 2); push. Committing and pushing to the PR's own branch is part of the task, no separate owner approval (owner,
   2026-11-13, #178: «дозволяю»); if the permission classifier still refuses, stop and report it to the lead.
3. Report to the lead in 10–15 lines, no narrative (owner, 2026-11-13): PR, new head SHA (full), result (each
   blocking item → fixed by file / test, in one line each), blockers, owner questions. Follow-ups and check
   details go in the PR body. The reviewers then re-review only this diff.
