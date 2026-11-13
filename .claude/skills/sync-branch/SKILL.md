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

**Own ports, databases and processes** (owner, 2026-11-13): up to 3–4 agents run at once, so the lead gives you
a slot `k` (1–4; none given → ask, or use 4). Use only your slot: the web dev server
`pnpm --filter @willowsum/web exec vite --port 517k --strictPort` (5171–5174; preview `--port 417k`), the API with
`WS_PORT=808k`, and `WS_API_ORIGIN=http://localhost:808k` for the web proxy. Test databases only through
`pnpm db:test` from your own worktree: their names carry your branch (`ws_t_<branch>_<random>`; `HEAD` in a
detached worktree, shared with other reviewers); record the names it prints and drop only those. Start a server in the background and record its PID (`echo $! >> <scratchpad>/pr<n>-<role>/pids`); stop only
your own PIDs (`kill $(cat <scratchpad>/pr<n>-<role>/pids)`), never `pkill`, `killall`, a kill by port or process
name, or `pnpm local:down` (it stops the shared environment). `pnpm test:e2e` picks free ports by itself.

## 6. Commit and push

1. Conclude the merge with `git commit` (not `--no-edit` when the branch's own code changed).
2. The message names what the merge changed **in the branch's own code**: files you edited to adapt to main,
   conflicts resolved and how, regenerated files. Example subject: `Merge origin/main into <branch>`; body:
   «reset link now /#/password/reset?token=…; req-check report regenerated». A merge that touched nothing of
   the branch's own code says so in one line.
3. End with the attribution lines the session gives; then a normal `git push` (never `--force`).

**Local PR checks before every push and body change** (owner, 2026-11-13): before `git push`, opening the
PR or PATCHing its body, write the body to your own scratchpad file and run, from the worktree root:

```
git fetch origin main
node tools/pr-rules/index.mjs local --title "<the PR title>" --body-file <scratchpad>/pr<n>-sync/body.md
```

It runs, offline, what the CI job `traceability` (description) and the label job check, on
`git diff origin/main...HEAD`: the title's requirement ID, the template sections, and the labels CI will set.
Fix every `ERROR` line first (exit code 0 is required). When it lists `sensitive` labels, tick «Sensitive areas
touched»; when it lists `owner-decision`, the body must record the owner decision the PR implements.
The body to check is the PR's current one (`gh api repos/{owner}/{repo}/pulls/<n> --jq .title,.body`):
the merge can change the files and so the labels and the «Sensitive areas touched» box it needs.

**GitHub errors** (owner, 2026-11-13): on HTTP 502 or 503, or «token store unavailable», retry with backoff
(wait about 10 s, 30 s, then 90 s; at most 3 retries), then report the failure instead of looping. Before
retrying a call that is not idempotent — posting a review, a comment or an issue, opening a PR — check whether
the first attempt landed: list the PR's reviews (`gh api repos/{owner}/{repo}/pulls/<n>/reviews`), its comments
(`gh api repos/{owner}/{repo}/issues/<n>/comments`), the issues (`gh api 'repos/{owner}/{repo}/issues?state=open&creator=<you>'`)
or the open PRs of the branch (`gh api 'repos/{owner}/{repo}/pulls?head=<owner>:<branch>'`) and look for your text
or head SHA; post again only when it is not there. A PATCH of a PR body, adding labels and `git push` (never
`--force`) are idempotent: retry them as they are.


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
  before and after), and that the merge's tree equals a clean merge
  (the first output line of `git merge-tree --write-tree HEAD^1 HEAD^2` = `git rev-parse HEAD^{tree}`;
  `review-pr` «6. Confirmation rounds»). Give the reviewers both SHAs.

Report to the lead in 10–15 lines, no narrative (owner, 2026-11-13): PR, the new head SHA (full), result (what
the merge changed in the branch's code, checks), blockers, owner questions. Details go in the merge commit
message or the PR body.
