---
name: fix-review-findings
description: Apply the findings of the review-pr and security-review reviews to a Willowsum PR — reviewer tests first, then their patches, one commit, updated PR body, head SHA reported. Use when the lead asks the implementing agent to fix review findings on its PR.
---

# Fix review findings

**Створено:** 2026-11-12 · **Оновлено:** 2026-11-13

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
   the requirement changed. A test that fails only sometimes needs a root cause, never «load», «flake» or
   «timeout under load» (owner, 2026-11-13): reproduce it, compare with `main`, find the cause (#146: a shared
   `test/.tmp` race), or file a separately tracked issue with the evidence. Never skip, quarantine or raise a
   timeout without a stated basis.
6. Requirement text: a finding or patch against a release view (`<ID>.<release key>.md`, line 2 «Згенеровано
   з …») is applied to the source `<ID>.md` instead — the same line, with the release tag that limits it to the
   releases the finding names — and then `node tools/req-check/index.mjs --views` regenerates the views. Never
   patch a view. A moved item goes through `--move` (`change-requirement`), and its warnings are handled in the
   same commit. New tests go into «Перевіряється» of the source.

## 3. Non-blocking

Do not fix non-blocking items in this commit unless they are one-line and safe. List each under «Follow-ups»
in the PR body (or open an issue and link it).

A decision this round records (the lead's choice between patches, a small detail) goes into a **new file**
`docs/decisions/log/YYYY-MM-DD-<short-slug>.md` (a numeric suffix if the name is taken; owner, 2026-11-13),
worded as before; never append to the archive `docs/decisions/state-2026-11-05.md`.

## 4. Check

Run what the changed code needs: `pnpm typecheck`, `pnpm lint`, `pnpm test`; integration tests as
`pnpm db:test run -- pnpm test:integration` when the database is involved (one run per cluster at a time;
without Docker, as in cloud sessions, give the admin URL:
`WS_TEST_PG_ADMIN_URL=postgres://postgres@127.0.0.1:5432/postgres pnpm db:test run -- pnpm test:integration`);
`node --test tools/pr-rules` / `tools/req-check` when those changed; when requirements, «Перевіряється» or
`tools/req-check` changed, also `node tools/req-check/index.mjs --views` and `node tools/req-check/index.mjs --check-mentions` (0 errors,
regenerated views committed; the traceability files and the req-check report are not committed, CI generates
them); the local secret-shaped literal check.

**Own ports, databases and processes** (owner, 2026-11-13): up to 3–4 agents run at once, so the lead gives you
a slot `k` (1–4; none given → ask, or use 4). Use only your slot: the web dev server
`pnpm --filter @willowsum/web exec vite --port 517k --strictPort` (5171–5174; preview `--port 417k`), the API with
`WS_PORT=808k`, and `WS_API_ORIGIN=http://localhost:808k` for the web proxy. Test databases only through
`pnpm db:test` from your own worktree: their names carry your branch (`ws_t_<branch>_<random>`; `HEAD` in a
detached worktree, shared with other reviewers); record the names it prints and drop only those. Start a server in the background and record its PID (`echo $! >> <scratchpad>/pr<n>-<role>/pids`); stop only
your own PIDs (`kill $(cat <scratchpad>/pr<n>-<role>/pids)`), never `pkill`, `killall`, a kill by port or process
name, or `pnpm local:down` (it stops the shared environment). `pnpm test:e2e` picks free ports by itself.


## 5. Push and report

Scratchpad files (owner, 2026-11-13): only under a prefix or subfolder unique to the PR and role
(`pr153-fix/`), never a generic name like `body.md` (two PR bodies were overwritten with
another agent's text).

**Local PR checks before every push and body change** (owner, 2026-11-13): before `git push`, opening the
PR or PATCHing its body, write the body to your own scratchpad file and run, from the worktree root:

```
git fetch origin main
node tools/pr-rules/index.mjs local --title "<the PR title>" --body-file <scratchpad>/pr<n>-fix/body.md
```

It runs, offline, what the CI job `traceability` (description) and the label job check, on
`git diff origin/main...HEAD`: the title's requirement ID, the template sections, and the labels CI will set.
Fix every `ERROR` line first (exit code 0 is required). When it lists `sensitive` labels, tick «Sensitive areas
touched»; when it lists `owner-decision`, the body must record the owner decision the PR implements.

**GitHub errors** (owner, 2026-11-13): on HTTP 502 or 503, or «token store unavailable», retry with backoff
(wait about 10 s, 30 s, then 90 s; at most 3 retries), then report the failure instead of looping. Before
retrying a call that is not idempotent — posting a review, a comment or an issue, opening a PR — check whether
the first attempt landed: list the PR's reviews (`gh api repos/{owner}/{repo}/pulls/<n>/reviews`), its comments
(`gh api repos/{owner}/{repo}/issues/<n>/comments`), the issues (`gh api 'repos/{owner}/{repo}/issues?state=open&creator=<you>'`)
or the open PRs of the branch (`gh api 'repos/{owner}/{repo}/pulls?head=<owner>:<branch>'`) and look for your text
or head SHA; post again only when it is not there. A PATCH of a PR body, adding labels and `git push` (never
`--force`) are idempotent: retry them as they are.

1. Update the PR body (from a file: first check that it is the one you wrote for this PR): the criteria →
   tests table if tests were added, «Follow-ups».
2. One commit for the round (`<ID>: address review round <n>`), with the attribution lines the session gives;
   push.
3. Report to the lead in 10–15 lines, no narrative (owner, 2026-11-13): PR, new head SHA (full), result (each
   blocking item → fixed by file / test, in one line each), blockers, owner questions. Follow-ups and check
   details go in the PR body. The reviewers then re-review only this diff.
