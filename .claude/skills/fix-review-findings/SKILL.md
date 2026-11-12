---
name: fix-review-findings
description: Apply the findings of the review-pr and security-review reviews to a Willowsum PR — reviewer tests first, then their patches, one commit, updated PR body, head SHA reported. Use when the lead asks the implementing agent to fix review findings on its PR.
---

# Fix review findings

**Створено:** 2026-11-12 · **Оновлено:** 2026-11-12

Input: a PR number, the review IDs to address (usually the latest `review-pr` and, for a `sensitive` PR, the
latest `security-review`), and the lead's decisions where reviewers disagree. Output: one pushed commit that
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
   do not pick one yourself.
5. Never weaken, skip or delete a test to get green (AGENTS.md step 6); never edit an acceptance test unless
   the requirement changed.

## 3. Non-blocking

Do not fix non-blocking items in this commit unless they are one-line and safe. List each under «Follow-ups»
in the PR body (or open an issue and link it).

## 4. Check

Run what the changed code needs: `pnpm typecheck`, `pnpm lint`, `pnpm test`; integration tests as
`pnpm db:test run -- pnpm test:integration` when the database is involved (one run per cluster at a time;
without Docker, as in cloud sessions, give the admin URL:
`WS_TEST_PG_ADMIN_URL=postgres://postgres@127.0.0.1:5432/postgres pnpm db:test run -- pnpm test:integration`);
`node --test tools/pr-rules` / `tools/req-check` when those changed; the local secret-shaped literal check.

## 5. Push and report

1. Update the PR body: the criteria → tests table if tests were added, «Follow-ups».
2. One commit for the round (`<ID>: address review round <n>`), with the attribution lines the session gives;
   push.
3. Report to the lead in a few lines: new head SHA (full), each blocking item → fixed by (file / test),
   follow-ups listed, checks run. The reviewers then re-review only this diff.
